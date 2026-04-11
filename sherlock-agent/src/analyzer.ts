import * as fs from 'fs';
import * as path from 'path';

// Define expected paths inside the Docker container
const LOG_FILE_PATH = process.env.LOG_FILE_PATH || '/logs/replication_failure.txt';
const OUTPUT_FILE_PATH = process.env.OUTPUT_FILE_PATH || '/logs/DiagnosticReport.json';

function maskPII(text: string): string {
    let masked = text;
    // Mask Emails
    masked = masked.replace(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi, '[REDACTED_EMAIL]');
    // Mask Bearer Tokens
    masked = masked.replace(/Bearer [A-Za-z0-9\-_~+\/]+[=]*/g, 'Bearer [REDACTED_TOKEN]');
    // Mask Device IDs (Simple alphanumeric 16-32 length like 82e1627c)
    masked = masked.replace(/\b([a-fA-F0-9]{8,32})\b/g, '[REDACTED_DEVICE_ID]');
    return masked;
}

function calculateConfidence(errLine: string): number {
    if (errLine.includes('NullPointerException')) return 0.9;
    if (errLine.includes('TimeoutException')) return 0.4;
    if (errLine.includes('IllegalStateException')) return 0.7;
    return 0.5; // Default confidence
}

function analyzeLog(logContent: string) {
    const lines = logContent.split('\n');
    let patientZero = null;
    let confidence = 0.5;
    let failureType = "UnknownException";
    
    // Reverse search for the earliest line in our code (Assuming package typically starts with com.something but not com.android)
    for (const line of lines) {
         if (line.includes('FATAL EXCEPTION') || line.includes('Exception')) {
             failureType = line.trim();
             confidence = calculateConfidence(line);
         }
         
         // Looking for stack trace lines like "at com.voidenterprise..."
         // We'll consider the first "at com." or non-android trace as Patient Zero
         if (line.includes('at ') && !line.includes('android.os') && !line.includes('java.lang')) {
             if (!patientZero) {
                 patientZero = line.trim();
             }
         }
    }
    
    return {
        patientZero: patientZero || "Unable to determine Patient Zero from OS trace.",
        failureType,
        confidence,
    };
}

function main() {
    console.log("[Sherlock-Zero] Starting RCA Analysis inside Vault...");
    
    if (!fs.existsSync(LOG_FILE_PATH)) {
        console.error(`[Sherlock-Zero] Log file not found at ${LOG_FILE_PATH}`);
        process.exit(1);
    }
    
    const rawLogs = fs.readFileSync(LOG_FILE_PATH, 'utf-8');
    const maskedLogs = maskPII(rawLogs);
    const analysis = analyzeLog(maskedLogs);
    
    const report = {
        metadata: {
            analyzer: "Sherlock-Zero",
            timestamp: new Date().toISOString(),
            security: "SOC2 JIT Compliant (PII Redacted)"
        },
        rca: {
             patientZero: analysis.patientZero,
             confidence: analysis.confidence,
             errorClass: analysis.failureType
        },
        maskedLogSnippet: maskedLogs.substring(0, 500) + "...\n[TRUNCATED]"
    };
    
    fs.writeFileSync(OUTPUT_FILE_PATH, JSON.stringify(report, null, 2));
    console.log(`[Sherlock-Zero] Analysis complete. DiagnosticReport saved to ${OUTPUT_FILE_PATH}`);
}

main();
