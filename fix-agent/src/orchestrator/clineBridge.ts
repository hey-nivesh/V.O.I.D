import fetch from 'node-fetch';
import { CLINE_URL } from './config.js';

/**
 * Ensure Cline (or local UI) responds on the configured port. Retries once after a short delay.
 */
export async function assertClineReachable(url: string = CLINE_URL): Promise<void> {
    const attempt = async (): Promise<void> => {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 8000);
        try {
            const res = await fetch(url, { method: 'GET', signal: controller.signal }).catch((e) => {
                throw new Error(String(e));
            });
            clearTimeout(t);
            if (!res.ok && res.status >= 500) {
                throw new Error(`Cline health: HTTP ${res.status}`);
            }
        } catch (e) {
            clearTimeout(t);
            throw e;
        }
    };

    try {
        await attempt();
    } catch (first) {
        console.warn('[orchestrator] Cline unreachable, retrying once in 2s...', first);
        await new Promise((r) => setTimeout(r, 2000));
        await attempt();
    }
}
