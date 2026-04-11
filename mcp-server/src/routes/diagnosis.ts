// ============================================
// Zone 3: Diagnosis Routes
// ============================================
// Orchestrates the full Zone 3 pipeline:
// Gatekeeper (sandbox) → LogScrubber (PII) → Sherlock-Zero (RCA)
// ============================================

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import db from '../db/connection.js';
import { GatekeeperService } from '../services/gatekeeper.js';
import { SherlockService } from '../services/sherlock.js';
import { LogScrubberService } from '../services/logScrubber.js';
import { AuditService, SSEService } from '../services/index.js';
import { requireRole } from '../middleware/index.js';
import type { JWTPayload, APIResponse, RCAReport, StartDiagnosisRequest } from '../types/index.js';

interface DiagnosisParams { Params: { ticket_id: string }; }
interface StartDiagnosisBody { Params: { ticket_id: string }; Body?: StartDiagnosisRequest; }

export async function diagnosisRoutes(fastify: FastifyInstance): Promise<void> {

    /**
     * POST /api/diagnosis/:ticket_id/start
     * Triggers the full Zone 3 pipeline
     */
    fastify.post<StartDiagnosisBody>(
        '/:ticket_id/start',
        {
            preHandler: [requireRole('fix_agent', 'admin')]
        },
        async (request: FastifyRequest<StartDiagnosisBody>, reply: FastifyReply) => {
            const user = request.user as JWTPayload;
            const { ticket_id } = request.params;
            const force = request.body?.force || false;

            // Verify ticket exists
            const ticket = db.prepare('SELECT id, status, diagnosis_status FROM tickets WHERE id = ?')
                .get(ticket_id) as { id: string; status: string; diagnosis_status: string | null } | undefined;

            if (!ticket) {
                return reply.code(404).send({
                    success: false,
                    error: 'Ticket not found'
                } as APIResponse);
            }

            // Check if already diagnosed (unless force)
            if (ticket.diagnosis_status === 'COMPLETE' && !force) {
                return reply.code(400).send({
                    success: false,
                    error: 'Ticket already diagnosed. Use force=true to re-run.'
                } as APIResponse);
            }

            // Check if currently running
            if (ticket.diagnosis_status === 'ANALYZING' || ticket.diagnosis_status === 'SANDBOXED') {
                return reply.code(409).send({
                    success: false,
                    error: 'Diagnosis is already in progress for this ticket'
                } as APIResponse);
            }

            // Update status to PENDING
            const now = new Date().toISOString();
            db.prepare('UPDATE tickets SET diagnosis_status = ?, updated_at = ? WHERE id = ?')
                .run('PENDING', now, ticket_id);

            // Broadcast start event
            SSEService.broadcast('diagnosis.started', {
                ticket_id,
                started_by: user.username
            });

            // Run the pipeline asynchronously
            // (don't await — return immediately and let it run in background)
            runDiagnosisPipeline(ticket_id, user.username).catch((err: Error) => {
                console.error(`[Diagnosis] Pipeline failed for ${ticket_id}:`, err);
            });

            return reply.code(202).send({
                success: true,
                data: {
                    ticket_id,
                    diagnosis_status: 'PENDING',
                    message: 'Diagnosis pipeline started. Listen for SSE events for updates.'
                }
            } as APIResponse);
        }
    );

    /**
     * GET /api/diagnosis/:ticket_id/report
     * Get the RCA report for a ticket
     */
    fastify.get<DiagnosisParams>(
        '/:ticket_id/report',
        {
            preHandler: [requireRole('fix_agent', 'admin')]
        },
        async (request: FastifyRequest<DiagnosisParams>, reply: FastifyReply) => {
            const { ticket_id } = request.params;

            const ticket = db.prepare(
                'SELECT id, diagnosis_status, rca_report, patient_zero_file, patient_zero_line FROM tickets WHERE id = ?'
            ).get(ticket_id) as Record<string, unknown> | undefined;

            if (!ticket) {
                return reply.code(404).send({
                    success: false,
                    error: 'Ticket not found'
                } as APIResponse);
            }

            let rcaReport: RCAReport | null = null;
            if (ticket.rca_report && typeof ticket.rca_report === 'string') {
                try { rcaReport = JSON.parse(ticket.rca_report); } catch { }
            }

            return reply.send({
                success: true,
                data: {
                    ticket_id,
                    diagnosis_status: ticket.diagnosis_status,
                    rca_report: rcaReport,
                    patient_zero: rcaReport ? {
                        file: ticket.patient_zero_file,
                        line: ticket.patient_zero_line
                    } : null
                }
            } as APIResponse);
        }
    );

    /**
     * GET /api/diagnosis/:ticket_id/sandbox
     * Get sandbox session status
     */
    fastify.get<DiagnosisParams>(
        '/:ticket_id/sandbox',
        {
            preHandler: [requireRole('fix_agent', 'admin')]
        },
        async (request: FastifyRequest<DiagnosisParams>, reply: FastifyReply) => {
            const { ticket_id } = request.params;

            const session = GatekeeperService.getSessionForTicket(ticket_id);

            return reply.send({
                success: true,
                data: {
                    ticket_id,
                    sandbox: session ? {
                        id: session.id,
                        container_id: session.container_id,
                        status: session.status,
                        jit_expires_at: session.jit_expires_at,
                        created_at: session.created_at,
                        terminated_at: session.terminated_at,
                    } : null
                }
            } as APIResponse);
        }
    );

    /**
     * POST /api/diagnosis/:ticket_id/sandbox/terminate
     * Force-terminate a sandbox (admin only)
     */
    fastify.post<DiagnosisParams>(
        '/:ticket_id/sandbox/terminate',
        {
            preHandler: [requireRole('admin')]
        },
        async (request: FastifyRequest<DiagnosisParams>, reply: FastifyReply) => {
            const user = request.user as JWTPayload;
            const { ticket_id } = request.params;

            const session = GatekeeperService.getSessionForTicket(ticket_id);

            if (!session) {
                return reply.code(404).send({
                    success: false,
                    error: 'No active sandbox found for this ticket'
                } as APIResponse);
            }

            const terminated = await GatekeeperService.terminateSandbox(session.id);

            AuditService.log(user.username, 'sandbox.force_terminate', {
                ticket_id,
                session_id: session.id
            });

            return reply.send({
                success: terminated,
                data: { message: terminated ? 'Sandbox terminated' : 'Failed to terminate sandbox' }
            } as APIResponse);
        }
    );
}

