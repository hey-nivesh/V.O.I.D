/**
 * S2R (Steps-to-Reproduce) Manifest — consumed by Gatekeeper / Sentinel / Void-Fixer pipeline.
 */
export type S2RSeverity = 'Low' | 'Medium' | 'High' | 'Critical';

export interface S2RManifest {
    /** Unique id (hash or MCP ticket id). */
    ticketId: string;
    intent: string;
    severity: S2RSeverity;
    /** Logical repo anchor for provisioning (Gatekeeper). */
    repository: 'v.o.i.d/Focus-Flow-';
    /** UI or route hint from HyperContext™. */
    active_component?: string;
    /** Scrubbed user narrative. */
    scrubbed_summary: string;
    s2r_steps: string[];
    target_files: string[];
    validation_command: string;
    /** Echo of non-sensitive HyperContext fields for auditors. */
    hyper_context_ref?: Record<string, unknown>;
    created_at: string;
}
