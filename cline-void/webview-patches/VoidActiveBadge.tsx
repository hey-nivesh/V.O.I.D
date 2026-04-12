import React from 'react';

/**
 * Drop into Cline `webview-ui/src/App.tsx` (or ChatView header): shows when VOID autonomous fix runs.
 * Wire `active` to extension postMessage or shared context (e.g. ExtensionStateContext + new field `voidAutonomousActive`).
 */
export function VoidActiveBadge(props: { active: boolean; ticketId?: string }) {
    if (!props.active) {
        return null;
    }
    return (
        <div
            className="void-active-badge"
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.06em',
                background: 'linear-gradient(90deg, #f97316, #ec4899)',
                color: '#0a0a0a',
                marginLeft: 8
            }}
            title="VOID-Fixer autonomous mode — manual Stop/Edit should stay disabled">
            VOID ACTIVE
            {props.ticketId ? <span style={{ opacity: 0.85 }}>({props.ticketId})</span> : null}
        </div>
    );
}
