#!/usr/bin/env node
import { createHash } from 'crypto';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';

const REQUIRED_SECTIONS = [
  'Metadata', 'Intent Lock', 'Approved Behavior', 'Design Constraints',
  'Execution Tasks', 'Test Obligations', 'Review Gates', 'Escalation Rules',
];

function usage() {
  console.error('Usage: contract-check.mjs <project-root> <change-name> [--json]');
  process.exit(2);
}

function read(file) { return existsSync(file) ? readFileSync(file, 'utf-8') : null; }
function walkSpecs(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkSpecs(full, out);
    else if (entry.name === 'spec.md') out.push(full);
  }
  return out;
}
function sourceHash(changeDir) {
  const files = [];
  for (const name of ['proposal.md', 'design.md', 'tasks.md']) {
    const full = join(changeDir, name);
    if (existsSync(full)) files.push(full);
  }
  files.push(...walkSpecs(join(changeDir, 'specs')).sort());
  if (files.length === 0) return null;
  const h = createHash('sha256');
  for (const file of files) {
    h.update(`\n--- ${relative(changeDir, file).replace(/\\/g, '/')} ---\n`);
    h.update(readFileSync(file));
  }
  return `sha256:${h.digest('hex')}`;
}
function stateOf(changeDir) {
  const raw = read(join(changeDir, '.pipeline-state.json'));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function metadata(content) {
  const data = {};
  let inMeta = false;
  for (const line of content.split(/\r?\n/)) {
    if (/^##\s+Metadata\s*$/.test(line)) { inMeta = true; continue; }
    if (inMeta && /^##\s+/.test(line)) break;
    if (!inMeta) continue;
    const m = line.match(/^[-*]\s*\*?([^:*]+)\*?:\s*(.*)$/);
    if (m) data[m[1].trim().toLowerCase().replace(/\s+/g, '_')] = m[2].trim();
  }
  return data;
}
function tasksOf(content) {
  const tasks = [];
  for (const block of content.split(/\n(?=##\s+)/g)) {
    const title = block.match(/^##\s+(.+)$/m)?.[1]?.trim();
    if (!title) continue;
    const id = title.match(/^(\d+(?:\.\d+)*)\./)?.[1] || title;
    const files = (block.match(/\*\*Files\*\*:\s*(.+)/)?.[1] || '')
      .split(',').map((s) => s.trim()).filter(Boolean);
    const testable = /^true\b/i.test(block.match(/\*\*Testable\*\*:\s*(.+)/i)?.[1]?.trim() || '');
    tasks.push({ id, title, files, testable });
  }
  return tasks;
}

const args = process.argv.slice(2);
const projectRoot = args[0];
const change = args[1];
const json = args.includes('--json');
if (!projectRoot || !change) usage();

const changeDir = join(projectRoot, 'specline', 'changes', change);
const state = stateOf(changeDir);
const failures = [];
const warnings = [];
const currentHash = sourceHash(changeDir);
const contract = read(join(changeDir, 'execution-contract.md'));

if (!state || !Object.prototype.hasOwnProperty.call(state, 'contract')) {
  warnings.push('Legacy change has no contract state; continuing under legacy_policy=warn.');
  const result = { pass: true, legacy: true, warnings, failures, source_hash: currentHash };
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log(`⚠️  ${warnings[0]}`);
  process.exit(0);
}

if (!contract) failures.push('execution-contract.md is missing.');
if (!currentHash) failures.push('No source artifacts found to hash.');

if (contract) {
  for (const section of REQUIRED_SECTIONS) {
    if (!new RegExp(`^##\\s+${section}\\s*$`, 'm').test(contract)) {
      failures.push(`Missing required contract section: ${section}.`);
    }
  }
  const meta = metadata(contract);
  const expectedHash = state.contract?.source_hash || meta.source_artifacts_hash || meta.source_hash || null;
  if (!expectedHash) failures.push('Contract source hash is missing from state and metadata.');
  if (expectedHash && currentHash && expectedHash !== currentHash) failures.push('execution-contract.md is stale: source artifact hash mismatch.');
  const approved = Object.prototype.hasOwnProperty.call(state.contract || {}, 'approved')
    ? state.contract?.approved === true
    : /^approved$/i.test(meta.approval || '');
  if (!approved) failures.push('execution-contract.md is not approved.');

  for (const task of tasksOf(read(join(changeDir, 'tasks.md')) || '')) {
    if (!(contract.includes(`Task ${task.id}`) || contract.includes(task.title))) failures.push(`Contract does not mention task ${task.id}.`);
    for (const file of task.files) {
      if (!contract.includes(file)) failures.push(`Contract does not mention file for task ${task.id}: ${file}.`);
    }
    if (task.testable && !contract.includes('Testable: true')) failures.push(`Contract does not expose Testable=true obligation for task ${task.id}.`);
  }
}

const result = { pass: failures.length === 0, legacy: false, warnings, failures, source_hash: currentHash };
if (json) console.log(JSON.stringify(result, null, 2));
else if (result.pass) console.log('✅ Execution Contract Gate passed');
else {
  console.error('❌ Execution Contract Gate failed');
  for (const failure of failures) console.error(`  - ${failure}`);
}
process.exit(result.pass ? 0 : 1);
