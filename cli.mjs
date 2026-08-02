#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, copyFileSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { get } from 'https';
import { execSync, spawnSync } from 'child_process';
import { createInterface } from 'readline/promises';

import { PACKAGE_ROOT, TEMPLATES_DIR } from './lib/paths.mjs';
import { computeFileHash } from './lib/hash.mjs';
import { readLockFile, writeLockFile } from './lib/lock.mjs';
import { cliGate } from './lib/gate.mjs';
import { cliHook } from './lib/hook.mjs';
import { cliPlatforms } from './lib/platforms.mjs';
import { runInit, resolvePlatforms } from './lib/init.mjs';
import { planSyncWithEphemeralLock, runSync } from './lib/sync.mjs';
import { decideLegacySyncMode, parseSyncPlatformList } from './lib/sync-options.mjs';
import { cliDiagram } from './lib/diagram.mjs';

const PKG = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf-8'));
const VERSION = PKG.version;

// ============================================================
// 共享工具函数
// ============================================================

function buildLockData(projectDir, rootDir) {
  const files = new Map();
  const walkRoot = rootDir || TEMPLATES_DIR;

  function walk(dir, base) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relPath = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(fullPath, relPath);
      } else {
        files.set(relPath, computeFileHash(fullPath));
      }
    }
  }

  walk(walkRoot, '');

  return {
    version: VERSION,
    synced_at: new Date().toISOString(),
    files,
  };
}

function compareVersions(a, b) {
  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const av = aParts[i] || 0;
    const bv = bParts[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

// ============================================================
// 日志输出函数
// ============================================================

function log(msg) {
  console.log(msg);
}

function warn(msg) {
  console.log(`\x1b[33m⚠️  ${msg}\x1b[0m`);
}

function success(msg) {
  console.log(`\x1b[32m✅ ${msg}\x1b[0m`);
}

function error(msg) {
  console.error(`\x1b[31m❌ ${msg}\x1b[0m`);
}

function copyDirRecursive(src, dest) {
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
  }
  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

async function askConfirm(question) {
  if (!process.stdin.isTTY) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(question + ' ');
    const trimmed = answer.trim().toLowerCase();
    return trimmed === '' || trimmed === 'y' || trimmed === 'yes';
  } catch {
    return false;
  } finally {
    rl.close();
  }
}

// ============================================================
// 命令实现 — init / sync / update（保持原有逻辑，Task 16/18 再拆）
// ============================================================

async function cmd_init(targetPath, rawArgs) {
  const cwd = process.cwd();
  const target = resolve(cwd, targetPath || '.');

  if (!existsSync(target)) {
    error(`目标路径不存在: ${target}`);
    process.exit(1);
  }

  const lockFile = join(target, 'specline', '.specline-lock.yaml');
  const forceMode = rawArgs.includes('--force') || rawArgs.includes('-f');
  const withShellGuard = rawArgs.includes('--with-shell-guard');

  let platformArg;
  for (let i = 0; i < rawArgs.length; i++) {
    if (rawArgs[i] !== '--platform') continue;
    const value = rawArgs[i + 1];
    if (value === undefined || value.startsWith('--')) {
      error('--platform 需要值；有效平台: cursor, claude, codex, opencode，或 all/none');
      process.exit(1);
    }
    platformArg = value;
    i++;
  }

  if (existsSync(lockFile) && !forceMode && !platformArg) {
    warn('Specline 已在此项目中初始化。使用 --force 强制覆盖，或使用 --platform 追加平台。');
    process.exit(0);
  }

  let platforms;
  try {
    platforms = await resolvePlatforms(process.stdin.isTTY, platformArg);
  } catch (err) {
    error(err.message);
    process.exit(1);
  }

  const result = runInit({
    target,
    platforms,
    withShellGuard,
    version: VERSION,
    force: forceMode,
  });

  if (result.appended && result.appended.length > 0) {
    success(`追加平台：${result.appended.join(', ')}。已有平台不受影响。`);
  } else {
    success('Specline 初始化完成');
  }
  log(`📁 文件: ${result.skills} skills, ${result.agents} agents, ${result.hooks} hooks`);
  if (result.platforms.length > 0) {
    log(`🌐 平台: ${result.platforms.join(', ')}`);
  } else {
    log('🌐 平台: 无（仅创建 specline/ 核心目录）');
  }

  log('');
  log('🚀 试试输入:');
  log('   /specline-pipeline "你的第一个需求"');
  log('   /specline-explore');

  process.exit(0);
}

function fetchLatestVersion() {
  return new Promise((resolve, reject) => {
    const req = get('https://registry.npmjs.org/specline/latest', (res) => {
      let body = '';
      if (res.statusCode !== 200) {
        reject(new Error('PARSE_ERROR'));
        return;
      }
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve(data.version || null);
        } catch {
          reject(new Error('PARSE_ERROR'));
        }
      });
    });
    req.setTimeout(10000);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('NETWORK_ERROR'));
    });
    req.on('error', () => {
      reject(new Error('NETWORK_ERROR'));
    });
  });
}

