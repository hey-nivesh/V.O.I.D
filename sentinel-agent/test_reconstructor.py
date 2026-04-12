import json
from src.reconstructor import reconstruct_conditions

payload = [{"x": 200, "y": 400}, {"x": 200, "y": 800}]
print("=== Zone 5 Reconstructor Pulse ===")
try:
    verified, img = reconstruct_conditions("com.android.settings", payload)
    print(json.dumps({"verified": verified, "proofImage": img, "status": "Fix Verified" if verified else "Still Crashing"}, indent=2))
except Exception as e:
    print(f"Error: {e}")
