import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { Gatekeeper } from './gatekeeper.js';

const execAsync = promisify(exec);

export interface S2RStep {
  x: number;
  y: number;
}

export class SentinelAgent {
  private pythonBridgePath: string;
  private fdroidPath: string;

  constructor() {
    this.pythonBridgePath = path.join(__dirname, 'bridge.py');
    this.fdroidPath = path.join(__dirname, '..', 'fdroid');
  }

  private async triggerBridge(packageName: string, steps: S2RStep[], apkPath?: string): Promise<{ hasCrash: boolean, maskedLogs?: string, error?: string }> {
    try {
      // Ensure ADB server is running using the specified path
      const adbPath = 'C:\\Users\\LENOVO\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe';
      await execAsync(`"${adbPath}" start-server`);

      const escapedSteps = JSON.stringify(steps).replace(/"/g, '\\"');
      const cmd = apkPath 
        ? `python "${this.pythonBridgePath}" "${packageName}" "${escapedSteps}" "${apkPath}"`
        : `python "${this.pythonBridgePath}" "${packageName}" "${escapedSteps}"`;
        
      const { stdout, stderr } = await execAsync(cmd);
      
      const lastLine = stdout.trim().split('\n').pop() || "{}";
      return JSON.parse(lastLine);
    } catch (e: any) {
      console.error("Sentinel Bridge Error:", e.stderr || e.message);
      return { hasCrash: false, error: e.message };
    }
  }

  /**
   * Zone 2 Logic
   * Execute simulation on the current build; if a crash is detected, save logs to logs/replication_failure.txt.
   */
  async runZone2(packageName: string, steps: S2RStep[]): Promise<any> {
    console.log(`[Zone 2] Sentinel executing simulation on current build for ${packageName}...`);
    const result = await this.triggerBridge(packageName, steps);
    
    if (result.error) {
       console.error(`[Zone 2] Bridge error: ${result.error}`);
       return { status: 'error', error: result.error };
    }
    
    if (result.hasCrash) {
      console.log("[Zone 2] Crash detected! Saving logs to logs/replication_failure.txt for Sherlock-Zero.");
      const logDir = path.join(__dirname, '..', 'logs');
      if (!fs.existsSync(logDir)) {
          fs.mkdirSync(logDir, { recursive: true });
      }
      fs.writeFileSync(path.join(logDir, 'replication_failure.txt'), result.maskedLogs || '');
      
      // TRIGGER THE GATEKEEPER (Zone 3 Sandbox)
      const gatekeeper = new Gatekeeper();
      await gatekeeper.spinUpSandbox();
      
      return { status: 'replicated', zone3Triggered: true, logs: 'logs/replication_failure.txt' };
    } else {
      console.log("[Zone 2] Bug not replicated (CNR).");
      return { status: 'not_replicated', zone3Triggered: false };
    }
  }

  /**
   * Zone 5 Logic
   * Run python -m fdroidserver update to sign the fix, install the signed APK, and verify the fix.
   */
  async runZone5(packageName: string, steps: S2RStep[]): Promise<any> {
    console.log(`[Zone 5] Running fdroidserver update to sign the fix...`);
    try {
        await execAsync(`python -m fdroidserver update`, { cwd: this.fdroidPath });
    } catch (e: any) {
        console.error("[Zone 5] Error signing APK via fdroidserver:", e.message);
        return { status: 'error', error: 'FDroid signing failed' };
    }

    console.log(`[Zone 5] Sentinel verifying fix via newly signed APK for ${packageName}...`);
    // Assume apk is in fdroid/repo/
    const apkPath = path.join(this.fdroidPath, 'repo', `${packageName}.apk`);
    
    const result = await this.triggerBridge(packageName, steps, apkPath);
    
    if (result.error) {
       console.error(`[Zone 5] Bridge error: ${result.error}`);
       return { status: 'error', error: result.error };
    }
    
    if (!result.hasCrash) {
      console.log("[Zone 5] Post-fix verification successful. Triggering Admin-Envoy (Zone 6).");
      return { status: 'fix_verified', zone6Triggered: true };
    } else {
      console.log("[Zone 5] Fix failed. Bug still present.");
      return { status: 'fix_failed', zone6Triggered: false };
    }
  }
}
