// ============================================
// Ticket Routes
// ============================================

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuid } from 'uuid';
import db from '../db/connection.js';
import { AuditService, SSEService } from '../services/index.js';
import { requireRole, sanitizeBody, validateRequired } from '../middleware/index.js';
import type {
    Ticket,
    TicketStatus,
    Priority,
    CreateTicketRequest,
    ClaimTicketRequest,
    SubmitFixRequest,
    ApproveTicketRequest,
    RejectTicketRequest,
    JWTPayload,
    APIResponse
} from '../types/index.js';

interface CreateTicketBody { Body: CreateTicketRequest; }
interface ClaimTicketParams { Params: { ticket_id: string }; Body?: ClaimTicketRequest; }
interface SubmitFixBody { Params: { ticket_id: string }; Body: SubmitFixRequest; }
interface ApproveBody { Params: { ticket_id: string }; Body: ApproveTicketRequest; }
interface RejectBody { Params: { ticket_id: string }; Body: RejectTicketRequest; }
interface ListQuery { Querystring: { status?: TicketStatus; priority?: Priority; limit?: string; }; }
interface TicketParams { Params: { ticket_id: string }; }

// Helper to parse JSON fields from DB
function parseTicket(row: Record<string, unknown>): Ticket {
    return {
        ...row,
        user_context: typeof row.user_context === 'string' ? JSON.parse(row.user_context) : row.user_context || {},
        files_modified: typeof row.files_modified === 'string' ? JSON.parse(row.files_modified) : row.files_modified || [],
        test_results: row.test_results && typeof row.test_results === 'string' ? JSON.parse(row.test_results) : row.test_results
    } as Ticket;
}

function sessionUserExists(userId: string): boolean {
    return db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId) !== undefined;
}

function isSqliteForeignKeyError(e: unknown): boolean {
    const err = e as { code?: string; message?: string };
    return err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || Boolean(err.message?.includes('FOREIGN KEY constraint failed'));
}

