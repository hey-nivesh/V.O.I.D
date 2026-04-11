import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { ParsedTicket } from './llm-parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execAsync = promisify(exec);

export class Dispatcher {
    
    async dispatchTicket(ticketId: string, parsedData: ParsedTicket) {
        console.log(`[Dispatcher] Routing Ticket ${ticketId}...`);
        
        if (parsedData.category === "UI_BUG") {
            console.log(`[Dispatcher] Mobile UI Bug detected. Engaging Sentinel Reconstructor...`);
            await this.triggerSentinel(parsedData);
        } else if (parsedData.category === "API_FAILURE") {
            console.log(`[Dispatcher] Backend API Failure detected. Archiving for manual Admin-Envoy review. \nNo automated physical interaction required.`);
        } else {
            console.log(`[Dispatcher] Issue classified as ${parsedData.category}. Awaiting manual triage.`);
        }
    }

    private async triggerSentinel(data: ParsedTicket) {
        const payloadStr = JSON.stringify(data.coordinates);
        
        // Define paths to python and reconstructor script relative to triage-envoy
        const reconstructorPath = path.resolve(__dirname, '..', '..', 'sentinel-agent', 'src', 'reconstructor.py');
        
        console.log(`[Dispatcher] Executing command payload to Sentinel Bridge...`);
        // We use single quotes around the JSON payload strictly, though reconstructor.py is robust enough to handle messy strings now.
        const cmd = `python "${reconstructorPath}" ${data.package_name} '${payloadStr}'`;
        
        try {
            const { stdout, stderr } = await execAsync(cmd);
            console.log(`[Sentinel Output] Status Retrieved:\n${stdout.trim()}`);
            if (stderr) {
                console.error(`[Sentinel Error Stream]:\n${stderr.trim()}`);
            }
        } catch (error: any) {
            console.error(`[Dispatcher] Critical Failure in Sentinel Pipeline:`, error.message);
        }
    }
}
