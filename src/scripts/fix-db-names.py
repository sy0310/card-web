import os
import sys
import re
import requests

def parse_caption(caption):
    lines = caption.split('\n')
    first_line = lines[0].strip() if lines else ""
    
    group = ''
    album_era = ''
    
    if first_line.startswith('#'):
        tokens = [t.strip() for t in first_line.split() if t.strip()]
        if len(tokens) >= 2:
            group = tokens[1]
            lower_group = group.lower()
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
            
    return group, album_era

def main():
    print("🚀 Starting database name repair script...")

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

    # Configure SOCKS5 proxy
    proxies = None
    if proxy:
        clean_proxy = proxy.replace('http://', '').replace('https://', '')
        socks_proxy = f"socks5h://{clean_proxy}"
        print(f"🌐 Using SOCKS5 proxy: {socks_proxy}")
        proxies = {
            "http": socks_proxy,
            "https": socks_proxy
        }

    # Base request headers
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json"
    }

    # 2. Fetch all cards with their descriptions
    print("🔍 Fetching all cards from database...")
    try:
        url = f"{supabase_url}/rest/v1/cards?select=id,title,description,group_name,album_era"
        response = requests.get(url, headers=headers, proxies=proxies, timeout=30)
        response.raise_for_status()
        cards = response.json()
    except Exception as e:
        print(f"❌ Failed to fetch cards: {e}")
        sys.exit(1)

    print(f"ℹ️ Found {len(cards)} total cards in database. Analyzing naming data...")

    updated_count = 0
    skipped_count = 0

    for card in cards:
        card_id = card.get('id')
        description = card.get('description') or ""
        current_group = card.get('group_name') or ""
        current_album = card.get('album_era') or ""

        if not description:
            skipped_count += 1
            continue

        # Parse correct names from description
        correct_group, correct_album = parse_caption(description)

        if not correct_group:
            # If we couldn't parse a group, we skip it
            skipped_count += 1
            continue

        # If names differ, update them
        if correct_group != current_group or correct_album != current_album:
            print(f"🛠️ Repairing Card [{card_id}] ({card.get('title')[:30]}...):")
            print(f"   Group: '{current_group}' -> '{correct_group}'")
            print(f"   Album: '{current_album}' -> '{correct_album}'")

            try:
                patch_url = f"{supabase_url}/rest/v1/cards?id=eq.{card_id}"
                payload = {
                    "group_name": correct_group,
                    "album_era": correct_album
                }
                patch_resp = requests.patch(patch_url, headers=headers, json=payload, proxies=proxies, timeout=15)
                patch_resp.raise_for_status()
                updated_count += 1
            except Exception as e:
                print(f"   ❌ Failed to update card [{card_id}]: {e}")
        else:
            skipped_count += 1

    print("\n🏁 Naming Repair Complete!")
    print(f"📊 Repaired/Updated: {updated_count} cards")
    print(f"⏭️ Unchanged/Skipped: {skipped_count} cards")

if __name__ == '__main__':
    main()
