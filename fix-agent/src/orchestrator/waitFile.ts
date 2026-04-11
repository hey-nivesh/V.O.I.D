import fs from 'node:fs/promises';

export async function waitForPath(
    filePath: string,
    options: { timeoutMs: number; pollMs?: number; label: string }
): Promise<void> {
    const pollMs = options.pollMs ?? 3000;
    const deadline = Date.now() + options.timeoutMs;
    while (Date.now() < deadline) {
        try {
            await fs.access(filePath);
            return;
        } catch {
            await new Promise((r) => setTimeout(r, pollMs));
        }
    }
    throw new Error(`Timeout waiting for ${options.label}: ${filePath}`);
}
