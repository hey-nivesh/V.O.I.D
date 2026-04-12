// API Client for MCP Server
const API_BASE = '';

// Get token from localStorage
const getToken = (): string | null => localStorage.getItem('void_token');

// Generic fetch wrapper
async function apiFetch<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<{ success: boolean; data?: T; error?: string }> {
    const token = getToken();

    const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
        ...options.headers,
    };

    try {
        const response = await fetch(`${API_BASE}${endpoint}`, {
            ...options,
            headers,
        });

        const data = await response.json();
        return data;
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Network error',
        };
    }
}

// Auth API
export const authAPI = {
    login: (username: string, password: string) =>
        apiFetch<{ token: string; user: { id: string; username: string; role: string } }>(
            '/auth/login',
            {
                method: 'POST',
                body: JSON.stringify({ username, password }),
            }
        ),

    me: () => apiFetch<{ user: { id: string; username: string; role: string } }>('/auth/me'),
};

// Tickets API
export const ticketsAPI = {
    list: (status?: string) =>
        apiFetch<{ tickets: Ticket[] }>(`/api/tickets${status ? `?status=${status}` : ''}`),

    get: (ticketId: string) =>
        apiFetch<{ ticket: Ticket }>(`/api/tickets/${ticketId}`),

    create: (data: CreateTicketData) =>
        apiFetch<{ ticket_id: string; status: string; created_at: string }>(
            '/api/tickets',
            {
                method: 'POST',
                body: JSON.stringify(data),
            }
        ),

    approve: (ticketId: string, approvedBy: string, note?: string) =>
        apiFetch<{ status: string }>(`/api/tickets/${ticketId}/approve`, {
            method: 'POST',
            body: JSON.stringify({ approved_by: approvedBy, note }),
        }),

    reject: (ticketId: string, reason: string, requestChanges?: boolean) =>
        apiFetch<{ status: string }>(`/api/tickets/${ticketId}/reject`, {
            method: 'POST',
            body: JSON.stringify({ reason, request_changes: requestChanges }),
        }),
};

/** Git push gate (orchestrator / VOID-Fixer) — same file as fix-agent `v.o.i.d/approval.json` */
export interface PushApprovalState {
    status: 'pending' | 'approved' | 'rejected';
    summary?: string;
    ticketId?: string;
    branch?: string;
    updatedAt?: string;
    decidedBy?: string;
    decisionNote?: string;
}

export const pushApprovalAPI = {
    get: () => apiFetch<{ approval: PushApprovalState | null }>('/api/push-approval'),

    setStatus: (status: 'approved' | 'rejected', note?: string) =>
        apiFetch<{ approval: PushApprovalState }>('/api/push-approval', {
            method: 'POST',
            body: JSON.stringify({ status, note })
        })
};

// System API
export const systemAPI = {
    status: () => apiFetch<{
        active_connections: number;
        connected_agents: Array<{ username: string; role: string }>
    }>('/api/events/status'),
};

// Diagnosis API
export const diagnosisAPI = {
    start: (ticketId: string, force = false) =>
        apiFetch<{ ticket_id: string; diagnosis_status: string; message: string }>(
            `/api/diagnosis/${ticketId}/start`,
            {
                method: 'POST',
                body: JSON.stringify({ force }),
            }
        ),

    getReport: (ticketId: string) =>
        apiFetch<{
            ticket_id: string;
            diagnosis_status: string;
            rca_report: any;
            patient_zero: { file: string; line: number } | null;
        }>(`/api/diagnosis/${ticketId}/report`),
};

// Tunnel API
export const tunnelAPI = {
    start: (ticketId: string, port = 8080) => // Defaulting admin app to 8080
        apiFetch<{ tunnel_url: string; status: string; cloudflared_available: boolean }>(
            '/api/tunnel/start',
            {
                method: 'POST',
                body: JSON.stringify({ ticket_id: ticketId, port }),
            }
        ),

    stop: (ticketId: string) =>
        apiFetch<{ message: string }>(
            '/api/tunnel/stop',
            {
                method: 'POST',
                body: JSON.stringify({ ticket_id: ticketId }),
            }
        ),

    getStatus: (ticketId: string) =>
        apiFetch<{ tunnel: any; cloudflared_available: boolean }>(`/api/tunnel/status/${ticketId}`),
};

// Types
export type TicketStatus = 'PENDING' | 'IN_PROGRESS' | 'REVIEW_PENDING' | 'APPROVED_FOR_PROD' | 'CLOSED' | 'REOPENED';

export interface Ticket {
    id: string;
    title: string;
    description: string;
    component: string;
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    status: TicketStatus;
    user_context: Record<string, unknown>;
    diff?: string;
    files_modified?: string[];
    sandbox_preview_url?: string;
    test_results?: { status: string; logs?: string };
    claimed_by?: string;
    approved_by?: string;
    approval_note?: string;
    rejection_reason?: string;
    created_at: string;
    updated_at: string;
}

export interface CreateTicketData {
    title: string;
    description: string;
    component: string;
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    user_context?: Record<string, unknown>;
}

// SSE connection
export function createSSEConnection(
    onEvent: (event: { type: string; payload: Record<string, unknown>; timestamp: string }) => void,
    onError?: (error: Error) => void
): () => void {
    const token = getToken();
    if (!token) {
        onError?.(new Error('No auth token'));
        return () => { };
    }

    // Use EventSource polyfill with headers
    const eventSource = new EventSource(`${API_BASE}/api/events`, {
        // Note: EventSource doesn't support custom headers natively
        // We'll need to use a different approach or proxy
    } as EventSourceInit);

    eventSource.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            onEvent(data);
        } catch (e) {
            console.error('Failed to parse SSE event:', e);
        }
    };

    eventSource.onerror = (event) => {
        console.error('SSE error:', event);
        onError?.(new Error('SSE connection error'));
    };

    return () => eventSource.close();
}

export { getToken };
