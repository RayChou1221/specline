import { readFileSync } from 'fs';
import { join } from 'path';
import { PACKAGE_ROOT } from './paths.mjs';

/**
 * @param {string} yamlContent
 * @returns {{ name: string, description: string, instructions: string }}
 */
export function parseAgentYaml(yamlContent) {
  const lines = yamlContent.split('\n');
  const fields = { name: '', description: '', instructions: '' };
  let current = '';
  const block = [];

  for (const line of lines) {
    if (line.match(/^name:\s/)) {
      current = 'name';
      fields.name = line.replace(/^name:\s*"?/, '').replace(/"$/, '').trim();
    } else if (line.match(/^description:\s/)) {
      current = 'description';
      const remainder = line.replace(/^description:\s*"?/, '').replace(/"$/, '').trim();
      if (/^[>|][-+]?$/.test(remainder)) {
        // Multi-line block scalar (e.g. >-, |, >+, |-)
        block.length = 0;
        fields.description = '';
      } else {
        fields.description = remainder;
      }
    } else if (line.match(/^instructions:\s*\|\s*$/)) {
      // Save collected description block before switching to instructions
      if (current === 'description' && block.length > 0) {
        fields.description = block.join(' ').trim();
        block.length = 0;
      }
      current = 'instructions';
    } else if (current === 'description') {
      const trimmed = line.trim();
      if (trimmed.length > 0) block.push(trimmed);
    } else if (current === 'instructions') {
      block.push(line.replace(/^  /, ''));
    } else if (line.match(/^(output|constraints|phases):/)) {
      current = '';
    }
  }

  // Handle description at end-of-file
  if (current === 'description' && block.length > 0) {
    fields.description = block.join(' ').trim();
  }

  fields.instructions = block.join('\n').trim();
  return fields;
}

/** @param {string} yamlContent */
export function renderCursorAgent(yamlContent) {
  const { name, description, instructions } = parseAgentYaml(yamlContent);
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${instructions}\n`;
}

/** @param {string} yamlContent */
export function renderClaudeAgent(yamlContent) {
  return renderCursorAgent(yamlContent);
}

/** @param {string} yamlContent @param {string} [tomlTemplate] */
export function renderCodexAgent(yamlContent, tomlTemplate) {
  const { name, description, instructions } = parseAgentYaml(yamlContent);
  if (tomlTemplate) {
    return tomlTemplate
      .replace(/\{\{name\}\}/g, name)
      .replace(/\{\{description\}\}/g, description)
      .replace(/\{\{instructions\}\}/g, instructions.replace(/\\/g, '\\\\').replace(/"/g, '\\"'));
  }
  const escapedInstructions = instructions.replace(/\\/g, '\\\\').replace(/"""/g, '\\"""');
  return `name = "${name}"\ndescription = "${description}"\n\n[instructions]\ndeveloper_instructions = """\n${escapedInstructions}\n"""\n`;
}

/** @param {string} yamlPath */
export function getAgentInstructionsFromFile(yamlPath) {
  return parseAgentYaml(readFileSync(yamlPath, 'utf-8')).instructions;
}

/** @param {string} role e.g. specline-backend-dev */
export function getAgentInstructions(role, packageRoot = PACKAGE_ROOT) {
  const yamlPath = join(packageRoot, 'core', 'agents', `${role}.yaml`);
  return getAgentInstructionsFromFile(yamlPath);
}
