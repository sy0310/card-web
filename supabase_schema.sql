-- SQL Schema for K-pop Card Website

-- 1. Cards Table
CREATE TABLE IF NOT EXISTS cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL,
    image_url TEXT,
    group_name TEXT,
    member_name TEXT,
    album_era TEXT,
    pob_name TEXT,
    rarity TEXT,
    inventory_count INTEGER DEFAULT 1,
    original_ig_url TEXT, -- Link to the original IG post
    source TEXT DEFAULT 'manual', -- 'manual' or 'instagram'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Categories Table (Optional, can be used for dynamic filters)
CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    type TEXT NOT NULL -- 'group', 'member', 'album', 'rarity'
);

-- 3. Wishlists Table (Orders)
CREATE TABLE IF NOT EXISTS wishlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_ig_handle TEXT NOT NULL,
    status TEXT DEFAULT 'pending', -- 'pending', 'completed'
    total_price DECIMAL(10, 2),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Wishlist Items Table
CREATE TABLE IF NOT EXISTS wishlist_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wishlist_id UUID REFERENCES wishlists(id) ON DELETE CASCADE,
    card_id UUID REFERENCES cards(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Site Settings Table
CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Initial Settings
INSERT INTO site_settings (key, value) VALUES 
('official_ig_handle', '@official_account'),
('site_title', 'K-POP CARD'),
('checkout_intro', 'Enter your Instagram handle so we can track your request.'),
('wishlist_footer_note', 'Please DM this image to complete your purchase.'),
('low_stock_threshold', '2')
ON CONFLICT (key) DO NOTHING;

-- RLS Policies (Row Level Security)

-- Enable RLS
ALTER TABLE cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE wishlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE wishlist_items ENABLE ROW LEVEL SECURITY;

-- Public Read access for cards and categories
CREATE POLICY "Public Read Cards" ON cards FOR SELECT USING (true);
CREATE POLICY "Public Read Categories" ON categories FOR SELECT USING (true);

-- Admin access (you'll need to define admin role or use authenticated user)
-- For now, let's allow all actions for authenticated users (admins)
CREATE POLICY "Admin All Cards" ON cards FOR ALL TO authenticated USING (true);
CREATE POLICY "Admin All Categories" ON categories FOR ALL TO authenticated USING (true);
CREATE POLICY "Admin All Wishlists" ON wishlists FOR ALL TO authenticated USING (true);
CREATE POLICY "Admin All Wishlist Items" ON wishlist_items FOR ALL TO authenticated USING (true);
CREATE POLICY "Admin All Settings" ON site_settings FOR ALL TO authenticated USING (true);

-- Public Read access for settings
CREATE POLICY "Public Read Settings" ON site_settings FOR SELECT USING (true);

-- Public can insert wishlists (for checkout)
CREATE POLICY "Public Insert Wishlists" ON wishlists FOR INSERT WITH CHECK (true);
CREATE POLICY "Public Insert Wishlist Items" ON wishlist_items FOR INSERT WITH CHECK (true);
