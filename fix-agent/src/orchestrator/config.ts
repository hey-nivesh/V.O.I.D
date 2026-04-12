import fs from 'node:fs';
import path from 'node:path';

/** Primary app repo (Focus-Flow-). */
export function resolveFocusFlowRoot(): string {
    const fromEnv = process.env.VOID_FOCUS_FLOW_ROOT?.trim() || process.env.VOID_TARGET_REPO?.trim();
    if (fromEnv) {
        return path.resolve(fromEnv);
    }
    return path.resolve(process.cwd(), '..', 'Focus-Flow-');
}

/**
 * Prefer nested `Focus-Flow-` (Focus-Flow-/Focus-Flow-) over legacy `Focus Flow` folder name.
 */
function scoreNpmSubdirName(name: string): number {
    const norm = name.toLowerCase().replace(/\s+/g, '-');
    // Nested `Focus-Flow-` (…/Focus-Flow-/Focus-Flow-) beats legacy `Focus Flow` (norm `focus-flow`).
    if (norm === 'focus-flow-' || norm.startsWith('focus-flow-')) return 120;
    if (norm === 'focus-flow') return 100;
    if (norm === 'focusflow') return 95;
    if (['client', 'app', 'web', 'frontend'].includes(norm)) return 50;
    return 10;
}

/**
 * Directory where `npm run build` should run (often `Focus-Flow-/Focus-Flow-`, not repo root).
 * Override with VOID_ORCH_NPM_CWD or VOID_NPM_PROJECT_ROOT when layout differs.
 */
export function resolveNpmProjectRoot(repoRoot: string): string {
    const fromEnv = process.env.VOID_ORCH_NPM_CWD?.trim() || process.env.VOID_NPM_PROJECT_ROOT?.trim();
    if (fromEnv) {
        return path.resolve(fromEnv);
    }

    const root = path.resolve(repoRoot);
    const rootPkg = path.join(root, 'package.json');
    if (fs.existsSync(rootPkg)) {
        try {
            const j = JSON.parse(fs.readFileSync(rootPkg, 'utf8')) as { scripts?: { build?: string } };
            if (j.scripts?.build) {
                return root;
            }
        } catch {
            /* ignore */
        }
    }

    type Cand = { dir: string; score: number };
    const cands: Cand[] = [];
    try {
        for (const e of fs.readdirSync(root, { withFileTypes: true })) {
            if (!e.isDirectory()) continue;
            const name = e.name;
            if (name === 'node_modules' || name === '.git') continue;
            const pkg = path.join(root, name, 'package.json');
            if (!fs.existsSync(pkg)) continue;
            try {
                const j = JSON.parse(fs.readFileSync(pkg, 'utf8')) as { scripts?: { build?: string } };
                if (!j.scripts?.build) continue;
                cands.push({ dir: path.join(root, name), score: scoreNpmSubdirName(name) });
            } catch {
                /* ignore */
            }
        }
    } catch {
        /* ignore */
    }

    if (cands.length === 0) {
        return root;
    }
    cands.sort((a, b) => b.score - a.score);
    return cands[0].dir;
}

export const CLINE_URL = process.env.VOID_CLINE_URL?.trim() || 'http://localhost:25463';

export const ORCH_VERIFY_CMD = process.env.VOID_ORCH_VERIFY_CMD?.trim() || 'npm run build';

export function orchestratorDir(focusRoot: string): string {
    return path.join(focusRoot, '.void', 'orchestrator');
}
