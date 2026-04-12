import 'dotenv/config';
import EventSource from 'eventsource';
import fetch, { Headers, type RequestInit as NodeFetchRequestInit } from 'node-fetch';
import chalk from 'chalk';
import { startVoidFix } from './void/voidFixer.js';
import { applyDefaultRcaJsonFromCwd, resolveHandoverForTicket } from './void/loadHandover.js';
import { runEngineeringOrchestrator } from './orchestrator/runEngineeringOrchestrator.js';

const BASE_URL = process.env.VOID_MCP_URL?.trim() || 'http://localhost:3000';
const AGENT_CREDENTIALS = {
    username: process.env.FIXAGENT_USERNAME?.trim() || 'fixagent',
    password: process.env.FIXAGENT_PASSWORD?.trim() || 'fixpass'
};

let authToken: string | null = null;
/** JWT `id` — used to resume IN_PROGRESS tickets we already claimed */
let fixAgentUserId: string | null = null;
let eventSource: EventSource | null = null;
/** True after startListening() so token refresh can reconnect SSE */
let listeningStarted = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;

/** Serialize ticket runs so sparse-checkout / git steps do not overlap */
let workChain: Promise<void> = Promise.resolve();

/** Avoid queuing the same ticket twice while a run is still in flight */
const ticketInFlight = new Set<string>();

const pendingPollMs = Math.max(0, parseInt(process.env.VOID_PENDING_POLL_MS || '45000', 10));

const log = {
    info: (msg: string) => console.log(chalk.blue('ℹ  ') + msg),
    success: (msg: string) => console.log(chalk.green('✔  ') + msg),
    warn: (msg: string) => console.log(chalk.yellow('⚠  ') + msg),
    error: (msg: string) => console.log(chalk.red('✖  ') + msg),
    agent: (msg: string) => console.log(chalk.magenta('🤖 [FixAgent] ') + msg)
};

/**
 * Authenticated MCP API call with one automatic re-login on 401 (expired JWT, server restart, JWT_SECRET change).
 */
async function authenticatedFetch(url: string, init: NodeFetchRequestInit = {}): Promise<Awaited<ReturnType<typeof fetch>>> {
    const headers = new Headers(init.headers as Headers | Record<string, string> | undefined);
    if (authToken) {
        headers.set('Authorization', `Bearer ${authToken}`);
    }
    let res = await fetch(url, { ...init, headers } as NodeFetchRequestInit);
    if (res.status === 401) {
        log.warn('MCP API returned 401 — re-authenticating (expired JWT or server restart)...');
        if (await login({ silent: true })) {
            const h = new Headers(init.headers as Headers | Record<string, string> | undefined);
            if (authToken) {
                h.set('Authorization', `Bearer ${authToken}`);
            }
            res = await fetch(url, { ...init, headers: h } as NodeFetchRequestInit);
        }
    }
    return res;
}

async function login(options?: { silent?: boolean }): Promise<boolean> {
    if (!options?.silent) {
        log.info(`Authenticating with MCP Server (${BASE_URL}) as ${AGENT_CREDENTIALS.username}...`);
    }
    try {
        const response = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(AGENT_CREDENTIALS)
        });

        const data = (await response.json()) as {
            success?: boolean;
            data?: { token?: string; user?: { id?: string; role?: string } };
            error?: string;
        };

        const token = data.data?.token;
        const uid = data.data?.user?.id;
        if (data.success && typeof token === 'string' && token.length > 0) {
            authToken = token;
            if (typeof uid === 'string' && uid.length > 0) {
                fixAgentUserId = uid;
            }
            if (!options?.silent) {
                log.success(`Authenticated as ${data.data?.user?.role ?? 'fix_agent'}`);
            }
            if (listeningStarted) {
                connectSSE();
            }
            return true;
        }
        log.error(`Login failed: ${data.error ?? 'no token in response'}`);
        return false;
    } catch (error) {
        log.error(`Connection error: ${error}`);
        return false;
    }
}

function connectSSE(): void {
    if (!authToken) {
        return;
    }
    if (eventSource) {
        try {
            eventSource.close();
        } catch {
            /* already closed */
        }
        eventSource = null;
    }

    log.info('Connecting to Event Stream...');
    eventSource = new EventSource(`${BASE_URL}/api/events?token=${authToken}`);

    eventSource.onopen = () => {
        log.success('Connected to MCP Event Stream');
        log.agent('Listening for new tickets (SSE + pending backlog)...');
    };

    eventSource.onmessage = (event: { data?: string }) => {
        try {
            const data = JSON.parse(String(event.data)) as { type?: string; payload?: Record<string, unknown> };
            void handleEvent(data);
        } catch {
            // keep-alive
        }
    };

    eventSource.onerror = () => {
        /* reconnect handled by eventsource */
    };
}

