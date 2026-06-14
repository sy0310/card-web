import os
import sys
import json
from instagrapi import Client
from publish_ig_env import load_publish_env

def main():
    if len(sys.argv) < 3:
        print("❌ Error: Missing arguments. Usage: python publish-ig.py <image_path> <caption_text>")
        sys.exit(1)

    image_path = sys.argv[1]
    caption = sys.argv[2]

    if not os.path.exists(image_path):
        print(f"❌ Error: Image path does not exist: {image_path}")
        sys.exit(1)

    # 1. Read runtime env first, then fall back to local .env.local for scripts.
    env = load_publish_env('.env.local')

    session_id = env.get('session_id')
    proxy = env.get('proxy')

    if not session_id:
        print("❌ Error: session_id not found in environment or .env.local!")
        sys.exit(1)

    # 2. Setup client
    cl = Client()
    cl.request_timeout = 20
    
    if proxy:
        print(f"🌐 Using proxy: {proxy}")
        cl.set_proxy(proxy)

    # 3. Login
    print("🔑 Logging into Instagram via session_id...")
    try:
        cl.login_by_sessionid(session_id)
        print("✅ Login successful.")
    except Exception as e:
        print(f"❌ Error: Login via sessionid failed: {e}")
        sys.exit(1)

    # 4. Upload photo
    print(f"📤 Uploading photo {image_path} with caption length {len(caption)}...")
    try:
        media = cl.photo_upload(image_path, caption)
        print("✅ Photo upload successful!")
        
        result = {
            "success": True,
            "media_code": media.code,
            "pk": media.pk,
            "url": f"https://www.instagram.com/p/{media.code}/"
        }
        print(f"RESULT_JSON:{json.dumps(result)}")
        sys.exit(0)
    except Exception as e:
        print(f"❌ Error: Photo upload failed: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()
