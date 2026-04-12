// ============================================
// VOID MCP Server - Type Definitions
// ============================================

// User Roles
export type UserRole = 'voice_agent' | 'fix_agent' | 'admin';

// Ticket Status
export type TicketStatus =
    | 'PENDING'
    | 'IN_PROGRESS'
    | 'REVIEW_PENDING'
    | 'APPROVED_FOR_PROD'
    | 'CLOSED'
    | 'REOPENED';

// Priority Levels
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

// User Context from Voice Agent
export interface UserContext {
    user_id?: string;
    route?: string;
    device?: string;
    logs?: string[];
    [key: string]: unknown;
}

// Test Results
export interface TestResults {
    status: 'PASS' | 'FAIL' | 'PENDING';
    logs?: string;
    [key: string]: unknown;
}

// ============================================
// Database Models
// ============================================

export interface User {
    id: string;
    username: string;
    password_hash: string;
    role: UserRole;
    created_at: string;
}

export interface Ticket {
    id: string;
    title: string;
    description: string;
    component: string;
    priority: Priority;
    status: TicketStatus;
    user_context: UserContext;
    diff?: string;
    files_modified?: string[];
    sandbox_preview_url?: string;
    test_results?: TestResults;
    claimed_by?: string;
    approved_by?: string;
    approval_note?: string;
    rejection_reason?: string;
    created_at: string;
    updated_at: string;
}

export interface AuditLog {
    id: string;
    actor: string;
    action: string;
    payload: Record<string, unknown>;
    timestamp: string;
}

export interface Preview {
    id: string;
    ticket_id: string;
    preview_url: string;
    expires_at?: string;
    created_at: string;
}

// ============================================
// API Request/Response Types
// ============================================

// Auth
export interface LoginRequest {
    username: string;
    password: string;
}

export interface LoginResponse {
    token: string;
    user: {
        id: string;
        username: string;
        role: UserRole;
    };
}

// Tickets
export interface CreateTicketRequest {
    title: string;
    description: string;
    component: string;
    priority: Priority;
    user_context?: UserContext;
    attachments?: string[];
}

export interface CreateTicketResponse {
    ticket_id: string;
    status: TicketStatus;
    created_at: string;
}

export interface ClaimTicketRequest {
    agent_id?: string;
}

export interface SubmitFixRequest {
    summary: string;
    files_modified: string[];
    diff: string;
    sandbox_preview_url?: string;
    test_results?: TestResults;
}

export interface ApproveTicketRequest {
    approved_by: string;
    note?: string;
}

export interface RejectTicketRequest {
    reason: string;
    request_changes?: boolean;
}

// Previews
export interface RegisterPreviewRequest {
    ticket_id: string;
    preview_url: string;
    expires_at?: string;
}

// ============================================
// SSE Event Types
// ============================================

export type SSEEventType =
    | 'ticket.created'
    | 'ticket.claimed'
    | 'ticket.submitted_fix'
    | 'ticket.approved'
    | 'ticket.rejected'
    | 'preview.registered'
    | 'push_approval.changed';

export interface SSEEvent {
    type: SSEEventType;
    payload: Record<string, unknown>;
    timestamp: string;
}

// ============================================
// JWT Payload
// ============================================

export interface JWTPayload {
    id: string;
    username: string;
    role: UserRole;
    iat?: number;
    exp?: number;
}

// ============================================
// API Response Wrapper
// ============================================

export interface APIResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
}