function scheduleProcessTicket(ticketId: string, reason: string): void {
    if (ticketInFlight.has(ticketId)) {
        return;
    }
    ticketInFlight.add(ticketId);
    workChain = workChain
        .then(async () => {
            log.info(`${reason}: queue ${ticketId}`);
            await processTicket(ticketId);
        })
        .catch((e) => {
            log.error(`Work queue error: ${e}`);
        })
        .finally(() => {
            ticketInFlight.delete(ticketId);
        });
}

async function fetchActionableTicketIds(): Promise<string[]> {
    const res = await authenticatedFetch(`${BASE_URL}/api/tickets`, {});
    const data = (await res.json()) as {
        success?: boolean;
        data?: { tickets?: Array<{ id: string }> };
        error?: string;
    };
    if (res.status === 401) {
        log.error('List tickets still unauthorized after re-login — check FIXAGENT_USERNAME / FIXAGENT_PASSWORD and MCP server.');
        return [];
    }
    if (!data.success || !data.data?.tickets) {
        return [];
    }
    return data.data.tickets.map((t) => t.id);
}

async function pollActionableTickets(reason: string): Promise<void> {
    let ids: string[];
    try {
        ids = await fetchActionableTicketIds();
    } catch (e) {
        log.error(`Failed to list tickets (${reason}): ${e}`);
        return;
    }
    if (ids.length === 0) {
        log.info(`${reason}: no PENDING / resumable IN_PROGRESS tickets`);
        return;
    }
    log.agent(`${reason}: found ${ids.length} ticket(s) to process (PENDING, REOPENED, or your IN_PROGRESS): ${ids.join(', ')}`);
    for (const id of ids) {
        scheduleProcessTicket(id, reason);
    }
}

function startListening(): void {
    if (!authToken) {
        return;
    }
    listeningStarted = true;
    connectSSE();
    if (pendingPollMs > 0 && !pollTimer) {
        pollTimer = setInterval(() => {
            void pollActionableTickets('poll');
        }, pendingPollMs);
    }
}

async function handleEvent(event: { type?: string; payload?: Record<string, unknown> }) {
    if (event.type === 'ticket.created') {
        const ticketId = event.payload?.ticket_id as string;
        log.agent(`New ticket detected: ${chalk.bold(ticketId)}`);
        log.info(`Title: ${event.payload?.title}`);
        log.info(`Component: ${event.payload?.component}`);

        scheduleProcessTicket(ticketId, 'sse');
    }
}

async function fetchTicket(ticketId: string): Promise<{
    id: string;
    title: string;
    description: string;
    component?: string;
    user_context?: unknown;
    status?: string;
    claimed_by?: string | null;
}> {
    const res = await authenticatedFetch(`${BASE_URL}/api/tickets/${ticketId}`, {});
    const data: any = await res.json();
    if (!data.success || !data.data?.ticket) {
        throw new Error(data.error || 'Failed to load ticket');
    }
    return data.data.ticket;
}

