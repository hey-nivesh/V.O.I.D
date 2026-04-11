// ============================================
// Authentication Middleware
// ============================================

import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
import type { JWTPayload, UserRole } from '../types/index.js';

declare module '@fastify/jwt' {
    interface FastifyJWT {
        payload: JWTPayload;
        user: JWTPayload;
    }
}

/**
 * Require authentication - verifies JWT token
 */
export async function requireAuth(
    request: FastifyRequest,
    reply: FastifyReply
): Promise<void> {
    try {
        // Support token in query param for SSE
        const query = request.query as Record<string, string>;
        if (!request.headers.authorization && query && query.token) {
            request.headers.authorization = `Bearer ${query.token}`;
        }
        await request.jwtVerify();
    } catch (err) {
        reply.code(401).send({ success: false, error: 'Unauthorized' });
    }
}

/**
 * Create role-based access control middleware factory
 */
export function requireRole(...roles: UserRole[]) {
    return async function (
        request: FastifyRequest,
        reply: FastifyReply
    ): Promise<void> {
        // First verify JWT
        try {
            await request.jwtVerify();
        } catch (err) {
            return reply.code(401).send({ success: false, error: 'Unauthorized' });
        }

        // Then check role
        const user = request.user as JWTPayload | undefined;
        if (!user || !roles.includes(user.role)) {
            return reply.code(403).send({
                success: false,
                error: `Forbidden: requires one of roles [${roles.join(', ')}]`
            });
        }
    };
}

/**
 * Optional auth - sets user if token present but doesn't require it
 */
export async function optionalAuth(
    request: FastifyRequest,
    _reply: FastifyReply
): Promise<void> {
    try {
        await request.jwtVerify();
    } catch {
        // Token not present or invalid - that's fine for optional auth
    }
}
