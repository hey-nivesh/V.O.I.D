import type { S2RSeverity } from './types.js';

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** HTTP 4xx/5xx in log strings → Critical severity for triage. */
export function severityFromLogs(logs: unknown): S2RSeverity | null {
    const text = serializeLogs(logs);
    if (!text) return null;
    if (/\b5\d{2}\b/.test(text)) return 'Critical';
    if (/\b4\d{2}\b/.test(text)) return 'Critical';
    return null;
}

function serializeLogs(logs: unknown): string {
    if (logs == null) return '';
    if (typeof logs === 'string') return logs;
    if (Array.isArray(logs)) {
        return logs.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n');
    }
    if (isRecord(logs)) {
        return JSON.stringify(logs);
    }
    return String(logs);
}

/**
 * Map HyperContext™ `current_view` to likely source paths under Focus-Flow- (repo-relative).
 * Extend VIEW_TO_TARGET_FILES for new screens.
 */
const VIEW_TO_TARGET_FILES: Record<string, string[]> = {
    TimerScreen: ['src/logic/timer.ts'],
    SearchScreen: ['src/components/Search.tsx'],
    HomeScreen: ['src/App.tsx'],
    default: ['src']
};

export function activeComponentFromView(currentView: unknown): { active_component: string; target_files: string[] } {
    const key = typeof currentView === 'string' ? currentView.trim() : '';
    const files = (key && VIEW_TO_TARGET_FILES[key]) || VIEW_TO_TARGET_FILES.default;
    return {
        active_component: key || 'UnknownView',
        target_files: [...files]
    };
}

export function parseHyperContext(hyperContext: unknown): {
    current_view?: string;
    logs?: unknown;
    rest: Record<string, unknown>;
} {
    if (!isRecord(hyperContext)) {
        return { rest: {} };
    }
    const current_view =
        typeof hyperContext.current_view === 'string'
            ? hyperContext.current_view
            : typeof hyperContext.currentView === 'string'
              ? hyperContext.currentView
              : undefined;
    const logs = hyperContext.logs ?? hyperContext.last_logcat_lines;
    const rest = { ...hyperContext } as Record<string, unknown>;
    delete rest.current_view;
    delete rest.currentView;
    delete rest.logs;
    delete rest.last_logcat_lines;
    return { current_view, logs, rest };
}
