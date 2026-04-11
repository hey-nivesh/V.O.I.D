// ============================================
// Zone 6: Tunnel Routes
// ============================================
// Manages Cloudflare tunnel lifecycle via API
// ============================================

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import db from '../db/connection.js';
import { TunnelService } from '../services/tunnelService.js';
import { AuditService } from '../services/index.js';
import { requireRole, sanitizeBody } from '../middleware/index.js';
import type { JWTPayload, APIResponse, StartTunnelRequest } from '../types/index.js';

interface StartTunnelBody { Body: StartTunnelRequest; }
interface TunnelParams { Params: { ticket_id: string }; }

export async function tunnelRoutes(fastify: FastifyInstance): Promise<void> {

    /**
     * POST /api/tunnel/start
     * Start a Cloudflare tunnel for a ticket
     */
    fastify.post<StartTunnelBody>(
        '/start',
        {
            preHandler: [
                requireRole('fix_agent', 'admin'),
                sanitizeBody
            ]
        },
        async (request: FastifyRequest<StartTunnelBody>, reply: FastifyReply) => {
            const user = request.user as JWTPayload;
            const { ticket_id, port = 3001 } = request.body;

            if (!ticket_id) {
                return reply.code(400).send({
                    success: false,
                    error: 'ticket_id is required'
                } as APIResponse);
            }

            // Verify ticket exists
            const ticket = db.prepare('SELECT id, status FROM tickets WHERE id = ?')
                .get(ticket_id) as { id: string; status: string } | undefined;

            if (!ticket) {
                return reply.code(404).send({
                    success: false,
                    error: 'Ticket not found'
                } as APIResponse);
            }

            try {
                const session = await TunnelService.startTunnel(ticket_id, port);

                // Update ticket's sandbox_preview_url
                const now = new Date().toISOString();
                db.prepare('UPDATE tickets SET sandbox_preview_url = ?, updated_at = ? WHERE id = ?')
                    .run(session.tunnel_url, now, ticket_id);

                AuditService.log(user.username, 'tunnel.started', {
                    ticket_id,
                    tunnel_url: session.tunnel_url,
                    local_port: port
                });

                return reply.code(201).send({
                    success: true,
                    data: {
                        ticket_id,
                        tunnel_url: session.tunnel_url,
                        local_port: session.local_port,
                        status: session.status,
                        cloudflared_available: TunnelService.isCloudflaredAvailable()
                    }
                } as APIResponse);

            } catch (error) {
                return reply.code(500).send({
                    success: false,
                    error: error instanceof Error ? error.message : 'Failed to start tunnel'
                } as APIResponse);
            }
        }
    );

    /**
     * POST /api/tunnel/stop
     * Stop a tunnel for a ticket
     */
    fastify.post<{ Body: { ticket_id: string } }>(
        '/stop',
        {
            preHandler: [requireRole('admin')]
        },
        async (request, reply) => {
            const user = request.user as JWTPayload;
            const { ticket_id } = request.body as { ticket_id: string };

            if (!ticket_id) {
                return reply.code(400).send({
                    success: false,
                    error: 'ticket_id is required'
                } as APIResponse);
            }

            const stopped = TunnelService.stopTunnel(ticket_id);

            if (!stopped) {
                return reply.code(404).send({
                    success: false,
                    error: 'No active tunnel found for this ticket'
                } as APIResponse);
            }

            AuditService.log(user.username, 'tunnel.stopped', { ticket_id });

            return reply.send({
                success: true,
                data: { message: 'Tunnel stopped', ticket_id }
            } as APIResponse);
        }
    );

    /**
     * GET /api/tunnel/status/:ticket_id
     * Get tunnel status for a ticket
     */
    fastify.get<TunnelParams>(
        '/status/:ticket_id',
        {
            preHandler: [requireRole('fix_agent', 'admin')]
        },
        async (request: FastifyRequest<TunnelParams>, reply: FastifyReply) => {
            const { ticket_id } = request.params;

            const session = TunnelService.getTunnelStatus(ticket_id);

            return reply.send({
                success: true,
                data: {
                    ticket_id,
                    tunnel: session,
                    cloudflared_available: TunnelService.isCloudflaredAvailable()
                }
            } as APIResponse);
        }
    );

    /**
     * GET /api/tunnel/active
     * List all active tunnels
     */
    fastify.get(
        '/active',
        {
            preHandler: [requireRole('admin')]
        },
        async (_request, reply) => {
            const tunnels = TunnelService.getActiveTunnels();

            return reply.send({
                success: true,
                data: { tunnels }
            } as APIResponse);
        }
    );
}