export async function ticketRoutes(fastify: FastifyInstance): Promise<void> {

    /**
     * POST /api/tickets
     * Create a new ticket (voice_agent role)
     */
    fastify.post<CreateTicketBody>(
        '/',
        {
            preHandler: [
                requireRole('voice_agent', 'admin'),
                sanitizeBody,
                validateRequired('title', 'description', 'component', 'priority')
            ]
        },
        async (request: FastifyRequest<CreateTicketBody>, reply: FastifyReply) => {
            const user = request.user as JWTPayload;
            const { title, description, component, priority, user_context = {} } = request.body;

            const id = `T-${uuid().slice(0, 8).toUpperCase()}`;
            const now = new Date().toISOString();

            db.prepare(`
        INSERT INTO tickets (id, title, description, component, priority, status, user_context, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)
      `).run(id, title, description, component, priority, JSON.stringify(user_context), now, now);

            AuditService.log(user.username, 'ticket.created', { ticket_id: id, title, component, priority });

            SSEService.broadcast('ticket.created', { ticket_id: id, title, priority, component });

            return reply.code(201).send({
                success: true,
                data: {
                    ticket_id: id,
                    status: 'PENDING',
                    created_at: now
                }
            } as APIResponse);
        }
    );

    /**
     * GET /api/tickets
     * List tickets (fix_agent can see PENDING, admin can see all)
     */
    fastify.get<ListQuery>(
        '/',
        {
            preHandler: [requireRole('fix_agent', 'admin')]
        },
        async (request: FastifyRequest<ListQuery>, reply: FastifyReply) => {
            const user = request.user as JWTPayload;
            const { status, priority, limit = '50' } = request.query;

            let query = 'SELECT * FROM tickets WHERE 1=1';
            const params: unknown[] = [];

            // fix_agent: PENDING/REOPENED to claim, plus own IN_PROGRESS (resume after failed verify/orchestrator)
            if (user.role === 'fix_agent' && !status) {
                query +=
                    " AND (status IN ('PENDING', 'REOPENED') OR (status = 'IN_PROGRESS' AND claimed_by = ?))";
                params.push(user.id);
            } else if (status) {
                query += ' AND status = ?';
                params.push(status);
            }

            if (priority) {
                query += ' AND priority = ?';
                params.push(priority);
            }

            query +=
                " ORDER BY CASE status WHEN 'PENDING' THEN 0 WHEN 'REOPENED' THEN 1 WHEN 'IN_PROGRESS' THEN 2 ELSE 3 END, CASE priority WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END, created_at DESC";
            query += ` LIMIT ${parseInt(limit, 10)}`;

            const rows = db.prepare(query).all(...params) as Record<string, unknown>[];
            const tickets = rows.map(parseTicket);

            return reply.send({
                success: true,
                data: { tickets }
            } as APIResponse);
        }
    );

    /**
     * GET /api/tickets/:ticket_id
     * Get single ticket details
     */
    fastify.get<TicketParams>(
        '/:ticket_id',
        {
            preHandler: [requireRole('fix_agent', 'admin')]
        },
        async (request: FastifyRequest<TicketParams>, reply: FastifyReply) => {
            const { ticket_id } = request.params;

            const row = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticket_id) as Record<string, unknown> | undefined;

            if (!row) {
                return reply.code(404).send({
                    success: false,
                    error: 'Ticket not found'
                } as APIResponse);
            }

            const ticket = parseTicket(row);

            return reply.send({
                success: true,
                data: { ticket }
            } as APIResponse);
        }
    );

    /**
     * POST /api/tickets/:ticket_id/claim
     * Claim a ticket for work (fix_agent role)
     */
    fastify.post<ClaimTicketParams>(
        '/:ticket_id/claim',
        {
            preHandler: [requireRole('fix_agent')]
        },
        async (request: FastifyRequest<ClaimTicketParams>, reply: FastifyReply) => {
            const user = request.user as JWTPayload;
            const { ticket_id } = request.params;

            const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticket_id) as Record<string, unknown> | undefined;

            if (!ticket) {
                return reply.code(404).send({
                    success: false,
                    error: 'Ticket not found'
                } as APIResponse);
            }

            if (ticket.status !== 'PENDING' && ticket.status !== 'REOPENED') {
                return reply.code(400).send({
                    success: false,
                    error: `Cannot claim ticket with status ${ticket.status}`
                } as APIResponse);
            }

            if (!sessionUserExists(user.id)) {
                return reply.code(401).send({
                    success: false,
                    error: 'Session user no longer exists (database was re-seeded). Please log in again.'
                } as APIResponse);
            }

            const now = new Date().toISOString();
            try {
                db.prepare(`
        UPDATE tickets 
        SET status = 'IN_PROGRESS', claimed_by = ?, updated_at = ?
        WHERE id = ?
      `).run(user.id, now, ticket_id);
            } catch (e: unknown) {
                if (isSqliteForeignKeyError(e)) {
                    return reply.code(400).send({
                        success: false,
                        error: 'Claim failed: user id is not valid for this database. Log in again after a reset.'
                    } as APIResponse);
                }
                throw e;
            }

            AuditService.log(user.username, 'ticket.claimed', { ticket_id });

            SSEService.broadcast('ticket.claimed', { ticket_id, claimed_by: user.username });

            return reply.send({
                success: true,
                data: { status: 'IN_PROGRESS' }
            } as APIResponse);
        }
    );

    /**
     * POST /api/tickets/:ticket_id/submit_fix
     * Submit a fix for review (fix_agent role)
     */
    fastify.post<SubmitFixBody>(
        '/:ticket_id/submit_fix',
        {
            preHandler: [
                requireRole('fix_agent'),
                sanitizeBody,
                validateRequired('summary', 'files_modified', 'diff')
            ]
        },
        async (request: FastifyRequest<SubmitFixBody>, reply: FastifyReply) => {
            const user = request.user as JWTPayload;
            const { ticket_id } = request.params;
            const { summary, files_modified, diff, sandbox_preview_url, test_results } = request.body;

            const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticket_id) as Record<string, unknown> | undefined;

            if (!ticket) {
                return reply.code(404).send({
                    success: false,
                    error: 'Ticket not found'
                } as APIResponse);
            }

            if (ticket.status !== 'IN_PROGRESS') {
                return reply.code(400).send({
                    success: false,
                    error: `Cannot submit fix for ticket with status ${ticket.status}`
                } as APIResponse);
            }

            const now = new Date().toISOString();
            db.prepare(`
        UPDATE tickets 
        SET status = 'REVIEW_PENDING',
            diff = ?,
            files_modified = ?,
            sandbox_preview_url = ?,
            test_results = ?,
            updated_at = ?
        WHERE id = ?
      `).run(
                diff,
                JSON.stringify(files_modified),
                sandbox_preview_url || null,
                test_results ? JSON.stringify(test_results) : null,
                now,
                ticket_id
            );

            AuditService.log(user.username, 'ticket.submitted_fix', {
                ticket_id,
                summary,
                files_modified,
                has_preview: !!sandbox_preview_url
            });

            SSEService.broadcast('ticket.submitted_fix', {
                ticket_id,
                summary,
                files_modified,
                sandbox_preview_url,
                submitted_by: user.username
            });

            return reply.send({
                success: true,
                data: { status: 'REVIEW_PENDING' }
            } as APIResponse);
        }
    );

    /**
     * POST /api/tickets/:ticket_id/approve
     * Approve a fix (admin role only)
     */
    fastify.post<ApproveBody>(
        '/:ticket_id/approve',
        {
            preHandler: [
                requireRole('admin'),
                sanitizeBody,
                validateRequired('approved_by')
            ]
        },
        async (request: FastifyRequest<ApproveBody>, reply: FastifyReply) => {
            const user = request.user as JWTPayload;
            const { ticket_id } = request.params;
            const { approved_by, note } = request.body;

            const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticket_id) as Record<string, unknown> | undefined;

            if (!ticket) {
                return reply.code(404).send({
                    success: false,
                    error: 'Ticket not found'
                } as APIResponse);
            }

            if (ticket.status !== 'REVIEW_PENDING') {
                return reply.code(400).send({
                    success: false,
                    error: `Cannot approve ticket with status ${ticket.status}`
                } as APIResponse);
            }

            if (!sessionUserExists(user.id)) {
                return reply.code(401).send({
                    success: false,
                    error: 'Session user no longer exists (database was re-seeded). Please log in again.'
                } as APIResponse);
            }

            const now = new Date().toISOString();
            try {
                db.prepare(`
        UPDATE tickets 
        SET status = 'APPROVED_FOR_PROD',
            approved_by = ?,
            approval_note = ?,
            updated_at = ?
        WHERE id = ?
      `).run(user.id, note || null, now, ticket_id);
            } catch (e: unknown) {
                if (isSqliteForeignKeyError(e)) {
                    return reply.code(400).send({
                        success: false,
                        error: 'Approve failed: user id is not valid for this database. Log in again after a reset.'
                    } as APIResponse);
                }
                throw e;
            }

            AuditService.log(user.username, 'ticket.approved', { ticket_id, approved_by, note });

            SSEService.broadcast('ticket.approved', {
                ticket_id,
                approved_by,
                note
            });

            // Optionally call webhook for CI/deploy
            // TODO: Implement webhook call if WEBHOOK_URL is set

            return reply.send({
                success: true,
                data: { status: 'APPROVED_FOR_PROD' }
            } as APIResponse);
        }
    );

    /**
     * POST /api/tickets/:ticket_id/reject
     * Reject a fix (admin role only)
     */
    fastify.post<RejectBody>(
        '/:ticket_id/reject',
        {
            preHandler: [
                requireRole('admin'),
                sanitizeBody,
                validateRequired('reason')
            ]
        },
        async (request: FastifyRequest<RejectBody>, reply: FastifyReply) => {
            const user = request.user as JWTPayload;
            const { ticket_id } = request.params;
            const { reason, request_changes } = request.body;

            const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticket_id) as Record<string, unknown> | undefined;

            if (!ticket) {
                return reply.code(404).send({
                    success: false,
                    error: 'Ticket not found'
                } as APIResponse);
            }

            if (ticket.status !== 'REVIEW_PENDING') {
                return reply.code(400).send({
                    success: false,
                    error: `Cannot reject ticket with status ${ticket.status}`
                } as APIResponse);
            }

            const newStatus = request_changes ? 'REOPENED' : 'CLOSED';
            const now = new Date().toISOString();

            db.prepare(`
        UPDATE tickets 
        SET status = ?,
            rejection_reason = ?,
            updated_at = ?
        WHERE id = ?
      `).run(newStatus, reason, now, ticket_id);

            AuditService.log(user.username, 'ticket.rejected', { ticket_id, reason, request_changes });

            SSEService.broadcast('ticket.rejected', {
                ticket_id,
                reason,
                new_status: newStatus,
                rejected_by: user.username
            });

            return reply.send({
                success: true,
                data: { status: newStatus }
            } as APIResponse);
        }
    );
}
