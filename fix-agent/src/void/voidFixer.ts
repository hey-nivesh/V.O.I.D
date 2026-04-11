import { spawn } from 'node:child_process';
import type { FixManifest, RCAHandover, VoidFixResult } from './types.js';
import { normalizeTargetRepo } from './pathScope.js';
import {
    checkoutBranch,
    commitAll,
    createBranchFromHead,
    getUnifiedDiffVsBase,
    listFilesChangedVsBase,
    makeFixBranchName,
    setupSparseCheckout,
    writePlaceholderAudit
} from './gitVoid.js';
import { writeFixManifest } from './exitHandler.js';
import { applyTerminalSanitizerToRunResult } from './terminalOutputSanitizer.js';
import { resolveNpmProjectRoot } from '../orchestrator/config.js';

function redactHandoverForLog(rca: RCAHandover): string {
    return JSON.stringify(
        {
            ...rca,
            gatekeeper_context: {
                ...rca.gatekeeper_context,
                jit_token: '[REDACTED]'
            }
        },
        null,
        0
    );
}

function runShellCommand(
    cwd: string,
    command: string,
    envExtra?: Record<string, string | undefined>
): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
        const child = spawn(command, {
            cwd,
            shell: true,
            env: { ...process.env, ...envExtra }
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
            const s = applyTerminalSanitizerToRunResult(stdout, stderr);
            resolve({ code: code ?? 1, stdout: s.stdout, stderr: s.stderr });
        });
        child.on('error', (err) => {
            const s = applyTerminalSanitizerToRunResult(stdout, stderr);
            resolve({ code: 1, stdout: s.stdout, stderr: s.stderr + String(err) });
        });
    });
}

function resolveTargetRepo(rca: RCAHandover): string {
    const fromEnv = process.env.VOID_TARGET_REPO;
    if (fromEnv && fromEnv.trim()) {
        return normalizeTargetRepo(fromEnv.trim());
    }
    return normalizeTargetRepo(rca.gatekeeper_context.sandbox_path);
}

/**
 * VOID-Fixer headless pipeline: optional sparse-checkout → fix branch → reflexion loop → commit → manifest.
 * Full clone is preserved unless VOID_USE_SPARSE_CHECKOUT=1.
 * Does not merge.
 */
export async function startVoidFix(rca: RCAHandover): Promise<VoidFixResult> {
    const targetRepo = resolveTargetRepo(rca);
    const npmCwd = resolveNpmProjectRoot(targetRepo);
    const base = rca.void_fixer_instructions.target_branch_base;
    const ticketId = rca.metadata.ticket_id;
    const paths = rca.sherlock_diagnosis.relevant_paths;
    const maxAttempts = Math.max(1, rca.void_fixer_instructions.self_healing_attempts);
    const verifyCmd = rca.void_fixer_instructions.verification_command;
    const fixCmd = process.env.VOID_FIX_COMMAND?.trim();

    const scope = rca.hyper_context_payload?.product_fix_scope?.trim();
    const repoPath = rca.hyper_context_payload?.product_fix_repo_path?.trim();
    const handoverEnv: Record<string, string | undefined> = {};
    if (scope) {
        handoverEnv.VOID_HANDOVER_PRODUCT_FIX_SCOPE = scope;
    }
    if (repoPath) {
        handoverEnv.VOID_HANDOVER_PRODUCT_REPO_PATH = repoPath;
    }

    if (process.env.VOID_DEBUG_RCA === '1') {
        console.debug('[void-fixer] RCA (jit redacted):', redactHandoverForLog(rca));
    }

    await checkoutBranch(targetRepo, base);
    await setupSparseCheckout(targetRepo, paths);

    const branchName = makeFixBranchName(ticketId);
    await createBranchFromHead(targetRepo, branchName);

    let attemptsUsed = 0;
    let lastVerifyOk = false;
    let lastVerifyLog = '';

    if (!fixCmd) {
        await writePlaceholderAudit(targetRepo, ticketId, rca.sherlock_diagnosis.issue_summary, paths);
    }

    for (let i = 0; i < maxAttempts; i++) {
        attemptsUsed = i + 1;
        if (fixCmd) {
            const fx = await runShellCommand(npmCwd, fixCmd, handoverEnv);
            if (fx.code !== 0) {
                lastVerifyLog = `VOID_FIX_COMMAND exit ${fx.code}\n${fx.stderr || fx.stdout}`;
            }
        }

        const ver = await runShellCommand(npmCwd, verifyCmd, handoverEnv);
        lastVerifyLog = [ver.stdout, ver.stderr].filter(Boolean).join('\n');
        lastVerifyOk = ver.code === 0;
        if (lastVerifyOk) {
            break;
        }
    }

    const summaryLine = lastVerifyOk
        ? `Verification passed after ${attemptsUsed} attempt(s).`
        : `Verification did not pass; last output:\n${lastVerifyLog.slice(0, 2000)}`;

    await commitAll(
        targetRepo,
        `void-fix: ${ticketId} — ${rca.sherlock_diagnosis.issue_summary.slice(0, 72)}`
    );

    const filesModified = await listFilesChangedVsBase(targetRepo, base);
    const diff = await getUnifiedDiffVsBase(targetRepo, base);

    const manifest: FixManifest = {
        branch_name: branchName,
        ticket_id: ticketId,
        summary: `${rca.sherlock_diagnosis.issue_summary}\n\n${summaryLine}`,
        test_status: lastVerifyOk,
        files_modified: filesModified,
        created_at: new Date().toISOString(),
        verification_command: verifyCmd,
        attempts_used: attemptsUsed,
        manifest_path: ''
    };

    const written = await writeFixManifest(targetRepo, manifest);

    return {
        manifest: written,
        diff
    };
}
