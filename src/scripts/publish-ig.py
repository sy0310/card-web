import os
import sys
import json
from instagrapi import Client

def main():
    if len(sys.argv) < 3:
        print("❌ Error: Missing arguments. Usage: python publish-ig.py <image_path> <caption_text>")
        sys.exit(1)

    image_path = sys.argv[1]
    caption = sys.argv[2]

    if not os.path.exists(image_path):
        print(f"❌ Error: Image path does not exist: {image_path}")
        sys.exit(1)

    # 1. Parse env file
    env = {}
    env_path = '.env.local'
    if os.path.exists(env_path):
        with open(env_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                if '=' in line:
                    key, val = line.split('=', 1)
                    env[key.strip()] = val.strip().strip("'").strip('"')

    session_id = env.get('session_id')
    proxy = env.get('proxy')

    if not session_id:
        print("❌ Error: session_id not found in .env.local!")
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
