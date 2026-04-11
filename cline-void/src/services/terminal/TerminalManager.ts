import { spawn } from 'child_process';
import path from 'path';
import { resolveVoidRepoAbsolute } from '../../void/config.js';
import { applyTerminalSanitizerToRunResult } from './terminalOutputSanitizer.js';

export interface RunResult {
    code: number;
    stdout: string;
    stderr: string;
}

/**
 * VOID-Fixer terminal sessions: every command runs with `cwd` locked to the Focus-Flow- repo.
 * Use `startVoidFixSession` before `startVoidFix`; call `endVoidFixSession` when finished.
 */
export class TerminalManager {
    private lockedCwd: string | null = null;
    private voidFixMode = false;

    /** Lock all subsequent runs to this directory (must be inside resolved Focus-Flow-). */
    startVoidFixSession(workspaceRoot?: string): void {
        const resolved = resolveVoidRepoAbsolute(workspaceRoot);
        this.lockedCwd = path.resolve(resolved);
        this.voidFixMode = true;
    }

    endVoidFixSession(): void {
        this.lockedCwd = null;
        this.voidFixMode = false;
    }

    isVoidFixSession(): boolean {
        return this.voidFixMode && this.lockedCwd !== null;
    }

    getLockedCwd(): string | null {
        return this.lockedCwd;
    }

    /**
     * Run a shell command strictly inside the locked repo root.
     * Optional `subcwd` must stay within `lockedCwd` (relative segment only).
     */
    async run(command: string, options?: { subcwd?: string }): Promise<RunResult> {
        const cwd = this.resolveRunCwd(options?.subcwd);
        return runShell(cwd, command);
    }

    /** Prefer this for `git` with path arguments (no shell quoting issues). */
    async runGit(args: string[], options?: { subcwd?: string }): Promise<RunResult> {
        const cwd = this.resolveRunCwd(options?.subcwd);
        return runProcess('git', args, cwd);
    }

    private resolveRunCwd(subcwd?: string): string {
        if (!this.lockedCwd) {
            throw new Error('TerminalManager: startVoidFixSession() required before run()');
        }
        if (!subcwd) {
            return this.lockedCwd;
        }
        const candidate = path.resolve(this.lockedCwd, subcwd);
        const rel = path.relative(this.lockedCwd, candidate);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
            throw new Error(`TerminalManager: subcwd escapes repo: ${subcwd}`);
        }
        return candidate;
    }
}

function runProcess(command: string, args: string[], cwd: string): Promise<RunResult> {
    return new Promise((resolve) => {
        const child = spawn(command, args, {
            cwd,
            shell: false,
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (chunk: unknown) => {
            stdout += String(chunk);
        });
        child.stderr?.on('data', (chunk: unknown) => {
            stderr += String(chunk);
        });
        child.on('close', (code: number | null) => {
            const sanitized = applyTerminalSanitizerToRunResult(stdout, stderr);
            resolve({ code: code ?? 1, stdout: sanitized.stdout, stderr: sanitized.stderr });
        });
        child.on('error', (err: Error) => {
            const sanitized = applyTerminalSanitizerToRunResult(stdout, stderr);
            resolve({ code: 1, stdout: sanitized.stdout, stderr: sanitized.stderr + err.message });
        });
    });
}

/**
 * Run a user shell command (e.g. `npm run test`). Uses the two-arg `spawn` + `shell: true`
 * form so Windows `cmd.exe` parses the full line correctly (empty `[]` args are unreliable).
 */
function runShell(cwd: string, command: string): Promise<RunResult> {
    return new Promise((resolve) => {
        const child = spawn(command, {
            cwd,
            shell: true,
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (chunk: unknown) => {
            stdout += String(chunk);
        });
        child.stderr?.on('data', (chunk: unknown) => {
            stderr += String(chunk);
        });
        child.on('close', (code: number | null) => {
            const sanitized = applyTerminalSanitizerToRunResult(stdout, stderr);
            resolve({ code: code ?? 1, stdout: sanitized.stdout, stderr: sanitized.stderr });
        });
        child.on('error', (err: Error) => {
            const sanitized = applyTerminalSanitizerToRunResult(stdout, stderr);
            resolve({ code: 1, stdout: sanitized.stdout, stderr: sanitized.stderr + err.message });
        });
    });
}
