import path from 'node:path';

/**
 * Resolve and normalize the sandbox / target repo root.
 */
export function normalizeTargetRepo(sandboxPath: string): string {
    return path.resolve(sandboxPath);
}

/**
 * Ensure `candidate` resolves inside `targetRepo` (no `..` escape).
 */
export function assertUnderTargetRepo(targetRepo: string, candidate: string): string {
    const root = normalizeTargetRepo(targetRepo);
    const resolved = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(root, candidate);
    const relative = path.relative(root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`Path escapes target repo: ${candidate}`);
    }
    return resolved;
}

/**
 * Validate repo-relative paths for sparse-checkout (POSIX-style segments).
 */
export function normalizeRepoRelativePaths(paths: string[], targetRepo: string): string[] {
    return paths.map((p) => {
        const trimmed = p.replace(/\\/g, '/').replace(/^\/+/, '');
        assertUnderTargetRepo(targetRepo, trimmed);
        return trimmed;
    });
}