async function processTicket(ticketId: string) {
    let ticket: Awaited<ReturnType<typeof fetchTicket>>;
    try {
        ticket = await fetchTicket(ticketId);
    } catch (e) {
        log.error(`Failed to fetch ticket: ${e}`);
        return;
    }

    const st = ticket.status ?? 'PENDING';

    if (st === 'REVIEW_PENDING' || st === 'APPROVED_FOR_PROD' || st === 'CLOSED') {
        log.info(`Skip ${ticketId} — already ${st}`);
        return;
    }

    if (st === 'IN_PROGRESS') {
        if (fixAgentUserId && ticket.claimed_by && ticket.claimed_by !== fixAgentUserId) {
            log.info(`Skip ${ticketId} — IN_PROGRESS but claimed by another user`);
            return;
        }
        if (!fixAgentUserId) {
            log.warn(`Resume ${ticketId}: no local user id after login — proceeding if API listed this ticket`);
        }
        log.agent(`Resuming IN_PROGRESS ticket ${ticketId} (orchestrator / VOID-Fixer)...`);
    } else if (st === 'PENDING' || st === 'REOPENED') {
        log.agent(`Claiming ticket ${ticketId}...`);
        const claimRes = await authenticatedFetch(`${BASE_URL}/api/tickets/${ticketId}/claim`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });

        if (!claimRes.ok) {
            let msg = claimRes.statusText;
            try {
                const err = (await claimRes.json()) as { error?: string };
                if (err.error) msg = err.error;
            } catch {
                /* use statusText */
            }
            if (msg.includes('Cannot claim ticket with status')) {
                log.info(`Skip ${ticketId} (state changed): ${msg}`);
            } else {
                log.error(`Failed to claim ticket: ${msg}`);
            }
            return;
        }
        log.success('Ticket claimed successfully.');
        try {
            ticket = await fetchTicket(ticketId);
        } catch (e) {
            log.error(`Failed to re-fetch ticket: ${e}`);
            return;
        }
    } else {
        log.info(`Skip ${ticketId} — unsupported status ${st}`);
        return;
    }

    const orchMode =
        process.env.VOID_ORCHESTRATOR_MODE === '1' || process.env.VOID_ORCH_MODE === '1';
    if (orchMode) {
        log.agent('Engineering Orchestrator mode (Cline → verify → senior gate → deploy)...');
        try {
            const { branch } = await runEngineeringOrchestrator({
                id: ticket.id,
                title: ticket.title,
                description: ticket.description,
                component: ticket.component,
                user_context:
                    ticket.user_context && typeof ticket.user_context === 'object'
                        ? (ticket.user_context as Record<string, unknown>)
                        : undefined
            });
            log.success('Orchestrator pipeline completed.');
            const submitRes = await authenticatedFetch(`${BASE_URL}/api/tickets/${ticketId}/submit_fix`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    summary: `Engineering Orchestrator: pushed ${branch} (Focus-Flow-). Awaiting merge per process.`,
                    files_modified: [],
                    diff: '(orchestrator — see branch on remote)',
                    test_results: { status: 'PASS', logs: `branch: ${branch}` }
                })
            });
            if (submitRes.ok) {
                log.info('Ticket updated to REVIEW_PENDING with orchestrator summary.');
            } else {
                const err: any = await submitRes.json().catch(() => ({}));
                log.warn(`Could not submit_fix metadata: ${err.error || submitRes.statusText}`);
            }
        } catch (e) {
            log.error(`Orchestrator failed: ${e}`);
        }
        return;
    }

    let handover;
    try {
        handover = await resolveHandoverForTicket(ticketId, ticket.user_context, {
            title: ticket.title,
            description: ticket.description
        });
    } catch (e) {
        log.error(String(e));
        return;
    }

    log.agent('Starting VOID-Fixer (branch → verify → manifest; sparse-checkout only if VOID_USE_SPARSE_CHECKOUT=1)...');
    let result;
    try {
        result = await startVoidFix(handover);
    } catch (e) {
        log.error(`VOID-Fixer failed: ${e}`);
        return;
    }

    const { manifest, diff } = result;
    const testStatus = manifest.test_status ? 'PASS' : 'FAIL';

    log.agent('Submitting fix for review...');
    const fixPayload = {
        summary: manifest.summary,
        files_modified: manifest.files_modified,
        diff: diff || '(no diff)',
        sandbox_preview_url: process.env.VOID_SANDBOX_PREVIEW_URL,
        test_results: {
            status: testStatus,
            logs: `verification: ${manifest.verification_command}\nattempts: ${manifest.attempts_used}\nmanifest: ${manifest.manifest_path}`
        }
    };

    const submitRes = await authenticatedFetch(`${BASE_URL}/api/tickets/${ticketId}/submit_fix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fixPayload)
    });

    if (submitRes.ok) {
        log.success('Fix submitted successfully.');
        log.info(`Branch: ${manifest.branch_name}`);
        log.info(`Manifest: ${manifest.manifest_path}`);
        log.info('Waiting for admin approval...');
    } else {
        const err: any = await submitRes.json();
        log.error(`Failed to submit fix: ${err.error}`);
    }
}

async function main() {
    process.stdout.write('\x1Bc');
    console.log(chalk.bold.cyan('🤖 VOID Fix Agent v1.0'));
    console.log('==========================\n');

    const loggedIn = await login();
    if (loggedIn) {
        const orch =
            process.env.VOID_ORCHESTRATOR_MODE === '1' || process.env.VOID_ORCH_MODE === '1';
        if (orch) {
            log.info('VOID_ORCHESTRATOR_MODE: Cline → verify → senior approval → fix/ticket-* push');
        } else {
            const defaultRca = await applyDefaultRcaJsonFromCwd();
            if (defaultRca) {
                log.info(`Using default RCA handover file: ${defaultRca}`);
            } else {
                log.warn(
                    'No VOID_RCA_JSON_PATH and no rca-handover.example.json in cwd — set user_context.rca on tickets or VOID_RCA_JSON_PATH.'
                );
            }
        }
        startListening();
        void pollActionableTickets('startup');
    }
}

main();
