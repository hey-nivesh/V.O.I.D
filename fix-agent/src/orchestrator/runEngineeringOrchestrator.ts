import fs from 'node:fs/promises';
import path from 'node:path';
import { assertClineReachable } from './clineBridge.js';
import { orchestratorDir, resolveFocusFlowRoot, resolveNpmProjectRoot } from './config.js';
import { extractAffectedFileHints } from './extractAffected.js';
import { deployApprovedFix } from './gitDeploy.js';
import { buildWorkerInstruction } from './workerPrompt.js';
import { runVerification } from './verify.js';
import { approvalMarkerPath, sanitizeTicketForBranch, waitForSeniorApproval, writeSeniorReviewRequest } from './seniorGate.js';
import { waitForPath } from './waitFile.js';

export interface TicketRecord {
    id: string;
    title: string;
    description: string;
    component?: string;
    user_context?: Record<string, unknown>;
}

const log = {
    info: (m: string) => console.log(`[orchestrator] ${m}`),
    warn: (m: string) => console.warn(`[orchestrator] ${m}`)
};

/**
 * AI Engineering Orchestrator: Cline delegation → verify → senior gate → git deploy.
 */
export async function runEngineeringOrchestrator(ticket: TicketRecord): Promise<{ branch: string }> {
    const focusRoot = resolveFocusFlowRoot();
    const npmRoot = resolveNpmProjectRoot(focusRoot);
    const ticketId = ticket.id;
    const affected = extractAffectedFileHints(ticket.description, ticket.user_context);

    log.info(`Focus-Flow root: ${focusRoot}`);
    if (path.resolve(npmRoot) !== path.resolve(focusRoot)) {
        log.info(`npm / Vite project root (verify cwd): ${npmRoot}`);
    }
    log.info(`Affected file hints: ${affected.length ? affected.join(', ') : '(none — infer in Cline)'}`);

    await assertClineReachable();

    const dir = orchestratorDir(focusRoot);
    await fs.mkdir(dir, { recursive: true });

    const instruction = buildWorkerInstruction({
        ticketId,
        title: ticket.title,
        description: ticket.description,
        component: ticket.component,
        focusFlowRoot: focusRoot,
        npmProjectRoot: npmRoot,
        affectedHints: affected
    });

    const workerFile = path.join(dir, `WORKER_INSTRUCTION_${ticketId}.md`);
    await fs.writeFile(workerFile, instruction, 'utf8');
    log.info(`Worker instruction written: ${workerFile}`);
    log.info('Paste the contents into your Cline session on the local port, or use your Cline automation if available.');

    const readyMarker = path.join(dir, `CLINE_READY_${ticketId}`);
    const skipClineWait = process.env.VOID_ORCH_SKIP_CLINE_WAIT === '1';
    if (!skipClineWait) {
        log.info(
            `Waiting for Cline completion marker: ${readyMarker} (touch this file when the worker is done), or set VOID_ORCH_SKIP_CLINE_WAIT=1`
        );
        const readyTimeout = parseInt(process.env.VOID_ORCH_CLINE_READY_TIMEOUT_MS || `${7200_000}`, 10);
        await waitForPath(readyMarker, {
            timeoutMs: readyTimeout,
            pollMs: 4000,
            label: 'Cline ready marker'
        });
        log.info('Cline ready marker detected.');
    } else {
        log.warn('Skipping Cline ready wait (VOID_ORCH_SKIP_CLINE_WAIT=1).');
    }

    const verify = await runVerification(focusRoot);
    if (!verify.ok) {
        log.warn(`Verification failed (exit non-zero). Output:\n${verify.stderr || verify.stdout}`);
        throw new Error('Internal verification failed; fix build/lint before senior review.');
    }
    log.info('Verification command succeeded.');

    const reviewPath = await writeSeniorReviewRequest({
        focusRoot,
        ticketId,
        summary: `Worker completed; hints: ${affected.join(', ') || 'see repo diff'}`,
        verifyLog: verify.stdout + verify.stderr
    });
    log.info(`Senior dev packet written: ${reviewPath}`);
    log.info(
        `BLOCKED on senior approval. Create ${approvalMarkerPath(focusRoot, ticketId)} with first line "Approved" to continue.`
    );

    const skipApproval = process.env.VOID_ORCH_SKIP_APPROVAL === '1';
    if (!skipApproval) {
        await waitForSeniorApproval(focusRoot, ticketId);
    } else {
        log.warn('VOID_ORCH_SKIP_APPROVAL=1 — skipping human approval (dev only).');
    }

    const { branch } = await deployApprovedFix({
        focusRoot,
        ticketId,
        ticketTitle: ticket.title
    });

    log.info(`Pushed branch: ${branch}`);
    log.info('Notify stakeholders that the fix is on the remote branch pending merge (main/develop untouched).');
    return { branch };
}
