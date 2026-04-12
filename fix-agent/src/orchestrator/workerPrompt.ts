import path from 'node:path';

export function buildWorkerInstruction(params: {
    ticketId: string;
    title: string;
    description: string;
    component?: string;
    focusFlowRoot: string;
    /** Where package.json / `npm run build` live when not at repo root (e.g. Focus Flow/). */
    npmProjectRoot?: string;
    affectedHints: string[];
}): string {
    const relRoot = path.basename(params.focusFlowRoot);
    const npmRoot = params.npmProjectRoot?.trim();
    const npmNote =
        npmRoot && path.resolve(npmRoot) !== path.resolve(params.focusFlowRoot)
            ? [
                  '',
                  `**Application package root:** ${npmRoot}`,
                  '(Git repo root may have no package.json — implement and run builds/tests from the folder above.)',
                  ''
              ].join('\n')
            : '';
    const hints =
        params.affectedHints.length > 0
            ? `Likely affected paths (hints): ${params.affectedHints.join(', ')}`
            : 'Infer affected files from the description; stay within the product src tree.';

    return [
        'You are acting as a Fixing Worker.',
        `Repository (local): ${params.focusFlowRoot} (folder: ${relRoot})`,
        npmNote,
        '',
        `Ticket ID: ${params.ticketId}`,
        `Title: ${params.title}`,
        `Component: ${params.component ?? '(none)'}`,
        '',
        'Description:',
        params.description,
        '',
        hints,
        '',
        'Your task:',
        '- Implement the fix following existing patterns in this codebase.',
        '- Verify behavior mentally against the description; do not break unrelated functionality.',
        '- Do **not** create a git commit or push yet — the orchestrator will handle branching after human approval.',
        '',
        'When you are done editing, signal completion using the process agreed with the operator (e.g. create the ready marker file the orchestrator documented).'
    ].join('\n');
}
