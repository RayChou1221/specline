/**
 * Parent (empty parentSession) may only write Specline runtime artifacts.
 * Child sessions (has parent) may write application source.
 */
export declare function parentWriteAllowed(relPath: string, parentSession?: string | null): boolean;
