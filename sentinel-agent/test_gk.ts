import { Gatekeeper } from './src/gatekeeper.js';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
    console.log("=== Dry Run: Triggering Gatekeeper ===");
    
    // Create a dummy fake log
    const logDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    
    fs.writeFileSync(path.join(logDir, 'replication_failure.txt'), "FATAL EXCEPTION: main\\njava.lang.NullPointerException: fake trace");
    
    const gk = new Gatekeeper();
    await gk.spinUpSandbox();
    
    console.log("Validation complete.");
}
main();
