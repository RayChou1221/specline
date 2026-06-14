#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, copyFileSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname, resolve, relative, basename } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { get } from 'https';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, 'templates');

// 从 package.json 读取版本号（由 npm version 命令自动维护）
const PKG = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'));
const VERSION = PKG.version;

// ============================================================
// 共享工具函数 — 锁文件读写、哈希计算
// ============================================================

/**
 * 计算内容的 SHA-256 哈希，返回 sha256:<hex> 格式字符串
 */
function sha256(content) {
  const hash = createHash('sha256').update(content).digest('hex');
  return `sha256:${hash}`;
}

/**
 * 读取文件内容并计算 SHA-256 哈希
 */
function computeFileHash(filePath) {
  const content = readFileSync(filePath);
  return sha256(content);
}

/**
 * 读取 specline/.specline-lock.yaml，手工行解析器
 * 返回 { version, synced_at, files: Map<string, string> } | null
 */
function readLockFile(projectDir) {
  const lockPath = join(projectDir, 'specline', '.specline-lock.yaml');
  if (!existsSync(lockPath)) return null;

  const lines = readFileSync(lockPath, 'utf-8').split('\n');
  const result = { version: '', synced_at: '', files: new Map() };
  let inFiles = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    if (trimmed.startsWith('version:')) {
      result.version = trimmed.slice('version:'.length).trim().replace(/^"(.*)"$/, '$1');
    } else if (trimmed.startsWith('synced_at:')) {
      result.synced_at = trimmed.slice('synced_at:'.length).trim().replace(/^"(.*)"$/, '$1');
    } else if (trimmed === 'files:') {
      inFiles = true;
    } else if (inFiles && trimmed.includes(':')) {
      const colonIdx = trimmed.indexOf(':');
      const key = trimmed.slice(0, colonIdx).trim();
      const value = trimmed.slice(colonIdx + 1).trim();
      result.files.set(key, value);
    }
  }

  return result;
}

/**
 * 将锁数据序列化为 YAML 格式写入 specline/.specline-lock.yaml
 */
function writeLockFile(projectDir, lockData) {
  const lockDir = join(projectDir, 'specline');
  if (!existsSync(lockDir)) {
    mkdirSync(lockDir, { recursive: true });
  }
  const lockPath = join(lockDir, '.specline-lock.yaml');
  const lines = [
    '# Specline Lock File — 自动生成，请勿手动编辑',
    `version: "${lockData.version}"`,
    `synced_at: "${lockData.synced_at}"`,
    'files:',
  ];
  for (const [key, value] of lockData.files) {
    lines.push(`  ${key}: ${value}`);
  }
  writeFileSync(lockPath, lines.join('\n') + '\n', 'utf-8');
}

/**
 * 遍历指定目录所有文件，构建锁数据结构
 * rootDir: 要遍历的根目录（必须是目标项目目录，这样 init 后锁哈希与实际文件一致）
 * 返回 { version, synced_at, files: Map<string, string> }
 */
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

/**
 * 版本号语义比较：返回 -1 (a<b)、0 (a==b)、1 (a>b)
 */
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

/**
 * 九态决策树：根据模板哈希、锁记录、项目文件状态，分类文件同步策略
 */
