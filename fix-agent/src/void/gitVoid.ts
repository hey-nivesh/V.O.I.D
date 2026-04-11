import { spawn } from 'node:child_process';
import path from 'node:path';
import { normalizeRepoRelativePaths, normalizeTargetRepo } from './pathScope.js';

function runProcess(
    command: string,
    args: string[],
    cwd: string
): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
        const child = spawn(command, args, {
            cwd,
            shell: false,
            env: process.env
        });
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (d) => {
            stdout += d.toString();
        });
        child.stderr?.on('data', (d) => {
            stderr += d.toString();
        });
        child.on('close', (code) => {
            resolve({ code: code ?? 1, stdout, stderr });
        });
        child.on('error', (err) => {
            stderr += String(err);
            resolve({ code: 1, stdout, stderr });
        });
    });
}

export async function assertGitRepo(cwd: string): Promise<void> {
    const { code, stderr } = await runProcess('git', ['rev-parse', '--git-dir'], cwd);
    if (code !== 0) {
        throw new Error(`Not a git repository: ${cwd}${stderr ? `\n${stderr}` : ''}`);
    }
}

/**
 * Sparse-checkout **removes** every path outside the listed set from the working tree.
 * Default is OFF so a normal clone stays intact; set `VOID_USE_SPARSE_CHECKOUT=1` to enable.
 */
export function shouldUseSparseCheckout(): boolean {
    return process.env.VOID_USE_SPARSE_CHECKOUT === '1';
}

/**
 * Cone sparse-checkout for given repo-relative paths (opt-in only).
 */
export async function setupSparseCheckout(targetRepo: string, relevantPaths: string[]): Promise<void> {
    const cwd = normalizeTargetRepo(targetRepo);
    await assertGitRepo(cwd);
    if (relevantPaths.length === 0) {
        return;
    }
    if (!shouldUseSparseCheckout()) {
        console.info(
            '[void-fixer] Skipping git sparse-checkout — full repo checkout preserved. ' +
                'Set VOID_USE_SPARSE_CHECKOUT=1 only if you need a path-scoped working tree.'
        );
        return;
    }
    const safe = normalizeRepoRelativePaths(relevantPaths, cwd);
    let r = await runProcess('git', ['sparse-checkout', 'init', '--cone'], cwd);
    if (r.code !== 0) {
        throw new Error(`git sparse-checkout init failed: ${r.stderr}`);
    }
    r = await runProcess('git', ['sparse-checkout', 'set', ...safe], cwd);
    if (r.code !== 0) {
        throw new Error(`git sparse-checkout set failed: ${r.stderr}`);
    }
}

/**
 * Restore a full working tree after sparse-checkout (e.g. if the clone only shows a few files).
 * Run from the repo root: `npx tsx src/void/recoverRepo.ts` or call this from tooling.
 */
export async function recoverFullWorkingTreeAfterSparse(targetRepo: string): Promise<void> {
    const cwd = normalizeTargetRepo(targetRepo);
    await assertGitRepo(cwd);
    let r = await runProcess('git', ['sparse-checkout', 'disable'], cwd);
    if (r.code !== 0) {
        throw new Error(`git sparse-checkout disable failed: ${r.stderr}`);
    }
    r = await runProcess('git', ['read-tree', '-mu', 'HEAD'], cwd);
    if (r.code !== 0) {
        throw new Error(`git read-tree -mu HEAD failed: ${r.stderr}`);
    }
}

export function sanitizeBranchTicketId(ticketId: string): string {
    return ticketId.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'ticket';
}

export function makeFixBranchName(ticketId: string): string {
    const ts = Date.now();
    return `void-fix/${sanitizeBranchTicketId(ticketId)}-${ts}`;
}

/** Checkout an existing branch (typically target_branch_base). */
export async function checkoutBranch(targetRepo: string, branch: string): Promise<void> {
    const cwd = normalizeTargetRepo(targetRepo);
    await assertGitRepo(cwd);
    const r = await runProcess('git', ['checkout', branch], cwd);
    if (r.code !== 0) {
        throw new Error(`git checkout ${branch} failed: ${r.stderr}`);
    }
}

/** Create fix branch from current HEAD (after sparse-checkout). */
export async function createBranchFromHead(targetRepo: string, fixBranchName: string): Promise<void> {
    const cwd = normalizeTargetRepo(targetRepo);
    const r = await runProcess('git', ['checkout', '-b', fixBranchName], cwd);
    if (r.code !== 0) {
        throw new Error(`git checkout -b failed: ${r.stderr}`);
    }
}

export async function commitAll(targetRepo: string, message: string): Promise<void> {
    const cwd = normalizeTargetRepo(targetRepo);
    let r = await runProcess('git', ['add', '-A'], cwd);
    if (r.code !== 0) {
        throw new Error(`git add -A failed: ${r.stderr}`);
    }
    r = await runProcess('git', ['commit', '-m', message], cwd);
    if (r.code !== 0 && !/nothing to commit/i.test(r.stdout + r.stderr)) {
        throw new Error(`git commit failed: ${r.stderr || r.stdout}`);
    }
}

export async function listFilesChangedVsBase(targetRepo: string, baseBranch: string): Promise<string[]> {
    const cwd = normalizeTargetRepo(targetRepo);
    const { code, stdout, stderr } = await runProcess(
        'git',
        ['diff', '--name-only', `${baseBranch}...HEAD`],
        cwd
    );
    if (code !== 0) {
        throw new Error(`git diff --name-only failed: ${stderr}`);
    }
    return stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
}

export async function getUnifiedDiffVsBase(targetRepo: string, baseBranch: string): Promise<string> {
    const cwd = normalizeTargetRepo(targetRepo);
    const { code, stdout, stderr } = await runProcess(
        'git',
        ['diff', `${baseBranch}...HEAD`],
        cwd
    );
    if (code !== 0) {
        throw new Error(`git diff failed: ${stderr}`);
    }
    return stdout;
}

/** Best-effort: write a marker file under targetRepo for demo when no fix command is set */
export async function writePlaceholderAudit(
    targetRepo: string,
    ticketId: string,
    issueSummary: string,
    relevantPaths: string[]
): Promise<void> {
    const fs = await import('node:fs/promises');
    const root = normalizeTargetRepo(targetRepo);
    const first = relevantPaths[0];
    const subdir = first ? path.dirname(first.replace(/\//g, path.sep)) : '.';
    const file = path.join(root, subdir, 'VOID_FIXER_AUDIT.md');
    const line = `\n## ${new Date().toISOString()} — ${ticketId}\n${issueSummary}\n`;
    await fs.appendFile(file, line, 'utf8');
}
