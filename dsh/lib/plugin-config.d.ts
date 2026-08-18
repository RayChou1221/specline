export declare const PLUGIN_CONFIG_SCHEMA: Readonly<{
    writeIntercept: Readonly<{
        type: "boolean";
        default: true;
    }>;
    maxDepth: Readonly<{
        type: "number";
        default: 1;
    }>;
    gateViaCli: Readonly<{
        type: "boolean";
        default: true;
    }>;
}>;
export declare const DEFAULT_PLUGIN_CONFIG: Readonly<{
    writeIntercept: true;
    maxDepth: 1;
    gateViaCli: true;
}>;
export declare class MissingSpeclineProjectError extends Error {
    constructor(projectDir: string);
}
export type PluginConfig = {
    writeIntercept: boolean;
    maxDepth: number;
    gateViaCli: boolean;
};
export type ProjectCheckpointConfig = {
    pipeline: {
        human_gate_policy: string | undefined;
    };
    gate: {
        command: string | undefined;
        fallback: string | undefined;
    };
};
export type CheckpointReadOptions = {
    pluginConfig?: unknown;
    profileConfig?: unknown;
    dshHome?: string;
};
export declare function resolvePluginConfig(raw?: unknown): PluginConfig;
export declare function canRunPipeline(projectDir: string): boolean;
export declare function readProjectCheckpointConfig(projectDir: string, _options?: CheckpointReadOptions): ProjectCheckpointConfig;
