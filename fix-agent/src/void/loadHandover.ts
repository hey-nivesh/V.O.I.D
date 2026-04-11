import fs from 'node:fs/promises';
import path from 'node:path';
import type { RCAHandover } from './types.js';

/** Default scope: tickets fix the Focus-Flow- app unless VOID_PRODUCT_FIX_SCOPE_DISABLE=1 or handover already sets product_fix_scope. */
const DEFAULT_PRODUCT_FIX_SCOPE =
    'User-facing fixes must be implemented in the Focus-Flow- app repository in this workspace, not in fix-agent, mcp-server, or other sibling folders unless the ticket explicitly targets those.';

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isRcaShape(o: Record<string, unknown>): boolean {
    return (
        isRecord(o.metadata) &&
        typeof o.metadata.ticket_id === 'string' &&
        isRecord(o.gatekeeper_context) &&
        typeof o.gatekeeper_context.sandbox_path === 'string' &&
        isRecord(o.sherlock_diagnosis) &&
        isRecord(o.void_fixer_instructions)
    );
}

export async function loadRcaHandoverFromFile(filePath: string): Promise<RCAHandover> {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !isRcaShape(parsed)) {
        throw new Error(`Invalid RCA handover JSON: ${filePath}`);
    }
    return parsed as unknown as RCAHandover;
}

/** If ticket API stores the full protocol object under user_context.rca or as user_context root */
export function parseRcaFromTicketUserContext(raw: unknown): RCAHandover | null {
    if (!isRecord(raw)) {
        return null;
    }
    const candidate = isRecord(raw.rca) ? raw.rca : raw;
    if (!isRecord(candidate) || !isRcaShape(candidate)) {
        return null;
    }
    return candidate as unknown as RCAHandover;
}

export interface TicketMetaForHandover {
    title?: string;
    description?: string;
}

/**
 * Fold API ticket fields into the handover so manual tickets (voice/MCP) set the real user concern
 * while VOID_RCA_JSON_PATH still supplies branch/paths/verify defaults.
 */
export function mergeTicketMetaIntoHandover(
    handover: RCAHandover,
    ticketUserContext: unknown,
    meta: TicketMetaForHandover
): RCAHandover {
    const uc = isRecord(ticketUserContext) ? ticketUserContext : {};
    const userConcern =
        typeof uc.user_concern === 'string' && uc.user_concern.trim() ? uc.user_concern.trim() : '';
    const area = typeof uc.area === 'string' && uc.area.trim() ? uc.area.trim() : '';
    const steps =
        typeof uc.steps_to_reproduce === 'string' && uc.steps_to_reproduce.trim()
            ? uc.steps_to_reproduce.trim()
            : '';
    const productHint =
        typeof uc.product === 'string' && uc.product.trim()
            ? uc.product.trim()
            : 'Focus-Flow- (local workspace clone)';

    const lines: string[] = [];
    if (meta.title?.trim()) lines.push(`Title: ${meta.title.trim()}`);
    if (meta.description?.trim()) lines.push(`Description: ${meta.description.trim()}`);
    if (userConcern) lines.push(`User concern: ${userConcern}`);
    if (area) lines.push(`Area: ${area}`);
    if (steps) lines.push(`Steps to reproduce: ${steps}`);
    if (lines.length > 0) {
        lines.push(`Product / repo: ${productHint}`);
    }

    if (lines.length === 0) {
        return handover;
    }

    const block = lines.join('\n');
    const prev = handover.sherlock_diagnosis.issue_summary?.trim() || '';
    const issue_summary =
        prev && !/^example:/i.test(prev)
            ? `${prev}\n\n---\n[From ticket]\n${block}`
            : block;

    let relevant_paths = [...handover.sherlock_diagnosis.relevant_paths];
    if (Array.isArray(uc.relevant_paths) && uc.relevant_paths.every((p) => typeof p === 'string')) {
        const extra = uc.relevant_paths as string[];
        relevant_paths = [...new Set([...relevant_paths, ...extra])];
    }

    return {
        ...handover,
        sherlock_diagnosis: {
            ...handover.sherlock_diagnosis,
            issue_summary,
            relevant_paths
        },
        void_fixer_instructions: {
            ...handover.void_fixer_instructions,
            styling_rules: `${handover.void_fixer_instructions.styling_rules}\n\n[User-reported context — fix in ${productHint}]\n${block}`.trim()
        }
    };
}

