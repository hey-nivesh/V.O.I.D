/**
 * VOID Protocol v1.0.0 — inter-agent handover (Gatekeeper + Sherlock → Void-Fixer)
 */

export interface HandoverMetadata {
    protocol_version: string;
    timestamp: string;
    ticket_id: string;
    priority: string;
}

export interface GatekeeperContext {
    session_id: string;
    jit_token: string;
    expiry_unix: number;
    sandbox_path: string;
}

export interface PatientZero {
    file: string;
    line_number?: number;
    code_snippet?: string;
}

export interface SherlockDiagnosis {
    issue_summary: string;
    patient_zero: PatientZero;
    failure_chain: string[];
    relevant_paths: string[];
}

export interface VoidFixerInstructions {
    target_branch_base: string;
    mode: string;
    self_healing_attempts: number;
    verification_command: string;
    styling_rules: string;
}

export interface HyperContextPayload {
    redux_state_snapshot?: Record<string, unknown>;
    last_logcat_lines?: string[];
    /** Canonical app repo where user-facing fixes should land (e.g. Focus-Flow-). */
    product_fix_scope?: string;
    product_fix_repo_path?: string;
    [key: string]: unknown;
}

/** Full RCA payload consumed by Void-Fixer */
export interface RCAHandover {
    metadata: HandoverMetadata;
    gatekeeper_context: GatekeeperContext;
    sherlock_diagnosis: SherlockDiagnosis;
    void_fixer_instructions: VoidFixerInstructions;
    hyper_context_payload?: HyperContextPayload;
}

/** Written to fix_manifest.json on completion (no merge / no PR) */
export interface FixManifest {
    branch_name: string;
    ticket_id: string;
    summary: string;
    test_status: boolean;
    files_modified: string[];
    created_at: string;
    verification_command: string;
    attempts_used: number;
    manifest_path: string;
}

export interface VoidFixResult {
    manifest: FixManifest;
    /** Unified diff vs target_branch_base for MCP submit_fix */
    diff: string;
}
