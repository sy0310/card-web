import os
import sys
import requests

def main():
    print("🚀 Scanning for duplicate card records in Supabase...")

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

    # Fetch all cards
    try:
        url = f"{supabase_url}/rest/v1/cards?select=id,title,description,image_url,created_at"
        response = requests.get(url, headers=headers, proxies=proxies, timeout=30)
        response.raise_for_status()
        cards = response.json()
    except Exception as e:
        print(f"❌ Failed to fetch cards: {e}")
        sys.exit(1)

    print(f"ℹ️ Found {len(cards)} total cards in database.")

    # Group cards by (title, description) to check duplicates
    groups = {}
    for card in cards:
        title = card.get('title') or ""
        desc = card.get('description') or ""
        # Create a unique key based on title and description
        key = f"{title.strip()}::{desc.strip()}"
        if key not in groups:
            groups[key] = []
        groups[key].append(card)

    duplicate_keys = {k: v for k, v in groups.items() if len(v) > 1}
    print(f"🔍 Found {len(duplicate_keys)} groups of duplicates.")

    total_to_delete = 0
    delete_ids = []

    for key, card_list in duplicate_keys.items():
        # Sort cards by created_at ascending (keep the oldest, delete the rest)
        # Sort key handles None values safely
        card_list.sort(key=lambda x: x.get('created_at') or "")
        
        # Keep the first card (index 0)
        kept_card = card_list[0]
        to_delete = card_list[1:]
        
        print(f"\n⚠️ Duplicates for key: '{kept_card.get('title')[:40]}...':")
        print(f"   [KEPT] ID: {kept_card.get('id')} (Created: {kept_card.get('created_at')})")
        
        for item in to_delete:
            print(f"   [DELETE] ID: {item.get('id')} (Created: {item.get('created_at')})")
            delete_ids.append(item.get('id'))
            total_to_delete += 1

    print(f"\n📊 Summary of duplicate detection:")
    print(f"   Total cards: {len(cards)}")
    print(f"   Duplicates to delete: {total_to_delete}")
    
    if total_to_delete > 0:
        print("\n💡 Tip: To delete these duplicates, write a cleanup logic. Currently dry-run is completed.")

if __name__ == '__main__':
    main()
