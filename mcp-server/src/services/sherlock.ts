// ============================================
// Zone 3: Sherlock-Zero — Root Cause Analysis Engine
// ============================================
// Performs Failure Chain Analysis on ticket context
// to identify "Patient Zero" — the root cause at
// the file and line level.
//
// Uses Gemini AI for intelligent analysis when API
// key is available, falls back to deterministic
// heuristics otherwise.
//
// P(Bug | ErrorChain) = P(ErrorChain | Bug) · P(Bug)
//                       ──────────────────────────────
//                              P(ErrorChain)
// ============================================

import db from '../db/connection.js';
import { AuditService } from './audit.js';
import { LogScrubberService } from './logScrubber.js';
import type { RCAReport, FailureChainStep, Ticket, UserContext } from '../types/index.js';

// Check for Gemini API key
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

export class SherlockService {

    /**
     * Main entry point: Analyze a ticket and produce an RCA Report
     */
    static async analyzeTicket(ticketId: string): Promise<RCAReport> {
        const row = db.prepare('SELECT * FROM tickets WHERE id = ?')
            .get(ticketId) as Record<string, unknown> | undefined;

        if (!row) {
            throw new Error(`Ticket ${ticketId} not found`);
        }

        // Parse user context
        let userContext: UserContext = {};
        if (row.user_context && typeof row.user_context === 'string') {
            try { userContext = JSON.parse(row.user_context); } catch { }
        }

        // Step 1: Scrub PII from all data before analysis
        LogScrubberService.resetCounters();
        const scrubbedContext = LogScrubberService.scrubContext(userContext);
        const scrubbedDescription = LogScrubberService.scrubText(row.description as string);
        const scrubbedTitle = LogScrubberService.scrubText(row.title as string);
        const maskingReport = LogScrubberService.getMaskingReport();

        console.log(`🔍 [Sherlock] PII Masking complete: ${JSON.stringify(maskingReport)}`);

        // Step 2: Run analysis
        let report: RCAReport;

        if (GEMINI_API_KEY) {
            console.log('🔍 [Sherlock] Using Gemini AI for Failure Chain Analysis...');
            report = await this.analyzeWithAI({
                title: scrubbedTitle,
                description: scrubbedDescription,
                component: row.component as string,
                priority: row.priority as string,
                context: scrubbedContext,
            });
        } else {
            console.log('🔍 [Sherlock] Using heuristic analysis (no API key)...');
            report = this.analyzeWithHeuristics({
                title: scrubbedTitle,
                description: scrubbedDescription,
                component: row.component as string,
                priority: row.priority as string,
                context: scrubbedContext,
            });
        }

        report.pii_masked = true;

        AuditService.log('sherlock-zero', 'diagnosis.complete', {
            ticket_id: ticketId,
            patient_zero: report.patient_zero,
            confidence: report.confidence,
            chain_length: report.failure_chain.length,
            pii_masking: maskingReport,
            method: GEMINI_API_KEY ? 'gemini_ai' : 'heuristic'
        });

        return report;
    }

    // ===================================================================
    // AI-Powered Analysis (Gemini)
    // ===================================================================

    private static async analyzeWithAI(data: {
        title: string;
        description: string;
        component: string;
        priority: string;
        context: UserContext;
    }): Promise<RCAReport> {
        try {
            const { GoogleGenAI } = await import('@google/genai');
            const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

            const logsText = data.context.logs?.join('\n') || 'No logs available';
            const errorsText = (data.context as Record<string, unknown>).recent_errors
                ? JSON.stringify((data.context as Record<string, unknown>).recent_errors)
                : 'No recent errors';

            const prompt = `You are Sherlock-Zero, an expert Root Cause Analysis engine for software bugs.

Analyze this bug report and perform a Failure Chain Analysis to identify "Patient Zero" — the root cause.

## Bug Report
- **Title**: ${data.title}
- **Description**: ${data.description}
- **Component**: ${data.component}
- **Priority**: ${data.priority}
- **Route**: ${data.context.route || 'unknown'}
- **Device**: ${data.context.device || 'unknown'}

## Application Logs
${logsText}

## Recent Errors
${errorsText}

## Your Task
1. Identify the most likely root cause file and line number (Patient Zero)
2. Trace the failure chain: how the initial fault cascaded into the reported bug
3. Rate your confidence from 0.0 to 1.0
4. Provide a diagnosis summary
5. Suggest fix hints

Respond in this exact JSON format:
{
  "patient_zero": { "file": "path/to/file.tsx", "line": 42, "function": "functionName" },
  "failure_chain": [
    { "step": 1, "file": "path/to/file.tsx", "line": 42, "description": "Root cause description", "severity": "root_cause" },
    { "step": 2, "file": "path/to/other.tsx", "line": 15, "description": "Error propagated here", "severity": "propagation" },
    { "step": 3, "file": "path/to/component.tsx", "line": 78, "description": "User-visible symptom", "severity": "symptom" }
  ],
  "confidence": 0.82,
  "diagnosis_summary": "The root cause is...",
  "recommended_fix_hints": ["hint1", "hint2"]
}`;

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash-preview-05-20',
                contents: prompt,
                config: {
                    responseMimeType: 'application/json'
                }
            });

