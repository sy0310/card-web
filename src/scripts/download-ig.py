import os
import sys
from datetime import datetime
from instagrapi import Client

def main():
    print("🚀 Starting Instagram download script using instagrapi...")
    
    # 1. Parse .env.local manually to handle spaces and quotes
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

    username = env.get('user_name')
    password = env.get('password')
    session_id = env.get('session_id')

    if not session_id and (not username or not password):
        print("❌ Error: session_id or (user_name and password) not found in .env.local!")
        sys.exit(1)

    # 2. Login to Instagram
    cl = Client()
    cl.request_timeout = 10
    cl.delay_range = [2, 5]
    
    proxy = env.get('proxy')
    if proxy:
        print(f"🌐 Setting proxy: {proxy}")
        cl.set_proxy(proxy)
    
    if session_id:
        print("🔑 Attempting login using session_id from .env.local...")
        try:
            cl.login_by_sessionid(session_id)
            print("✅ Login via sessionid successful.")
            # Set username if not already populated
            if not username:
                username = cl.username
                print(f"👤 Resolved username from session: {username}")
        except Exception as e:
            print(f"❌ Failed to login via sessionid: {e}")
            sys.exit(1)
    else:
        # Optional: load session if exists to avoid frequent logins
        session_file = f".config_session_{username}.json"
        if os.path.exists(session_file):
            try:
                print("💾 Loading saved Instagram session...")
                cl.load_settings(session_file)
                cl.login(username, password)
                print("✅ Loaded session and logged in successfully.")
            except Exception as e:
                print(f"⚠️ Failed to load session: {e}. Trying normal login...")
                cl.login(username, password)
        else:
            print(f"🔑 Logging in as {username}...")
            cl.login(username, password)
            print("✅ Login successful.")
            try:
                cl.dump_settings(session_file)
                print("💾 Saved session for future use.")
            except Exception as e:
                print(f"⚠️ Failed to save session: {e}")

    # 3. Get User ID
    try:
        user_id = cl.user_id_from_username(username)
        print(f"👤 Account User ID: {user_id}")
    except Exception as e:
        print(f"❌ Failed to resolve user ID for username {username}: {e}")
        sys.exit(1)

    # 4. Fetch medias (posts) using manual pagination and cooldowns to bypass 429 rate limit
    print("Fetching posts from profile with pagination and sleep cooldowns...")
    medias = []
    end_cursor = ""
    page = 1
    import time
    
    while len(medias) < 1850:
        print(f"📖 Fetching page {page} from profile (cursor: '{end_cursor}')...")
        try:
            page_medias, end_cursor = cl.user_medias_paginated(user_id, amount=100, end_cursor=end_cursor)
            if not page_medias:
                print("ℹ️ No more medias returned from Instagram.")
                break
                
            medias.extend(page_medias)
            print(f"   Fetched {len(page_medias)} posts. Total gathered: {len(medias)}")
            
            if not end_cursor:
                print("ℹ️ Reached the end of profile (no cursor left).")
                break
                
            time.sleep(1.2)  # 1.2 seconds cooldown between API requests to prevent 429
            page += 1
        except Exception as e:
            print(f"❌ Failed to fetch page {page}: {e}")
            print("   Waiting 15 seconds before retrying this page...")
            time.sleep(15)
            continue
            
    print(f"📋 Completed list scan. Total posts fetched: {len(medias)}")

    # 5. Download missing posts
    os.makedirs('ig_export', exist_ok=True)
    download_count = 0
    skipped_count = 0

    for media in medias:
        # Format the taken_at datetime in UTC matching Instaloader format: YYYY-MM-DD_HH-MM-SS_UTC
        # taken_at in instagrapi is already a datetime object (usually UTC or local depending on library version)
        dt_str = media.taken_at.strftime('%Y-%m-%d_%H-%M-%S_UTC')
        txt_path = f"ig_export/{dt_str}.txt"
        jpg_path = f"ig_export/{dt_str}.jpg"

        # Check if already downloaded
        if os.path.exists(txt_path) and os.path.exists(jpg_path):
            skipped_count += 1
            continue

        print(f"📥 Downloading post: {dt_str} (Code: {media.code})")

        # Save Caption to .txt
        caption = media.caption_text or ""
        try:
            with open(txt_path, 'w', encoding='utf-8') as f:
                f.write(caption)
        except Exception as e:
            print(f"⚠️ Failed to write caption file for {dt_str}: {e}")
            continue

        # Download Photo/Thumbnail using private request session with 15s timeout
        try:
            img_url = None
            if media.media_type == 1:  # Photo
                img_url = media.thumbnail_url
            elif media.media_type == 8:  # Album (Carousel)
                img_url = media.resources[0].thumbnail_url if media.resources else media.thumbnail_url
            else:
                # Video or other, download thumbnail
                img_url = media.thumbnail_url

            if not img_url:
                raise Exception("No valid image URL found")

            # Fetch via clean requests to avoid API session headers causing 404 from CDN
            import requests
            proxies = {"http": proxy, "https": proxy} if proxy else None
            # Download using clean session with 15s timeout
            img_res = requests.get(img_url, proxies=proxies, timeout=15)
            img_res.raise_for_status()
            with open(jpg_path, 'wb') as f:
                f.write(img_res.content)
            
            download_count += 1
            print(f"   Saved to {jpg_path}")
            
            # Add a small random delay to avoid rate limiting
            import time
            import random
            sleep_time = random.uniform(1.0, 2.5)
            time.sleep(sleep_time)
        except Exception as e:
            print(f"⚠️ Failed to download image for {dt_str}: {e}")
            # Clean up txt file if image download failed so it retries next time
            if os.path.exists(txt_path):
                os.remove(txt_path)

        # Break early to prevent hitting heavy rate limits
        if download_count >= 400:
            print("🛑 Reached download limit of 400 posts for this run. Run again later if needed.")
            break

    print(f"\n🏁 Download execution completed!")
    print(f"📊 New downloaded: {download_count}")
    print(f"⏭️ Skipped (already exist): {skipped_count}")

if __name__ == '__main__':
    main()
