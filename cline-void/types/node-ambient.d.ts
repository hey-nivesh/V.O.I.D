/**
 * Minimal Node builtins so `cline-void` typechecks before `npm install` (or without hoisted @types/node).
 * Prefer `@types/node` when available: run `npm install` in `cline-void/`.
 */
declare module 'child_process' {
    export interface SpawnOptions {
        cwd?: string;
        shell?: boolean;
        env?: Record<string, string | undefined>;
        stdio?: Array<'ignore' | 'pipe' | 'inherit' | number>;
    }
    export interface ChildProcess {
        stdout: { on(event: 'data', listener: (chunk: unknown) => void): void } | null;
        stderr: { on(event: 'data', listener: (chunk: unknown) => void): void } | null;
        on(event: 'close', listener: (code: number | null) => void): ChildProcess;
        on(event: 'error', listener: (err: Error) => void): ChildProcess;
    }
    export function spawn(command: string, args: readonly string[], options?: SpawnOptions): ChildProcess;
    export function spawn(command: string, options: SpawnOptions): ChildProcess;
}

declare module 'path' {
    export function resolve(...pathSegments: string[]): string;
    export function relative(from: string, to: string): string;
    export function isAbsolute(p: string): boolean;
}

declare const process: { env: Record<string, string | undefined> };
