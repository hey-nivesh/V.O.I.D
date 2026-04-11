import fs from 'node:fs/promises';
import path from 'node:path';

const POLL_MS = 10_000;

export interface ApprovalJson {
    status: 'pending' | 'approved' | 'rejected';
    summary?: string;
    ticketId?: string;
    branch?: string;
    updatedAt?: string;
}

export function resolveApprovalJsonPath(): string {
    const explicit = process.env.VOID_APPROVAL_JSON_PATH?.trim();
    if (explicit) {
        return path.resolve(explicit);
    }
    const root = process.env.VOID_WORKSPACE_ROOT?.trim() || path.resolve(process.cwd(), '..');
    return path.join(root, 'v.o.i.d', 'approval.json');
}

export async function writePushApprovalPending(params: { summary: string; ticketId: string; branch: string }): Promise<string> {
    const file = resolveApprovalJsonPath();
    await fs.mkdir(path.dirname(file), { recursive: true });
    const payload: ApprovalJson = {
        status: 'pending',
        summary: params.summary,
        ticketId: params.ticketId,
        branch: params.branch,
        updatedAt: new Date().toISOString()
    };
    await fs.writeFile(file, JSON.stringify(payload, null, 2), 'utf8');
    return file;
}

export async function waitForApprovalJsonApproved(): Promise<ApprovalJson> {
    const file = resolveApprovalJsonPath();
    const deadline = Date.now() + parseInt(process.env.VOID_APPROVAL_TIMEOUT_MS || '86400000', 10);
    while (Date.now() < deadline) {
        try {
            const raw = await fs.readFile(file, 'utf8');
            const j = JSON.parse(raw) as ApprovalJson;
            if (j.status === 'approved') {
                return j;
            }
            if (j.status === 'rejected') {
                throw new Error('Push blocked: approval.json status is "rejected".');
            }
        } catch (e: unknown) {
            const err = e as NodeJS.ErrnoException;
            if (err?.code === 'ENOENT') {
                /* wait for file */
            } else if (e instanceof SyntaxError) {
                /* invalid JSON */
            } else {
                throw e;
            }
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
    }
    throw new Error(`Timeout waiting for approval.json (status approved) at ${file}`);
}
