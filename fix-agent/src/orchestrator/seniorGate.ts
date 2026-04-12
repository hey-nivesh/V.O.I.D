import fs from 'node:fs/promises';
import path from 'node:path';
import fetch from 'node-fetch';
import { orchestratorDir } from './config.js';
import { waitForPath } from './waitFile.js';

export async function writeSeniorReviewRequest(params: {
    focusRoot: string;
    ticketId: string;
    summary: string;
    verifyLog: string;
}): Promise<string> {
    const dir = orchestratorDir(params.focusRoot);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `senior-review-${params.ticketId}.md`);
    const body = [
        '# Senior developer review requested',
        '',
        `Ticket **${params.ticketId}** has been addressed by the Fixing Worker in this repository.`,
        'The orchestrator has run a local verification step.',
        '',
        '## Summary of changes',
        params.summary,
        '',
        '## Verification output (excerpt)',
        '```',
        params.verifyLog.slice(0, 12000),
        '```',
        '',
        '---',
        '**Action:** If approved, create the approval marker file (see orchestrator README) or reply via configured channel.',
        '',
        `> Kindly review the changes. If approved, the orchestrator will push to branch \`fix/ticket-${params.ticketId}\` (sanitized).`
    ].join('\n');
    await fs.writeFile(file, body, 'utf8');

    const webhook = process.env.VOID_SENIOR_WEBHOOK_URL?.trim();
    if (webhook) {
        try {
            await fetch(webhook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ticket_id: params.ticketId,
                    message: `Ticket ${params.ticketId} ready for senior review. Summary: ${params.summary.slice(0, 500)}`,
                    review_file: file
                })
            });
        } catch (e) {
            console.warn('[orchestrator] Senior webhook failed:', e);
        }
    }

    return file;
}

export function approvalMarkerPath(focusRoot: string, ticketId: string): string {
    return path.join(orchestratorDir(focusRoot), `approval-${sanitizeTicketForBranch(ticketId)}`);
}

/** Branch segment: fix/ticket-<id> — sanitize for git ref safety */
export function sanitizeTicketForBranch(ticketId: string): string {
    return ticketId.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'ticket';
}

export async function waitForSeniorApproval(focusRoot: string, ticketId: string): Promise<void> {
    const marker = approvalMarkerPath(focusRoot, ticketId);
    const timeoutMs = Math.max(
        60_000,
        parseInt(process.env.VOID_ORCH_APPROVAL_TIMEOUT_MS || `${86400_000}`, 10)
    );
    await waitForPath(marker, {
        timeoutMs,
        pollMs: 5000,
        label: 'senior approval file'
    });
    const raw = await fs.readFile(marker, 'utf8').catch(() => '');
    const first = raw.split(/\r?\n/)[0]?.trim().toLowerCase() ?? '';
    if (!first.includes('approved')) {
        throw new Error(`Approval file exists but first line must contain "Approved" (got: ${JSON.stringify(first)})`);
    }
}