async function cmd_update() {
  let latest;
  try {
    latest = await fetchLatestVersion();
  } catch (err) {
    if (err.message === 'NETWORK_ERROR') {
      warn('无法检查更新：网络连接失败');
    } else {
      warn('无法解析版本信息');
    }
    process.exit(0);
  }

  if (latest === null) {
    warn('无法解析版本信息');
    process.exit(0);
  }

  if (compareVersions(VERSION, latest) >= 0) {
    success('已是最新版本 (v' + VERSION + ')');
    process.exit(0);
  }

  log('✨ 新版本可用: v' + latest + '（当前: v' + VERSION + '）');

  if (!process.stdin.isTTY) {
    log('在非交互环境中无法自动升级，请手动执行: npm install -g specline@latest');
    process.exit(0);
  }

  const proceed = await askConfirm('是否升级到 v' + latest + '？[Y/n]');
  if (!proceed) {
    log('已取消升级');
    process.exit(0);
  }

  log('正在升级 specline...');
  try {
    execSync('npm install -g specline@latest', { stdio: 'inherit' });
  } catch (err) {
    const stderr = (err.stderr || '').toString();
    if (stderr.includes('EACCES') || stderr.includes('permission denied')) {
      error('权限不足。请尝试：');
      log('  sudo npm install -g specline@latest');
      log('  或使用 Node 版本管理器（nvm / fnm / n）');
    } else {
      error('升级失败：' + (stderr || err.message));
    }
    process.exit(1);
  }

  success('已升级至 v' + latest);

  const cwd = process.cwd();
  const lockFile = join(cwd, 'specline', '.specline-lock.yaml');
  if (existsSync(lockFile)) {
    const doSync = await askConfirm('检测到 specline 项目，是否同步最新模板？[Y/n]');
    if (doSync) {
      log('正在同步模板文件...');
      try {
        const result = spawnSync('specline', ['sync'], { stdio: 'inherit' });
        if (result.status !== 0) {
          warn('模板同步失败（退出码: ' + result.status + '），请手动运行 specline sync');
        }
      } catch (err) {
        warn('无法运行 specline sync：' + err.message);
      }
    }
  }

  process.exit(0);
}

function cmd_sync({ dryRun, targetPath, platforms }) {
  const cwd = process.cwd();
  const target = resolve(cwd, targetPath || '.');

  const lockFile = join(target, 'specline', '.specline-lock.yaml');
  const oldMarker = join(target, '.specline-config.yaml');
  const legacyMode = decideLegacySyncMode({
    hasLock: existsSync(lockFile),
    hasLegacyMarker: existsSync(oldMarker),
    dryRun,
  });

  if (legacyMode === 'uninitialized') {
    error('未检测到 Specline 项目，请先运行 specline init');
    process.exit(1);
  }

  let ephemeralLockData;
  if (legacyMode === 'legacy-dry-run') {
    warn('检测到旧版项目；本次仅预览，实际同步时将自动迁移');
    ephemeralLockData = buildLockData(target, target);
  } else if (legacyMode === 'legacy-real') {
    warn('检测到旧版项目，正在自动迁移...');
    const lockData = buildLockData(target, target);
    writeLockFile(target, lockData);
    success('已从旧版项目迁移，生成了锁文件');
  }

  try {
    if (!ephemeralLockData) {
      const lockData = readLockFile(target);
      if (lockData && compareVersions(lockData.version, VERSION) > 0) {
        error('锁文件版本 (v' + lockData.version + ') 高于 CLI 版本 (v' + VERSION + ')，请先更新 CLI');
        process.exit(1);
      }
    }

    const result = ephemeralLockData
      ? planSyncWithEphemeralLock(target, ephemeralLockData, { platforms })
      : runSync(target, { dryRun, platforms });

    if (dryRun) {
      for (const item of result.plan) {
        if (item.type === 'UNCHANGED' || item.type === 'MODIFIED_ONLY') continue;
        const labels = {
          NEW: '➕ 新增',
          WILL_UPDATE: '🔄 更新',
          CONFLICT: '⚠️  冲突（将备份后覆盖）',
          UPSTREAM_REMOVED: '🗑️  上游移除',
        };
        const label = item.removalConflict
          ? '⚠️  冲突（UPSTREAM_REMOVED，保留本地修改）'
          : (labels[item.type] || item.type);
        log(label + '  ' + item.path);
      }
      const s = result.stats;
      if (s.newCount === 0 && s.updated === 0 && s.conflicted === 0 && s.upstreamRemoved === 0) {
        log('所有模板文件已是最新，无需同步');
      } else {
        log('\n以上为预览，未实际执行。去掉 --dry-run 以执行同步。');
      }
      if (result.migrated) {
        log('📦 Lock file 将从 v1 迁移至 v2');
      }
      process.exit(0);
    }

    for (const item of result.plan) {
      if (item.removalConflict) {
        log('⚠️  冲突（上游已移除，保留本地修改）  ' + item.path);
      }
    }

    const s = result.stats;
    if (s.newCount === 0 && s.updated === 0 && s.conflicted === 0
        && s.skippedModified === 0 && s.upstreamRemoved === 0) {
      success('项目模板已是最新，无需同步 (v' + VERSION + ')');
    } else {
      log('📊 同步摘要：');
      log('   ✅ 已新增: ' + s.newCount);
      log('   🔄 已更新: ' + s.updated);
      log('   ⚠️  已覆盖（冲突）: ' + s.conflicted);
      log('   ⏭️  已跳过（本地修改）: ' + s.skippedModified);
      log('   🗑️  上游已移除: ' + s.upstreamRemoved);
      log('   ✨ 锁文件已更新至 v' + VERSION);
    }
    if (result.migrated) {
      success('Lock file 已从 v1 迁移至 v2 格式');
    }
  } catch (err) {
    error(err.message);
    process.exit(1);
  }

  process.exit(0);
}

