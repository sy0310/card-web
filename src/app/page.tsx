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
  buildStorefrontSearchFilter,
  createStorefrontRequestTracker,
  getStorefrontSearchTerms,
  getStorefrontPageRange,
  hasNextStorefrontPage,
  mergeStorefrontPage,
  normalizeStorefrontSearch,
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

const STOREFRONT_REQUEST_TIMEOUT_MS = 12_000;
const CATEGORY_PAGE_SIZE = 1_000;

export default function Home() {
  const [cards, setCards] = useState<StorefrontCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [categories, setCategories] = useState<string[]>(['All']);
  const [activeCategory, setActiveCategory] = useState('All');
  const [isWishlistOpen, setIsWishlistOpen] = useState(false);
  const [siteTitle, setSiteTitle] = useState('K-POP CARD');
  const [isExpanded, setIsExpanded] = useState(false);
  const visibleLimit = 10;
  const nextOffsetRef = useRef(0);
  const cardsRequestControllerRef = useRef<AbortController | null>(null);
  const categoriesRequestControllerRef = useRef<AbortController | null>(null);
  const isLoadMoreRequestInFlightRef = useRef(false);
  const isMountedRef = useRef(true);
  const [requestTracker] = useState(createStorefrontRequestTracker);
  
  const { items } = useWishlist();

  const safeSiteTitle = typeof siteTitle === 'string' && siteTitle.trim() ? siteTitle : 'K-POP CARD';
  const siteTitleWords = useMemo(() => {
    return safeSiteTitle.split(/\s+/).filter(Boolean);
  }, [safeSiteTitle]);
  const normalizedSearch = useMemo(() => normalizeStorefrontSearch(debouncedSearch), [debouncedSearch]);

  useEffect(() => {
    const debounce = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(debounce);
  }, [search]);

  const loadCardsPage = useCallback(async (reset = false) => {
    if (!reset && isLoadMoreRequestInFlightRef.current) return;

    const requestId = requestTracker.begin();
    if (reset) {
      cardsRequestControllerRef.current?.abort();
    } else {
      isLoadMoreRequestInFlightRef.current = true;
    }

    const controller = new AbortController();
    cardsRequestControllerRef.current = controller;
    const offset = reset ? 0 : nextOffsetRef.current;
    const [from, to] = getStorefrontPageRange(offset);

    if (reset) {
      nextOffsetRef.current = 0;
      setLoading(true);
      setHasMore(true);
      setCards([]);
    } else {
      setLoadingMore(true);
    }
    setLoadError('');

    try {
      let cardsQuery = supabase
        .from('cards')
        .select('*')
        .order('created_at', { ascending: false })
        .range(from, to);
      if (activeCategory !== 'All') cardsQuery = cardsQuery.eq('group_name', activeCategory);
      const searchFilter = buildStorefrontSearchFilter(getStorefrontSearchTerms(normalizedSearch));
      if (searchFilter) {
        cardsQuery = cardsQuery.or(searchFilter);
      }

      const cardsTimeout = window.setTimeout(
        () => controller.abort(),
        STOREFRONT_REQUEST_TIMEOUT_MS,
      );
      let data: StorefrontCardRow[] | null;
      let error: { message?: string } | null;

      try {
        ({ data, error } = await cardsQuery.retry(false).abortSignal(controller.signal));
      } finally {
        window.clearTimeout(cardsTimeout);
      }

      if (!requestTracker.isCurrent(requestId) || !isMountedRef.current) return;

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
        const optionsTimeout = window.setTimeout(
          () => controller.abort(),
          STOREFRONT_REQUEST_TIMEOUT_MS,
        );
        let optionsData: Partial<PurchaseOption>[] | null;
        let optionsError: { message?: string } | null;

        try {
          ({ data: optionsData, error: optionsError } = await supabase
            .from('card_purchase_options')
            .select('id, card_id, label, price, min_quantity, max_quantity, is_default, is_active, sort_order')
            .in('card_id', cardsBatch.map(card => card.id))
            .eq('is_active', true)
            .order('sort_order', { ascending: true })
            .retry(false)
            .abortSignal(controller.signal));
        } finally {
          window.clearTimeout(optionsTimeout);
        }

        if (!requestTracker.isCurrent(requestId) || !isMountedRef.current) return;

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
      if (!requestTracker.isCurrent(requestId) || controller.signal.aborted) return;

      console.error('Error loading storefront cards:', error);
      if (isMountedRef.current) {
        setLoadError('Could not load cards. Check your connection and try again.');
      }
    } finally {
      if (!reset) {
        isLoadMoreRequestInFlightRef.current = false;
      }
      if (cardsRequestControllerRef.current === controller) {
        cardsRequestControllerRef.current = null;
      }
      if (requestTracker.isCurrent(requestId) && isMountedRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [activeCategory, normalizedSearch, requestTracker]);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      cardsRequestControllerRef.current?.abort();
      categoriesRequestControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadCardsPage(true), 0);
    return () => window.clearTimeout(initialLoad);
  }, [loadCardsPage]);

  useEffect(() => {
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
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    categoriesRequestControllerRef.current = controller;
    const timeout = window.setTimeout(
      () => controller.abort(),
      STOREFRONT_REQUEST_TIMEOUT_MS,
    );

    const loadCategories = async () => {
      const namesByLowercase = new Map<string, string>();
      let offset = 0;

      try {
        while (!controller.signal.aborted) {
          const { data, error } = await supabase
            .from('cards')
            .select('group_name')
            .order('group_name', { ascending: true })
            .range(offset, offset + CATEGORY_PAGE_SIZE - 1)
            .retry(false)
            .abortSignal(controller.signal);

          if (error) throw new Error(error.message || 'Could not load storefront categories.');

          const page = data ?? [];
          for (const { group_name } of page) {
            const name = typeof group_name === 'string' ? group_name.trim() : '';
            if (name) namesByLowercase.set(name.toLowerCase(), name);
          }

          if (page.length < CATEGORY_PAGE_SIZE) break;
          offset += page.length;
        }

        if (!controller.signal.aborted && isMountedRef.current) {
          setCategories([
            'All',
            ...[...namesByLowercase.values()].sort((left, right) => left.localeCompare(right)),
          ]);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn('Could not load all storefront categories.', error);
        }
      } finally {
        window.clearTimeout(timeout);
        if (categoriesRequestControllerRef.current === controller) {
          categoriesRequestControllerRef.current = null;
        }
      }
    };

    void loadCategories();

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, []);

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
        ) : (Array.isArray(cards) && cards.length > 0) ? (
          (Array.isArray(cards) ? cards : []).map(card => (
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
