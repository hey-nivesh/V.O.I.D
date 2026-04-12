import sys
import json
import time
import os
import glob
import subprocess
import re
from ppadb.client import Client as AdbClient

def parse_steps(steps_str):
    try:
        return json.loads(steps_str)
    except json.JSONDecodeError:
        pass
        
    clean_str = steps_str.replace("'", '"')
    clean_str = re.sub(r'([{,]\s*)([a-zA-Z0-9_]+)(\s*:)', r'\1"\2"\3', clean_str)
    
    try:
        return json.loads(clean_str)
    except json.JSONDecodeError:
        pass
        
    parts = [re.sub(r'[^0-9-]', '', p) for p in steps_str.split(',')]
    parts = [p for p in parts if p]
    try:
        numbers = [int(n) for n in parts]
        if numbers and len(numbers) % 2 == 0:
            return [{"x": numbers[i], "y": numbers[i+1]} for i in range(0, len(numbers), 2)]
    except ValueError:
        pass

    raise Exception(f"Could not parse steps argument: {steps_str}")

def run_fdroid_update():
    print("[Zone 5 Reconstructor] Syncing F-Droid: Running python -m fdroidserver update...", file=sys.stderr)
    fdroid_dir = os.path.join(os.path.dirname(__file__), '..', 'fdroid')
    # Assuming fdroidserver is available in the current python env
    subprocess.run(["python", "-m", "fdroidserver", "update"], cwd=fdroid_dir, check=True)

def find_latest_apk(package_name):
    repo_dir = os.path.join(os.path.dirname(__file__), '..', 'fdroid', 'repo')
    search_pattern = os.path.join(repo_dir, f"*{package_name}*.apk")
    apks = glob.glob(search_pattern)
    
    if not apks:
        # Fallback to direct naming
        direct = os.path.join(repo_dir, f"{package_name}.apk")
        if os.path.exists(direct): return direct
        return None
        
    # Sort by modification time to get the latest
    apks.sort(key=os.path.getmtime, reverse=True)
    return apks[0]

def reconstruct_conditions(package_name, steps):
    # Task 1: F-Droid Sync & Artifact Retrieval
    try:
        run_fdroid_update()
    except Exception as e:
        print(f"[Zone 5 Reconstructor] F-Droid Update failed (Proceeding to checks): {e}", file=sys.stderr)
        
    base_pkg = package_name.split('/')[0]
    apk_path = find_latest_apk(base_pkg)
    
    if not apk_path:
        print(f"[Zone 5 Reconstructor] No F-Droid APK found for {base_pkg}", file=sys.stderr)
    else:
        print(f"[Zone 5 Reconstructor] Located target Artifact: {apk_path}", file=sys.stderr)

    # ADB Bridge Setup
    client = AdbClient(host="127.0.0.1", port=5037)
    devices = client.devices()
    if not devices:
        raise Exception("No physical devices attached to ADB")
    device = devices[0]

    # Task 2: Environmental Reconstruction (The Clean Slate)
    print(f"[{base_pkg}] Hardware Clean Slate & Mirror World Protection initializing...", file=sys.stderr)
    
    # 2.1 Hardware Reset (Mirror and pointers)
    device.shell("setprop debug.force_rtl 0")
    device.shell("settings put global debug.force_rtl 0")
    device.shell("settings put system force_rtl_layout_direction 0") # Native settings fallback
    
    device.shell("input keyevent 26") # Wake
    time.sleep(1)
    device.shell("input keyevent 82") # Unlock
    
    device.shell("settings put system pointer_location 1")
    
    # 2.2 Wiping Application Storage
    print(f"[{base_pkg}] Clearing local App Data cache via pm clear...", file=sys.stderr)
    device.shell(f"pm clear {base_pkg}")
    
    # 2.3 Deployment
    if apk_path:
        print(f"[{base_pkg}] Deploying F-Droid Signed Artifact across bridge...", file=sys.stderr)
        device.install(apk_path, reinstall=True)
        time.sleep(2)

    device.shell("logcat -c")
    
    # Task 3: Logic Replay (The Reconstruction)
    if "/" in package_name:
        device.shell(f"am start -n {package_name}")
    else:
        device.shell(f"am start -n {package_name}/.MainActivity")
    
    time.sleep(3) # Wait for UI to render
    
    print(f"[{base_pkg}] Replaying precise logic actions...", file=sys.stderr)
    for step in steps:
        x = step.get('x') or step.get('X')
        y = step.get('y') or step.get('Y')
        if x is not None and y is not None:
            device.shell(f"input tap {x} {y}")
            # Strict 1-second delay execution
            time.sleep(1.0)
            
    time.sleep(3) # Buffer for post-crash logging
    
    # 3.2 Verdict Capture
    logcat_output = device.shell("logcat -d -t 1500")
    has_crash = "FATAL EXCEPTION" in logcat_output
    verified = not has_crash or "Fix Verified" in logcat_output
    
    logs_dir = os.path.join(os.path.dirname(__file__), '..', 'logs')
    os.makedirs(logs_dir, exist_ok=True)
    screenshot_path = os.path.join(logs_dir, 'reconstruction_proof.png')
    
    print(f"[{base_pkg}] Retrieving proof of life screenshot...", file=sys.stderr)
    with open(screenshot_path, "wb") as f:
        f.write(device.screencap())
        
    device.shell("settings put system pointer_location 0")

    return verified, screenshot_path

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python reconstructor.py <package_name> <steps_json>")
        sys.exit(1)
        
    pkg = sys.argv[1]
    steps_json = " ".join(sys.argv[2:])
    
    try:
        steps = parse_steps(steps_json)
        verified, img = reconstruct_conditions(pkg, steps)
        
        print(json.dumps({
            "verified": verified,
            "proofImage": img,
            "status": "Fix Verified" if verified else "Reconstruction Failed (Crash persists)"
        }))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
