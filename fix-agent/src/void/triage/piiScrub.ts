/** Best-effort local PII strip on free-text fields (defense in depth after LLM). */
export function scrubPii(text: string): string {
    let s = text;
    s = s.replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '[REDACTED_EMAIL]');
    s = s.replace(/\b\+?\d[\d\s().-]{8,}\b/g, '[REDACTED_PHONE]');
    s = s.replace(/\bBearer\s+[A-Za-z0-9._-]+\b/gi, 'Bearer [REDACTED_TOKEN]');
    s = s.replace(/\b(api[_-]?key|token|secret)\s*[:=]\s*\S+/gi, '$1: [REDACTED]');
    s = s.replace(/\b[0-9]{4}[\s-]?[0-9]{4}[\s-]?[0-9]{4}\b/g, '[REDACTED_ID]');
    return s;
}
