import { copyFileSync } from 'fs';

/**
 * hooks.json 语义合并：清理 specline 官方条目，注入模板最新 hook
 */
export function mergeHooksJson(existingContent, templateContent, warn = () => {}) {
  let existingObj;
  let templateObj;
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

  if (!existingObj.hooks) existingObj.hooks = {};

  for (const eventName of Object.keys(existingObj.hooks)) {
    existingObj.hooks[eventName] = existingObj.hooks[eventName].filter(
      (entry) => !(entry.command || '').includes('specline-') && !(entry.command || '').includes('specline '),
    );
  }

  for (const eventName of Object.keys(templateObj.hooks || {})) {
    if (!existingObj.hooks[eventName]) existingObj.hooks[eventName] = [];
    existingObj.hooks[eventName] = [
      ...templateObj.hooks[eventName],
      ...existingObj.hooks[eventName],
    ];
  }
  return JSON.stringify(existingObj, null, 2) + '\n';
}

export function countCustomHooks(hooksObj) {
  let count = 0;
  for (const eventName of Object.keys(hooksObj.hooks || {})) {
    for (const entry of hooksObj.hooks[eventName] || []) {
      const cmd = entry.command || '';
      if (!cmd.includes('specline')) count++;
    }
  }
  return count;
}

/** Claude Code settings.json — merge hooks 段 */
export function mergeClaudeSettings(existingContent, templateContent, warn = () => {}) {
  let existingObj = {};
  let templateObj;
  try {
    if (existingContent.trim()) existingObj = JSON.parse(existingContent);
  } catch {
    warn('settings.json 解析失败，将使用模板 hooks 段');
    existingObj = {};
  }
  try {
    templateObj = JSON.parse(templateContent);
  } catch {
    return existingContent;
  }
  const tmplHooks = templateObj.hooks || templateObj;
  if (!existingObj.hooks) existingObj.hooks = {};
  for (const [eventName, entries] of Object.entries(tmplHooks)) {
    if (!existingObj.hooks[eventName]) existingObj.hooks[eventName] = [];
    existingObj.hooks[eventName] = existingObj.hooks[eventName].filter(
      (e) => !JSON.stringify(e).includes('specline'),
    );
    existingObj.hooks[eventName] = [...entries, ...existingObj.hooks[eventName]];
  }
  return JSON.stringify(existingObj, null, 2) + '\n';
}

/** opencode.json plugin 数组 merge */
export function mergeOpencodeJson(existingContent, pluginPath = './specline/opencode-plugin') {
  let base = {};
  if (existingContent?.trim()) {
    try {
      base = JSON.parse(existingContent);
    } catch {
      base = {};
    }
  }
  const key = base.plugin != null ? 'plugin' : 'plugins';
  const current = Array.isArray(base[key]) ? base[key] : [];
  const set = new Set(current);
  set.add(pluginPath);
  base[key] = [...set];
  return JSON.stringify(base, null, 2) + '\n';
}

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
      const bodyTrimmed = bodyStr.trim();
      const onlyKeyDeclaration = currentKey !== null &&
        currentBodyLines.length === 1 &&
        bodyTrimmed.match(/^\w[\w_-]*\s*:\s*$/) !== null;
      const isEmpty = bodyTrimmed === '' || bodyTrimmed.startsWith('#') || onlyKeyDeclaration;
      sections.push({ key: currentKey, headerComments: [...currentComments], body: bodyStr, isEmpty });
    }
    currentComments = [];
    currentKey = null;
    currentBodyLines = [];
    inBody = false;
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') {
      if (inBody) currentBodyLines.push(line);
      continue;
    }
    if (trimmed.startsWith('#')) {
      if (inBody) currentBodyLines.push(line);
      else currentComments.push(line);
      continue;
    }
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

export function mergeConfigYaml(existingContent, templateContent) {
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

export function backupBeforeOverwrite(destPath) {
  const backupPath = destPath + '.orig';
  copyFileSync(destPath, backupPath);
  return backupPath;
}
