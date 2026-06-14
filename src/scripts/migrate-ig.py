import os
import sys
import re
import random
import string
import requests

def parse_caption(caption):
    lines = caption.split('\n')
    first_line = lines[0].strip() if lines else ""
    
    price = 0
    group = ''
    album_era = ''
    member = ''
    
    # 1. Extract Price
    price_match = re.search(r'\$(\d+)(?:\s+set)?', caption, re.IGNORECASE)
    if price_match:
        price = float(price_match.group(1))
        
    # 2. Extract Group and Album from the first line
    # Format: #hashtag GroupName AlbumName SpecialDetail
    if first_line.startswith('#'):
        tokens = [t.strip() for t in first_line.split() if t.strip()]
        if len(tokens) >= 2:
            group = tokens[1]
            lower_group = group.lower()
            # Beautify known groups
            if lower_group == 'p1harmony':
                group = 'P1Harmony'
            elif lower_group == 'illit':
                group = 'Illit'
            elif lower_group == 'ampers&one':
                group = 'Ampers&one'
            elif lower_group == '&team':
                group = '&Team'
            elif lower_group == 'xikers':
                group = 'Xikers'
            elif lower_group == 'riize':
                group = 'Riize'
                
        if len(tokens) >= 3:
            album_era = tokens[2]
            
    # 3. Extract Title (strip first token if it starts with #)
    title = first_line
    if first_line.startswith('#'):
        tokens = [t.strip() for t in first_line.split() if t.strip()]
        if len(tokens) >= 2:
            title = " ".join(tokens[1:])
    title = title[:80].strip() if title else 'IG Post'
    
    return title, price, group, album_era, member

def main():
    print("🚀 Starting Instagram to Supabase migration using Python (SOCKS5)...")

    # 1. Parse .env.local manually
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

    supabase_url = env.get('NEXT_PUBLIC_SUPABASE_URL')
    supabase_key = env.get('SUPABASE_SERVICE_ROLE_KEY') or env.get('NEXT_PUBLIC_SUPABASE_ANON_KEY')
    proxy = env.get('proxy')

    if not supabase_url or not supabase_key:
        print("❌ Error: Supabase credentials not found in .env.local!")
        sys.exit(1)

    # Force SOCKS5h to bypass TLS connect proxy handshake errors
    proxies = None
    if proxy:
        clean_proxy = proxy.replace('http://', '').replace('https://', '')
        socks_proxy = f"socks5h://{clean_proxy}"
        print(f"🌐 Using SOCKS5 proxy: {socks_proxy}")
        proxies = {
            "http": socks_proxy,
            "https": socks_proxy
        }

    # Set base request headers
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}"
    }

    # 2. Fetch existing migrated cards from database
    print("🔍 Fetching existing migrated cards from database...")
    try:
        url = f"{supabase_url}/rest/v1/cards?select=title,description"
        response = requests.get(url, headers=headers, proxies=proxies, timeout=15)
        response.raise_for_status()
        existing_cards = response.json()
    except Exception as e:
        print(f"❌ Failed to fetch existing cards from Supabase: {e}")
        sys.exit(1)

    existing_keys = set(f"{c.get('title')}::{c.get('description')}" for c in existing_cards)
    print(f"ℹ️ Found {len(existing_keys)} existing cards in database.")

    # 3. Scan export directory
    export_dir = 'ig_export'
    if not os.path.exists(export_dir):
        print(f"❌ Folder '{export_dir}' not found! Please create it and run download script first.")
        sys.exit(1)

    files = os.listdir(export_dir)
    txt_files = [f for f in files if f.endswith('.txt')]

    print(f"🚀 Starting migration of {len(txt_files)} posts...")

    success_count = 0
    fail_count = 0
    skipped_count = 0

    for i, txt_file in enumerate(txt_files):
        base_name = txt_file[:-4]
        
        # Find corresponding image
        img_file = None
        for ext in ['.jpg', '_1.jpg', '.png']:
            possible_file = f"{base_name}{ext}"
            if possible_file in files:
                img_file = possible_file
                break
                
        if not img_file:
            print(f"[{i+1}/{len(txt_files)}] ⚠️ No image found for {txt_file}, skipping.")
            continue

        try:
            # Read Caption
            with open(os.path.join(export_dir, txt_file), 'r', encoding='utf-8') as f:
                caption = f.read()
                
            title, price, group, album_era, member = parse_caption(caption)

            # Check if already migrated
            key = f"{title}::{caption}"
            if key in existing_keys:
                skipped_count += 1
                continue

            print(f"🔄 Migrating: {title} (File: {base_name})")

            # Upload Image to Storage Bucket 'cards'
            img_path = os.path.join(export_dir, img_file)
            random_str = ''.join(random.choices(string.ascii_lowercase + string.digits, k=6))
            unique_name = f"{int(os.path.getmtime(img_path))}-{random_str}.jpg"
            
            storage_url = f"{supabase_url}/storage/v1/object/cards/migrated/{unique_name}"
            upload_headers = {
                **headers,
                "Content-Type": "image/jpeg"
            }
            
            with open(img_path, 'rb') as img_data:
                upload_resp = requests.post(storage_url, headers=upload_headers, data=img_data, proxies=proxies, timeout=30)
                upload_resp.raise_for_status()

            # Construct Public URL
            public_url = f"{supabase_url}/storage/v1/object/public/cards/migrated/{unique_name}"

            # Insert into database 'cards' table
            db_url = f"{supabase_url}/rest/v1/cards"
            insert_headers = {
                **headers,
                "Content-Type": "application/json",
                "Prefer": "return=representation"
            }
            payload = {
                "title": title,
                "description": caption,
                "price": price,
                "group_name": group,
                "album_era": album_era,
                "member_name": member,
                "image_url": public_url,
                "source": "instagram",
                "original_ig_url": f"https://www.instagram.com/p/{base_name.split('_')[0]}/"
            }
            
            insert_resp = requests.post(db_url, headers=insert_headers, json=payload, proxies=proxies, timeout=15)
            insert_resp.raise_for_status()

            success_count += 1
            if success_count % 10 == 0:
                print(f"✅ Progress: {success_count}/{len(txt_files)} ({int(success_count/len(txt_files)*100)}%)")

        except Exception as e:
            fail_count += 1
            print(f"❌ [{i+1}/{len(txt_files)}] Failed {base_name}: {e}")

    print("\n🏁 Migration Complete!")
    print(f"📊 Success: {success_count}")
    print(f"⏭️ Skipped (already exist): {skipped_count}")
    print(f"❌ Failed: {fail_count}")

if __name__ == '__main__':
    main()
