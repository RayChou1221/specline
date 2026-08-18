import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
export const PLUGIN_CONFIG_SCHEMA = Object.freeze({
    writeIntercept: Object.freeze({ type: 'boolean', default: true }),
    maxDepth: Object.freeze({ type: 'number', default: 1 }),
    gateViaCli: Object.freeze({ type: 'boolean', default: true }),
});
export const DEFAULT_PLUGIN_CONFIG = Object.freeze({
    writeIntercept: PLUGIN_CONFIG_SCHEMA.writeIntercept.default,
    maxDepth: PLUGIN_CONFIG_SCHEMA.maxDepth.default,
    gateViaCli: PLUGIN_CONFIG_SCHEMA.gateViaCli.default,
});
export class MissingSpeclineProjectError extends Error {
    constructor(projectDir) {
        super(`Not a Specline project: missing specline/config.yaml under ${projectDir}`);
        this.name = 'MissingSpeclineProjectError';
    }
}
function projectConfigPath(projectDir) {
    return join(projectDir, 'specline', 'config.yaml');
}
export function resolvePluginConfig(raw) {
    const input = raw && typeof raw === 'object' ? raw : {};
    return {
        writeIntercept: typeof input.writeIntercept === 'boolean'
            ? input.writeIntercept
            : DEFAULT_PLUGIN_CONFIG.writeIntercept,
        maxDepth: typeof input.maxDepth === 'number' && Number.isFinite(input.maxDepth)
            ? input.maxDepth
            : DEFAULT_PLUGIN_CONFIG.maxDepth,
        gateViaCli: typeof input.gateViaCli === 'boolean'
            ? input.gateViaCli
            : DEFAULT_PLUGIN_CONFIG.gateViaCli,
    };
}
export function canRunPipeline(projectDir) {
    return existsSync(projectConfigPath(projectDir));
}
export function readProjectCheckpointConfig(projectDir, _options) {
    const configPath = projectConfigPath(projectDir);
    if (!existsSync(configPath)) {
        throw new MissingSpeclineProjectError(projectDir);
    }
    const parsed = parseTwoLevelYaml(readFileSync(configPath, 'utf8'));
    return {
        pipeline: {
            human_gate_policy: parsed.pipeline?.human_gate_policy,
        },
        gate: {
            command: parsed.gate?.command,
            fallback: parsed.gate?.fallback,
        },
    };
}
function unquote(value) {
    if ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1);
    }
    return value;
}
function parseTwoLevelYaml(content) {
    const result = {};
    let currentSection = null;
    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.replace(/\t/g, '  ');
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }
        const top = line.match(/^([A-Za-z0-9_]+)\s*:\s*(.*?)\s*$/);
        if (top && !line.startsWith(' ')) {
            const key = top[1];
            const value = top[2];
            if (value === '' || value === '|' || value === '>') {
                currentSection = key;
                if (!result[key]) {
                    result[key] = {};
                }
            }
            else {
                currentSection = null;
            }
            continue;
        }
        const nested = line.match(/^\s+([A-Za-z0-9_]+)\s*:\s*(.*?)\s*$/);
        if (!nested || !currentSection) {
            continue;
        }
        const nestedKey = nested[1];
        let nestedValue = nested[2];
        if (!nestedValue || nestedValue === '|' || nestedValue === '>' || nestedValue.startsWith('#')) {
            continue;
        }
        nestedValue = nestedValue.replace(/\s+#.*$/, '').trim();
        result[currentSection][nestedKey] = unquote(nestedValue);
    }
    return result;
}