// ============================================
// Diagnosis Pipeline — Runs asynchronously
// ============================================

async function runDiagnosisPipeline(ticketId: string, startedBy: string): Promise<void> {
    const now = () => new Date().toISOString();

    try {
        // ---- Phase 1: Gatekeeper — Provision Sandbox ----
        console.log(`🔐 [Zone 3] Phase 1: Provisioning sandbox for ${ticketId}...`);
        db.prepare('UPDATE tickets SET diagnosis_status = ?, updated_at = ? WHERE id = ?')
            .run('SANDBOXED', now(), ticketId);

        const sandbox = await GatekeeperService.provisionSandbox(ticketId);
        console.log(`🔐 [Zone 3] Sandbox ready: ${sandbox.container_id} (JIT: ${sandbox.jit_token.slice(0, 12)}...)`);

        // Simulate sandbox setup time
        await new Promise(r => setTimeout(r, 1500));

        // ---- Phase 2: LogScrubber — PII Masking ----
        console.log(`🧹 [Zone 3] Phase 2: Scrubbing PII...`);
        // (PII scrubbing happens inside SherlockService.analyzeTicket)

        // ---- Phase 3: Sherlock-Zero — RCA Analysis ----
        console.log(`🔍 [Zone 3] Phase 3: Sherlock-Zero analyzing...`);
        GatekeeperService.updateStatus(sandbox.id, 'analyzing');
        db.prepare('UPDATE tickets SET diagnosis_status = ?, updated_at = ? WHERE id = ?')
            .run('ANALYZING', now(), ticketId);

        // Simulate analysis time for demo effect
        await new Promise(r => setTimeout(r, 3000));

        const rcaReport = await SherlockService.analyzeTicket(ticketId);

        // ---- Phase 4: Store Results ----
        console.log(`📋 [Zone 3] Phase 4: Storing RCA report...`);
        db.prepare(`
            UPDATE tickets 
            SET diagnosis_status = 'COMPLETE',
                rca_report = ?,
                patient_zero_file = ?,
                patient_zero_line = ?,
                updated_at = ?
            WHERE id = ?
        `).run(
            JSON.stringify(rcaReport),
            rcaReport.patient_zero.file,
            rcaReport.patient_zero.line,
            now(),
            ticketId
        );

        // ---- Phase 5: Cleanup ----
        await GatekeeperService.terminateSandbox(sandbox.id);

        // Broadcast completion
        SSEService.broadcast('diagnosis.complete', {
            ticket_id: ticketId,
            patient_zero: rcaReport.patient_zero,
            confidence: rcaReport.confidence,
            diagnosis_summary: rcaReport.diagnosis_summary
        });

        console.log(`✅ [Zone 3] Diagnosis complete for ${ticketId}`);
        console.log(`   Patient Zero: ${rcaReport.patient_zero.file}:${rcaReport.patient_zero.line}`);
        console.log(`   Confidence: ${(rcaReport.confidence * 100).toFixed(0)}%`);

    } catch (error) {
        console.error(`❌ [Zone 3] Diagnosis failed for ${ticketId}:`, error);

        db.prepare('UPDATE tickets SET diagnosis_status = ?, updated_at = ? WHERE id = ?')
            .run('FAILED', now(), ticketId);

        SSEService.broadcast('diagnosis.failed', {
            ticket_id: ticketId,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}

// Attach pipeline runner to the routes context
(diagnosisRoutes as any).runDiagnosisPipeline = runDiagnosisPipeline;
