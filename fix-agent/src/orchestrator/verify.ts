import { spawn } from 'node:child_process';
import { ORCH_VERIFY_CMD, resolveNpmProjectRoot } from './config.js';

export async function runVerification(focusFlowRoot: string, command: string = ORCH_VERIFY_CMD): Promise<{
    ok: boolean;
    stdout: string;
    stderr: string;
}> {
    const cwd = resolveNpmProjectRoot(focusFlowRoot);
    return new Promise((resolve) => {
        const child = spawn(command, {
            cwd,
            shell: true,
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (d: Buffer) => {
            stdout += d.toString();
        });
        child.stderr?.on('data', (d: Buffer) => {
            stderr += d.toString();
        });
        child.on('close', (code) => {
            resolve({ ok: code === 0, stdout, stderr });
        });
        child.on('error', (err) => {
            resolve({ ok: false, stdout, stderr: stderr + String(err) });
        });
    });
}
