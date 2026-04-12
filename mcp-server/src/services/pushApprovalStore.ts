// ============================================
// Git push gate (approval.json) — shared with fix-agent / cline-void
// ============================================

import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

export interface PushApprovalState {
    status: 'pending' | 'approved' | 'rejected';
    summary?: string;
    ticketId?: string;
    branch?: string;
    updatedAt?: string;
    decidedBy?: string;
    decisionNote?: string;
}

export function resolvePushApprovalJsonPath(): string {
    const explicit = process.env.VOID_APPROVAL_JSON_PATH?.trim();
    if (explicit) {
        return path.resolve(explicit);
    }
    const wr = process.env.VOID_WORKSPACE_ROOT?.trim();
    if (wr) {
        return path.join(path.resolve(wr), 'v.o.i.d', 'approval.json');
    }
    return path.resolve(process.cwd(), '..', 'v.o.i.d', 'approval.json');
}

export async function readPushApproval(): Promise<PushApprovalState | null> {
    const file = resolvePushApprovalJsonPath();
    try {
        const raw = await fsPromises.readFile(file, 'utf8');
        return JSON.parse(raw) as PushApprovalState;
    } catch (e: unknown) {
        const err = e as NodeJS.ErrnoException;
        if (err.code === 'ENOENT') {
            return null;
        }
        throw e;
    }
}

export function readPushApprovalSync(): PushApprovalState | null {
    const file = resolvePushApprovalJsonPath();
    try {
        const raw = fs.readFileSync(file, 'utf8');
        return JSON.parse(raw) as PushApprovalState;
    } catch (e: unknown) {
        const err = e as NodeJS.ErrnoException;
        if (err.code === 'ENOENT') {
            return null;
        }
        throw e;
    }
}

export async function writePushApproval(state: PushApprovalState): Promise<void> {
    const file = resolvePushApprovalJsonPath();
    await fsPromises.mkdir(path.dirname(file), { recursive: true });
    await fsPromises.writeFile(file, JSON.stringify(state, null, 2), 'utf8');
}
