'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import styles from "./page.module.css";
import CardItem from '@/components/CardItem';
import WishlistDrawer from '@/components/WishlistDrawer';
import { useWishlist } from '@/context/WishlistContext';

type StorefrontCard = {
  id: string;
  title: string;
  price: number;
  image_url: string;
  group_name: string;
  inventory_count: number;
  rarity?: string;
};

export default function Home() {
  const [cards, setCards] = useState<StorefrontCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [isWishlistOpen, setIsWishlistOpen] = useState(false);
  const [siteTitle, setSiteTitle] = useState('K-POP CARD');
  const [isExpanded, setIsExpanded] = useState(false);
  const visibleLimit = 10;
  
  const { items } = useWishlist();

  useEffect(() => {
    let isMounted = true;

    const loadAllCards = async () => {
      let allCards: StorefrontCard[] = [];
      let offset = 0;
      const limit = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from('cards')
          .select('*')
          .range(offset, offset + limit - 1)
          .order('created_at', { ascending: false });

        if (error) {
          console.error('Error loading cards:', error.message);
          hasMore = false;
          break;
        }

        if (!data || data.length === 0) {
          hasMore = false;
          break;
        }

        allCards = [...allCards, ...(data as StorefrontCard[])];
        if (data.length < limit) {
          hasMore = false;
        } else {
          offset += limit;
        }
      }

      if (isMounted) {
        setCards(allCards);
        setLoading(false);
      }
    };

    void loadAllCards();

    void supabase
      .from('site_settings')
      .select('value')
      .eq('key', 'site_title')
      .single()
      .then(({ data }) => {
        if (isMounted && data) setSiteTitle(data.value);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const filteredCards = useMemo(() => {
    let result = [...cards];
    
    if (activeCategory !== 'All') {
      result = result.filter(card => card.group_name === activeCategory);
    }
    
    if (search) {
      const s = search.toLowerCase();
      result = result.filter(card => 
        card.title.toLowerCase().includes(s) || 
        card.group_name.toLowerCase().includes(s)
      );
    }
    
    return result;
  }, [activeCategory, cards, search]);

  const categories = useMemo(
    () => ['All', ...Array.from(new Set(cards.map(c => c.group_name))).filter(Boolean)],
    [cards],
  );

  const visibleCategories = useMemo(() => {
    if (isExpanded || categories.length <= visibleLimit) {
      return categories;
    }
    return categories.slice(0, visibleLimit);
  }, [categories, isExpanded]);

  return (
    <main className={styles.main}>
      <WishlistDrawer isOpen={isWishlistOpen} onClose={() => setIsWishlistOpen(false)} />
      
      <header className={styles.header}>
        <div className="glass" style={{ padding: '0.75rem 1.5rem', borderRadius: '100px', display: 'flex', gap: '2rem', alignItems: 'center' }}>
          <h1 className={styles.logo}>
            {siteTitle.split(' ').map((word, i) => (
              <span key={i} style={i === siteTitle.split(' ').length - 1 ? { color: 'var(--primary)' } : {}}>{word} </span>
            ))}
          </h1>
          <nav className={styles.topNav}>
            <button onClick={() => setIsWishlistOpen(true)} className={styles.wishlistTrigger}>
              Wishlist ({items.length})
            </button>
          </nav>
        </div>
      </header>

      <section className={styles.hero}>
        <h2 className="fade-in">Find Your <span style={{ color: 'var(--accent)' }}>Bias</span></h2>
        <div className={styles.searchBar}>
          <input 
            type="text" 
            placeholder="Search for cards, groups or members..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="glass"
          />
        </div>
      </section>

      <div className={styles.filterContainer}>
        {visibleCategories.map(cat => (
          <button 
            key={cat}
            className={`${styles.filterBtn} ${activeCategory === cat ? styles.activeFilter : ''}`}
            onClick={() => setActiveCategory(cat as string)}
          >
            {cat}
          </button>
        ))}
        {categories.length > visibleLimit && (
          <button 
            className={`${styles.filterBtn} ${styles.moreBtn}`}
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? 'Less ↑' : `More (${categories.length - visibleLimit}) ↓`}
          </button>
        )}
      </div>

      <div className={styles.grid}>
        {loading ? (
          <div className={styles.fullWidth}>
            <p className={styles.loadingText}>Fetching collection...</p>
          </div>
        ) : filteredCards.length > 0 ? (
          filteredCards.map(card => (
            <CardItem key={card.id} card={card} />
          ))
        ) : (
          <div className={styles.fullWidth}>
            <p className={styles.noResults}>No cards found matching your criteria.</p>
          </div>
        )}
      </div>
    </main>
  );
}
