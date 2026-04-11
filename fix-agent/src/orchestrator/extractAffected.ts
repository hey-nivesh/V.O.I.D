/**
 * Best-effort paths under Focus-Flow- that may be affected (for isolation hints).
 */
export function extractAffectedFileHints(description: string, userContext: Record<string, unknown> | undefined): string[] {
    const fromCtx = userContext?.affected_files ?? userContext?.affectedPaths;
    if (Array.isArray(fromCtx)) {
        return fromCtx.filter((x): x is string => typeof x === 'string');
    }
    const text = description || '';
    const paths = new Set<string>();
    const re = /(?:^|\s)(src\/[^\s`'"]+\.(?:tsx?|jsx?|css))(?:\s|$)/gim;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        paths.add(m[1].replace(/\\/g, '/'));
    }
    return [...paths];
}
