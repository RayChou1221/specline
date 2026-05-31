#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, copyFileSync, writeFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, 'templates');
const VERSION = '1.0.0';

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

function cmd_init(targetPath) {
  const cwd = process.cwd();
  const target = resolve(cwd, targetPath || '.');

  if (!existsSync(target)) {
    error(`目标路径不存在: ${target}`);
    process.exit(1);
  }

  const configFile = join(target, '.specline-config.yaml');
  const forceMode = process.argv.includes('--force') || process.argv.includes('-f');

  if (existsSync(configFile) && !forceMode) {
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

  // 写入初始化配置
  const initConfig = `# Specline 项目配置
version: "${VERSION}"
initialized_at: "${new Date().toISOString()}"
`;
  writeFileSync(configFile, initConfig, 'utf-8');

  success('Specline 初始化完成');
  log(`📁 文件: ${commandsCount} commands, ${skillsCount} skills, ${agentsCount} agents, ${hooksCount} hooks`);
  log('');
  log('🚀 试试在 Cursor 中输入:');
  log('   /specline-pipeline "你的第一个需求"');
  log('   /specline-explore');

  process.exit(0);
}

function cmd_version() {
  log(`specline v${VERSION}`);
  process.exit(0);
}

function cmd_help() {
  log(`specline v${VERSION} — Spec-driven AI coding pipeline for Cursor IDE

用法:
  specline init [path]        在指定路径初始化流水线基础设施
  specline init --force       强制覆盖已有配置
  specline --version, -v      显示版本号
  specline --help, -h         显示此帮助信息

示例:
  specline init               在当前目录初始化
  specline init ./my-project  在指定目录初始化
  npx specline init           无需全局安装即可使用
`);
  process.exit(0);
}

// 入口
const [,, command, ...args] = process.argv;

switch (command) {
  case 'init': {
    // 过滤出 --force/-f 之外的真实路径参数
    const pathArg = args.filter(a => a !== '--force' && a !== '-f')[0];
    cmd_init(pathArg);
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
