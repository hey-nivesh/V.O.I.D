// ============================================
// Zone 6: Tunnel Service — Cloudflare Integration
// ============================================
// Manages ephemeral Cloudflare tunnels for UAT
// preview environments. Falls back to localhost
// URLs when cloudflared is not installed.
// ============================================

import { spawn, execSync, type ChildProcess } from 'child_process';
import { AuditService } from './audit.js';
import { SSEService } from './sse.js';
import type { TunnelSession } from '../types/index.js';

// Store active tunnel processes
const activeTunnels: Map<string, { process: ChildProcess; session: TunnelSession }> = new Map();

// Check if cloudflared is available
let CLOUDFLARED_AVAILABLE = false;
try {
    execSync('which cloudflared', { stdio: 'ignore' });
    CLOUDFLARED_AVAILABLE = true;
} catch {
    console.log('☁️  [Tunnel] cloudflared not found — using fallback localhost URLs');
}

export class TunnelService {

    /**
     * Start a Cloudflare tunnel for a ticket's preview environment
     */
    static async startTunnel(ticketId: string, localPort: number = 3001): Promise<TunnelSession> {
        // Check if there's already an active tunnel for this ticket
        const existing = activeTunnels.get(ticketId);
        if (existing && existing.session.status === 'active') {
            return existing.session;
        }

        const now = new Date().toISOString();

        if (!CLOUDFLARED_AVAILABLE) {
            // Fallback: generate a simulated tunnel URL
            const session: TunnelSession = {
                ticket_id: ticketId,
                tunnel_url: `http://localhost:${localPort}`,
                local_port: localPort,
                status: 'active',
                started_at: now,
            };

            activeTunnels.set(ticketId, { process: null as unknown as ChildProcess, session });

            console.log(`☁️  [Tunnel] SIMULATED: Tunnel for ${ticketId} → ${session.tunnel_url}`);

            AuditService.log('tunnel-service', 'tunnel.started', {
                ticket_id: ticketId,
                tunnel_url: session.tunnel_url,
                simulated: true
            });

            SSEService.broadcast('tunnel.started', {
                ticket_id: ticketId,
                tunnel_url: session.tunnel_url,
                simulated: true
            });

            return session;
        }

        // Real cloudflared tunnel
        return new Promise<TunnelSession>((resolve, reject) => {
            const session: TunnelSession = {
                ticket_id: ticketId,
                tunnel_url: '',
                local_port: localPort,
                status: 'starting',
                started_at: now,
            };

            const tunnelProcess = spawn('cloudflared', [
                'tunnel', '--url', `http://localhost:${localPort}`
            ], { stdio: ['ignore', 'pipe', 'pipe'] });

            session.pid = tunnelProcess.pid;

            let resolved = false;
            const urlPattern = /https:\/\/[a-z0-9\-]+\.trycloudflare\.com/;

            // Listen for tunnel URL in stderr (cloudflared outputs there)
            const handleOutput = (data: Buffer) => {
                const output = data.toString();
                const match = urlPattern.exec(output);
                if (match && !resolved) {
                    resolved = true;
                    session.tunnel_url = match[0];
                    session.status = 'active';

                    activeTunnels.set(ticketId, { process: tunnelProcess, session });

                    console.log(`☁️  [Tunnel] Started: ${session.tunnel_url} → localhost:${localPort}`);

                    AuditService.log('tunnel-service', 'tunnel.started', {
                        ticket_id: ticketId,
                        tunnel_url: session.tunnel_url,
                        pid: tunnelProcess.pid,
                        simulated: false
                    });

                    SSEService.broadcast('tunnel.started', {
                        ticket_id: ticketId,
                        tunnel_url: session.tunnel_url
                    });

                    resolve(session);
                }
            };

            tunnelProcess.stdout?.on('data', handleOutput);
            tunnelProcess.stderr?.on('data', handleOutput);

            tunnelProcess.on('error', (err) => {
                if (!resolved) {
                    session.status = 'error';
                    reject(new Error(`Failed to start tunnel: ${err.message}`));
                }
            });

            tunnelProcess.on('exit', (code) => {
                const tunnel = activeTunnels.get(ticketId);
                if (tunnel) {
                    tunnel.session.status = 'stopped';
                    tunnel.session.stopped_at = new Date().toISOString();
                    activeTunnels.delete(ticketId);

                    SSEService.broadcast('tunnel.stopped', { ticket_id: ticketId });
                }
                if (!resolved) {
                    reject(new Error(`cloudflared exited with code ${code}`));
                }
            });

            // Timeout after 30 seconds
            setTimeout(() => {
                if (!resolved) {
                    tunnelProcess.kill();
                    reject(new Error('Tunnel startup timed out after 30 seconds'));
                }
            }, 30000);
        });
    }

    /**
     * Stop a tunnel for a ticket
     */
    static stopTunnel(ticketId: string): boolean {
        const tunnel = activeTunnels.get(ticketId);
        if (!tunnel) return false;

        if (tunnel.process && tunnel.process.pid) {
            try {
                tunnel.process.kill('SIGTERM');
            } catch {
                // Process might already be dead
            }
        }

        tunnel.session.status = 'stopped';
        tunnel.session.stopped_at = new Date().toISOString();
        activeTunnels.delete(ticketId);

        console.log(`☁️  [Tunnel] Stopped tunnel for ${ticketId}`);

        AuditService.log('tunnel-service', 'tunnel.stopped', {
            ticket_id: ticketId,
        });

        SSEService.broadcast('tunnel.stopped', { ticket_id: ticketId });

        return true;
    }

    /**
     * Get tunnel status for a ticket
     */
    static getTunnelStatus(ticketId: string): TunnelSession | null {
        const tunnel = activeTunnels.get(ticketId);
        return tunnel ? { ...tunnel.session } : null;
    }

    /**
     * Get all active tunnels
     */
    static getActiveTunnels(): TunnelSession[] {
        return Array.from(activeTunnels.values()).map(t => ({ ...t.session }));
    }

    /**
     * Check if cloudflared is available
     */
    static isCloudflaredAvailable(): boolean {
        return CLOUDFLARED_AVAILABLE;
    }
}