function classifyFile(templatePath, templateHash, lockEntry, projectPath) {
  const projectExists = existsSync(projectPath);
  if (!projectExists) return { type: 'NEW', path: templatePath };

  const projectHash = computeFileHash(projectPath);

  if (lockEntry) {
    if (projectHash === lockEntry) {
      // PRISTINE
      if (templateHash === lockEntry) return { type: 'UNCHANGED', path: templatePath };
      return { type: 'WILL_UPDATE', path: templatePath };
    } else {
      // MODIFIED
      if (templateHash === lockEntry) return { type: 'MODIFIED_ONLY', path: templatePath };
      return { type: 'CONFLICT', path: templatePath };
    }
  } else {
    // 旧版项目，无 lock 记录
    if (projectHash === templateHash) return { type: 'UNCHANGED', path: templatePath };
    return { type: 'NO_LOCK_CONFLICT', path: templatePath };
  }
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

// ============================================================
// 智能合并函数 — hooks.json / config.yaml / CONFLICT 备份
// ============================================================

/**
 * hooks.json 语义合并：清理所有 specline-* 条目，注入模板最新官方 hook
 */
function mergeHooksJson(existingContent, templateContent) {
  let existingObj, templateObj;
  try {
    existingObj = JSON.parse(existingContent);
  } catch {
    warn('hooks.json 解析失败，将使用模板完整替换');
    return templateContent;
  }
  try {
    templateObj = JSON.parse(templateContent);
  } catch {
    warn('模板 hooks.json 解析失败，保留现有文件');
    return existingContent;
  }

  for (const eventName of Object.keys(templateObj.hooks || {})) {
    if (!existingObj.hooks) {
      existingObj.hooks = {};
    }
    if (!existingObj.hooks[eventName]) {
      existingObj.hooks[eventName] = [];
    }
    existingObj.hooks[eventName] = existingObj.hooks[eventName].filter(
      (entry) => !(entry.command || '').includes('specline-')
    );
    existingObj.hooks[eventName] = [
      ...templateObj.hooks[eventName],
      ...existingObj.hooks[eventName],
    ];
  }
  return JSON.stringify(existingObj, null, 2) + '\n';
}

function countCustomHooks(hooksObj) {
  let count = 0;
  for (const eventName of Object.keys(hooksObj.hooks || {})) {
    for (const entry of (hooksObj.hooks[eventName] || [])) {
      if (!(entry.command || '').includes('specline-')) count++;
    }
  }
  return count;
}

/**
 * YAML 段落结构
 */
function parseYamlSections(content) {
  const lines = content.split('\n');
  const sections = [];
  let currentComments = [];
  let currentKey = null;
  let currentBodyLines = [];
  let inBody = false;

  function flushSection() {
    if (currentComments.length > 0 || currentBodyLines.length > 0 || currentKey) {
      const bodyStr = currentBodyLines.join('\n');
      // 判定 isEmpty：body 为空、纯注释、或仅声明 key 但无实际值
      const bodyTrimmed = bodyStr.trim();
      const onlyKeyDeclaration = currentKey !== null &&
        currentBodyLines.length === 1 &&
        bodyTrimmed.match(/^\w[\w_-]*\s*:\s*$/) !== null;
      const isEmpty = bodyTrimmed === '' ||
        bodyTrimmed.startsWith('#') ||
        onlyKeyDeclaration;
      sections.push({ key: currentKey, headerComments: [...currentComments], body: bodyStr, isEmpty });
    }
    currentComments = [];
    currentKey = null;
    currentBodyLines = [];
    inBody = false;
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') { if (inBody) currentBodyLines.push(line); continue; }
    if (trimmed.startsWith('#')) { if (inBody) currentBodyLines.push(line); else currentComments.push(line); continue; }
    const topKeyMatch = line.match(/^(\w[\w_-]*)\s*:(.*)/);
    if (topKeyMatch && !line.startsWith(' ') && !line.startsWith('\t')) {
      flushSection();
      currentKey = topKeyMatch[1];
      currentBodyLines = [line];
      inBody = true;
      continue;
    }
    if (inBody) currentBodyLines.push(line);
  }
  flushSection();
  return sections;
}

function findSection(sections, key) {
  return sections.find((s) => s.key === key) || null;
}

function mergeConfigYaml(existingContent, templateContent) {
  const existingSections = parseYamlSections(existingContent);
  const templateSections = parseYamlSections(templateContent);
  const resultLines = [];

  for (const tmplSec of templateSections) {
    const existSec = findSection(existingSections, tmplSec.key);
    if (existSec) {
      if (!existSec.isEmpty && existSec.body.trim() !== tmplSec.body.trim()) {
        resultLines.push(...tmplSec.headerComments);
        resultLines.push(existSec.body);
      } else {
        resultLines.push(...tmplSec.headerComments);
        resultLines.push(tmplSec.body);
      }
      resultLines.push('');
    } else if (tmplSec.key !== null) {
      resultLines.push('# 🆕 新增配置段 (specline sync)');
      resultLines.push(...tmplSec.headerComments);
      resultLines.push(tmplSec.body);
      resultLines.push('');
    }
  }

  for (const existSec of existingSections) {
    if (existSec.key === null) continue;
    if (!findSection(templateSections, existSec.key)) {
      resultLines.push(...existSec.headerComments);
      resultLines.push(existSec.body);
      resultLines.push('');
    }
  }
  return resultLines.join('\n');
}

function backupBeforeOverwrite(destPath) {
  const backupPath = destPath + '.orig';
  copyFileSync(destPath, backupPath);
  return backupPath;
}

function cmd_init(targetPath) {
  const cwd = process.cwd();
  const target = resolve(cwd, targetPath || '.');

  if (!existsSync(target)) {
    error(`目标路径不存在: ${target}`);
    process.exit(1);
  }

  const lockFile = join(target, 'specline', '.specline-lock.yaml');
  const forceMode = process.argv.includes('--force') || process.argv.includes('-f');

  if (existsSync(lockFile) && !forceMode) {
    warn('Specline 已在此项目中初始化。使用 --force 强制覆盖。');
    process.exit(0);
  }

  // 检测 hooks.json 冲突
  const hooksJsonDest = join(target, '.cursor', 'hooks.json');
  if (existsSync(hooksJsonDest)) {
    const backupPath = hooksJsonDest + '.bak';
    copyFileSync(hooksJsonDest, backupPath);
    warn('已备份原有 hooks.json → .cursor/hooks.json.bak');
  }

  // 创建目录结构
  const dirs = [
    '.cursor/agents',
    '.cursor/commands',
    '.cursor/skills',
    '.cursor/hooks',
    'specline/changes/archive',
    'specline/specs',
  ];

  for (const dir of dirs) {
    const fullDir = join(target, dir);
    if (!existsSync(fullDir)) {
      mkdirSync(fullDir, { recursive: true });
    }
  }

  // 从 templates/ 复制文件
  if (!existsSync(TEMPLATES_DIR)) {
    error(`templates/ 目录不存在: ${TEMPLATES_DIR}`);
    process.exit(1);
  }

  copyDirRecursive(TEMPLATES_DIR, target);

  // 统计各类文件数量
  function countFiles(dir) {
    let count = 0;
    if (!existsSync(dir)) return 0;
    try {
      const entries = readdirSync(dir, { withFileTypes: true, recursive: true });
      for (const entry of entries) {
        if (entry.isFile()) count++;
      }
    } catch (_) {}
    return count;
  }

  const agentsCount = countFiles(join(target, '.cursor', 'agents'));
  const commandsCount = countFiles(join(target, '.cursor', 'commands'));
  const skillsCount = countFiles(join(target, '.cursor', 'skills'));
  const hooksCount = countFiles(join(target, '.cursor', 'hooks'));

  success('Specline 初始化完成');
  log(`📁 文件: ${commandsCount} commands, ${skillsCount} skills, ${agentsCount} agents, ${hooksCount} hooks`);
  log('');
  log('🚀 试试在 Cursor 中输入:');
  log('   /specline-pipeline "你的第一个需求"');
  log('   /specline-explore');

  // 生成锁文件
  const lockPath = join(target, 'specline', '.specline-lock.yaml');
  if (existsSync(lockPath) && !forceMode) {
    warn('锁文件已存在，跳过');
  } else {
    const lockData = buildLockData(target, target);
    writeLockFile(target, lockData);
    success('已生成锁文件');
  }

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

  const currentParts = VERSION.split('.').map(Number);
  const latestParts = latest.split('.').map(Number);

  let isNewer = false;
  for (let i = 0; i < 3; i++) {
    const c = currentParts[i] || 0;
    const l = latestParts[i] || 0;
    if (l > c) {
      isNewer = true;
      break;
    } else if (l < c) {
      break;
    }
  }

  if (isNewer) {
    log('✨ 新版本可用: v' + latest + '（当前: v' + VERSION + '）\n运行 npm install -g specline@latest 更新');
  } else {
    success('已是最新版本 (v' + VERSION + ')');
  }

  process.exit(0);
}

function cmd_sync({ dryRun, targetPath }) {
  const cwd = process.cwd();
  const target = resolve(cwd, targetPath || '.');

  // 1. 检查项目是否已初始化
  const lockFile = join(target, 'specline', '.specline-lock.yaml');
  if (!existsSync(lockFile)) {
    // 向后兼容：检查旧版 .specline-config.yaml
    const oldMarker = join(target, '.specline-config.yaml');
    if (existsSync(oldMarker)) {
      warn('检测到旧版项目，正在自动迁移...');
      const lockData = buildLockData(target, target);
      writeLockFile(target, lockData);
      success('已从旧版项目迁移，生成了锁文件');
    } else {
      error('未检测到 Specline 项目，请先运行 specline init');
      process.exit(1);
    }
  }

  // 2. 构建上游模板哈希映射
  const upstreamData = buildLockData(target);
  const upstreamFiles = upstreamData.files;

  // 3. 读取锁文件
  const lockData = readLockFile(target);

  // 4. 版本校验
  if (lockData && compareVersions(lockData.version, VERSION) > 0) {
    warn('锁文件版本 (v' + lockData.version + ') 高于 CLI 版本 (v' + VERSION + ')，继续同步可能导致问题');
    if (!process.stdin.isTTY) {
      error('非交互式环境，已跳过同步');
      process.exit(1);
    }
    error('锁文件版本高于 CLI，请先更新 CLI');
    process.exit(1);
  }

  // 5. 收集所有需要分类的路径
  const allPaths = new Set();
  for (const p of upstreamFiles.keys()) allPaths.add(p);
  if (lockData) {
    for (const p of lockData.files.keys()) {
      if (!upstreamFiles.has(p)) allPaths.add(p);
    }
  }

  // 6. 分类
  const results = [];
  for (const path of allPaths) {
    const templateHash = upstreamFiles.get(path) || null;
    const lockEntry = lockData ? (lockData.files.get(path) || null) : null;
    const projectPath = join(target, path);

    if (templateHash === null) {
      results.push({ type: 'UPSTREAM_REMOVED', path });
    } else {
      results.push(classifyFile(path, templateHash, lockEntry, projectPath));
    }
  }

  // 7. 统计
  const stats = { newCount: 0, updated: 0, conflicted: 0, skippedModified: 0, unchanged: 0, upstreamRemoved: 0 };
  for (const r of results) {
    if (r.type === 'NEW') stats.newCount++;
    else if (r.type === 'WILL_UPDATE') stats.updated++;
    else if (r.type === 'CONFLICT' || r.type === 'NO_LOCK_CONFLICT') stats.conflicted++;
    else if (r.type === 'MODIFIED_ONLY') stats.skippedModified++;
    else if (r.type === 'UPSTREAM_REMOVED') stats.upstreamRemoved++;
    else stats.unchanged++;
  }

  // 8. dryRun 模式只预览
  if (dryRun) {
    const HOOKS_JSON = '.cursor/hooks.json';
    const CONFIG_YAML = 'specline/config.yaml';
    let hooksPlan = null;

    for (const r of results) {
      if (r.type === 'UNCHANGED' || r.type === 'MODIFIED_ONLY') {
        if (r.path === HOOKS_JSON) {
          const projPath = join(target, r.path);
          if (existsSync(projPath)) {
            try {
              const existingObj = JSON.parse(readFileSync(projPath, 'utf-8'));
              hooksPlan = { customCount: countCustomHooks(existingObj) };
            } catch {}
          }
        }
        if (r.path === CONFIG_YAML) {
          log('💡 config.yaml: 用户已修改，保留现有配置不变');
        }
        continue;
      }

      if (r.path === HOOKS_JSON) {
        hooksPlan = hooksPlan || { customCount: 0 };
        // 读取用户现有 hooks.json，计算自定义 hook 数量
        const projPath = join(target, r.path);
        if (existsSync(projPath) && !hooksPlan.readFromUser) {
          try {
            const existingObj = JSON.parse(readFileSync(projPath, 'utf-8'));
            hooksPlan = { customCount: countCustomHooks(existingObj), readFromUser: true };
          } catch {}
        }
        let tplCount = 0;
        try {
          const tpl = JSON.parse(readFileSync(join(TEMPLATES_DIR, r.path), 'utf-8'));
          for (const ev of Object.keys(tpl.hooks || {})) tplCount += (tpl.hooks[ev] || []).length;
        } catch {}
        log(`🔄 hooks.json 语义合并: 保留 ${hooksPlan.customCount >= 0 ? hooksPlan.customCount : '?'} 个自定义 hook, 更新 ${tplCount} 个官方 hook`);
        continue;
      }

      if (r.path === CONFIG_YAML) {
        log('💡 config.yaml: 保留用户配置不变，更新文档注释');
        continue;
      }

      const labels = { NEW: '➕ 新增', WILL_UPDATE: '🔄 更新', CONFLICT: '⚠️  冲突（将备份后覆盖）', NO_LOCK_CONFLICT: '⚠️  无锁记录', UPSTREAM_REMOVED: '🗑️  上游移除' };
      log(labels[r.type] + '  ' + r.path);
    }
    if (stats.newCount === 0 && stats.updated === 0 && stats.conflicted === 0
        && stats.skippedModified === 0 && stats.upstreamRemoved === 0) {
      log('所有模板文件已是最新，无需同步');
    } else {
      log('\n以上为预览，未实际执行。去掉 --dry-run 以执行同步。');
    }
    process.exit(0);
  }

  // 9. 执行写入
  const newFiles = new Map();
  const HOOKS_JSON = '.cursor/hooks.json';
  const CONFIG_YAML = 'specline/config.yaml';
  const mergeStats = { hooksMerged: false, configUpdated: false, backupsCreated: 0 };

  for (const r of results) {
    if (r.type === 'UNCHANGED' || r.type === 'MODIFIED_ONLY') {
      const projectPath = join(target, r.path);
      if (existsSync(projectPath)) {
        newFiles.set(r.path, computeFileHash(projectPath));
      }
      continue;
    }

    if (r.type === 'UPSTREAM_REMOVED') {
      warn('上游已移除：' + r.path);
      continue;
    }

    const srcPath = join(TEMPLATES_DIR, r.path);
    const destPath = join(target, r.path);
    const destDir = dirname(destPath);
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }

    try {
      // 特殊文件：hooks.json 语义合并
      if (r.path === HOOKS_JSON) {
        const existingContent = existsSync(destPath) ? readFileSync(destPath, 'utf-8') : '{}';
        const templateContent = readFileSync(srcPath, 'utf-8');
        try {
          const merged = mergeHooksJson(existingContent, templateContent);
          writeFileSync(destPath, merged, 'utf-8');
          newFiles.set(r.path, sha256(merged));
          mergeStats.hooksMerged = true;
        } catch {
          warn('hooks.json 合并失败，将保留现有文件');
          newFiles.set(r.path, computeFileHash(destPath));
        }
        continue;
      }

      // 特殊文件：config.yaml 注释合并
      if (r.path === CONFIG_YAML) {
        const existingContent = existsSync(destPath) ? readFileSync(destPath, 'utf-8') : '';
        const templateContent = readFileSync(srcPath, 'utf-8');
        try {
          const merged = mergeConfigYaml(existingContent, templateContent);
          writeFileSync(destPath, merged, 'utf-8');
          newFiles.set(r.path, sha256(merged));
          mergeStats.configUpdated = true;
        } catch {
          warn('config.yaml 合并失败，将保留现有文件');
          newFiles.set(r.path, computeFileHash(destPath));
        }
        continue;
      }

      // CONFLICT：备份后覆盖
      if (r.type === 'CONFLICT' || r.type === 'NO_LOCK_CONFLICT') {
        if (existsSync(destPath)) {
          const backupPath = backupBeforeOverwrite(destPath);
          mergeStats.backupsCreated++;
          warn('已覆盖（冲突，备份: ' + basename(backupPath) + '）: ' + r.path);
        }
        copyFileSync(srcPath, destPath);
        newFiles.set(r.path, computeFileHash(destPath));
      } else {
        copyFileSync(srcPath, destPath);
        newFiles.set(r.path, computeFileHash(destPath));
      }
    } catch (err) {
      warn(r.path + ' 写入失败：' + err.message);
      if (lockData && lockData.files.has(r.path)) {
        newFiles.set(r.path, lockData.files.get(r.path));
      }
    }
  }

  // 10. 更新锁文件
  writeLockFile(target, {
    version: VERSION,
    synced_at: new Date().toISOString(),
    files: newFiles,
  });

  // 11. 输出摘要
  if (stats.newCount === 0 && stats.updated === 0 && stats.conflicted === 0
      && stats.skippedModified === 0 && stats.upstreamRemoved === 0
      && !mergeStats.hooksMerged && !mergeStats.configUpdated) {
    success('项目模板已是最新，无需同步 (v' + VERSION + ')');
  } else {
    log('📊 同步摘要：');
    log('   总模板文件: ' + allPaths.size);
    log('   ✅ 已新增: ' + stats.newCount);
    log('   🔄 已更新: ' + stats.updated);
    log('   ⚠️  已覆盖（冲突）: ' + stats.conflicted);
    log('   ⏭️  已跳过（本地修改）: ' + stats.skippedModified);
    log('   🗑️  上游已移除: ' + stats.upstreamRemoved);
    if (mergeStats.hooksMerged) log('   🔧 hooks.json: 语义合并完成');
    if (mergeStats.configUpdated) log('   📝 config.yaml: 注释已更新');
    if (mergeStats.backupsCreated > 0) log('   💾 创建备份: ' + mergeStats.backupsCreated + ' 个 .orig 文件');
    log('   ✨ 锁文件已更新至 v' + VERSION);
  }

  process.exit(0);
}

