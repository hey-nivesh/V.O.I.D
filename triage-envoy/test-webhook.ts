import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function runTest() {
    const payload = JSON.stringify({
        id: "TCK-900",
        description: "i tried to open the gallery and click a picture but it crashed my phone!"
    });

    console.log("Sending Mock Ticket to Triage Envoy...");
    
    // Using curl to hit the local server
    // On Windows, curl is available in modern versions, otherwise invoke-webrequest
    try {
        const cmd = `curl -X POST http://localhost:3000/webhook/ticket-created -H "Content-Type: application/json" -d "${payload.replace(/"/g, '\\"')}"`;
        const { stdout } = await execAsync(cmd);
        console.log("\n[Response from Envoy]:");
        console.log(stdout);
    } catch(e: any) {
        console.error("Test failed:", e.message);
    }
}

runTest();
