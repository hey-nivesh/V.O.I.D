/**
 * Gemini API: allow 12 requests, then synchronous 60s cooldown, then counter resets.
 * 429 responses: exponential backoff 2s, 4s, 8s (with fresh RPM slot before retry).
 */

const BURST_LIMIT = 12;
const COOLDOWN_AFTER_BURST_MS = 60_000;
const BACKOFF_MS = [2000, 4000, 8000];

let requestCount = 0;

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

/** Call before each Gemini HTTP request. Blocks 60s after every 12th request. */
export async function acquireGeminiRpmSlot(): Promise<void> {
    if (requestCount >= BURST_LIMIT) {
        await sleep(COOLDOWN_AFTER_BURST_MS);
        requestCount = 0;
    }
    requestCount += 1;
}

/**
 * Wrap a fetch call: RPM slot + 429 exponential backoff (re-invoke doRequest on 429).
 */
export async function fetchWithGeminiRpmGuard(doRequest: () => Promise<Response>): Promise<Response> {
    await acquireGeminiRpmSlot();
    let attempt = 0;
    for (;;) {
        const res = await doRequest();
        if (res.status !== 429) {
            return res;
        }
        if (attempt >= BACKOFF_MS.length) {
            return res;
        }
        await sleep(BACKOFF_MS[attempt]);
        attempt += 1;
        await acquireGeminiRpmSlot();
    }
}

export function resetRpmGuardForTests(): void {
    requestCount = 0;
}
