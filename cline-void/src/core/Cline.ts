import { setVoidAutonomousActive } from '../bridge/VoidUiState.js';
import path from 'path';
import { ROOT_REPO_PATH, resolveNpmAppRoot, resolveVoidRepoAbsolute } from '../void/config.js';
import { writeFixManifest } from '../void/exitHandler.js';
import type { FixManifestPayload, RcaVoidHandover, RepairAttemptContext } from '../void/types.js';
import { TerminalManager } from '../services/terminal/TerminalManager.js';
import {
    buildVoidFixerGeminiRequest,
    toGenerateContentBody
} from '../integrations/gemini/geminiVoidMessages.js';
import { writePushApprovalPending, waitForApprovalJsonApproved } from '../void/approvalJsonGate.js';

const DEFAULT_MAX_REPAIR = 5;

export function buildVoidFixerSystemPrompt(h: RcaVoidHandover): string {
    return [
        'You are VOID-Fixer (Cline autonomous repair).',
        `Ticket: ${h.ticketId}`,
        `Target repo (locked): ${ROOT_REPO_PATH}`,
        `Relevant paths: ${h.relevantPaths.join(', ')}`,
        '',
        'Error / symptom:',
        h.rawError,
        '',
        'Instructions: edit only files under relevantPaths, preserve style, then verification must pass.'
    ].join('\n');
}

/** RCA + system instructions in Gemini `systemInstruction`; use for generateContent API calls. */
export function buildVoidFixerGeminiGenerateBody(h: RcaVoidHandover, userMessage: string): Record<string, unknown> {
    const systemInstructions = buildVoidFixerSystemPrompt(h);
    const rcaReport = [
        `Raw error / symptom:\n${h.rawError}`,
        `Relevant paths:\n${h.relevantPaths.join('\n')}`
    ].join('\n\n');
    const anchored = buildVoidFixerGeminiRequest({
        rcaReport,
        systemInstructions,
        userMessage
    });
    return toGenerateContentBody(anchored);
}

export { buildVoidFixerGeminiRequest, toGenerateContentBody } from '../integrations/gemini/geminiVoidMessages.js';
export { fetchWithGeminiRpmGuard, acquireGeminiRpmSlot } from '../integrations/gemini/rpmThrottler.js';

function sanitizeRefSegment(id: string): string {
    return id.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'ticket';
}

function parseGithubTreeUrl(remoteUrl: string, branch: string): string | undefined {
    const u = remoteUrl.trim();
    const gitSsh = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i.exec(u);
    if (gitSsh) {
        return `https://github.com/${gitSsh[1]}/${gitSsh[2]}/tree/${branch}`;
    }
    if (/^https?:\/\//i.test(u)) {
        const base = u.replace(/\.git$/i, '').replace(/\/$/, '');
        return `${base}/tree/${branch}`;
    }
    return undefined;
}

async function tryCheckoutBase(terminal: TerminalManager, base: string): Promise<string> {
    let r = await terminal.runGit(['checkout', base]);
    if (r.code === 0) {
        return base;
    }
    const alt = base === 'main' ? 'master' : 'main';
    r = await terminal.runGit(['checkout', alt]);
    if (r.code === 0) {
        return alt;
    }
    throw new Error(`git checkout ${base}/${alt} failed: ${r.stderr}`);
}

/**
 * VOID-Fixer entry: git handover → sparse paths → repair loop → commit → push → fix_manifest.json
 */
