/** ~1000 tokens ≈ 4000 chars for English-ish text */
const CHAR_THRESHOLD = 4000;
const HEAD_LINES = 200;
const TAIL_LINES = 500;

/** Remove ANSI color / cursor codes and common spinner noise */
export function stripAnsiAndProgressNoise(text: string): string {
    let s = text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
    s = s.replace(/\r[^\n]/g, '');
    const lines = s.split(/\r?\n/);
    const out: string[] = [];
    for (const line of lines) {
        const trimmed = line.trimEnd();
        if (/^[█░▓▒\s:=\-–—]{3,}$/.test(trimmed) && trimmed.length > 40) {
            continue;
        }
        if (/\b\d{1,3}%\s*[|█░▓▒]+\s*$/.test(trimmed)) {
            continue;
        }
        out.push(line);
    }
    return out.join('\n');
}

/**
 * Head + tail trim when output is large: keep first HEAD_LINES and last TAIL_LINES.
 */
export function trimTerminalOutputForContext(raw: string): { text: string; truncated: boolean; droppedLines: number } {
    const cleaned = stripAnsiAndProgressNoise(raw);
    if (cleaned.length <= CHAR_THRESHOLD) {
        return { text: cleaned, truncated: false, droppedLines: 0 };
    }
    const lines = cleaned.split(/\r?\n/);
    if (lines.length <= HEAD_LINES + TAIL_LINES) {
        return { text: cleaned, truncated: false, droppedLines: 0 };
    }
    const head = lines.slice(0, HEAD_LINES);
    const tail = lines.slice(-TAIL_LINES);
    const dropped = lines.length - head.length - tail.length;
    const placeholder = `[... VOID truncated ${dropped} lines of logs to save context window ...]`;
    return {
        text: [...head, placeholder, ...tail].join('\n'),
        truncated: true,
        droppedLines: dropped
    };
}

export function applyTerminalSanitizerToRunResult(stdout: string, stderr: string): {
    stdout: string;
    stderr: string;
    meta: { stdoutTruncated: boolean; stderrTruncated: boolean };
} {
    const o = trimTerminalOutputForContext(stdout);
    const e = trimTerminalOutputForContext(stderr);
    return {
        stdout: o.text,
        stderr: e.text,
        meta: { stdoutTruncated: o.truncated, stderrTruncated: e.truncated }
    };
}
