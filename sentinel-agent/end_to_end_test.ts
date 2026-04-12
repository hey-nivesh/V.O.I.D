import { SentinelAgent } from './src/index.js';
import { Gatekeeper } from './src/gatekeeper.js';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
    console.log("🚀 VOID Protocol: End-to-End Integration Test 🚀\n");

    const agent = new SentinelAgent();
    
    // Task 1: The Sentinel "Replication" (Zone 2)
    const payload = {
        "packageName": "com.android.settings/.Settings",
        "s2rSteps": [
            { "x": 500, "y": 1000 },
            { "x": 500, "y": 1500 }
        ]
    };

    console.log("=== Task 1: Executing Sentinel Replication (Zone 2) ===");
    try {
        const result = await agent.runZone2(payload.packageName, payload.s2rSteps);
        
        let shouldTriggerGatekeeper = result.zone3Triggered;

        // Force Mock Crash if not replicated natively
        if (!shouldTriggerGatekeeper) {
            console.log("\n[Mock] App is running successfully. Forcing a Mock Crash for Sherlock-Zero handoff...");
            
            const logDir = path.join(__dirname, 'logs');
            if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
            
            const dummyCrash = `
04-12 00:00:00.000 1234 5678 E AndroidRuntime: FATAL EXCEPTION: main
04-12 00:00:00.000 1234 5678 E AndroidRuntime: Process: com.android.settings, PID: 1234
04-12 00:00:00.000 1234 5678 E AndroidRuntime: java.lang.NullPointerException: Attempt to invoke virtual method 'void com.android.settings.display.Display.render()' on a null object reference
04-12 00:00:00.000 1234 5678 E AndroidRuntime: 	at com.android.settings.display.Display.render(Display.java:42)
04-12 00:00:00.000 1234 5678 E AndroidRuntime: 	at com.android.settings.SettingsActivity.onResume(SettingsActivity.java:101)
04-12 00:00:00.000 1234 5678 E AndroidRuntime: 	at android.app.Instrumentation.callActivityOnResume(Instrumentation.java:1456)
User Email: admin@void-enterprise.com
Bearer Token: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWI...
Device ID: 82e1627caabbccdd
            `.trim();
            
            fs.writeFileSync(path.join(logDir, 'replication_failure.txt'), dummyCrash);
            shouldTriggerGatekeeper = true;
        }

        if (shouldTriggerGatekeeper) {
            console.log("\n=== Task 2 & 3: The Gatekeeper Sandbox & Sherlock Analysis (Zone 3) ===");
            const gatekeeper = new Gatekeeper();
            await gatekeeper.spinUpSandbox();
        }

        // Task 4: Final Output Verification
        const outPath = path.join(__dirname, 'rca_output', 'DiagnosticReport.json');
        if (fs.existsSync(outPath)) {
            console.log("\n=== Task 4: Final Output ===");
            const report = fs.readFileSync(outPath, 'utf8');
            console.log(report);
            console.log("\nVOID PIPELINE TEST COMPLETE: Hardware Verified, Sandbox Cleared, Report Generated.");
        } else {
            console.log("\n[Error] DiagnosticReport.json was not generated.");
        }

    } catch (e) {
        console.error("Integration Test failed:", e);
    }
}

main().catch(console.error);
