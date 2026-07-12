'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import styles from "./page.module.css";
import CardItem from '@/components/CardItem';
import WishlistDrawer from '@/components/WishlistDrawer';
import { useWishlist } from '@/context/WishlistContext';
import {
  createFallbackPurchaseOption,
  normalizePurchaseOption,
  type PurchaseOption,
} from '@/lib/purchaseOptions';
import {
  getStorefrontPageRange,
  hasNextStorefrontPage,
  mergeStorefrontPage,
} from '@/lib/storefrontPagination';

type StorefrontCard = {
  id: string;
  title: string;
  price: number;
  image_url: string;
  group_name: string;
  inventory_count: number;
  rarity?: string;
  pob_name?: string;
  purchase_options: PurchaseOption[];
};

type StorefrontCardRow = Omit<StorefrontCard, 'price' | 'inventory_count' | 'purchase_options'> & {
  price: number | string | null;
  inventory_count: number | string | null;
};

export default function Home() {
  const [cards, setCards] = useState<StorefrontCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [isWishlistOpen, setIsWishlistOpen] = useState(false);
  const [siteTitle, setSiteTitle] = useState('K-POP CARD');
  const [isExpanded, setIsExpanded] = useState(false);
  const visibleLimit = 10;
  const nextOffsetRef = useRef(0);
  const isPageRequestInFlightRef = useRef(false);
  const isMountedRef = useRef(true);
  
  const { items } = useWishlist();

  const safeSiteTitle = typeof siteTitle === 'string' && siteTitle.trim() ? siteTitle : 'K-POP CARD';
  const siteTitleWords = useMemo(() => {
    return safeSiteTitle.split(/\s+/).filter(Boolean);
  }, [safeSiteTitle]);

  const loadCardsPage = useCallback(async (reset = false) => {
    if (isPageRequestInFlightRef.current) return;

    isPageRequestInFlightRef.current = true;
    const offset = reset ? 0 : nextOffsetRef.current;
    const [from, to] = getStorefrontPageRange(offset);

    if (reset) {
      nextOffsetRef.current = 0;
      setLoading(true);
      setHasMore(true);
    } else {
      setLoadingMore(true);
    }
    setLoadError('');

    try {
      const cardsController = new AbortController();
      const cardsTimeout = window.setTimeout(() => cardsController.abort(), 12_000);
      const { data, error } = await supabase
        .from('cards')
        .select('*')
        .order('created_at', { ascending: false })
        .range(from, to)
        .retry(false)
        .abortSignal(cardsController.signal);
      window.clearTimeout(cardsTimeout);

      if (error) throw new Error(error.message || 'Could not load the card collection.');

      const cardsBatch = (data as StorefrontCardRow[] ?? []).map(card => ({
        ...card,
        price: Number.isFinite(Number(card.price)) ? Number(card.price) : 0,
        inventory_count: Number.isFinite(Number(card.inventory_count))
          ? Number(card.inventory_count)
          : 0,
        purchase_options: [],
      }));
      const optionsByCardId = new Map<string, PurchaseOption[]>();

      if (cardsBatch.length > 0) {
        const optionsController = new AbortController();
        const optionsTimeout = window.setTimeout(() => optionsController.abort(), 12_000);
        const { data: optionsData, error: optionsError } = await supabase
          .from('card_purchase_options')
          .select('id, card_id, label, price, min_quantity, max_quantity, is_default, is_active, sort_order')
          .in('card_id', cardsBatch.map(card => card.id))
          .eq('is_active', true)
          .order('sort_order', { ascending: true })
          .retry(false)
          .abortSignal(optionsController.signal);
        window.clearTimeout(optionsTimeout);

        if (optionsError) {
          console.warn('Could not load purchase options; using the card price as a fallback.', optionsError.message);
        } else {
          for (const optionRow of optionsData ?? []) {
            const option = normalizePurchaseOption(optionRow);
            if (!option.card_id) continue;

            const currentOptions = optionsByCardId.get(option.card_id) ?? [];
            currentOptions.push(option);
            optionsByCardId.set(option.card_id, currentOptions);
          }
        }
      }

      const hydratedCards = cardsBatch.map(card => {
        const activeOptions = optionsByCardId.get(card.id) ?? [];
        return {
          ...card,
          purchase_options: activeOptions.length > 0
            ? activeOptions
            : [createFallbackPurchaseOption(card)],
        };
      });

      if (!isMountedRef.current) return;

      nextOffsetRef.current = offset + cardsBatch.length;
      setCards(currentCards => reset ? hydratedCards : mergeStorefrontPage(currentCards, hydratedCards));
      setHasMore(hasNextStorefrontPage(cardsBatch.length));
    } catch (error) {
      console.error('Error loading storefront cards:', error);
      if (isMountedRef.current) {
        setLoadError('Could not load cards. Check your connection and try again.');
      }
    } finally {
      isPageRequestInFlightRef.current = false;
      if (isMountedRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    const initialLoad = window.setTimeout(() => void loadCardsPage(true), 0);

    void supabase
      .from('site_settings')
      .select('value')
      .eq('key', 'site_title')
      .single()
      .then(({ data }) => {
        if (isMountedRef.current && data && typeof data.value === 'string') {
          setSiteTitle(data.value);
        }
      });

    return () => {
      window.clearTimeout(initialLoad);
      isMountedRef.current = false;
    };
  }, [loadCardsPage]);

  const filteredCards = useMemo(() => {
    let result = Array.isArray(cards) ? [...cards] : [];
    
    if (activeCategory !== 'All') {
      result = result.filter(
        card => (card.group_name || '').toLowerCase() === activeCategory.toLowerCase()
      );
    }
    
    if (search) {
      const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
      if (terms.length > 0) {
        result = result.filter(card =>
          terms.every(term =>
            (card.title || '').toLowerCase().includes(term) || 
            (card.group_name || '').toLowerCase().includes(term)
          )
        );
      }
    }
    
    return result;
  }, [activeCategory, cards, search]);

  const categories = useMemo(() => {
    const safeCards = Array.isArray(cards) ? cards : [];
    const seen = new Set<string>();
    const uniqueCategories: string[] = [];
    for (const card of safeCards) {
      if (!card || !card.group_name) continue;
      const lower = card.group_name.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        uniqueCategories.push(card.group_name);
      }
    }
    return ['All', ...uniqueCategories];
  }, [cards]);

  const visibleCategories = useMemo(() => {
    const safeCategories = Array.isArray(categories) ? categories : ['All'];
    if (isExpanded || safeCategories.length <= visibleLimit) {
      return safeCategories;
    }
    return safeCategories.slice(0, visibleLimit);
  }, [categories, isExpanded]);

  return (
    <main className={styles.main}>
      <WishlistDrawer isOpen={isWishlistOpen} onClose={() => setIsWishlistOpen(false)} />
      
      <header className={styles.header}>
        <div className="glass" style={{ padding: '0.75rem 1.5rem', borderRadius: '100px', display: 'flex', gap: '2rem', alignItems: 'center' }}>
          <h1 className={styles.logo}>
            {siteTitleWords.map((word, i) => (
              <span key={i} style={i === siteTitleWords.length - 1 ? { color: 'var(--primary)' } : {}}>{word} </span>
            ))}
          </h1>
          <nav className={styles.topNav}>
            <button onClick={() => setIsWishlistOpen(true)} className={styles.wishlistTrigger}>
              Wishlist ({Array.isArray(items) ? items.length : 0})
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
        {(Array.isArray(visibleCategories) ? visibleCategories : []).map(cat => (
          <button 
            key={cat}
            className={`${styles.filterBtn} ${activeCategory === cat ? styles.activeFilter : ''}`}
            onClick={() => setActiveCategory(cat as string)}
          >
            {cat}
          </button>
        ))}
        {(Array.isArray(categories) ? categories.length : 0) > visibleLimit && (
          <button 
            className={`${styles.filterBtn} ${styles.moreBtn}`}
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? 'Less ↑' : `More (${(Array.isArray(categories) ? categories.length : 0) - visibleLimit}) ↓`}
          </button>
        )}
      </div>

      <div className={styles.grid}>
        {loading && cards.length === 0 ? (
          <div className={styles.fullWidth}>
            <p className={styles.loadingText}>{loadError || 'Fetching collection...'}</p>
            {loadError && (
              <button className={styles.retryBtn} onClick={() => void loadCardsPage(true)}>
                Try again
              </button>
            )}
          </div>
        ) : (Array.isArray(filteredCards) && filteredCards.length > 0) ? (
          (Array.isArray(filteredCards) ? filteredCards : []).map(card => (
            card && <CardItem key={card.id} card={card} />
          ))
        ) : (
          <div className={styles.fullWidth}>
            <p className={styles.noResults}>No cards found matching your criteria.</p>
          </div>
        )}
      </div>
      {!loading && cards.length > 0 && (hasMore || loadError) && (
        <section className={styles.loadMoreSection}>
          {loadError && <p className={styles.loadError}>{loadError}</p>}
          {hasMore && (
            <button
              className={styles.loadMoreBtn}
              onClick={() => void loadCardsPage()}
              disabled={loadingMore}
            >
              {loadingMore ? 'Loading more cards…' : 'Load more cards'}
            </button>
          )}
        </section>
      )}
    </main>
  );
}
