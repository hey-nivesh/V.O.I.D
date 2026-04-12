import { SentinelAgent } from './src/index.js';

async function main() {
    const agent = new SentinelAgent();
    
    const payload = {
        "packageName": "com.android.settings",
        "s2rSteps": [
            { "x": 500, "y": 1000 },
            { "x": 500, "y": 1500 }
        ]
    };

    console.log("=== Pre-Sherlock Mock Test ===");
    console.log(`Sending Payload to Zone 2:`, JSON.stringify(payload, null, 2));
    
    try {
        const result = await agent.runZone2(payload.packageName, payload.s2rSteps);
        console.log("\n=== Mock Test Result ===");
        console.log(JSON.stringify(result, null, 2));
    } catch (e) {
        console.error("Mock Test failed:", e);
    }
}

main().catch(console.error);
