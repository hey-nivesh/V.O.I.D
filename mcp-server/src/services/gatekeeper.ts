// ============================================
// Zone 3: The Gatekeeper — Sandbox & JIT Service
// ============================================
// Manages ephemeral Docker sandbox provisioning
// and JIT (Just-In-Time) token lifecycle.
//
// In simulated mode: Returns mock container IDs
// but real JIT tokens with real expiry validation.
// ============================================

import { randomUUID, randomBytes } from 'crypto';
import db from '../db/connection.js';
import { AuditService } from './audit.js';
import { SSEService } from './sse.js';
import type { SandboxSession } from '../types/index.js';

// Runtime mode — set to true when Docker is available
const DOCKER_AVAILABLE = false;
const JIT_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

export class GatekeeperService {

    /**
     * Provision an ephemeral sandbox for a ticket
     * Creates a Docker container (or simulated) and generates a JIT token
     */
    static async provisionSandbox(ticketId: string): Promise<SandboxSession> {
        const id = randomUUID();
        const jitToken = `jit_${randomBytes(32).toString('hex')}`;
        const now = new Date();
        const expiresAt = new Date(now.getTime() + JIT_TOKEN_TTL_MS);

        let containerId: string | undefined;

        if (DOCKER_AVAILABLE) {
            // Real Docker provisioning
            containerId = await this.startDockerContainer(ticketId);
        } else {
            // Simulated mode — generate a realistic-looking container ID
            containerId = `void-sandbox-${randomBytes(6).toString('hex')}`;
            console.log(`🐳 [Gatekeeper] SIMULATED: Container ${containerId} for ticket ${ticketId}`);
        }

        // Store session in DB
        db.prepare(`
            INSERT INTO sandbox_sessions (id, ticket_id, container_id, jit_token, jit_expires_at, status, created_at)
            VALUES (?, ?, ?, ?, ?, 'ready', ?)
        `).run(id, ticketId, containerId, jitToken, expiresAt.toISOString(), now.toISOString());

        AuditService.log('gatekeeper', 'sandbox.provisioned', {
            session_id: id,
            ticket_id: ticketId,
            container_id: containerId,
            simulated: !DOCKER_AVAILABLE,
            jit_expires_at: expiresAt.toISOString()
        });

        SSEService.broadcast('sandbox.provisioned', {
            session_id: id,
            ticket_id: ticketId,
            container_id: containerId,
            status: 'ready'
        });

        const session: SandboxSession = {
            id,
            ticket_id: ticketId,
            container_id: containerId,
            jit_token: jitToken,
            jit_expires_at: expiresAt.toISOString(),
            status: 'ready',
            created_at: now.toISOString()
        };

        return session;
    }

    /**
     * Terminate a sandbox session
     */
    static async terminateSandbox(sessionId: string): Promise<boolean> {
        const session = db.prepare('SELECT * FROM sandbox_sessions WHERE id = ?')
            .get(sessionId) as { id: string; container_id: string; ticket_id: string; status: string } | undefined;

        if (!session || session.status === 'terminated') {
            return false;
        }

        if (DOCKER_AVAILABLE && session.container_id) {
            await this.stopDockerContainer(session.container_id);
        } else {
            console.log(`🐳 [Gatekeeper] SIMULATED: Terminated container ${session.container_id}`);
        }

        const now = new Date().toISOString();
        db.prepare(`
            UPDATE sandbox_sessions SET status = 'terminated', terminated_at = ? WHERE id = ?
        `).run(now, sessionId);

        AuditService.log('gatekeeper', 'sandbox.terminated', {
            session_id: sessionId,
            ticket_id: session.ticket_id,
            container_id: session.container_id
        });

        SSEService.broadcast('sandbox.terminated', {
            session_id: sessionId,
            ticket_id: session.ticket_id
        });

        return true;
    }

    /**
     * Update sandbox status
     */
    static updateStatus(sessionId: string, status: SandboxSession['status']): void {
        db.prepare('UPDATE sandbox_sessions SET status = ? WHERE id = ?').run(status, sessionId);
    }

    /**
     * Validate a JIT token — checks existence and expiry
     */
    static validateJITToken(token: string): { valid: boolean; session?: SandboxSession } {
        const row = db.prepare(
            'SELECT * FROM sandbox_sessions WHERE jit_token = ? AND status != ?'
        ).get(token, 'terminated') as Record<string, unknown> | undefined;

        if (!row) {
            return { valid: false };
        }

        const expiresAt = new Date(row.jit_expires_at as string);
        if (expiresAt < new Date()) {
            return { valid: false };
        }

        return {
            valid: true,
            session: {
                id: row.id as string,
                ticket_id: row.ticket_id as string,
                container_id: row.container_id as string | undefined,
                jit_token: row.jit_token as string,
                jit_expires_at: row.jit_expires_at as string,
                status: row.status as SandboxSession['status'],
                created_at: row.created_at as string,
                terminated_at: row.terminated_at as string | undefined,
            }
        };
    }

    /**
     * Get active session for a ticket
     */
    static getSessionForTicket(ticketId: string): SandboxSession | null {
        const row = db.prepare(
            'SELECT * FROM sandbox_sessions WHERE ticket_id = ? AND status != ? ORDER BY created_at DESC LIMIT 1'
        ).get(ticketId, 'terminated') as Record<string, unknown> | undefined;

        if (!row) return null;

        return {
            id: row.id as string,
            ticket_id: row.ticket_id as string,
            container_id: row.container_id as string | undefined,
            jit_token: row.jit_token as string,
            jit_expires_at: row.jit_expires_at as string,
            status: row.status as SandboxSession['status'],
            logs: row.logs ? JSON.parse(row.logs as string) : [],
            created_at: row.created_at as string,
            terminated_at: row.terminated_at as string | undefined,
        };
    }

    // ---- Docker Helpers (for when Docker is available) ----

    private static async startDockerContainer(ticketId: string): Promise<string> {
        // Real Docker implementation would use child_process or dockerode
        // docker run -d --name void-sandbox-{id} --rm --network none node:20-alpine
        const containerId = `void-sandbox-${randomBytes(6).toString('hex')}`;
        console.log(`🐳 [Gatekeeper] Starting Docker container: ${containerId}`);
        return containerId;
    }

    private static async stopDockerContainer(containerId: string): Promise<void> {
        console.log(`🐳 [Gatekeeper] Stopping Docker container: ${containerId}`);
    }
}
