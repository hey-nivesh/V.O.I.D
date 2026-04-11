import EventSource from 'eventsource';
import fetch from 'node-fetch';
import chalk from 'chalk';

const BASE_URL = 'http://0.0.0.0:3000';
const AGENT_CREDENTIALS = {
    username: 'fixagent',
    password: 'fixpass'
};

let authToken: string | null = null;
let eventSource: EventSource | null = null;

// Logging helpers
const log = {
    info: (msg: string) => console.log(chalk.blue('ℹ  ') + msg),
    success: (msg: string) => console.log(chalk.green('✔  ') + msg),
    warn: (msg: string) => console.log(chalk.yellow('⚠  ') + msg),
    error: (msg: string) => console.log(chalk.red('✖  ') + msg),
    agent: (msg: string) => console.log(chalk.magenta('🤖 [FixAgent] ') + msg),
};

async function login() {
    log.info('Authenticating with MCP Server...');
    try {
        const response = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(AGENT_CREDENTIALS)
        });

        const data: any = await response.json();

        if (data.success) {
            authToken = data.data.token;
            log.success(`Authenticated as ${data.data.user.role}`);
            return true;
        } else {
            log.error(`Login failed: ${data.error}`);
            return false;
        }
    } catch (error) {
        log.error(`Connection error: ${error}`);
        return false;
    }
}

async function startListening() {
    if (!authToken) return;

    log.info('Connecting to Event Stream...');

    // Connect to SSE with token in query param (since EventSource doesn't support headers)
    eventSource = new EventSource(`${BASE_URL}/api/events?token=${authToken}`);

    eventSource.onopen = () => {
        log.success('Connected to MCP Event Stream');
        log.agent('Listening for new tickets...');
    };

    eventSource.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleEvent(data);
        } catch (e) {
            // Ignore keep-alive
        }
    };

    eventSource.onerror = (err) => {
        // console.error(err); // clean output
    };
}

async function handleEvent(event: any) {
    if (event.type === 'ticket.created') {
        const ticketId = event.payload.ticket_id;
        log.agent(`New ticket detected: ${chalk.bold(ticketId)}`);
        log.info(`Title: ${event.payload.title}`);
        log.info(`Component: ${event.payload.component}`);

        // Simulate "Thinking" time
        await processTicket(ticketId);
    }
}

async function processTicket(ticketId: string) {
    // 1. Claim Ticket
    log.agent(`Claiming ticket ${ticketId}...`);
    await new Promise(r => setTimeout(r, 2000)); // Simulate reading

    const claimRes = await fetch(`${BASE_URL}/api/tickets/${ticketId}/claim`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
    });

    if (claimRes.ok) {
        log.success(`Ticket claimed successfully.`);

        // 2. Simulate Work
        log.agent('Analyzing codebase...');
        await new Promise(r => setTimeout(r, 3000));

        log.agent('Reproduction found. Generating fix...');
        await new Promise(r => setTimeout(r, 4000));

        // 3. Submit Fix
        log.agent('Submitting fix for review...');

        const fixPayload = {
            summary: "Fixed validation logic in login form",
            files_modified: ["src/components/LoginForm.tsx"],
            diff: `--- a/src/components/LoginForm.tsx
+++ b/src/components/LoginForm.tsx
@@ -12,7 +12,7 @@
-  const isValid = email.includes('@');
+  const isValid = email.includes('@') && email.includes('.');`,
            sandbox_preview_url: "https://void-demo-app.trycloudflare.com/preview/login-fix",
            test_results: { status: "PASS", logs: "All tests passed." }
        };

        const submitRes = await fetch(`${BASE_URL}/api/tickets/${ticketId}/submit_fix`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(fixPayload)
        });

        if (submitRes.ok) {
            log.success('Fix submitted successfully! 🚀');
            log.info('Waiting for admin approval...');
        } else {
            const err: any = await submitRes.json();
            log.error(`Failed to submit fix: ${err.error}`);
        }

    } else {
        const err: any = await claimRes.json();
        log.error(`Failed to claim ticket: ${err.error}`);
    }
}

async function main() {
    process.stdout.write('\x1Bc'); // Clear screen
    console.log(chalk.bold.cyan('🤖 VOID Fix Agent v1.0'));
    console.log('==========================\n');

    const loggedIn = await login();
    if (loggedIn) {
        startListening();
    }
}

main();
