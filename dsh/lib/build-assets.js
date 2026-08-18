import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAgentYaml } from '../../lib/render-agents.mjs';
import { renderDshSkill, renderFrontendDevPersona, yamlNameToToolName, } from './render-from-core.js';
const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const DSH_PACKAGE_ROOT = resolve(THIS_DIR, '..');
export const ASSET_SKILLS_DIR = 'skills';
export const ASSET_PERSONAS_DIR = 'personas';
export const FRONTEND_DESIGN_SKILL = 'frontend-design';
export const FRONTEND_DEV_YAML = 'specline-frontend-dev.yaml';
export const SKIP_SKILL_DIRS = new Set([FRONTEND_DESIGN_SKILL]);
function isCoreDir(dir) {
    try {
        return statSync(join(dir, 'skills')).isDirectory()
            && statSync(join(dir, 'agents')).isDirectory();
    }
    catch {
        return false;
    }
}
/**
 * Locate repo `core/` from dsh/src (../../core), cwd = dsh/, or cwd = repo root.
 */
export function resolveCoreDir(options = {}) {
    const cwd = resolve(options.cwd ?? process.cwd());
    const fromDir = resolve(options.fromDir ?? THIS_DIR);
    const candidates = [
        resolve(fromDir, '..', '..', 'core'),
        resolve(cwd, 'core'),
        resolve(cwd, '..', 'core'),
    ];
    for (const dir of candidates) {
        if (isCoreDir(dir))
            return dir;
    }
    throw new Error(`Cannot locate core/ (tried ${candidates.join(', ')})`);
}
export function resolveAssetsDir() {
    return join(DSH_PACKAGE_ROOT, 'assets');
}
function parseFlag(argv, name) {
    const index = argv.indexOf(name);
    if (index === -1)
        return undefined;
    const value = argv[index + 1];
    if (!value || value.startsWith('-')) {
        throw new Error(`Missing value for ${name}`);
    }
    return value;
}
function emptySubdir(outDir, name) {
    const dir = join(outDir, name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    return dir;
}
function walkFiles(dir, relBase = '') {
    const out = [];
    if (!existsSync(dir))
        return out;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const abs = join(dir, entry.name);
        const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            out.push(...walkFiles(abs, rel));
        }
        else {
            out.push({ rel, abs });
        }
    }
    return out;
}
function bakeSkillTree(srcDir, destDir) {
    const written = [];
    for (const file of walkFiles(srcDir)) {
        const dest = join(destDir, file.rel);
        mkdirSync(dirname(dest), { recursive: true });
        if (file.rel === 'SKILL.md' || file.rel.endsWith('/SKILL.md')) {
            writeFileSync(dest, renderDshSkill(readFileSync(file.abs, 'utf8')));
        }
        else {
            copyFileSync(file.abs, dest);
        }
        written.push(file.rel);
    }
    return written;
}
function renderPersona(yamlPath, yamlName, coreDir) {
    const yamlContent = readFileSync(yamlPath, 'utf8');
    if (yamlName === 'specline-frontend-dev') {
        const designPath = join(coreDir, 'skills', FRONTEND_DESIGN_SKILL, 'SKILL.md');
        if (!existsSync(designPath)) {
            throw new Error(`Missing ${FRONTEND_DESIGN_SKILL} SKILL.md for frontend-dev persona`);
        }
        return renderFrontendDevPersona(yamlContent, readFileSync(designPath, 'utf8'));
    }
    return `${parseAgentYaml(yamlContent).instructions.trim()}\n`;
}
/**
 * Read core/skills and core/agents, bake DSH Skill/persona assets.
 * Published output does not require the source tree core/ at runtime.
 */
export function buildAssets(options = {}) {
    const coreDir = resolve(options.coreDir ?? resolveCoreDir({
        cwd: options.cwd,
        fromDir: options.fromDir,
    }));
    if (!isCoreDir(coreDir)) {
        throw new Error(`Not a Specline core dir: ${coreDir}`);
    }
    const outDir = resolve(options.outDir ?? resolveAssetsDir());
    mkdirSync(outDir, { recursive: true });
    const skillsOut = emptySubdir(outDir, ASSET_SKILLS_DIR);
    const personasOut = emptySubdir(outDir, ASSET_PERSONAS_DIR);
    const skillsDir = join(coreDir, 'skills');
    const skills = [];
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || SKIP_SKILL_DIRS.has(entry.name))
            continue;
        const src = join(skillsDir, entry.name);
        if (!existsSync(join(src, 'SKILL.md')))
            continue;
        const dest = join(skillsOut, entry.name);
        mkdirSync(dest, { recursive: true });
        for (const rel of bakeSkillTree(src, dest)) {
            skills.push(`${entry.name}/${rel}`);
        }
    }
    skills.sort();
    const agentsDir = join(coreDir, 'agents');
    const personas = [];
    for (const name of readdirSync(agentsDir).filter((file) => file.endsWith('.yaml')).sort()) {
        const yamlName = name.slice(0, -'.yaml'.length);
        const toolFile = `${yamlNameToToolName(yamlName)}.md`;
        writeFileSync(join(personasOut, toolFile), renderPersona(join(agentsDir, name), yamlName, coreDir));
        personas.push(toolFile);
    }
    return { coreDir, outDir, skills, personas };
}
export function main(argv = process.argv.slice(2)) {
    const result = buildAssets({
        coreDir: parseFlag(argv, '--core'),
        outDir: parseFlag(argv, '--out'),
    });
    const skillCount = new Set(result.skills.map((rel) => rel.split('/')[0])).size;
    console.log(`baked ${skillCount} skills and ${result.personas.length} personas → ${result.outDir}`);
    return result;
}
function isMainModule() {
    const entry = process.argv[1];
    if (!entry)
        return false;
    try {
        return fileURLToPath(import.meta.url) === resolve(entry);
    }
    catch {
        return false;
    }
}
if (isMainModule()) {
    try {
        main();
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        process.exitCode = 1;
    }
}
