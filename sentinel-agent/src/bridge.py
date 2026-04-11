import sys
import json
import time
from ppadb.client import Client as AdbClient

def simulate_user_actions(package_name, steps, apk_path=None):
    client = AdbClient(host="127.0.0.1", port=5037)
    devices = client.devices()
    
    if len(devices) == 0:
        raise Exception("No physical or emulated devices found attached to ADB")
        
    device = devices[0]
    
    if apk_path:
        print(f"[{package_name}] Installing APK from {apk_path}...", file=sys.stderr)
        # Reinstall keeping data or replace
        device.install(apk_path, reinstall=True)
        time.sleep(2)
        
    # Hardware Stabilization: Wake & Unlock
    print(f"[{package_name}] Waking up device...", file=sys.stderr)
    device.shell("input keyevent 26")
    time.sleep(1)
    device.shell("input keyevent 82")
    
    # Visual Debugging: Pointer Location ON
    device.shell("settings put system pointer_location 1")

    # Clear logcat buffer to avoid false positives
    device.shell("logcat -c")
    print(f"[{package_name}] Launching application via direct am start...", file=sys.stderr)
    
    # Direct Launch
    if "/" in package_name:
        device.shell(f"am start -n {package_name}")
    else:
        device.shell(f"am start -n {package_name}/.MainActivity")
    time.sleep(3) # Wait for app to be ready
    
    print(f"[{package_name}] Replaying S2R steps...", file=sys.stderr)
    
    # Replay steps
    for step in steps:
        x = step.get('x') or step.get('X')
        y = step.get('y') or step.get('Y')
        if x is not None and y is not None:
            device.shell(f"input tap {x} {y}")
            time.sleep(0.5) 
            
    # Wait to allow crash to occur and logcat to catch it
    time.sleep(3)
    
    # Capture logcat
    logcat_output = device.shell("logcat -d -t 1000")
    
    # Evidence Capture: Screenshot
    import os
    logs_dir = os.path.join(os.path.dirname(__file__), '..', 'logs')
    os.makedirs(logs_dir, exist_ok=True)
    screenshot_path = os.path.join(logs_dir, 'verification_screenshot.png')
    with open(screenshot_path, "wb") as f:
        f.write(device.screencap())
    print(f"[{package_name}] Screenshot saved to {screenshot_path}", file=sys.stderr)
    
    # Visual Debugging: Pointer Location OFF
    device.shell("settings put system pointer_location 0")

    # Return true if FATAL EXCEPTION is found
    has_crash = "FATAL EXCEPTION" in logcat_output
    
    return has_crash, logcat_output

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python bridge.py <package_name> <steps_json> [apk_path]")
        sys.exit(1)
        
    package_name = sys.argv[1]
    steps_json = sys.argv[2]
    apk_path = sys.argv[3] if len(sys.argv) > 3 else None
    
    try:
        steps = json.loads(steps_json)
        crash, logcat = simulate_user_actions(package_name, steps, apk_path)
        
        # Masked logs for Sherlock-Zero (Zone 3)
        masked_logs = "Masked Logcat Snippet:\n" + "\n".join(
            line for line in logcat.split("\n") if "FATAL EXCEPTION" in line or "Exception" in line
        )
        
        print(json.dumps({
            "hasCrash": crash,
            "maskedLogs": masked_logs if crash else None
        }))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