function cmd_version() {
  log(`specline v${VERSION}`);
  process.exit(0);
}

function cmd_help() {
  log(`specline v${VERSION} — Spec-driven AI coding pipeline for Cursor IDE

用法:
  specline init [path]           在指定路径初始化流水线基础设施
  specline init --force          强制覆盖已有配置
  specline update                检查 CLI 自身更新（npm registry）
  specline sync [--dry-run] [path]  同步项目模板文件到最新版本
  specline --version, -v         显示版本号
  specline --help, -h            显示此帮助信息

示例:
  specline init                  在当前目录初始化
  specline init ./my-project     在指定目录初始化
  specline sync --dry-run        预览模板文件更新
  npx specline init              无需全局安装即可使用
`);
  process.exit(0);
}

// 入口
const [,, command, ...args] = process.argv;

switch (command) {
  case 'init': {
    const pathArg = args.filter(a => a !== '--force' && a !== '-f')[0];
    cmd_init(pathArg);
    break;
  }
  case 'update': {
    await cmd_update();
    break;
  }
  case 'sync': {
    const dryRun = args.includes('--dry-run');
    const pathArg = args.filter(a => a !== '--dry-run')[0];
    cmd_sync({ dryRun, targetPath: pathArg });
    break;
  }
  case '--version':
  case '-v':
    cmd_version();
    break;
  case '--help':
  case '-h':
  default:
    cmd_help();
    break;
}
