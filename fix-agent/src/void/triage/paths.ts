import fs from 'node:fs/promises';
import path from 'node:path';

/** Workspace root (V.O.I.D monorepo). */
export function resolveWorkspaceRoot(): string {
    const w = process.env.VOID_WORKSPACE_ROOT?.trim();
    if (w) return path.resolve(w);
    return path.resolve(process.cwd(), '..');
}

/** Gatekeeper-ready: v.o.i.d/.void/incidents/S2R_<ticketId>.json */
export function resolveS2RManifestPath(ticketId: string): string {
    const safe = ticketId.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
    const root = resolveWorkspaceRoot();
    return path.join(root, 'v.o.i.d', '.void', 'incidents', `S2R_${safe}.json`);
}

export async function ensureIncidentsDir(filePath: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
}
