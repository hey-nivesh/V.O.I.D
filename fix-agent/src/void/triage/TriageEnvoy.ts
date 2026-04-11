import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import fetch from 'node-fetch';
import type { S2RManifest, S2RSeverity } from './types.js';
import {
    activeComponentFromView,
    parseHyperContext,
    severityFromLogs
} from './hyperContext.js';
import { TRIAGE_ENVOY_SYSTEM_PROMPT, buildTriageUserContent } from './triageGeminiPrompt.js';
import { scrubPii } from './piiScrub.js';
import { ensureIncidentsDir, resolveS2RManifestPath } from './paths.js';

function geminiTriageModel(): string {
    return process.env.GEMINI_TRIAGE_MODEL?.trim() || 'gemini-2.0-flash';
}

interface GeminiS2RJson {
    intent?: string;
    severity?: S2RSeverity;
    steps_to_reproduce?: string[];
    s2r_steps?: string[];
    target_files?: string[];
    validation_command?: string;
    scrubbed_summary?: string;
}

export interface GenerateManifestOptions {
    /** If omitted, a stable-looking hash id is generated. */
    ticketId?: string;
    /** Skip Gemini and emit heuristic-only manifest (tests / no API key). */
    offline?: boolean;
}

export class TriageEnvoy {
    constructor(
        private readonly opts: {
            apiKey?: string;
        } = {}
    ) {}

    private apiKey(): string {
        const k = this.opts.apiKey?.trim() || process.env.GEMINI_API_KEY?.trim();
        if (!k) {
            throw new Error('GEMINI_API_KEY is required for TriageEnvoy.generateManifest (or pass offline: true).');
        }
        return k;
    }

    private makeTicketId(rawInput: string, explicit?: string): string {
        if (explicit?.trim()) {
            return explicit.trim();
        }
        const h = createHash('sha256').update(rawInput).update(randomBytes(8)).digest('hex').slice(0, 16);
        return `H-${h.toUpperCase()}`;
    }

    /**
     * Transform raw incident text + HyperContext™ into an S2R manifest and persist for Gatekeeper pickup.
     */
    async generateManifest(
        rawInput: string,
        hyperContext: unknown,
        options: GenerateManifestOptions = {}
    ): Promise<S2RManifest> {
        const { current_view, logs, rest } = parseHyperContext(hyperContext);
        const logSeverity = severityFromLogs(logs);
        const viewHints = current_view ? activeComponentFromView(current_view) : { active_component: 'UnknownView', target_files: ['src'] };

        const hyperSafe = scrubPii(JSON.stringify({ current_view, logs, ...rest }, null, 0));

        let llm: GeminiS2RJson = {};
        if (!options.offline) {
            llm = await this.callGemini(buildTriageUserContent(scrubPii(rawInput), hyperSafe));
        }

        let severity: S2RSeverity = llm.severity ?? 'Medium';
        if (logSeverity === 'Critical') {
            severity = 'Critical';
        }

        const s2r_steps =
            Array.isArray(llm.s2r_steps) && llm.s2r_steps.length > 0
                ? llm.s2r_steps.map((s) => scrubPii(String(s)))
                : fallbackS2rSteps(llm.steps_to_reproduce, rawInput);

        const target_files =
            Array.isArray(llm.target_files) && llm.target_files.length > 0
                ? llm.target_files.map((f) => String(f).replace(/\\/g, '/'))
                : viewHints.target_files;

        const validation_command =
            typeof llm.validation_command === 'string' && llm.validation_command.trim()
                ? llm.validation_command.trim()
                : 'npm run build';

        const ticketId = this.makeTicketId(rawInput, options.ticketId);

        const manifest: S2RManifest = {
            ticketId,
            intent: scrubPii(llm.intent?.trim() || 'User-reported incident (see scrubbed_summary).'),
            severity,
            repository: 'v.o.i.d/Focus-Flow-',
            active_component: viewHints.active_component,
            scrubbed_summary: scrubPii(llm.scrubbed_summary?.trim() || scrubPii(rawInput).slice(0, 2000)),
            s2r_steps,
            target_files,
            validation_command,
            hyper_context_ref: sanitizeHyperRef({ current_view, ...rest }),
            created_at: new Date().toISOString()
        };

        const outPath = resolveS2RManifestPath(manifest.ticketId);
        await ensureIncidentsDir(outPath);
        await fs.writeFile(outPath, JSON.stringify(manifest, null, 2), 'utf8');

        return manifest;
    }

    private async callGemini(userText: string): Promise<GeminiS2RJson> {
        const key = this.apiKey();
        const model = geminiTriageModel();
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: TRIAGE_ENVOY_SYSTEM_PROMPT }] },
                contents: [{ role: 'user', parts: [{ text: userText }] }],
                generationConfig: {
                    temperature: 0.2,
                    responseMimeType: 'application/json'
                }
            })
        });

        const data = (await res.json()) as {
            error?: { message?: string };
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };

        if (!res.ok) {
            throw new Error(`Gemini triage failed: ${data.error?.message || res.statusText}`);
        }

        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
            throw new Error('Gemini triage: empty response');
        }

        try {
            return JSON.parse(text) as GeminiS2RJson;
        } catch {
            throw new Error(`Gemini triage: invalid JSON in response: ${text.slice(0, 400)}`);
        }
    }
}

function fallbackS2rSteps(steps: string[] | undefined, raw: string): string[] {
    if (Array.isArray(steps) && steps.length > 0) {
        return steps.map((s) => scrubPii(String(s)));
    }
    return [
        'Open the Focus-Flow- app build referenced in v.o.i.d/Focus-Flow-.',
        `Reproduce from user narrative: ${scrubPii(raw).slice(0, 280)}…`,
        'Capture network/console logs and attach to Sentinel run.'
    ];
}

function sanitizeHyperRef(obj: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string') {
            out[k] = scrubPii(v).slice(0, 500);
        } else if (v === null || typeof v === 'number' || typeof v === 'boolean') {
            out[k] = v;
        } else if (typeof v === 'object') {
            out[k] = '[object]';
        }
    }
    return out;
}
