/**
 * Gemini GenerateContent: anchor RCA + system instructions in `systemInstruction`
 * so they stay authoritative (re-send each request; do not rely on long chat history for RCA).
 *
 * @see https://ai.google.dev/api/rest/v1beta/models/generateContent
 */

export interface GeminiAnchoredRequest {
    /** Maps to GenerateContentRequest.systemInstruction */
    systemInstruction: { parts: { text: string }[]; role?: 'system' };
    /** User/model turns only — RCA should not be duplicated here */
    contents: Array<{ role: 'user' | 'model'; parts: { text: string }[] }>;
}

export function buildVoidFixerGeminiRequest(params: {
    rcaReport: string;
    systemInstructions: string;
    userMessage: string;
    /** Optional prior turns (without RCA — keep short) */
    history?: Array<{ role: 'user' | 'model'; text: string }>;
}): GeminiAnchoredRequest {
    const systemBlock = [
        '=== VOID SYSTEM INSTRUCTIONS (do not ignore) ===',
        params.systemInstructions.trim(),
        '',
        '=== RCA REPORT (authoritative context) ===',
        params.rcaReport.trim()
    ].join('\n');

    const contents: GeminiAnchoredRequest['contents'] = [];
    if (params.history?.length) {
        for (const h of params.history) {
            contents.push({
                role: h.role,
                parts: [{ text: h.text }]
            });
        }
    }
    contents.push({
        role: 'user',
        parts: [{ text: params.userMessage }]
    });

    return {
        systemInstruction: {
            role: 'system',
            parts: [{ text: systemBlock }]
        },
        contents
    };
}

/** JSON body for REST POST to :generateContent */
export function toGenerateContentBody(anchored: GeminiAnchoredRequest, generationConfig?: Record<string, unknown>): Record<string, unknown> {
    return {
        systemInstruction: anchored.systemInstruction,
        contents: anchored.contents,
        ...(generationConfig ? { generationConfig } : {})
    };
}
