import express, { Request, Response } from 'express';
import { LLMParser } from './llm-parser.js';
import { Dispatcher } from './dispatcher.js';

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

const parser = new LLMParser();
const dispatcher = new Dispatcher();

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'OK', agent: 'Triage Envoy' });
});

// The core Ingestion Matrix Webhook
app.post('/webhook/ticket-created', async (req: Request, res: Response) => {
    try {
        console.log("-------------------------------------------------");
        console.log(`[Webhook] Incoming Ticket Incident intercepted...`);
        
        // Extract messy description from arbitrary ticket formats
        const description = req.body.description || req.body.text || req.body.issue || "";
        const ticketId = req.body.id || `TKT-${Math.floor(Math.random() * 10000)}`;

        if (!description) {
            return res.status(400).json({ error: "Missing 'description' in payload." });
        }

        console.log(`[Ticket ${ticketId}] Content: "${description}"`);

        // Phase 1: AI Intent Parsing
        const parsedData = await parser.parseTicket(description);

        // Send an immediate 202 Accepted response so ticketing system doesn't timeout
        res.status(202).json({ 
            status: "Accepted", 
            message: "Ticket is being processed by VOID Protocol.",
            parsed_intent: parsedData
        });

        // Phase 2: Background Automated Dispatch
        // The dispatcher dynamically routes the code to reconstructor.py if it's a mobile issue.
        await dispatcher.dispatchTicket(ticketId, parsedData);

        console.log(`[Ticket ${ticketId}] Processing routine finalized.`);
        console.log("-------------------------------------------------");

    } catch (error: any) {
        console.error(`[Webhook Error]`, error.message);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Internal Matrix Error' });
        }
    }
});

app.listen(port, () => {
    console.log(`=================================================`);
    console.log(`🚀 VOID Zone 1: Triage Envoy Online`);
    console.log(`📡 Listening for IT Incidents on port ${port}`);
    console.log(`=================================================`);
});