function enrichHandoverWithProductScope(handover: RCAHandover): RCAHandover {
    if (process.env.VOID_PRODUCT_FIX_SCOPE_DISABLE === '1') {
        return handover;
    }
    const extra = process.env.VOID_PRODUCT_FIX_CONTEXT?.trim();
    const repoPath = process.env.VOID_DEFAULT_PRODUCT_REPO?.trim();
    const existingScope = handover.hyper_context_payload?.product_fix_scope?.trim();
    const scopeText = existingScope
        ? [existingScope, extra].filter(Boolean).join(' ')
        : [DEFAULT_PRODUCT_FIX_SCOPE, extra].filter(Boolean).join(' ');

    const stylingAppend = `\n\n[Product scope] ${scopeText}`;
    const styling = handover.void_fixer_instructions.styling_rules.includes('[Product scope]')
        ? handover.void_fixer_instructions.styling_rules
        : `${handover.void_fixer_instructions.styling_rules}${stylingAppend}`.trim();

    return {
        ...handover,
        void_fixer_instructions: {
            ...handover.void_fixer_instructions,
            styling_rules: styling
        },
        hyper_context_payload: {
            ...handover.hyper_context_payload,
            product_fix_scope: scopeText,
            ...(repoPath ? { product_fix_repo_path: repoPath } : {})
        }
    };
}

/**
 * If VOID_RCA_JSON_PATH is unset, use ./rca-handover.example.json when present (local dev).
 * Set VOID_SKIP_DEFAULT_RCA=1 to disable.
 */
export async function applyDefaultRcaJsonFromCwd(): Promise<string | null> {
    if (process.env.VOID_RCA_JSON_PATH?.trim()) {
        return process.env.VOID_RCA_JSON_PATH.trim();
    }
    if (process.env.VOID_SKIP_DEFAULT_RCA === '1') {
        return null;
    }
    const candidate = path.join(process.cwd(), 'rca-handover.example.json');
    try {
        await fs.access(candidate);
        process.env.VOID_RCA_JSON_PATH = candidate;
        return candidate;
    } catch {
        return null;
    }
}

/** Prefer file path from env or ./rca-handover.example.json; merge ticket title/description into handover. */
export async function resolveHandoverForTicket(
    ticketId: string,
    ticketUserContext: unknown,
    meta: TicketMetaForHandover = {}
): Promise<RCAHandover> {
    const fromApi = parseRcaFromTicketUserContext(ticketUserContext);
    if (fromApi) {
        const withId =
            fromApi.metadata.ticket_id !== ticketId
                ? { ...fromApi, metadata: { ...fromApi.metadata, ticket_id: ticketId } }
                : fromApi;
        const merged = mergeTicketMetaIntoHandover(withId, ticketUserContext, meta);
        return enrichHandoverWithProductScope(merged);
    }

    let pathToUse = process.env.VOID_RCA_JSON_PATH?.trim() ?? '';
    if (!pathToUse) {
        const candidate = path.join(process.cwd(), 'rca-handover.example.json');
        try {
            await fs.access(candidate);
            pathToUse = candidate;
        } catch {
            pathToUse = '';
        }
    }

    if (pathToUse) {
        const handover = await loadRcaHandoverFromFile(pathToUse);
        const withId = { ...handover, metadata: { ...handover.metadata, ticket_id: ticketId } };
        const merged = mergeTicketMetaIntoHandover(withId, ticketUserContext, meta);
        return enrichHandoverWithProductScope(merged);
    }
    throw new Error(
        'No RCA handover: set user_context.rca on the ticket, place rca-handover.example.json in cwd, or set VOID_RCA_JSON_PATH.'
    );
}
