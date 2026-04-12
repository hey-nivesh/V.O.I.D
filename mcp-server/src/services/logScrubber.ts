// ============================================
// Zone 3: Log Scrubber — PII Masking Service
// ============================================
// Sanitizes logs and user context by masking
// Personally Identifiable Information before
// passing data to Sherlock-Zero for analysis.
//
// SOC2-compliant: No PII enters the RCA engine.
// ============================================

import type { UserContext, PIIMaskingReport } from '../types/index.js';

// ---- PII Detection Patterns ----

const PATTERNS = {
    // Email addresses
    email: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Z|a-z]{2,}\b/g,

    // IPv4 addresses
    ipv4: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|1?\d\d?)\b/g,

    // IPv6 addresses (simplified)
    ipv6: /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g,

    // Phone numbers (international formats)
    phone: /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g,

    // Bearer tokens
    bearer: /Bearer\s+[a-zA-Z0-9\-_.]+/g,

    // JWT tokens (3 base64 parts separated by dots)
    jwt: /\beyJ[a-zA-Z0-9\-_]+\.eyJ[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+\b/g,

    // API keys (common patterns: long alphanumeric strings)
    apiKey: /(?:api[_-]?key|apikey|secret|token|password)\s*[:=]\s*['"]?([a-zA-Z0-9\-_]{16,})['"]?/gi,

    // Long hex strings (hashes, session IDs)
    hexHash: /\b[a-f0-9]{32,}\b/g,

    // Credit card numbers (basic)
    creditCard: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,

    // User IDs that look like real IDs (UUID format)
    uuid: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
};

const REPLACEMENTS: Record<string, string> = {
    email: '[REDACTED_EMAIL]',
    ipv4: '[REDACTED_IP]',
    ipv6: '[REDACTED_IP]',
    phone: '[REDACTED_PHONE]',
    bearer: 'Bearer [REDACTED_TOKEN]',
    jwt: '[REDACTED_JWT]',
    apiKey: '[REDACTED_API_KEY]',
    hexHash: '[REDACTED_HASH]',
    creditCard: '[REDACTED_CC]',
    uuid: '[REDACTED_UUID]',
};

export class LogScrubberService {
    private static counters: PIIMaskingReport = {
        emails_masked: 0,
        ips_masked: 0,
        tokens_masked: 0,
        phone_numbers_masked: 0,
        api_keys_masked: 0,
        total_fields_scanned: 0,
    };

    /**
     * Reset counters for a new scrubbing session
     */
    static resetCounters(): void {
        this.counters = {
            emails_masked: 0,
            ips_masked: 0,
            tokens_masked: 0,
            phone_numbers_masked: 0,
            api_keys_masked: 0,
            total_fields_scanned: 0,
        };
    }

    /**
     * Scrub a single text string of PII
     */
    static scrubText(text: string): string {
        this.counters.total_fields_scanned++;

        let result = text;

        // Email
        const emailMatches = result.match(PATTERNS.email);
        if (emailMatches) this.counters.emails_masked += emailMatches.length;
        result = result.replace(PATTERNS.email, REPLACEMENTS.email);

        // IPs
        const ipv4Matches = result.match(PATTERNS.ipv4);
        const ipv6Matches = result.match(PATTERNS.ipv6);
        if (ipv4Matches) this.counters.ips_masked += ipv4Matches.length;
        if (ipv6Matches) this.counters.ips_masked += ipv6Matches.length;
        result = result.replace(PATTERNS.ipv4, REPLACEMENTS.ipv4);
        result = result.replace(PATTERNS.ipv6, REPLACEMENTS.ipv6);

        // Tokens (JWT first, then Bearer, then API keys)
        const jwtMatches = result.match(PATTERNS.jwt);
        if (jwtMatches) this.counters.tokens_masked += jwtMatches.length;
        result = result.replace(PATTERNS.jwt, REPLACEMENTS.jwt);

        const bearerMatches = result.match(PATTERNS.bearer);
        if (bearerMatches) this.counters.tokens_masked += bearerMatches.length;
        result = result.replace(PATTERNS.bearer, REPLACEMENTS.bearer);

        const apiKeyMatches = result.match(PATTERNS.apiKey);
        if (apiKeyMatches) this.counters.api_keys_masked += apiKeyMatches.length;
        result = result.replace(PATTERNS.apiKey, REPLACEMENTS.apiKey);

        // Phone numbers
        const phoneMatches = result.match(PATTERNS.phone);
        if (phoneMatches) this.counters.phone_numbers_masked += phoneMatches.length;
        result = result.replace(PATTERNS.phone, REPLACEMENTS.phone);

        // Hashes & credit cards
        result = result.replace(PATTERNS.creditCard, REPLACEMENTS.creditCard);
        result = result.replace(PATTERNS.hexHash, REPLACEMENTS.hexHash);

        return result;
    }

    /**
     * Scrub an array of log lines
     */
    static scrubLogs(logs: string[]): string[] {
        return logs.map(log => this.scrubText(log));
    }

    /**
     * Deep-scrub a UserContext object
     */
    static scrubContext(context: UserContext): UserContext {
        const scrubbed: UserContext = { ...context };

        if (scrubbed.user_id) {
            scrubbed.user_id = this.scrubText(scrubbed.user_id);
        }

        if (scrubbed.route) {
            scrubbed.route = this.scrubText(scrubbed.route);
        }

        if (scrubbed.device) {
            scrubbed.device = this.scrubText(scrubbed.device);
        }

        if (scrubbed.logs && Array.isArray(scrubbed.logs)) {
            scrubbed.logs = this.scrubLogs(scrubbed.logs);
        }

        // Scrub any additional string fields
        for (const [key, value] of Object.entries(scrubbed)) {
            if (typeof value === 'string' && !['user_id', 'route', 'device'].includes(key)) {
                (scrubbed as Record<string, unknown>)[key] = this.scrubText(value);
            }
            if (Array.isArray(value) && key !== 'logs') {
                (scrubbed as Record<string, unknown>)[key] = value.map(
                    (v: unknown) => typeof v === 'string' ? this.scrubText(v) : v
                );
            }
        }

        return scrubbed;
    }

    /**
     * Get the masking report for the current session
     */
    static getMaskingReport(): PIIMaskingReport {
        return { ...this.counters };
    }
}
