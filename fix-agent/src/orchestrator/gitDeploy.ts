import { spawn } from 'node:child_process';
import path from 'node:path';
import { sanitizeTicketForBranch } from './seniorGate.js';
import { waitForApprovalJsonApproved, writePushApprovalPending } from '../void/approvalJsonGate.js';

function runGit(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
        const child = spawn('git', args, { cwd, shell: false, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (d: Buffer) => {
            stdout += d.toString();
        });
        child.stderr?.on('data', (d: Buffer) => {
            stderr += d.toString();
        });
        child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
        child.on('error', (err) => resolve({ code: 1, stdout, stderr: stderr + String(err) }));
    });
}

/**
 * After senior approval: branch, commit scoped to repo, push.
 * Hard gate: never targets main/develop here — always `fix/ticket-*`.
 */
export async function deployApprovedFix(params: {
    focusRoot: string;
    ticketId: string;
    ticketTitle: string;
}): Promise<{ branch: string }> {
    const cwd = path.resolve(params.focusRoot);
    const safe = sanitizeTicketForBranch(params.ticketId);
    const branch = `fix/ticket-${safe}`;

    let r = await runGit(cwd, ['checkout', '-b', branch]);
    if (r.code !== 0) {
        r = await runGit(cwd, ['checkout', branch]);
        if (r.code !== 0) {
            throw new Error(`git checkout branch ${branch} failed: ${r.stderr}`);
        }
    }

    r = await runGit(cwd, ['add', '-A']);
    if (r.code !== 0) {
        throw new Error(`git add failed: ${r.stderr}`);
    }

    const msg = `Fix: ${params.ticketTitle} - Approved by Senior Dev`;
    r = await runGit(cwd, ['commit', '-m', msg]);
    if (r.code !== 0 && !/nothing to commit|no changes added/i.test(r.stdout + r.stderr)) {
        throw new Error(`git commit failed: ${r.stderr}`);
    }

    if (process.env.VOID_SKIP_APPROVAL_JSON !== '1') {
        const approvalFile = await writePushApprovalPending({
            summary: `Orchestrator: ${msg}`,
            ticketId: params.ticketId,
            branch
        });
        console.log(`[orchestrator] approval.json pending before push: ${approvalFile}`);
        await waitForApprovalJsonApproved();
    }

    r = await runGit(cwd, ['push', '-u', 'origin', branch]);
    if (r.code !== 0) {
        throw new Error(`git push failed (configure remote/credentials): ${r.stderr}`);
    }

    return { branch };
}
