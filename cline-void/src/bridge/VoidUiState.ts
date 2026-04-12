/** Shared UI / extension-host flags for VOID autonomous mode (no VS Code import here). */

let voidAutonomousActive = false;
let voidFixTicketId: string | undefined;

export function setVoidAutonomousActive(active: boolean, ticketId?: string): void {
    voidAutonomousActive = active;
    voidFixTicketId = active ? ticketId : undefined;
}

export function isVoidAutonomousActive(): boolean {
    return voidAutonomousActive;
}

export function getVoidFixTicketId(): string | undefined {
    return voidFixTicketId;
}