// ============================================================
// 命令路由
// ============================================================

function cmd_version() {
  log(`specline v${VERSION}`);
  process.exit(0);
}

function cmd_help(exitCode = 0) {
  log(`specline v${VERSION} — Spec-driven AI coding pipeline

用法:
  specline init [path]               在指定路径初始化流水线基础设施
  specline init --platform <list>    指定平台 (cursor,claude,codex,opencode,all,none)
  specline init --force              强制覆盖已有配置
  specline init --with-shell-guard   启用 shell 命令安全防护 hook
  specline sync [--dry-run] [path]   同步共享文件及全部已配置平台
  specline sync --platform <list>    仅限定本次目标范围，不改变已配置平台成员关系
                                      支持 cursor,claude,codex,opencode,all；不支持 none
  specline update                    检查 CLI 自身更新（npm registry）
  specline gate <sub> [--change <n>] 运行 Gate 检查（spec/build/lint/list …）
  specline hook <sub> [--platform p] 运行 Hook 脚本（session-start …）
  specline platforms                 显示已部署平台列表
  specline diagram <subcommand>       管理本地 Draw.io runtime 与 session
  specline --version, -v             显示版本号
  specline --help, -h                显示此帮助信息

示例:
  specline init                      在当前目录初始化（TTY 下交互选择平台）
  specline init --platform cursor    只部署 Cursor 平台
  specline init --platform all       部署全部 4 个平台
  specline init ./my-project         在指定目录初始化
  specline sync --dry-run            预览模板文件更新
  specline gate spec --change feat   运行 spec gate 检查
  specline hook session-start        运行 session-start hook
  specline platforms                 列出已部署平台
  npx specline init                  无需全局安装即可使用
`);
  process.exit(exitCode);
}

const [,, command, ...args] = process.argv;

switch (command) {
  case 'init': {
    const initFlags = ['--force', '-f', '--with-shell-guard', '--platform'];
    const pathArg = args.filter(a => {
      if (initFlags.includes(a)) return false;
      const prevIdx = args.indexOf(a) - 1;
      if (prevIdx >= 0 && args[prevIdx] === '--platform') return false;
      return true;
    })[0];
    await cmd_init(pathArg, args);
    break;
  }
  case 'update': {
    await cmd_update();
    break;
  }
  case 'sync': {
    const dryRun = args.includes('--dry-run');
    let platforms;
    const filteredArgs = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--platform') {
        const rawValue = args[i + 1];
        if (rawValue === undefined || rawValue.startsWith('--')) {
          error('--platform 需要值；有效平台: cursor, claude, codex, opencode，或 all');
          process.exit(1);
        }
        try {
          platforms = parseSyncPlatformList(rawValue);
        } catch (err) {
          error(err.message);
          process.exit(1);
        }
        i++;
      } else if (args[i] !== '--dry-run') {
        filteredArgs.push(args[i]);
      }
    }
    cmd_sync({ dryRun, targetPath: filteredArgs[0], platforms });
    break;
  }
  case 'gate': {
    const exitCode = cliGate(args);
    process.exit(exitCode);
    break;
  }
  case 'hook': {
    const exitCode = cliHook(args);
    process.exit(exitCode);
    break;
  }
  case 'diagram': {
    const exitCode = await cliDiagram(args);
    process.exit(exitCode);
    break;
  }
  case 'platforms': {
    const exitCode = cliPlatforms();
    process.exit(exitCode);
    break;
  }
  case '--version':
  case '-v':
    cmd_version();
    break;
  case '--help':
  case '-h':
    cmd_help();
    break;
  default:
    if (command) {
      console.error(`\x1b[31m未知命令: ${command}\x1b[0m\n`);
    }
    cmd_help(command ? 1 : 0);
    break;
}
