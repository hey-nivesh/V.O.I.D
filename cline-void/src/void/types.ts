/**
 * Minimal RCA JSON for VOID-Fixer (Cline handover).
 * Compatible with extended Gatekeeper payloads when merged at call site.
 */
export interface RcaVoidHandover {
    ticketId: string;
    /** Logical path segment, e.g. "v.o.i.d/Focus-Flow-" */
    targetRepo: string;
    relevantPaths: string[];
    rawError: string;
    verificationCommand: string;
    /** Default `main` */
    baseBranch?: string;
}

export interface FixManifestPayload {
    ticket_id: string;
    branch_name: string;
    remote_branch_url?: string;
    summary: string;
    test_status: boolean;
    verification_command: string;
    attempts_used: number;
    created_at: string;
    manifest_path: string;
}

export type RepairAttemptContext = {
    attempt: number;
    maxAttempts: number;
    rawError: string;
    lastTerminalOutput: string;
    relevantPaths: string[];
    repoRoot: string;
};
