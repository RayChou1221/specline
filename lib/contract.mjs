import { createHash } from 'crypto';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { basename, join, relative } from 'path';

const REQUIRED_CONTRACT_SECTIONS = [
  'Metadata',
  'Intent Lock',
  'Approved Behavior',
  'Design Constraints',
  'Execution Tasks',
  'Test Obligations',
  'Review Gates',
  'Escalation Rules',
];

export function sha256(content) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function readIfExists(filePath) {
  return existsSync(filePath) ? readFileSync(filePath, 'utf-8') : null;
}

function walkSpecFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkSpecFiles(full, out);
    else if (entry.isFile() && entry.name === 'spec.md') out.push(full);
  }
  return out;
}

export function listSourceArtifactFiles(changeDir) {
  const files = [];
  for (const name of ['proposal.md', 'design.md', 'tasks.md']) {
    const full = join(changeDir, name);
    if (existsSync(full)) files.push(full);
  }
  files.push(...walkSpecFiles(join(changeDir, 'specs')).sort());
  return files;
}

export function computeSourceArtifactsHash(changeDir) {
  const hash = createHash('sha256');
  let hasContent = false;
  for (const file of listSourceArtifactFiles(changeDir)) {
    const rel = relative(changeDir, file).replace(/\\/g, '/');
    hash.update(`\n--- ${rel} ---\n`);
    hash.update(readFileSync(file));
    hasContent = true;
  }
  return hasContent ? `sha256:${hash.digest('hex')}` : null;
}

export function computeContractHash(changeDir) {
  const content = readIfExists(join(changeDir, 'execution-contract.md'));
  return content == null ? null : sha256(content);
}

export function readPipelineState(changeDir) {
  const file = join(changeDir, '.pipeline-state.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

export function parseContractMetadata(content) {
  const metadata = {};
  const lines = content.split(/\r?\n/);
  let inMetadata = false;
  for (const line of lines) {
    if (/^##\s+Metadata\s*$/.test(line)) {
      inMetadata = true;
      continue;
    }
    if (inMetadata && /^##\s+/.test(line)) break;
    if (!inMetadata) continue;
    const match = line.match(/^[-*]\s*\*?([^:*]+)\*?:\s*(.*)$/);
    if (match) {
      const key = match[1].trim().toLowerCase().replace(/\s+/g, '_');
      metadata[key] = match[2].trim();
    }
  }
  return metadata;
}

export function parseTasks(content) {
  const tasks = [];
  const blocks = content.split(/\n(?=##\s+)/g);
  for (const block of blocks) {
    const titleMatch = block.match(/^##\s+(.+)$/m);
    if (!titleMatch) continue;
    const title = titleMatch[1].trim();
    const idMatch = title.match(/^(\d+(?:\.\d+)*)\./);
    const task = {
      id: idMatch ? idMatch[1] : title,
      title,
      files: [],
      testable: false,
    };
    const filesMatch = block.match(/\*\*Files\*\*:\s*(.+)/);
    if (filesMatch) {
      task.files = filesMatch[1]
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean);
    }
    const testableMatch = block.match(/\*\*Testable\*\*:\s*(.+)/i);
    task.testable = testableMatch ? /^true\b/i.test(testableMatch[1].trim()) : false;
    tasks.push(task);
  }
  return tasks;
}

function contractHasRequiredSections(content) {
  const missing = [];
  for (const section of REQUIRED_CONTRACT_SECTIONS) {
    const re = new RegExp(`^##\\s+${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm');
    if (!re.test(content)) missing.push(section);
  }
  return missing;
}

function isLegacyChange(state) {
  return !state || !Object.prototype.hasOwnProperty.call(state, 'contract');
}

export function checkExecutionContract(changeDir, options = {}) {
  const legacyPolicy = options.legacyPolicy || 'warn';
  const state = readPipelineState(changeDir);
  const currentSourceHash = computeSourceArtifactsHash(changeDir);
  const contractPath = join(changeDir, 'execution-contract.md');
  const contractContent = readIfExists(contractPath);
  const checks = [];
  const failures = [];
  const warnings = [];

  if (isLegacyChange(state)) {
    const message = 'Legacy change has no contract state; continuing under legacy_policy=warn.';
    if (legacyPolicy === 'warn' || legacyPolicy === 'off') {
      warnings.push(message);
      return { pass: true, legacy: true, warnings, failures, checks, currentSourceHash };
    }
    failures.push('Legacy change requires an execution contract by policy.');
    return { pass: false, legacy: true, warnings, failures, checks, currentSourceHash };
  }

  if (!contractContent) failures.push('execution-contract.md is missing.');
  if (!currentSourceHash) failures.push('No source artifacts found to hash.');

  if (contractContent) {
    const missingSections = contractHasRequiredSections(contractContent);
    if (missingSections.length) {
      failures.push(`execution-contract.md is missing required sections: ${missingSections.join(', ')}.`);
    }

    const metadata = parseContractMetadata(contractContent);
    const metadataHash = metadata.source_artifacts_hash || metadata.source_hash || null;
    const stateHash = state.contract?.source_hash || null;
    const expectedHash = stateHash || metadataHash;
    if (!expectedHash) failures.push('Contract source hash is missing from state and metadata.');
    if (expectedHash && currentSourceHash && expectedHash !== currentSourceHash) {
      failures.push('execution-contract.md is stale: source artifact hash mismatch.');
    }

    const approved = Object.prototype.hasOwnProperty.call(state.contract || {}, 'approved')
      ? state.contract?.approved === true
      : /^approved$/i.test(metadata.approval || '');
    if (!approved) failures.push('execution-contract.md is not approved.');

    const tasksContent = readIfExists(join(changeDir, 'tasks.md')) || '';
    const tasks = parseTasks(tasksContent);
    for (const task of tasks) {
      const taskMentioned = contractContent.includes(`Task ${task.id}`) || contractContent.includes(task.title);
      if (!taskMentioned) failures.push(`Contract does not mention task ${task.id}.`);
      for (const file of task.files) {
        if (!contractContent.includes(file)) failures.push(`Contract does not mention file for task ${task.id}: ${file}.`);
      }
      if (task.testable && !contractContent.includes('Testable: true')) {
        failures.push(`Contract does not expose Testable=true obligation for task ${task.id}.`);
      }
    }
  }

  return {
    pass: failures.length === 0,
    legacy: false,
    warnings,
    failures,
    checks,
    currentSourceHash,
    contractHash: computeContractHash(changeDir),
  };
}

export { REQUIRED_CONTRACT_SECTIONS };
