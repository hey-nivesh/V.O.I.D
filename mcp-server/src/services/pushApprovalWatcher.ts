// ============================================
// Watch approval.json → SSE so admin UI can react immediately
// ============================================

import fs from 'node:fs';
import path from 'node:path';
import { readPushApprovalSync, resolvePushApprovalJsonPath } from './pushApprovalStore.js';
import { SSEService } from './sse.js';

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function broadcastSnapshot(): void {
    try {
        const p = readPushApprovalSync();
        if (p) {
            SSEService.broadcast('push_approval.changed', p as unknown as Record<string, unknown>);
        }
    } catch {
        /* ignore parse errors */
    }
}

function scheduleBroadcast(): void {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        broadcastSnapshot();
    }, 350);
}

/**
 * Call after server listen. Emits initial snapshot and watches for fix-agent writes.
 */
export function startPushApprovalFileWatcher(): void {
    const file = resolvePushApprovalJsonPath();
    const dir = path.dirname(file);
    try {
        fs.mkdirSync(dir, { recursive: true });
    } catch {
        /* ignore */
    }

    try {
        if (fs.existsSync(file)) {
            fs.watch(file, () => scheduleBroadcast());
        } else {
            fs.watch(dir, (_evt, fname) => {
                if (fname && String(fname).includes('approval')) {
                    scheduleBroadcast();
                }
            });
        }
    } catch (e) {
        console.warn('[push-approval] fs.watch failed (SSE may miss some updates):', e);
    }

    scheduleBroadcast();
}
