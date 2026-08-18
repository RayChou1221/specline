// Relative specifiers resolve to existing .mjs files, so TypeScript ignores
// `declare module '../../lib/...'`. Wildcard names still attach types.
declare module '*lib/render.mjs' {
  export function renderSkill(
    content: string,
    vars: { DISPATCH?: string; CONFIRM?: string; LINT?: string },
  ): string;
  export function stripPlatformSections(content: string, targetPlatform: string): string;
}

declare module '*lib/render-agents.mjs' {
  export function parseAgentYaml(yamlContent: string): {
    name: string;
    description: string;
    instructions: string;
  };
}
