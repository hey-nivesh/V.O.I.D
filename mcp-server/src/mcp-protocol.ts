#!/usr/bin/env node
/**
 * VOID MCP Protocol Server
 * 
 * This is a Model Context Protocol (MCP) server that exposes ticket management
 * tools to AI agents like Antigravity. It uses stdio transport for communication.
 * 
 * Add to .gemini/settings.json:
 * {
 *   "mcpServers": {
 *     "void-tickets": {
 *       "command": "npx",
 *       "args": ["tsx", "d:/CodeAD CODE-BASE/VOID/mcp-server/src/mcp-protocol.ts"]
 *     }
 *   }
 * }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import db from './db/connection.js';
import type { Ticket } from './types/index.js';

// Create MCP Server
const server = new McpServer({
    name: 'void-tickets',
    version: '1.0.0',
});

// ---------------------------------------------------------------------------
// Tool: list_tickets
// ---------------------------------------------------------------------------
server.tool(
    'list_tickets',
    'List all tickets in the system. Can filter by status.',
    {
        status: z.enum(['open', 'in_progress', 'pending_review', 'approved', 'rejected', 'deployed']).optional()
            .describe('Filter by ticket status'),
        limit: z.number().optional().default(20)
            .describe('Maximum number of tickets to return'),
    },
    async ({ status, limit }) => {
        let query = 'SELECT * FROM tickets';
        const params: any[] = [];

        if (status) {
            query += ' WHERE status = ?';
            params.push(status);
        }

        query += ' ORDER BY created_at DESC LIMIT ?';
        params.push(limit);

        const tickets = db.prepare(query).all(...params) as Ticket[];

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(tickets, null, 2),
                },
            ],
        };
    }
);

// ---------------------------------------------------------------------------
// Tool: get_ticket
// ---------------------------------------------------------------------------
server.tool(
    'get_ticket',
    'Get detailed information about a specific ticket by ID.',
    {
        ticket_id: z.string().describe('The ticket ID to retrieve'),
    },
    async ({ ticket_id }) => {
        const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticket_id) as Ticket | undefined;

        if (!ticket) {
            return {
                content: [{ type: 'text', text: `Ticket ${ticket_id} not found.` }],
                isError: true,
            };
        }

        // Parse user_context if it's a string
        let userContext = ticket.user_context;
        if (typeof userContext === 'string') {
            try {
                userContext = JSON.parse(userContext);
            } catch { }
        }

        const enrichedTicket = {
            ...ticket,
            user_context: userContext,
        };

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(enrichedTicket, null, 2),
                },
            ],
        };
    }
);

// ---------------------------------------------------------------------------
// Tool: claim_ticket
// ---------------------------------------------------------------------------
server.tool(
    'claim_ticket',
    'Claim an open ticket to start working on it. Changes status to IN_PROGRESS.',
    {
        ticket_id: z.string().describe('The ticket ID to claim'),
    },
    async ({ ticket_id }) => {
        const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticket_id) as Ticket | undefined;

        if (!ticket) {
            return {
                content: [{ type: 'text', text: `Ticket ${ticket_id} not found.` }],
                isError: true,
            };
        }

        if (ticket.status !== 'PENDING') {
            return {
                content: [{ type: 'text', text: `Ticket ${ticket_id} is not PENDING. Current status: ${ticket.status}` }],
                isError: true,
            };
        }

        db.prepare(`
      UPDATE tickets 
      SET status = 'IN_PROGRESS', claimed_by = 'antigravity', updated_at = datetime('now')
      WHERE id = ?
    `).run(ticket_id);

        // Log audit
        db.prepare(`
      INSERT INTO audit_logs (action, entity_type, entity_id, actor_id, user_role, metadata, timestamp)
      VALUES ('claim_ticket', 'ticket', ?, 'antigravity', 'fix_agent', '{"via": "mcp_protocol"}', datetime('now'))
    `).run(ticket_id);

        return {
            content: [
                {
                    type: 'text',
                    text: `Successfully claimed ticket ${ticket_id}. Status changed to 'IN_PROGRESS'.`,
                },
            ],
        };
    }
);

// ---------------------------------------------------------------------------
// Tool: submit_fix
// ---------------------------------------------------------------------------
server.tool(
    'submit_fix',
    'Submit a code fix for a claimed ticket. Include the diff and optional test results.',
    {
        ticket_id: z.string().describe('The ticket ID to submit fix for'),
        diff: z.string().describe('The code diff in unified format'),
        test_results: z.string().optional().describe('Test results or verification output'),
    },
    async ({ ticket_id, diff, test_results }) => {
        const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticket_id) as Ticket | undefined;

        if (!ticket) {
            return {
                content: [{ type: 'text', text: `Ticket ${ticket_id} not found.` }],
                isError: true,
            };
        }

        if (ticket.status !== 'IN_PROGRESS') {
            return {
                content: [{ type: 'text', text: `Ticket ${ticket_id} is not IN_PROGRESS. Current status: ${ticket.status}` }],
                isError: true,
            };
        }

        db.prepare(`
      UPDATE tickets 
      SET status = 'REVIEW_PENDING', diff = ?, test_results = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(diff, test_results || null, ticket_id);

        // Log audit
        db.prepare(`
      INSERT INTO audit_logs (action, entity_type, entity_id, actor_id, user_role, metadata, timestamp)
      VALUES ('submit_fix', 'ticket', ?, 'antigravity', 'fix_agent', '{"via": "mcp_protocol"}', datetime('now'))
    `).run(ticket_id);

        return {
            content: [
                {
                    type: 'text',
                    text: `Fix submitted for ticket ${ticket_id}. Status changed to 'REVIEW_PENDING'. Awaiting admin approval.`,
                },
            ],
        };
    }
);

// ---------------------------------------------------------------------------
// Tool: get_codebase_context
// ---------------------------------------------------------------------------
server.tool(
    'get_codebase_context',
    'Get context about the codebase relevant to a ticket, including file hints and recent errors.',
    {
        ticket_id: z.string().describe('The ticket ID to get context for'),
    },
    async ({ ticket_id }) => {
        const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticket_id) as Ticket | undefined;

        if (!ticket) {
            return {
                content: [{ type: 'text', text: `Ticket ${ticket_id} not found.` }],
                isError: true,
            };
        }

        let userContext: any = {};
        if (ticket.user_context) {
            try {
                userContext = typeof ticket.user_context === 'string'
                    ? JSON.parse(ticket.user_context)
                    : ticket.user_context;
            } catch { }
        }

        const context = {
            ticket_id: ticket.id,
            title: ticket.title,
            description: ticket.description,
            component: ticket.component,
            priority: ticket.priority,
            file_hints: ticket.files_modified || [],
            user_route: userContext.route || 'unknown',
            user_device: userContext.device || 'unknown',
            recent_errors: userContext.recent_errors || [],
            logs: userContext.logs || [],
        };

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(context, null, 2),
                },
            ],
        };
    }
);

// ---------------------------------------------------------------------------
// Tool: add_comment
// ---------------------------------------------------------------------------
server.tool(
    'add_comment',
    'Add a comment or note to a ticket for tracking progress or communication.',
    {
        ticket_id: z.string().describe('The ticket ID to comment on'),
        comment: z.string().describe('The comment text'),
    },
    async ({ ticket_id, comment }) => {
        const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticket_id) as Ticket | undefined;

        if (!ticket) {
            return {
                content: [{ type: 'text', text: `Ticket ${ticket_id} not found.` }],
                isError: true,
            };
        }

        // Log as audit entry
        db.prepare(`
      INSERT INTO audit_logs (action, entity_type, entity_id, actor_id, user_role, metadata, timestamp)
      VALUES ('add_comment', 'ticket', ?, 'antigravity', 'fix_agent', ?, datetime('now'))
    `).run(ticket_id, JSON.stringify({ comment, via: 'mcp_protocol' }));


        return {
            content: [
                {
                    type: 'text',
                    text: `Comment added to ticket ${ticket_id}.`,
                },
            ],
        };
    }
);

// ---------------------------------------------------------------------------
// Start Server
// ---------------------------------------------------------------------------
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('VOID MCP Protocol Server running on stdio');
}

main().catch(console.error);