            const text = response.text;
            if (!text) throw new Error('Empty response from Gemini');

            const parsed = JSON.parse(text) as RCAReport;
            parsed.pii_masked = true;
            return parsed;

        } catch (error) {
            console.error('🔍 [Sherlock] AI analysis failed, falling back to heuristics:', error);
            return this.analyzeWithHeuristics(data);
        }
    }

    // ===================================================================
    // Heuristic Analysis (Fallback)
    // ===================================================================

    private static analyzeWithHeuristics(data: {
        title: string;
        description: string;
        component: string;
        priority: string;
        context: UserContext;
    }): RCAReport {
        const logs = data.context.logs || [];
        const errors = ((data.context as Record<string, unknown>).recent_errors as string[]) || [];

        // Extract file references from logs and errors
        const fileLinePattern = /(?:in\s+|at\s+)?([A-Za-z0-9_./\-]+\.\w{2,4}):(\d+)/g;
        const errorTypePattern = /(\w+Error):\s*(.+)/;

        const fileReferences: Array<{ file: string; line: number; source: string }> = [];
        const allText = [...logs, ...errors, data.description].join('\n');

        let match;
        while ((match = fileLinePattern.exec(allText)) !== null) {
            fileReferences.push({
                file: match[1],
                line: parseInt(match[2], 10),
                source: match[0]
            });
        }

        // Extract error type
        let errorType = 'Unknown Error';
        let errorMessage = data.title;
        for (const text of [...errors, ...logs]) {
            const errMatch = errorTypePattern.exec(text);
            if (errMatch) {
                errorType = errMatch[1];
                errorMessage = errMatch[2];
                break;
            }
        }

        // Build failure chain
        const failureChain: FailureChainStep[] = [];
        const componentFile = `src/components/${data.component}.tsx`;

        if (fileReferences.length > 0) {
            // First file reference is likely the symptom, last is closest to root cause
            const reversed = [...fileReferences].reverse();

            reversed.forEach((ref, i) => {
                failureChain.push({
                    step: i + 1,
                    file: ref.file,
                    line: ref.line,
                    description: i === 0
                        ? `Root cause: ${errorType} originates here`
                        : i === reversed.length - 1
                            ? `Symptom: ${errorMessage}`
                            : `Error propagated through this module`,
                    severity: i === 0 ? 'root_cause' : i === reversed.length - 1 ? 'symptom' : 'propagation'
                });
            });
        } else {
            // No file references found — construct a reasonable chain from component info
            failureChain.push({
                step: 1,
                file: componentFile,
                line: 1,
                description: `Likely root cause in ${data.component} component: ${errorType}`,
                severity: 'root_cause'
            });

            if (data.context.route) {
                failureChain.push({
                    step: 2,
                    file: `src/pages${data.context.route}.tsx`,
                    line: 1,
                    description: `Error surfaces on route ${data.context.route}`,
                    severity: 'symptom'
                });
            }
        }

        // Determine Patient Zero
        const patientZero = failureChain.find(s => s.severity === 'root_cause') || failureChain[0];

        // Calculate confidence based on available data
        let confidence = 0.4; // Base
        if (fileReferences.length > 0) confidence += 0.2;
        if (errors.length > 0) confidence += 0.15;
        if (logs.length > 0) confidence += 0.1;
        if (data.context.route) confidence += 0.05;
        if (data.context.device) confidence += 0.05;
        confidence = Math.min(confidence, 0.95);

        // Fix hints
        const fixHints: string[] = [];
        if (errorType === 'TypeError') {
            fixHints.push('Add null/undefined checks before property access');
            fixHints.push('Verify data shape matches component expectations');
        } else if (errorType === 'ReferenceError') {
            fixHints.push('Check variable declarations and imports');
        } else if (errorType === 'NetworkError' || errorType === 'FetchError') {
            fixHints.push('Add error handling for API calls');
            fixHints.push('Check CORS configuration');
        } else {
            fixHints.push(`Investigate ${errorType} in ${data.component} component`);
            fixHints.push('Check component lifecycle and state management');
        }
        fixHints.push(`Review ${componentFile} for edge cases`);

        return {
            patient_zero: {
                file: patientZero.file,
                line: patientZero.line,
                function: undefined
            },
            failure_chain: failureChain,
            confidence: Math.round(confidence * 100) / 100,
            diagnosis_summary: `${errorType} detected in the ${data.component} component. ${
                fileReferences.length > 0
                    ? `Failure chain traced through ${fileReferences.length} file(s). Root cause identified at ${patientZero.file}:${patientZero.line}.`
                    : `No explicit file references found in logs. Analysis based on component and error pattern matching.`
            } Priority: ${data.priority}. ${
                logs.filter(l => l.includes('[ERROR]')).length
            } error entries found in application logs.`,
            recommended_fix_hints: fixHints,
            pii_masked: true
        };
    }
}
