import os
import sys
import requests

def strip_hashtag_from_title(title):
    title = title.strip()
    if title.startswith('#'):
        tokens = [t.strip() for t in title.split() if t.strip()]
        if len(tokens) >= 2:
            return " ".join(tokens[1:])
    return title

def main():
    print("🚀 Starting database cleanup (removing duplicates & stripping '#' from titles)...")

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

    # 2. Fetch all cards
    print("🔍 Fetching cards from database...")
    try:
        url = f"{supabase_url}/rest/v1/cards?select=id,title,description,created_at"
        response = requests.get(url, headers=headers, proxies=proxies, timeout=30)
        response.raise_for_status()
        cards = response.json()
    except Exception as e:
        print(f"❌ Failed to fetch cards: {e}")
        sys.exit(1)

    print(f"ℹ️ Retrieved {len(cards)} cards.")

    # 3. Detect duplicates & prepare deletions
    groups = {}
    for card in cards:
        title = card.get('title') or ""
        desc = card.get('description') or ""
        key = f"{title.strip()}::{desc.strip()}"
        if key not in groups:
            groups[key] = []
        groups[key].append(card)

    duplicate_groups = {k: v for k, v in groups.items() if len(v) > 1}
    delete_ids = []

    for key, card_list in duplicate_groups.items():
        # Keep the oldest card, delete the newer duplicates
        card_list.sort(key=lambda x: x.get('created_at') or "")
        to_delete = card_list[1:]
        for item in to_delete:
            delete_ids.append(item.get('id'))

    print(f"📊 Found {len(delete_ids)} duplicate records to delete.")

    # Execute Deletions
    deleted_count = 0
    for i, card_id in enumerate(delete_ids):
        try:
            delete_url = f"{supabase_url}/rest/v1/cards?id=eq.{card_id}"
            del_resp = requests.delete(delete_url, headers=headers, proxies=proxies, timeout=15)
            del_resp.raise_for_status()
            deleted_count += 1
            if deleted_count % 10 == 0:
                print(f"   Deleted {deleted_count}/{len(delete_ids)} duplicates...")
        except Exception as e:
            print(f"   ❌ Failed to delete card [{card_id}]: {e}")

    print(f"✅ Successfully deleted {deleted_count} duplicates.")

    # Re-fetch cards after deletion to perform title cleanup
    print("\n🔍 Re-fetching remaining cards for title cleaning...")
    try:
        url = f"{supabase_url}/rest/v1/cards?select=id,title"
        response = requests.get(url, headers=headers, proxies=proxies, timeout=30)
        response.raise_for_status()
        remaining_cards = response.json()
    except Exception as e:
        print(f"❌ Failed to re-fetch remaining cards: {e}")
        sys.exit(1)

    # 4. Clean Titles (Strip hashtags)
    repaired_titles_count = 0
    for card in remaining_cards:
        card_id = card.get('id')
        current_title = card.get('title') or ""
        
        new_title = strip_hashtag_from_title(current_title)
        
        if new_title != current_title:
            try:
                patch_url = f"{supabase_url}/rest/v1/cards?id=eq.{card_id}"
                patch_resp = requests.patch(patch_url, headers=headers, json={"title": new_title}, proxies=proxies, timeout=15)
                patch_resp.raise_for_status()
                repaired_titles_count += 1
                if repaired_titles_count % 50 == 0:
                    print(f"   Cleaned {repaired_titles_count} titles...")
            except Exception as e:
                print(f"   ❌ Failed to update card title for [{card_id}]: {e}")

    print(f"✅ Successfully cleaned {repaired_titles_count} card titles in database.")
    print("\n🏁 Database cleanup execution complete!")

if __name__ == '__main__':
    main()
