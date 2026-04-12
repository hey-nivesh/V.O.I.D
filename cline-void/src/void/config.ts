import fs from 'node:fs';
import path from 'node:path';

/**
 * Logical path inside the monorepo (see V.O.I.D layout).
 * Physical clone is typically `<workspaceRoot>/Focus-Flow-`.
 */
export const ROOT_REPO_PATH = 'v.o.i.d/Focus-Flow-' as const;

function scoreNpmSubdirName(name: string): number {
    const norm = name.toLowerCase().replace(/\s+/g, '-');
    if (norm === 'focus-flow-' || norm.startsWith('focus-flow-')) return 120;
    if (norm === 'focus-flow') return 100;
    if (norm === 'focusflow') return 95;
    if (['client', 'app', 'web', 'frontend'].includes(norm)) return 50;
    return 10;
}

/**
 * Where `npm run build` / Vite live when not at the git repo root (e.g. `Focus-Flow-/Focus-Flow-`).
 * Same env overrides as fix-agent: VOID_ORCH_NPM_CWD, VOID_NPM_PROJECT_ROOT.
 */
export function resolveNpmAppRoot(repoRoot: string): string {
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

/** Dev webview / extension bridge (Cline local UI) */
export const VOID_CLINE_UI_ORIGIN = 'http://localhost:25463';

/**
 * Resolve the Focus-Flow- repo on disk.
 * If `WORKSPACE_ROOT` / `VOID_WORKSPACE_ROOT` is set, it anchors resolution.
 * Otherwise falls back to `process.cwd()`.
 *
 * When workspace is the V.O.I.D repo root, we map `v.o.i.d/Focus-Flow-` → `./Focus-Flow-`.
 */
export function resolveVoidRepoAbsolute(workspaceRoot?: string): string {
    const root = workspaceRoot ?? process.env.VOID_WORKSPACE_ROOT ?? process.cwd();
    const normalized = root.replace(/\\/g, '/').toLowerCase();
    const isVoidMonorepo =
        normalized.endsWith('v.o.i.d') ||
        normalized.endsWith('void/v.o.i.d') ||
        /[/\\]v\.o\.i\.d$/i.test(root);

    if (isVoidMonorepo) {
        return path.resolve(root, 'Focus-Flow-');
    }

    return path.resolve(root, ...ROOT_REPO_PATH.split('/').filter(Boolean));
}
