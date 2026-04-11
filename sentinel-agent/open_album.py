import time
from ppadb.client import Client as AdbClient

def launch_album_and_select():
    client = AdbClient(host="127.0.0.1", port=5037)
    devices = client.devices()
    
    if not devices:
        print("No devices attached.")
        return
        
    device = devices[0]
    
    # Enable visual pointers to see the tap
    device.shell("settings put system pointer_location 1")
    
    print("Launching OnePlus Gallery...")
    # Using monkey to launch default launcher activity
    device.shell("monkey -p com.oneplus.gallery -c android.intent.category.LAUNCHER 1")
    
    # Wait for the gallery to load fully
    time.sleep(3)
    
    print("Selecting a picture...")
    # Tapping coordinates mapping to the first/second picture block
    device.shell("input tap 300 600")
    
    time.sleep(2)
    # Turn off visual pointers
    device.shell("settings put system pointer_location 0")
    print("Action complete.")

if __name__ == "__main__":
    launch_album_and_select()