export async function startVoidFix(
    handover: RcaVoidHandover,
    terminal: TerminalManager,
    options?: {
        workspaceRoot?: string;
        onRepairAttempt?: (ctx: RepairAttemptContext) => Promise<void>;
        maxRepairIterations?: number;
    }
): Promise<{ manifest: FixManifestPayload }> {
    const repoRoot = resolveVoidRepoAbsolute(options?.workspaceRoot);
    const npmRoot = resolveNpmAppRoot(repoRoot);
    const npmSubcwd =
        path.resolve(npmRoot) === path.resolve(repoRoot) ? undefined : path.relative(repoRoot, npmRoot);
    if (npmSubcwd && (npmSubcwd.startsWith('..') || path.isAbsolute(npmSubcwd))) {
        throw new Error(`resolveNpmAppRoot left repo: ${npmRoot}`);
    }
    if (handover.targetRepo && !handover.targetRepo.includes('Focus-Flow')) {
        console.warn('[VOID-Fixer] targetRepo does not reference Focus-Flow; continuing with resolved path.');
    }
    if (npmSubcwd) {
        console.info(`[VOID-Fixer] Verification/npm cwd: ${npmRoot} (subcwd: ${npmSubcwd})`);
    }

    terminal.startVoidFixSession(options?.workspaceRoot);
    setVoidAutonomousActive(true, handover.ticketId);

    const branchSafe = sanitizeRefSegment(handover.ticketId);
    const fixBranch = `void-fix/${branchSafe}`;
    const baseBranch = handover.baseBranch ?? 'main';
    const maxAttempts = options?.maxRepairIterations ?? DEFAULT_MAX_REPAIR;

    let lastTerminalOutput = '';
    let attemptsUsed = 0;
    let testsPass = false;

    try {
        await tryCheckoutBase(terminal, baseBranch);
        let r = await terminal.runGit(['pull', '--ff-only']);
        if (r.code !== 0) {
            r = await terminal.runGit(['pull']);
        }
        if (r.code !== 0) {
            throw new Error(`git pull failed: ${r.stderr}`);
        }

        r = await terminal.runGit(['checkout', '-b', fixBranch]);
        if (r.code !== 0) {
            throw new Error(`git checkout -b ${fixBranch} failed: ${r.stderr}`);
        }

        if (process.env.VOID_USE_SPARSE_CHECKOUT === '1' && handover.relevantPaths.length > 0) {
            r = await terminal.runGit(['sparse-checkout', 'init', '--cone']);
            if (r.code !== 0) {
                throw new Error(`git sparse-checkout init failed: ${r.stderr}`);
            }
            r = await terminal.runGit(['sparse-checkout', 'set', ...handover.relevantPaths]);
            if (r.code !== 0) {
                throw new Error(`git sparse-checkout set failed: ${r.stderr}`);
            }
        } else if (handover.relevantPaths.length > 0) {
            console.info(
                '[VOID-Fixer] Skipping sparse-checkout — full tree preserved. Set VOID_USE_SPARSE_CHECKOUT=1 to enable.'
            );
        }

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            attemptsUsed = attempt;
            const ctx: RepairAttemptContext = {
                attempt,
                maxAttempts,
                rawError: handover.rawError,
                lastTerminalOutput,
                relevantPaths: handover.relevantPaths,
                repoRoot
            };
            if (options?.onRepairAttempt) {
                await options.onRepairAttempt(ctx);
            }

            const ver = await terminal.run(handover.verificationCommand, { subcwd: npmSubcwd });
            lastTerminalOutput = [ver.stdout, ver.stderr].filter(Boolean).join('\n');
            if (ver.code === 0) {
                testsPass = true;
                break;
            }
        }

        if (!testsPass) {
            throw new Error(
                `Verification did not pass after ${attemptsUsed} attempt(s). Last output:\n${lastTerminalOutput.slice(0, 4000)}`
            );
        }

        r = await terminal.runGit(['add', '-A']);
        if (r.code !== 0) {
            throw new Error(`git add failed: ${r.stderr}`);
        }
        r = await terminal.runGit(['commit', '-m', `VOID-Fixer: Automated repair for ${handover.ticketId}`]);
        if (r.code !== 0 && !/nothing to commit/i.test(r.stdout + r.stderr)) {
            throw new Error(`git commit failed: ${r.stderr}`);
        }

        if (process.env.VOID_SKIP_APPROVAL_JSON !== '1') {
            const approvalPath = await writePushApprovalPending({
                summary: `VOID-Fixer: commit ready for ${handover.ticketId} on ${fixBranch}.`,
                ticketId: handover.ticketId,
                branch: fixBranch
            });
            console.info(`[VOID-Fixer] approval.json pending (git push blocked): ${approvalPath}`);
            await waitForApprovalJsonApproved();
        }

        r = await terminal.runGit(['push', '-u', 'origin', fixBranch]);
        let remoteUrl: string | undefined;
        const rem = await terminal.runGit(['remote', 'get-url', 'origin']);
        if (rem.code === 0) {
            remoteUrl = parseGithubTreeUrl(rem.stdout, fixBranch);
        }
        if (r.code !== 0) {
            console.warn('[VOID-Fixer] git push failed (credentials or no remote):', r.stderr);
        }

        const manifest = await writeFixManifest(repoRoot, {
            ticket_id: handover.ticketId,
            branch_name: fixBranch,
            remote_branch_url: remoteUrl,
            summary: `Automated repair for ${handover.ticketId}. Verification: ${handover.verificationCommand}`,
            test_status: true,
            verification_command: handover.verificationCommand,
            attempts_used: attemptsUsed,
            created_at: new Date().toISOString(),
            manifest_path: ''
        });

        return { manifest };
    } finally {
        setVoidAutonomousActive(false);
        terminal.endVoidFixSession();
    }
}
