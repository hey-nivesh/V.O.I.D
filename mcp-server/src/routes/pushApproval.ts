// ============================================
// Admin API: read / resolve git push approval (approval.json)
// ============================================

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireRole, sanitizeBody } from '../middleware/index.js';
import { AuditService, SSEService } from '../services/index.js';
import {
    readPushApproval,
    writePushApproval,
    type PushApprovalState
} from '../services/pushApprovalStore.js';
import type { JWTPayload, APIResponse } from '../types/index.js';

interface PostBody {
    Body: { status: 'approved' | 'rejected'; note?: string };
}

export async function pushApprovalRoutes(fastify: FastifyInstance): Promise<void> {
    fastify.get(
        '/push-approval',
        {
            preHandler: [requireRole('admin')]
        },
        async (_request: FastifyRequest, reply: FastifyReply) => {
            const approval = await readPushApproval();
            return reply.send({
                success: true,
                data: { approval }
            } as APIResponse<{ approval: PushApprovalState | null }>);
        }
    );

    fastify.post<PostBody>(
        '/push-approval',
        {
            preHandler: [requireRole('admin'), sanitizeBody]
        },
        async (request: FastifyRequest<PostBody>, reply: FastifyReply) => {
            const user = request.user as JWTPayload;
            const { status, note } = request.body;

            if (status !== 'approved' && status !== 'rejected') {
                return reply.code(400).send({
                    success: false,
                    error: 'status must be approved or rejected'
                } as APIResponse);
            }

            const cur = await readPushApproval();
            if (!cur) {
                return reply.code(404).send({
                    success: false,
                    error: 'No approval.json found — nothing to approve yet'
                } as APIResponse);
            }

            if (cur.status !== 'pending') {
                return reply.send({
                    success: true,
                    data: { approval: cur }
                } as APIResponse<{ approval: PushApprovalState }>);
            }

            const next: PushApprovalState = {
                ...cur,
                status,
                updatedAt: new Date().toISOString(),
                decidedBy: user.username,
                decisionNote: note
            };

            await writePushApproval(next);

            AuditService.log(user.username, `push_approval.${status}`, {
                ticketId: cur.ticketId,
                branch: cur.branch
            });

            SSEService.broadcast('push_approval.changed', next as unknown as Record<string, unknown>);

            return reply.send({
                success: true,
                data: { approval: next }
            } as APIResponse<{ approval: PushApprovalState }>);
        }
    );
}
