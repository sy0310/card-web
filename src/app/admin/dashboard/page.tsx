'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { toPng } from 'html-to-image';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import BulkUpload from '@/components/admin/BulkUpload';
import WishlistReceipt, {
  type ReceiptLineItem,
  type WishlistReceiptMode,
} from '@/components/WishlistReceipt';
import { waitForImages } from '@/components/checkoutImageUtils';
import { fetchAdminJsonWithRetry, formatAdminFetchError } from '@/lib/client/adminFetch';
import { getWishlistQuantityError, MAX_UNITS_PER_ITEM } from '@/lib/wishlistLimits';
import {
  availabilityStatusOptions,
  type AvailabilityStatus,
} from '@/lib/availability';
import styles from './page.module.css';
import {
  type AdminSettings,
  type CardAvailabilityStatus,
  type CardEditDraft,
  type CardUpdatePayload,
  type PurchaseOptionDraft,
  type PurchaseOptionPayload,
  type WishlistDraftItem,
  applyCardPatch,
  buildCardUpdatePayload,
  buildPurchaseOptionPayloads,
  buildSettingsRows,
  buildWishlistItemInsertRows,
  calculateWishlistTotal,
  createCardDraft,
  createPurchaseOptionDrafts,
  createWishlistItemsDraft,
  defaultAdminSettings,
  formatAdminError,
  getPurchasableAdminPurchaseOptions,
  getAdminPurchaseOptions,
  getCardDraftErrors,
  getDefaultAdminPurchaseOption,
  getPurchaseOptionDraftErrors,
  getSelectedAdminPurchaseOption,
  isMissingColumnError,
  normalizePurchaseOptionDrafts,
  normalizeAdminSettings,
  parseWishlistQuantity,
} from './adminDashboardUtils';

type AdminTab = 'inventory' | 'wishlists' | 'analytics' | 'settings';

function AvailabilityStatusSelect({
  value,
  onChange,
}: {
  value: AvailabilityStatus;
  onChange: (status: AvailabilityStatus) => void;
}) {
  return (
    <select value={value} onChange={event => onChange(event.target.value as AvailabilityStatus)}>
      {availabilityStatusOptions.map(option => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  );
}

type AdminCard = CardUpdatePayload & {
  id: string;
  created_at?: string;
  purchase_options?: PurchaseOptionPayload[];
};

type CardSaveResponse = {
  success?: boolean;
  card?: AdminCard;
  error?: string;
};

type PurchaseOptionsSaveResponse = {
  success?: boolean;
  options?: PurchaseOptionPayload[];
  error?: string;
};

type ImageUploadResponse = {
  success?: boolean;
  publicUrl?: string;
  error?: string;
};

type WishlistItem = {
  id: string;
  card_id: string;
  purchase_option_id?: string | null;
  option_label_snapshot?: string | null;
  unit_price_snapshot?: number | string | null;
  card_title_snapshot?: string | null;
  group_name_snapshot?: string | null;
  album_era_snapshot?: string | null;
  image_url_snapshot?: string | null;
  cards?: AdminCard | null;
};

type Wishlist = {
  id: string;
  created_at: string;
  user_ig_handle: string;
  total_price: number;
  status: string;
  notes?: string | null;
  wishlist_items?: WishlistItem[];
};

type WishlistEditDraft = {
  user_ig_handle: string;
  status: string;
  notes: string;
  items: WishlistDraftItem[];
};

type InstagramSettingsStatusResponse = {
  status?: {
    configured: boolean;
    database_session_configured: boolean;
    database_settings_configured: boolean;
    database_proxy_configured: boolean;
    environment_fallback_configured: boolean;
    updated_at: string | null;
  };
  error?: string;
};

type InstagramSyncLog = {
  id: string;
  status: 'running' | 'success' | 'failed';
  message: string | null;
  posts_found: number | null;
  created_at: string;
  started_at: string;
  finished_at: string | null;
};

type InstagramSyncLogsResponse = {
  logs?: InstagramSyncLog[];
  error?: string;
};

type InstagramConnectionResponse = {
  success?: boolean;
  username?: string | null;
  error?: string;
};

type AnalyticsRank = { label: string; count: number; revenue?: number };

type AnalyticsResponse = {
  days: number;
  overview: {
    request_orders: number;
    requested_items: number;
    request_value: number;
    completed_orders: number;
    completed_value: number;
  };
  searches: { total: number; top_queries: AnalyticsRank[]; zero_result_queries: AnalyticsRank[] };
  requests: { top_groups: AnalyticsRank[]; top_albums: AnalyticsRank[]; top_cards: AnalyticsRank[] };
  completed: { top_groups: AnalyticsRank[] };
  error?: string;
};

function getPersistentPurchaseOptionId(optionId?: string | null) {
  return optionId && !optionId.startsWith('fallback-') ? optionId : null;
}

function hashReceiptSignature(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

function waitForReceiptRender() {
  return new Promise<void>(resolve => {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      resolve();
      return;
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        resolve();
      });
    });
  });
}

export default function AdminDashboard() {
  const [session, setSession] = useState<Session | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [cards, setCards] = useState<AdminCard[]>([]);
  const [wishlists, setWishlists] = useState<Wishlist[]>([]);
  const [loadingCards, setLoadingCards] = useState(true);
  const [activeTab, setActiveTab] = useState<AdminTab>('inventory');
  const [settings, setSettings] = useState<AdminSettings>(defaultAdminSettings);
  const [savingSettings, setSavingSettings] = useState(false);
  const [editingCard, setEditingCard] = useState<AdminCard | null>(null);
  const [cardDraft, setCardDraft] = useState<CardEditDraft | null>(null);
  const [purchaseOptionDrafts, setPurchaseOptionDrafts] = useState<PurchaseOptionDraft[]>([]);
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string>('');
  const [savingCard, setSavingCard] = useState(false);
  const [deletingCardId, setDeletingCardId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkAvailabilityUpdating, setBulkAvailabilityUpdating] = useState(false);
  const [selectedWishlistIds, setSelectedWishlistIds] = useState<string[]>([]);
  const [updatingWishlists, setUpdatingWishlists] = useState(false);
  const [editingWishlist, setEditingWishlist] = useState<Wishlist | null>(null);
  const [wishlistDraft, setWishlistDraft] = useState<WishlistEditDraft | null>(null);
  const [savingWishlist, setSavingWishlist] = useState(false);
  const [generatingWishlistImage, setGeneratingWishlistImage] = useState(false);
  const [wishlistImagePreview, setWishlistImagePreview] = useState<string | null>(null);
  const [wishlistImageSignature, setWishlistImageSignature] = useState('');
  const [wishlistImageMode, setWishlistImageMode] = useState<WishlistReceiptMode>('compact');
  const [wishlistRenderMode, setWishlistRenderMode] = useState<WishlistReceiptMode>('compact');
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [bulkEditDraft, setBulkEditDraft] = useState({
    group_name: '',
    album_era: '',
    price: '',
    inventory_count: '',
    unlimited_inventory: true,
    update_group_name: false,
    update_album_era: false,
    update_price: false,
    update_inventory_count: false,
    update_unlimited_inventory: false,
  });
  const [statusMessage, setStatusMessage] = useState('');
  const [instagramStatus, setInstagramStatus] = useState<InstagramSettingsStatusResponse['status'] | null>(null);
  const [instagramSyncLogs, setInstagramSyncLogs] = useState<InstagramSyncLog[]>([]);
  const [instagramSessionInput, setInstagramSessionInput] = useState('');
  const [instagramSettingsJsonInput, setInstagramSettingsJsonInput] = useState('');
  const [instagramProxyInput, setInstagramProxyInput] = useState('');
  const [instagramSyncUrl, setInstagramSyncUrl] = useState('');
  const [savingInstagramSettings, setSavingInstagramSettings] = useState(false);
  const [testingInstagramConnection, setTestingInstagramConnection] = useState(false);
  const [syncingInstagram, setSyncingInstagram] = useState(false);
  const instagramBusy = savingInstagramSettings || testingInstagramConnection || syncingInstagram;
  const [analyticsDays, setAnalyticsDays] = useState<7 | 30 | 90>(30);
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [wishlistSearchTerm, setWishlistSearchTerm] = useState('');
  const [wishlistCardSearch, setWishlistCardSearch] = useState('');
  const wishlistReceiptRef = useRef<HTMLDivElement>(null);

  const cardsById = useMemo(() => new Map(cards.map(card => [card.id, card])), [cards]);

  const filteredCards = useMemo(() => {
    if (!searchTerm.trim()) return cards;
    const terms = searchTerm.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return cards;
    
    return cards.filter(card =>
      terms.every(term =>
        (card.title || '').toLowerCase().includes(term) ||
        (card.group_name || '').toLowerCase().includes(term) ||
        (card.pob_name || '').toLowerCase().includes(term) ||
        (card.album_era || '').toLowerCase().includes(term) ||
        (card.member_name || '').toLowerCase().includes(term)
      )
    );
  }, [cards, searchTerm]);

  const filteredWishlists = useMemo(() => {
    const term = wishlistSearchTerm.toLowerCase().trim();
    if (!term) return wishlists;
    const terms = term.split(/\s+/).filter(Boolean);
    if (terms.length === 0) return wishlists;

    return wishlists.filter(wishlist => {
      const handle = String(wishlist.user_ig_handle || '').toLowerCase();
      const handleWithoutAt = handle.replace(/^@/, '');
      const notes = String(wishlist.notes || '').toLowerCase();
      const status = String(wishlist.status || '').toLowerCase();
      const itemText = (wishlist.wishlist_items ?? [])
        .map(item => item.card_title_snapshot || item.cards?.title || '')
        .join(' ')
        .toLowerCase();

      return terms.every(t => {
        const tWithoutAt = t.replace(/^@/, '');
        return (
          handle.includes(t) ||
          handleWithoutAt.includes(tWithoutAt) ||
          notes.includes(t) ||
          status.includes(t) ||
          itemText.includes(t)
        );
      });
    });
  }, [wishlistSearchTerm, wishlists]);

  const wishlistCardSearchTerm = wishlistCardSearch.trim().toLowerCase();
  const wishlistCardSearchResults = useMemo(() => {
    const terms = wishlistCardSearchTerm.split(/\s+/).filter(Boolean);

    const matchesSearch = (card: AdminCard) => {
      if (terms.length === 0) return true;

      const fields = [
        card.title,
        card.group_name,
        card.member_name,
        card.album_era,
        card.pob_name,
        card.rarity,
      ].map(value => String(value ?? '').toLowerCase());

      return terms.every(term => 
        fields.some(field => field.includes(term))
      );
    };

    return cards
      .filter(matchesSearch)
      .slice(0, wishlistCardSearchTerm ? 12 : 8);
  }, [cards, wishlistCardSearchTerm]);

  const wishlistDraftTotal = useMemo(() => {
    if (!wishlistDraft) return 0;
    return calculateWishlistTotal(wishlistDraft.items, cardsById);
  }, [cardsById, wishlistDraft]);

  const wishlistReceiptItems = useMemo<ReceiptLineItem[]>(() => {
    if (!wishlistDraft) return [];

    const lineItems: ReceiptLineItem[] = [];
    for (const item of wishlistDraft.items) {
      const card = cardsById.get(item.card_id);
      if (!card && !item.card_title_snapshot) continue;

      lineItems.push({
        id: item.key,
        card_id: item.card_id,
        purchase_option_id: item.purchase_option_id,
        title: item.card_title_snapshot || card?.title || 'Untitled card',
        price: Number(item.unit_price_snapshot ?? card?.price) || 0,
        unit_price: Number(item.unit_price_snapshot ?? card?.price) || 0,
        option_label: item.option_label_snapshot || 'Single',
        image_url: item.image_url_snapshot || card?.image_url || '',
        group_name: item.group_name_snapshot || card?.group_name || card?.member_name || '',
        album_era: item.album_era_snapshot || card?.album_era || '',
        quantity: parseWishlistQuantity(item.quantity),
      });
    }

    return lineItems;
  }, [cardsById, wishlistDraft]);

  const wishlistReceiptSignature = useMemo(() => {
    if (!wishlistDraft) return '';

    const itemSignature = wishlistReceiptItems
      .map(item => [
        item.id,
        item.card_id,
        item.purchase_option_id,
        item.title,
        item.quantity,
        Number(item.price).toFixed(2),
        item.image_url,
        item.group_name,
        item.album_era,
        item.option_label,
      ].join(':'))
      .join('|');

    return [
      wishlistDraft.user_ig_handle.trim(),
      wishlistDraftTotal.toFixed(2),
      settings.site_title,
      settings.official_ig_handle,
      settings.wishlist_footer_note,
      itemSignature,
    ].join('::');
  }, [
    settings.official_ig_handle,
    settings.site_title,
    settings.wishlist_footer_note,
    wishlistDraft,
    wishlistDraftTotal,
    wishlistReceiptItems,
  ]);
  const wishlistReceiptCacheKey = useMemo(
    () => hashReceiptSignature(wishlistReceiptSignature),
    [wishlistReceiptSignature],
  );
  const wishlistImageIsStale = Boolean(
    wishlistImagePreview && wishlistImageSignature !== wishlistReceiptSignature,
  );

  const fetchCards = useCallback(async () => {
    setLoadingCards(true);
    setSelectedIds([]);
    let allCards: AdminCard[] = [];
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
        setStatusMessage(`Could not load cards: ${error.message}`);
        hasMore = false;
        break;
      }

      if (!data || data.length === 0) {
        hasMore = false;
        break;
      }

      allCards = [...allCards, ...(data as AdminCard[])];
      if (data.length < limit) {
        hasMore = false;
      } else {
        offset += limit;
      }
    }

    if (allCards.length === 0) {
      setCards([]);
      setLoadingCards(false);
      return;
    }

    const optionsByCardId = new Map<string, PurchaseOptionPayload[]>();
    const cardIds = allCards.map(card => card.id);
    const optionIdBatchSize = 500;
    let optionsErrorMessage = '';

    for (let index = 0; index < cardIds.length; index += optionIdBatchSize) {
      const cardIdBatch = cardIds.slice(index, index + optionIdBatchSize);
      const { data: optionsData, error: optionsError } = await supabase
        .from('card_purchase_options')
        .select('*')
        .in('card_id', cardIdBatch)
        .order('sort_order', { ascending: true });

      if (optionsError) {
        optionsErrorMessage = optionsError.message;
        break;
      }

      for (const option of (optionsData ?? []) as PurchaseOptionPayload[]) {
        if (!option.card_id) continue;
        const currentOptions = optionsByCardId.get(option.card_id) ?? [];
        currentOptions.push(option);
        optionsByCardId.set(option.card_id, currentOptions);
      }
    }

    if (optionsErrorMessage) {
      setStatusMessage(`Cards loaded, but purchase options could not be loaded: ${optionsErrorMessage}`);
    }

    setCards(allCards.map(card => ({
      ...card,
      purchase_options: optionsByCardId.get(card.id) ?? [],
    })));
    setLoadingCards(false);
  }, []);

  const fetchWishlists = useCallback(async () => {
    setSelectedWishlistIds([]);
    const { data, error } = await supabase
      .from('wishlists')
      .select('*, wishlist_items(*, cards(*))')
      .order('created_at', { ascending: false });

    if (error) {
      setStatusMessage(`Could not load wishlists: ${error.message}`);
    } else {
      setWishlists((data ?? []) as Wishlist[]);
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    const { data, error } = await supabase
      .from('site_settings')
      .select('*');

    if (error) {
      setStatusMessage(`Could not load settings: ${error.message}`);
      return;
    }

    if (data) {
      const storedSettings = data.reduce(
        (acc, curr) => ({ ...acc, [curr.key]: curr.value }),
        {} as Partial<AdminSettings>,
      );
      setSettings(normalizeAdminSettings({ ...defaultAdminSettings, ...storedSettings }));
    }
  }, []);

  const fetchInstagramData = useCallback(async () => {
    try {
      const [settingsResult, logsResult] = await Promise.all([
        fetchAdminJsonWithRetry<InstagramSettingsStatusResponse>('/api/admin/instagram-settings'),
        fetchAdminJsonWithRetry<InstagramSyncLogsResponse>('/api/admin/instagram-sync-logs'),
      ]);

      if (!settingsResult.response.ok || settingsResult.data.error || !settingsResult.data.status) {
        throw new Error(settingsResult.data.error || 'Could not load Instagram settings.');
      }
      if (!logsResult.response.ok || logsResult.data.error) {
        throw new Error(logsResult.data.error || 'Could not load Instagram sync history.');
      }

      setInstagramStatus(settingsResult.data.status);
      setInstagramSyncLogs(logsResult.data.logs ?? []);
    } catch (error: unknown) {
      setStatusMessage(`Instagram settings unavailable: ${formatAdminFetchError(error, 'Loading Instagram settings')}`);
    }
  }, []);

  const fetchAnalytics = useCallback(async (days = analyticsDays) => {
    setLoadingAnalytics(true);
    try {
      const { response, data } = await fetchAdminJsonWithRetry<AnalyticsResponse>(
        `/api/admin/analytics?days=${days}`,
      );
      if (!response.ok || data.error) throw new Error(data.error || 'Could not load analytics.');
      setAnalytics(data);
    } catch (error: unknown) {
      setStatusMessage(`Analytics unavailable: ${formatAdminFetchError(error, 'Loading analytics')}`);
    } finally {
      setLoadingAnalytics(false);
    }
  }, [analyticsDays]);

  const fetchData = useCallback(async () => {
    await Promise.all([fetchCards(), fetchWishlists(), fetchSettings(), fetchInstagramData()]);
  }, [fetchCards, fetchInstagramData, fetchSettings, fetchWishlists]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      if (!currentSession) {
        router.push('/admin/login');
      } else {
        setSession(currentSession);
        void fetchData();
      }
    });
  }, [fetchData, router]);

  const inventoryStats = useMemo(() => {
    const lowStockThreshold = Number(normalizeAdminSettings(settings).low_stock_threshold);
    const totalValue = cards.reduce((sum, card) => {
      if (card.unlimited_inventory !== false) return sum;
      const price = Number(card.price) || 0;
      const stock = Number(card.inventory_count) || 0;
      return sum + price * stock;
    }, 0);

    return {
      total: cards.length,
      inStock: cards.filter(card => card.unlimited_inventory !== false || Number(card.inventory_count) > 0).length,
      soldOut: cards.filter(card => card.unlimited_inventory === false && Number(card.inventory_count) <= 0).length,
      lowStock: cards.filter(card => {
        if (card.unlimited_inventory !== false) return false;
        const stock = Number(card.inventory_count) || 0;
        return stock > 0 && stock <= lowStockThreshold;
      }).length,
      totalValue,
    };
  }, [cards, settings]);

  const handleSaveSettings = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const normalizedSettings = normalizeAdminSettings(settings);
    setSavingSettings(true);
    setStatusMessage('');

    const { error } = await supabase
      .from('site_settings')
      .upsert(buildSettingsRows(normalizedSettings));

    if (error) {
      setStatusMessage(`Error saving settings: ${error.message}`);
    } else {
      setSettings(normalizedSettings);
      setStatusMessage('Settings saved.');
    }
    setSavingSettings(false);
  };

  const handleSaveInstagramSettings = async () => {
    const payload: Record<string, unknown> = {};
    if (instagramSessionInput.trim()) payload.session_id = instagramSessionInput.trim();
    if (instagramSettingsJsonInput.trim()) payload.settings_json = instagramSettingsJsonInput.trim();
    if (instagramProxyInput.trim()) payload.proxy = instagramProxyInput.trim();

    if (Object.keys(payload).length === 0) {
      setStatusMessage('Enter a new Instagram session, saved settings JSON, or proxy before saving.');
      return;
    }

    setSavingInstagramSettings(true);
    setStatusMessage('');
    try {
      const { response, data } = await fetchAdminJsonWithRetry<InstagramSettingsStatusResponse>(
        '/api/admin/instagram-settings',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok || data.error || !data.status) {
        throw new Error(data.error || 'Instagram settings could not be saved.');
      }

      setInstagramStatus(data.status);
      setInstagramSessionInput('');
      setInstagramSettingsJsonInput('');
      setInstagramProxyInput('');
      setStatusMessage('Instagram settings saved. The next sync will use the database configuration.');
    } catch (error: unknown) {
      setStatusMessage(`Error saving Instagram settings: ${formatAdminFetchError(error, 'Saving Instagram settings')}`);
    } finally {
      setSavingInstagramSettings(false);
    }
  };

  const handleTestInstagramConnection = async () => {
    setTestingInstagramConnection(true);
    setStatusMessage('');
    try {
      const { response, data } = await fetchAdminJsonWithRetry<InstagramConnectionResponse>(
        '/api/admin/instagram-settings/test',
        { method: 'POST' },
      );
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Instagram connection failed.');
      }
      setStatusMessage(data.username ? `Instagram connected as @${data.username.replace(/^@/, '')}.` : 'Instagram connection succeeded.');
      await fetchInstagramData();
    } catch (error: unknown) {
      setStatusMessage(`Instagram connection failed: ${formatAdminFetchError(error, 'Testing Instagram connection')}`);
    } finally {
      setTestingInstagramConnection(false);
    }
  };

  const handleSyncInstagram = async () => {
    const url = instagramSyncUrl.trim();
    if (!url) {
      setStatusMessage('Paste an Instagram post or reel URL before syncing.');
      return;
    }

    setSyncingInstagram(true);
    setStatusMessage('Syncing Instagram post...');
    try {
      const { response, data } = await fetchAdminJsonWithRetry<{ success?: boolean; error?: string }>(
        '/api/admin/cards/sync-instagram',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        },
      );
      if (!response.ok || data.error || !data.success) {
        throw new Error(data.error || 'Instagram sync failed.');
      }
      setInstagramSyncUrl('');
      setStatusMessage('Instagram post synced successfully.');
      await Promise.all([fetchCards(), fetchInstagramData()]);
    } catch (error: unknown) {
      setStatusMessage(`Instagram sync failed: ${formatAdminFetchError(error, 'Syncing Instagram')}`);
      await fetchInstagramData();
    } finally {
      setSyncingInstagram(false);
    }
  };



  const handleEditCard = (card: AdminCard) => {
    setEditingCard(card);
    setCardDraft(createCardDraft(card));
    setPurchaseOptionDrafts(createPurchaseOptionDrafts(card.purchase_options ?? [], card.price));
    setSelectedImageFile(null);
    setImagePreviewUrl('');
    setStatusMessage('');
  };

  const handleCardDraftChange = (field: keyof CardEditDraft, value: string) => {
    setCardDraft(current => current ? { ...current, [field]: value } : current);
  };

  const updatePurchaseOptionDraft = (
    key: string,
    patch: Partial<Omit<PurchaseOptionDraft, 'key'>>,
  ) => {
    setPurchaseOptionDrafts(current =>
      current.map(option => {
        if (option.key !== key) return option;
        const next = { ...option, ...patch };
        return next.status === 'available' ? next : { ...next, is_default: false };
      }),
    );
  };

  const setDefaultPurchaseOption = (key: string, isDefault: boolean) => {
    setPurchaseOptionDrafts(current =>
      current.map(option => ({
        ...option,
        is_default: isDefault && option.key === key && option.status === 'available',
      })),
    );
  };

  const addPurchaseOptionDraft = () => {
    const fallbackPrice = cardDraft?.price ?? editingCard?.price ?? 0;
    const numericFallbackPrice = Number(fallbackPrice);
    setPurchaseOptionDrafts(current => [
      ...current,
      ...createPurchaseOptionDrafts([
        {
          label: `Option ${current.length + 1}`,
          price: Number.isFinite(numericFallbackPrice) ? numericFallbackPrice : 0,
          min_quantity: 1,
          max_quantity: null,
          is_default: false,
          sort_order: current.length,
          status: 'available',
        },
      ], fallbackPrice).map(option => ({
        ...option,
        is_default: false,
        sort_order: String(current.length),
      })),
    ]);
  };

  const removePurchaseOptionDraft = (key: string) => {
    const fallbackPrice = cardDraft?.price ?? editingCard?.price ?? 0;
    setPurchaseOptionDrafts(current => {
      const nextDrafts = current.filter(option => option.key !== key);
      return normalizePurchaseOptionDrafts(
        nextDrafts.length > 0 ? nextDrafts : createPurchaseOptionDrafts([], fallbackPrice),
        fallbackPrice,
      );
    });
  };

  const closeCardEditor = () => {
    setEditingCard(null);
    setCardDraft(null);
    setPurchaseOptionDrafts([]);
    setSelectedImageFile(null);
    setImagePreviewUrl('');
    setSavingCard(false);
  };

  const handleSaveCard = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingCard || !cardDraft) return;

    const normalizedPurchaseOptions = normalizePurchaseOptionDrafts(
      purchaseOptionDrafts,
      cardDraft.price,
    );
    const errors = getCardDraftErrors(cardDraft);
    const purchaseOptionErrors = getPurchaseOptionDraftErrors(normalizedPurchaseOptions);
    if (errors.length > 0) {
      setStatusMessage(errors.join(' '));
      return;
    }
    if (purchaseOptionErrors.length > 0) {
      setPurchaseOptionDrafts(normalizedPurchaseOptions);
      setStatusMessage(purchaseOptionErrors.join(' '));
      return;
    }

    setSavingCard(true);
    setStatusMessage('');

    try {
      if (!session) {
        throw new Error('Please sign in again before saving.');
      }

      let finalImageUrl = cardDraft.image_url;
      if (selectedImageFile) {
        const formData = new FormData();
        formData.append('file', selectedImageFile);

        const { response: uploadRes, data: uploadResult } = await fetchAdminJsonWithRetry<ImageUploadResponse>('/api/admin/cards/upload-image', {
          method: 'POST',
          body: formData,
        });

        if (!uploadRes.ok || uploadResult.error) {
          throw new Error(uploadResult.error || 'Failed to upload image to server.');
        }
        if (!uploadResult.publicUrl) {
          throw new Error('Image upload did not return a public URL.');
        }

        finalImageUrl = uploadResult.publicUrl;
      }

      const payload = {
        ...buildCardUpdatePayload(cardDraft),
        image_url: finalImageUrl,
      };

      const { response: saveRes, data: saveResult } = await fetchAdminJsonWithRetry<CardSaveResponse>(`/api/admin/cards/${encodeURIComponent(editingCard.id)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!saveRes.ok || saveResult.error) {
        setStatusMessage(`Error saving card: ${saveResult.error || `Request failed with status ${saveRes.status}`}`);
      } else {
        const savedCard = saveResult.card ?? { ...editingCard, ...payload };
        const optionPayloads = buildPurchaseOptionPayloads(
          editingCard.id,
          normalizedPurchaseOptions,
          payload.price,
        );

        try {
          const { response: optionsResponse, data: optionsResult } = await fetchAdminJsonWithRetry<PurchaseOptionsSaveResponse>(
            `/api/admin/cards/${encodeURIComponent(editingCard.id)}/purchase-options`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ options: optionPayloads }),
            },
          );
          if (!optionsResponse.ok || !optionsResult.success) {
            throw new Error(optionsResult.error || 'Could not save purchase options.');
          }
          const savedPurchaseOptions = (optionsResult.options ?? [])
            .sort((a, b) => a.sort_order - b.sort_order);

          const savedCardWithOptions = {
            ...savedCard,
            purchase_options: savedPurchaseOptions,
          };
          setCards(current => applyCardPatch(current, editingCard.id, savedCardWithOptions));
          setStatusMessage('Card updated.');
          closeCardEditor();
        } catch (optionError: unknown) {
          const savedCardWithExistingOptions = {
            ...savedCard,
            purchase_options: editingCard.purchase_options ?? [],
          };
          setCards(current => applyCardPatch(current, editingCard.id, savedCardWithExistingOptions));
          setEditingCard(savedCardWithExistingOptions);
          setCardDraft(createCardDraft(savedCardWithExistingOptions));
          setPurchaseOptionDrafts(normalizedPurchaseOptions);
          setStatusMessage(`Card saved, but purchase options failed: ${formatAdminError(optionError)}`);
        }
      }
    } catch (err: unknown) {
      const errMsg = formatAdminFetchError(err, 'Saving card');
      setStatusMessage(`Error saving card: ${errMsg}`);
    } finally {
      setSavingCard(false);
    }
  };

  const handleUpdateAvailability = async (
    cardIds: string[],
    availabilityStatus: CardAvailabilityStatus,
  ) => {
    if (cardIds.length === 0) return;
    setBulkAvailabilityUpdating(true);
    setStatusMessage('');
    try {
      const { response, data } = await fetchAdminJsonWithRetry<{
        success?: boolean;
        cards?: Array<{ id: string; availability_status: CardAvailabilityStatus }>;
        error?: string;
      }>('/api/admin/cards/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_ids: cardIds, availability_status: availabilityStatus }),
      });
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not update card availability.');
      const statusById = new Map((data.cards ?? []).map(card => [card.id, card.availability_status]));
      setCards(current => current.map(card => statusById.has(card.id)
        ? { ...card, availability_status: statusById.get(card.id)! }
        : card));
      setStatusMessage(`${cardIds.length} card${cardIds.length === 1 ? '' : 's'} set to ${availabilityStatus}.`);
      setSelectedIds([]);
      if (editingCard && cardIds.includes(editingCard.id)) {
        setEditingCard(current => current ? { ...current, availability_status: availabilityStatus } : current);
        setCardDraft(current => current ? { ...current, availability_status: availabilityStatus } : current);
      }
    } catch (error: unknown) {
      setStatusMessage(`Could not update availability: ${formatAdminFetchError(error, 'Updating availability')}`);
    } finally {
      setBulkAvailabilityUpdating(false);
    }
  };

  const handleDeleteCard = async (card: AdminCard) => {
    const confirmed = window.confirm(`Archive "${card.title}"? It will be hidden from customers but preserved for order history.`);
    if (!confirmed) return;
    setDeletingCardId(card.id);
    await handleUpdateAvailability([card.id], 'archived');
    setDeletingCardId(null);
    if (editingCard?.id === card.id) closeCardEditor();
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.length === 0) return;
    const confirmed = window.confirm(`Archive the selected ${selectedIds.length} cards? They will be hidden from customers and retained for order history.`);
    if (!confirmed) return;
    await handleUpdateAvailability(selectedIds, 'archived');
  };

  const handleBulkDeleteWishlists = async () => {
    if (selectedWishlistIds.length === 0) return;
    const confirmed = window.confirm(`确定要删除选中的 ${selectedWishlistIds.length} 个清单吗？此操作无法撤销。`);
    if (!confirmed) return;

    setUpdatingWishlists(true);
    setStatusMessage('');

    try {
      const { error } = await supabase
        .from('wishlists')
        .delete()
        .in('id', selectedWishlistIds);

      if (error) {
        setStatusMessage(`批量删除清单失败: ${error.message}`);
      } else {
        setWishlists(current => current.filter(w => !selectedWishlistIds.includes(w.id)));
        setStatusMessage(`成功删除选中的 ${selectedWishlistIds.length} 个清单。`);
        setSelectedWishlistIds([]);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setStatusMessage(`批量删除清单发生错误: ${errMsg}`);
    } finally {
      setUpdatingWishlists(false);
    }
  };

  const handleBulkUpdateWishlistStatus = async (newStatus: string) => {
    if (selectedWishlistIds.length === 0) return;
    setUpdatingWishlists(true);
    setStatusMessage('');

    try {
      const { error } = await supabase
        .from('wishlists')
        .update({ status: newStatus })
        .in('id', selectedWishlistIds);

      if (error) {
        setStatusMessage(`批量修改清单状态失败: ${error.message}`);
      } else {
        setWishlists(current =>
          current.map(w => selectedWishlistIds.includes(w.id) ? { ...w, status: newStatus } : w)
        );
        setStatusMessage(`成功更新选中清单的状态为 ${newStatus}。`);
        setSelectedWishlistIds([]);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setStatusMessage(`批量更新状态发生错误: ${errMsg}`);
    } finally {
      setUpdatingWishlists(false);
    }
  };

  const createWishlistDraftKey = () => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random()}`;
  };

  const handleEditWishlist = (wishlist: Wishlist) => {
    setEditingWishlist(wishlist);
    setWishlistDraft({
      user_ig_handle: wishlist.user_ig_handle || '',
      status: wishlist.status || 'pending',
      notes: wishlist.notes || '',
      items: createWishlistItemsDraft(wishlist.wishlist_items ?? []),
    });
    setWishlistImagePreview(null);
    setWishlistImageSignature('');
    setWishlistImageMode('compact');
    setWishlistRenderMode('compact');
    setWishlistCardSearch('');
    setStatusMessage('');
  };

  const closeWishlistEditor = () => {
    setEditingWishlist(null);
    setWishlistDraft(null);
    setSavingWishlist(false);
    setGeneratingWishlistImage(false);
    setWishlistImagePreview(null);
    setWishlistImageSignature('');
    setWishlistImageMode('compact');
    setWishlistRenderMode('compact');
    setWishlistCardSearch('');
  };

  const updateWishlistDraftItem = (
    key: string,
    patch: Partial<Pick<
      WishlistDraftItem,
      'card_id' | 'purchase_option_id' | 'option_label_snapshot' | 'unit_price_snapshot'
      | 'card_title_snapshot' | 'group_name_snapshot' | 'album_era_snapshot' | 'image_url_snapshot' | 'quantity'
    >>,
  ) => {
    setWishlistDraft(current => current ? {
      ...current,
      items: current.items.map(item => item.key === key ? { ...item, ...patch } : item),
    } : current);
  };

  const addWishlistDraftItem = (cardId?: string) => {
    const targetCardId = cardId || wishlistCardSearchResults[0]?.id || cards[0]?.id || '';
    if (!targetCardId) {
      setStatusMessage('No cards are available to add.');
      return;
    }

    const selectedCard = cardsById.get(targetCardId);
    const defaultOption = selectedCard ? getDefaultAdminPurchaseOption(selectedCard) : undefined;
    const purchaseOptionId = getPersistentPurchaseOptionId(defaultOption?.id);
    const optionLabel = defaultOption?.label || 'Single';
    const unitPrice = Number(defaultOption?.price ?? selectedCard?.price ?? 0) || 0;

    setWishlistDraft(current => current ? {
      ...current,
      items: current.items.some(item => (
        item.card_id === targetCardId && item.purchase_option_id === purchaseOptionId
      ))
        ? current.items.map(item => item.card_id === targetCardId && item.purchase_option_id === purchaseOptionId
          ? { ...item, quantity: String(parseWishlistQuantity(item.quantity) + 1) }
          : item)
        : [
            ...current.items,
            {
              key: `${targetCardId}:${purchaseOptionId || 'single'}:${createWishlistDraftKey()}`,
              card_id: targetCardId,
              purchase_option_id: purchaseOptionId,
              option_label_snapshot: optionLabel,
              unit_price_snapshot: unitPrice,
              card_title_snapshot: selectedCard?.title || '',
              group_name_snapshot: selectedCard?.group_name || '',
              album_era_snapshot: selectedCard?.album_era || '',
              image_url_snapshot: selectedCard?.image_url || '',
              quantity: '1',
            },
          ],
    } : current);
  };

  const removeWishlistDraftItem = (key: string) => {
    setWishlistDraft(current => current ? {
      ...current,
      items: current.items.filter(item => item.key !== key),
    } : current);
  };

  const saveWishlistDraft = async () => {
    if (!editingWishlist || !wishlistDraft) return false;

    const userHandle = wishlistDraft.user_ig_handle.trim();
    const validItems = wishlistDraft.items.filter(item => item.card_id && cardsById.has(item.card_id));
    if (!userHandle) {
      setStatusMessage('Instagram handle is required.');
      return false;
    }
    if (validItems.length === 0) {
      setStatusMessage('Order needs at least one card.');
      return false;
    }

    const quantityError = getWishlistQuantityError(
      validItems.map(item => ({ quantity: Number(item.quantity) }))
    );
    if (quantityError) {
      setStatusMessage(quantityError);
      return false;
    }

    setSavingWishlist(true);
    setStatusMessage('');

    try {
      const totalPrice = calculateWishlistTotal(validItems, cardsById);
      const wishlistUpdate = {
        user_ig_handle: userHandle,
        status: wishlistDraft.status,
        notes: wishlistDraft.notes.trim(),
        total_price: totalPrice,
      };
      let notesColumnUnavailable = false;
      let { error: wishlistError } = await supabase
        .from('wishlists')
        .update(wishlistUpdate)
        .eq('id', editingWishlist.id);

      if (wishlistError && isMissingColumnError(wishlistError, 'notes')) {
        notesColumnUnavailable = true;
        const wishlistUpdateWithoutNotes = {
          user_ig_handle: wishlistUpdate.user_ig_handle,
          status: wishlistUpdate.status,
          total_price: wishlistUpdate.total_price,
        };
        const retry = await supabase
          .from('wishlists')
          .update(wishlistUpdateWithoutNotes)
          .eq('id', editingWishlist.id);

        wishlistError = retry.error;
      }

      if (wishlistError) throw wishlistError;

      const { error: deleteItemsError } = await supabase
        .from('wishlist_items')
        .delete()
        .eq('wishlist_id', editingWishlist.id);

      if (deleteItemsError) throw deleteItemsError;

      const itemRows = buildWishlistItemInsertRows(editingWishlist.id, validItems, cardsById);
      if (itemRows.length > 0) {
        const { error: insertItemsError } = await supabase
          .from('wishlist_items')
          .insert(itemRows);

        if (insertItemsError) throw insertItemsError;
      }

      setWishlistDraft(current => current ? { ...current, user_ig_handle: userHandle, items: validItems } : current);
      setEditingWishlist(current => current ? {
        ...current,
        user_ig_handle: userHandle,
        status: wishlistDraft.status,
        notes: wishlistDraft.notes.trim(),
        total_price: totalPrice,
      } : current);
      setStatusMessage(
        notesColumnUnavailable
          ? 'Order updated. Notes were not saved because the database is missing the notes column.'
          : 'Order updated.',
      );
      await fetchWishlists();
      return true;
    } catch (err: unknown) {
      const errMsg = formatAdminError(err);
      setStatusMessage(`Error saving order: ${errMsg}`);
      return false;
    } finally {
      setSavingWishlist(false);
    }
  };

  const handleSaveWishlist = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await saveWishlistDraft();
  };

  const generateWishlistImage = async ({
    download = false,
    mode = 'compact',
  }: { download?: boolean; mode?: WishlistReceiptMode } = {}) => {
    if (!wishlistDraft || !editingWishlist) return false;

    const userHandle = wishlistDraft.user_ig_handle.trim();
    if (!userHandle) {
      setStatusMessage('Instagram handle is required before generating an image.');
      return false;
    }
    if (wishlistReceiptItems.length === 0) {
      setStatusMessage('Order needs at least one valid card before generating an image.');
      return false;
    }

    const quantityError = getWishlistQuantityError(
      wishlistDraft.items.map(item => ({ quantity: Number(item.quantity) }))
    );
    if (quantityError) {
      setStatusMessage(`Cannot generate receipt: ${quantityError}`);
      return false;
    }

    setGeneratingWishlistImage(true);
    setStatusMessage('');

    try {
      setWishlistRenderMode(mode);
      await waitForReceiptRender();

      const receiptElement = wishlistReceiptRef.current;
      if (!receiptElement) {
        throw new Error('Receipt renderer is unavailable.');
      }

      const imageReport = await waitForImages(receiptElement);
      if (imageReport.failed > 0) {
        console.warn('Some admin receipt images failed to load before export:', imageReport);
      }

      const dataUrl = await toPng(receiptElement, {
        cacheBust: true,
        includeQueryParams: true,
        quality: 1,
      });

      setWishlistImagePreview(dataUrl);
      setWishlistImageSignature(wishlistReceiptSignature);
      setWishlistImageMode(mode);

      if (download) {
        const safeWishlistId = editingWishlist.id.replace(/[^a-z0-9_-]+/gi, '') || 'order';
        const link = document.createElement('a');
        link.download = mode === 'packing'
          ? `wishlist-${safeWishlistId}-packing-list.png`
          : `wishlist-${safeWishlistId}-receipt.png`;
        link.href = dataUrl;
        link.click();
      }

      const imageName = mode === 'packing' ? 'packing list' : 'customer receipt';
      setStatusMessage(download
        ? `${imageName[0].toUpperCase()}${imageName.slice(1)} downloaded.`
        : `${imageName[0].toUpperCase()}${imageName.slice(1)} preview generated.`);
      return true;
    } catch (err: unknown) {
      const errMsg = formatAdminError(err);
      setStatusMessage(`Error generating order image: ${errMsg}`);
      return false;
    } finally {
      setGeneratingWishlistImage(false);
      setWishlistRenderMode('compact');
    }
  };

  const handleSaveWishlistAndGenerate = async (mode: WishlistReceiptMode) => {
    const saved = await saveWishlistDraft();
    if (saved) {
      await generateWishlistImage({ download: true, mode });
    }
  };

  const handleBulkUpdate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (selectedIds.length === 0) return;

    const updatePayload: Partial<Pick<
      CardUpdatePayload,
      'group_name' | 'album_era' | 'price' | 'inventory_count' | 'unlimited_inventory'
    >> = {};
    if (bulkEditDraft.update_group_name) updatePayload.group_name = bulkEditDraft.group_name.trim();
    if (bulkEditDraft.update_album_era) updatePayload.album_era = bulkEditDraft.album_era.trim();
    if (bulkEditDraft.update_price) {
      const parsedPrice = parseFloat(bulkEditDraft.price);
      updatePayload.price = isNaN(parsedPrice) ? 0 : parsedPrice;
    }
    if (bulkEditDraft.update_inventory_count) {
      const parsedCount = parseInt(bulkEditDraft.inventory_count, 10);
      updatePayload.inventory_count = isNaN(parsedCount) ? 0 : parsedCount;
    }
    if (bulkEditDraft.update_unlimited_inventory) {
      updatePayload.unlimited_inventory = bulkEditDraft.unlimited_inventory;
    }

    if (Object.keys(updatePayload).length === 0) {
      setStatusMessage('Please select at least one field to update.');
      return;
    }

    setBulkUpdating(true);
    setStatusMessage('');

    try {
      const { error } = await supabase
        .from('cards')
        .update(updatePayload)
        .in('id', selectedIds);

      if (error) {
        setStatusMessage(`Bulk update failed: ${error.message}`);
      } else {
        setStatusMessage(`Successfully updated ${selectedIds.length} cards.`);
        await fetchCards();
        setShowBulkEdit(false);
        setBulkEditDraft({
          group_name: '',
          album_era: '',
          price: '',
          inventory_count: '',
          unlimited_inventory: true,
          update_group_name: false,
          update_album_era: false,
          update_price: false,
          update_inventory_count: false,
          update_unlimited_inventory: false,
        });
        setSelectedIds([]);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setStatusMessage(`Bulk update error: ${errMsg}`);
    } finally {
      setBulkUpdating(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/admin/login');
  };

  const handleTabChange = (tab: AdminTab) => {
    setActiveTab(tab);
    setSelectedIds([]);
    setSelectedWishlistIds([]);
    closeWishlistEditor();
    if (tab === 'analytics') void fetchAnalytics();
  };

  if (!session) return <div className={styles.loading}>Checking session...</div>;

  return (
    <div className={styles.dashboard}>
      {showBulkEdit && (
        <div className={styles.modalOverlay} onClick={() => setShowBulkEdit(false)}>
          <form className={styles.editorPanel} onSubmit={handleBulkUpdate} onClick={event => event.stopPropagation()} style={{ maxWidth: '600px' }}>
            <div className={styles.editorHeader}>
              <div>
                <p className={styles.eyebrow}>Batch Actions</p>
                <h2>Bulk Edit {selectedIds.length} Selected Cards</h2>
              </div>
              <button type="button" className={styles.closeBtn} onClick={() => setShowBulkEdit(false)}>
                Close
              </button>
            </div>

            <div className={styles.editorBody} style={{ gridTemplateColumns: '1fr', padding: '1.25rem 0' }}>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                Check the fields you want to update. Unchecked fields will remain unchanged.
              </p>
              <div className={styles.formGrid} style={{ gridTemplateColumns: '1fr', gap: '1rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={bulkEditDraft.update_group_name}
                      onChange={(e) => setBulkEditDraft({ ...bulkEditDraft, update_group_name: e.target.checked })}
                      style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                    <label className={styles.field} style={{ flex: 1 }}>
                      <span>Group Name</span>
                      <input
                        type="text"
                        value={bulkEditDraft.group_name}
                        onChange={(e) => setBulkEditDraft({ ...bulkEditDraft, group_name: e.target.value })}
                        placeholder="e.g. NewJeans"
                        disabled={!bulkEditDraft.update_group_name}
                      />
                    </label>
                  </div>

                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={bulkEditDraft.update_album_era}
                      onChange={(e) => setBulkEditDraft({ ...bulkEditDraft, update_album_era: e.target.checked })}
                      style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                    <label className={styles.field} style={{ flex: 1 }}>
                      <span>Album / Era</span>
                      <input
                        type="text"
                        value={bulkEditDraft.album_era}
                        onChange={(e) => setBulkEditDraft({ ...bulkEditDraft, album_era: e.target.value })}
                        placeholder="e.g. Get Up"
                        disabled={!bulkEditDraft.update_album_era}
                      />
                    </label>
                  </div>

                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={bulkEditDraft.update_price}
                      onChange={(e) => setBulkEditDraft({ ...bulkEditDraft, update_price: e.target.checked })}
                      style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                    <label className={styles.field} style={{ flex: 1 }}>
                      <span>Price ($)</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={bulkEditDraft.price}
                        onChange={(e) => setBulkEditDraft({ ...bulkEditDraft, price: e.target.value })}
                        placeholder="0.00"
                        disabled={!bulkEditDraft.update_price}
                      />
                    </label>
                  </div>

                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={bulkEditDraft.update_inventory_count}
                      onChange={(e) => setBulkEditDraft({ ...bulkEditDraft, update_inventory_count: e.target.checked })}
                      style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                    <label className={styles.field} style={{ flex: 1 }}>
                      <span>Inventory Count</span>
                      <input
                        type="number"
                        min="0"
                        value={bulkEditDraft.inventory_count}
                        onChange={(e) => setBulkEditDraft({ ...bulkEditDraft, inventory_count: e.target.value })}
                        placeholder="1"
                        disabled={!bulkEditDraft.update_inventory_count}
                      />
                    </label>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <input
                      type="checkbox"
                      checked={bulkEditDraft.update_unlimited_inventory}
                      onChange={(e) => setBulkEditDraft({ ...bulkEditDraft, update_unlimited_inventory: e.target.checked })}
                      style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                    <label className={styles.checkboxField} style={{ flex: 1, paddingTop: '0.5rem', paddingBottom: '0.5rem' }}>
                      <input
                        type="checkbox"
                        checked={bulkEditDraft.unlimited_inventory}
                        onChange={(e) => setBulkEditDraft({ ...bulkEditDraft, unlimited_inventory: e.target.checked })}
                        disabled={!bulkEditDraft.update_unlimited_inventory}
                      />
                      <span>Unlimited inventory</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>

            <div className={styles.editorFooter}>
              <button type="button" className={styles.secondaryBtn} onClick={() => setShowBulkEdit(false)}>
                Cancel
              </button>
              <button type="submit" className={styles.addBtn} disabled={bulkUpdating}>
                {bulkUpdating ? 'Updating...' : 'Save Bulk Changes'}
              </button>
            </div>
          </form>
        </div>
      )}
      {showUpload && (
        <div className={styles.modalOverlay} onClick={() => setShowUpload(false)}>
          <div className={styles.modalContent} onClick={event => event.stopPropagation()}>
            <BulkUpload onComplete={() => {
              setShowUpload(false);
              void fetchCards();
            }} />
          </div>
        </div>
      )}

      {editingCard && cardDraft && (
        <div className={styles.modalOverlay} onClick={closeCardEditor}>
          <form className={styles.editorPanel} onSubmit={handleSaveCard} onClick={event => event.stopPropagation()}>
            <div className={styles.editorHeader}>
              <div>
                <p className={styles.eyebrow}>Card editor</p>
                <h2>{editingCard.title}</h2>
              </div>
              <button type="button" className={styles.closeBtn} onClick={closeCardEditor}>
                Close
              </button>
            </div>

            <div className={styles.editorBody}>
              <div className={styles.previewColumn}>
                <div className={styles.editorImageContainer}>
                  <div 
                    className={styles.editorBlurBackground} 
                    style={{ backgroundImage: `url(${imagePreviewUrl || cardDraft.image_url || editingCard.image_url})` }}
                  />
                  <img src={imagePreviewUrl || cardDraft.image_url || editingCard.image_url} alt={cardDraft.title} className={styles.editorImage} />
                </div>
                <div className={styles.previewMeta}>
                  <strong>{cardDraft.title || 'Untitled card'}</strong>
                  <span>{cardDraft.group_name || 'No group'} / {cardDraft.member_name || 'No member'}</span>
                  <span>${cardDraft.price || '0.00'}</span>
                  {cardDraft.pob_name && <span>POB: {cardDraft.pob_name}</span>}
                </div>
              </div>

              <div className={styles.formGrid}>
                <label className={styles.field}>
                  <span>Title</span>
                  <input
                    type="text"
                    value={cardDraft.title}
                    onChange={event => handleCardDraftChange('title', event.target.value)}
                    required
                  />
                </label>
                <label className={styles.field}>
                  <span>Price</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={cardDraft.price}
                    onChange={event => handleCardDraftChange('price', event.target.value)}
                    required
                  />
                </label>
                <label className={styles.checkboxField} style={{ padding: '0.5rem 0' }}>
                  <input
                    type="checkbox"
                    checked={cardDraft.unlimited_inventory}
                    onChange={event =>
                      setCardDraft(current =>
                        current
                          ? {
                              ...current,
                              unlimited_inventory:
                                event.target.checked,
                            }
                          : current
                      )
                    }
                  />
                  <span>Unlimited inventory</span>
                </label>
                <label className={styles.field}>
                  <span>Inventory Count</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={cardDraft.inventory_count}
                    onChange={event => handleCardDraftChange('inventory_count', event.target.value)}
                    disabled={cardDraft.unlimited_inventory}
                    required={!cardDraft.unlimited_inventory}
                  />
                </label>
                <label className={styles.field}>
                  <span>Storefront availability</span>
                  <AvailabilityStatusSelect
                    value={cardDraft.availability_status as AvailabilityStatus}
                    onChange={status => handleCardDraftChange('availability_status', status)}
                  />
                </label>
                <div className={`${styles.field} ${styles.wideField}`}>
                  <div className={styles.purchaseOptionsHeader}>
                    <span>Purchase Options</span>
                    <button
                      type="button"
                      className={styles.secondaryBtn}
                      onClick={addPurchaseOptionDraft}
                    >
                      Add Option
                    </button>
                  </div>
                  <div className={styles.purchaseOptionRows}>
                    {purchaseOptionDrafts.map(option => (
                      <div key={option.key} className={styles.purchaseOptionRow}>
                        <label className={styles.field}>
                          <span>Label</span>
                          <input
                            type="text"
                            value={option.label}
                            onChange={event => updatePurchaseOptionDraft(option.key, { label: event.target.value })}
                            required
                          />
                        </label>
                        <label className={styles.field}>
                          <span>Price</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={option.price}
                            onChange={event => updatePurchaseOptionDraft(option.key, { price: event.target.value })}
                            required
                          />
                        </label>
                        <label className={styles.field}>
                          <span>Min Qty</span>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={option.min_quantity}
                            onChange={event => updatePurchaseOptionDraft(option.key, { min_quantity: event.target.value })}
                            required
                          />
                        </label>
                        <label className={styles.field}>
                          <span>Max Qty</span>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={option.max_quantity}
                            onChange={event => updatePurchaseOptionDraft(option.key, { max_quantity: event.target.value })}
                            placeholder="No max"
                          />
                        </label>
                        <label className={styles.checkboxField}>
                          <input
                            type="checkbox"
                            checked={option.is_default}
                            onChange={event => setDefaultPurchaseOption(option.key, event.target.checked)}
                          />
                          <span>Default</span>
                        </label>
                        <label className={styles.field}>
                          <span>Availability</span>
                          <AvailabilityStatusSelect
                            value={option.status ?? 'available'}
                            onChange={status => updatePurchaseOptionDraft(option.key, { status })}
                          />
                        </label>
                        <button
                          type="button"
                          className={styles.deleteInlineBtn}
                          onClick={() => removePurchaseOptionDraft(option.key)}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
                <label className={styles.field}>
                  <span>Group</span>
                  <input
                    type="text"
                    value={cardDraft.group_name}
                    onChange={event => handleCardDraftChange('group_name', event.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  <span>Member</span>
                  <input
                    type="text"
                    value={cardDraft.member_name}
                    onChange={event => handleCardDraftChange('member_name', event.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  <span>Album / Era</span>
                  <input
                    type="text"
                    value={cardDraft.album_era}
                    onChange={event => handleCardDraftChange('album_era', event.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  <span>POB Name</span>
                  <input
                    type="text"
                    value={cardDraft.pob_name}
                    onChange={event => handleCardDraftChange('pob_name', event.target.value)}
                    placeholder="e.g. Everline, Makestar"
                  />
                </label>
                <label className={styles.field}>
                  <span>Rarity</span>
                  <input
                    type="text"
                    value={cardDraft.rarity}
                    onChange={event => handleCardDraftChange('rarity', event.target.value)}
                  />
                </label>

                <label className={styles.field}>
                  <span>Source</span>
                  <select
                    value={cardDraft.source}
                    onChange={event => handleCardDraftChange('source', event.target.value)}
                  >
                    <option value="manual">Manual</option>
                    <option value="instagram">Instagram</option>
                  </select>
                </label>
                <label className={`${styles.field} ${styles.wideField}`}>
                  <span>Upload New Image</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={event => {
                      const file = event.target.files?.[0] || null;
                      setSelectedImageFile(file);
                      if (file) {
                        setImagePreviewUrl(URL.createObjectURL(file));
                      } else {
                        setImagePreviewUrl('');
                      }
                    }}
                  />
                </label>
                <label className={`${styles.field} ${styles.wideField}`}>
                  <span>Or Image URL</span>
                  <input
                    type="url"
                    value={cardDraft.image_url}
                    onChange={event => handleCardDraftChange('image_url', event.target.value)}
                  />
                </label>
                <label className={`${styles.field} ${styles.wideField}`}>
                  <span>Original IG URL</span>
                  <input
                    type="url"
                    value={cardDraft.original_ig_url}
                    onChange={event => handleCardDraftChange('original_ig_url', event.target.value)}
                  />
                </label>
                <label className={`${styles.field} ${styles.wideField}`}>
                  <span>Description</span>
                  <textarea
                    rows={4}
                    value={cardDraft.description}
                    onChange={event => handleCardDraftChange('description', event.target.value)}
                  />
                </label>
              </div>
            </div>

            <div className={styles.editorFooter}>
              <button
                type="button"
                className={styles.dangerBtn}
                onClick={() => void handleDeleteCard(editingCard)}
                disabled={deletingCardId === editingCard.id}
              >
                {deletingCardId === editingCard.id ? 'Archiving...' : 'Archive card'}
              </button>
              <div className={styles.footerActions}>
                <button type="button" className={styles.secondaryBtn} onClick={closeCardEditor}>
                  Cancel
                </button>
                <button type="submit" className={styles.addBtn} disabled={savingCard}>
                  {savingCard ? 'Saving...' : 'Save card'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {editingWishlist && wishlistDraft && (
        <div className={styles.modalOverlay} onClick={closeWishlistEditor}>
          <form className={styles.editorPanel} onSubmit={handleSaveWishlist} onClick={event => event.stopPropagation()}>
            <div className={styles.editorHeader}>
              <div>
                <p className={styles.eyebrow}>Order editor</p>
                <h2>{wishlistDraft.user_ig_handle || 'Wishlist order'}</h2>
              </div>
              <button type="button" className={styles.closeBtn} onClick={closeWishlistEditor}>
                Close
              </button>
            </div>

            <div className={`${styles.editorBody} ${styles.orderEditorBody}`}>
              <div className={styles.orderPreviewColumn}>
                <div className={styles.orderSummaryBox}>
                  <span>Current total</span>
                  <strong>${wishlistDraftTotal.toFixed(2)}</strong>
                  <small>{wishlistReceiptItems.length} line item{wishlistReceiptItems.length === 1 ? '' : 's'}</small>
                </div>

                {wishlistImagePreview ? (
                  <img
                    src={wishlistImagePreview}
                    alt={wishlistImageMode === 'packing' ? 'Packing list preview' : 'Customer receipt preview'}
                    className={`${styles.orderReceiptPreview} ${wishlistImageIsStale ? styles.staleOrderReceiptPreview : ''}`}
                  />
                ) : (
                  <div className={styles.orderPreviewPlaceholder}>
                    <span>Generate a preview after adjusting this order.</span>
                  </div>
                )}
                {wishlistImageIsStale && (
                  <div className={styles.orderImageNotice}>
                    Order changed after this preview was generated.
                  </div>
                )}
                <div className={styles.orderPreviewActions}>
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    onClick={() => void generateWishlistImage({ mode: 'compact' })}
                    disabled={generatingWishlistImage}
                  >
                    {generatingWishlistImage
                      ? 'Generating...'
                      : wishlistImagePreview && wishlistImageMode === 'compact'
                        ? 'Regenerate customer receipt preview'
                        : 'Generate customer receipt preview'}
                  </button>
                </div>
              </div>

              <div className={styles.formGrid}>
                <label className={styles.field}>
                  <span>Instagram Handle</span>
                  <input
                    type="text"
                    value={wishlistDraft.user_ig_handle}
                    onChange={event => setWishlistDraft(current => current ? { ...current, user_ig_handle: event.target.value } : current)}
                    required
                  />
                </label>
                <label className={styles.field}>
                  <span>Status</span>
                  <select
                    value={wishlistDraft.status}
                    onChange={event => setWishlistDraft(current => current ? { ...current, status: event.target.value } : current)}
                  >
                    <option value="pending">Pending</option>
                    <option value="completed">Completed</option>
                  </select>
                </label>
                <label className={`${styles.field} ${styles.wideField}`}>
                  <span>Notes</span>
                  <textarea
                    rows={3}
                    value={wishlistDraft.notes}
                    onChange={event => setWishlistDraft(current => current ? { ...current, notes: event.target.value } : current)}
                    placeholder="Internal order notes"
                  />
                </label>

                <div className={`${styles.field} ${styles.wideField}`}>
                  <div className={styles.orderItemsHeader}>
                    <span>Order Items</span>
                    <button type="button" className={styles.secondaryBtn} onClick={() => addWishlistDraftItem()}>
                      Add top result
                    </button>
                  </div>

                  <div className={styles.orderCardSearch}>
                    <div className={styles.orderCardSearchBar}>
                      <input
                        type="search"
                        value={wishlistCardSearch}
                        onChange={event => setWishlistCardSearch(event.target.value)}
                        placeholder="Search cards by title, group, member, era or POB..."
                      />
                      {wishlistCardSearch && (
                        <button
                          type="button"
                          className={styles.secondaryBtn}
                          onClick={() => setWishlistCardSearch('')}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <div className={styles.orderCardResults}>
                      {wishlistCardSearchResults.length > 0 ? wishlistCardSearchResults.map(card => (
                        <button
                          key={card.id}
                          type="button"
                          className={styles.orderCardResult}
                          onClick={() => addWishlistDraftItem(card.id)}
                        >
                          {card.image_url ? (
                            <img src={card.image_url} alt="" className={styles.microImg} />
                          ) : (
                            <div className={styles.microImg} />
                          )}
                          <span>
                            <strong>{card.title || 'Untitled card'}</strong>
                            <small>
                              {[card.group_name, card.member_name, card.album_era, card.pob_name]
                                .filter(Boolean)
                                .join(' · ') || 'No metadata'}
                            </small>
                          </span>
                          <em>${Number(card.price || 0).toFixed(2)}</em>
                        </button>
                      )) : (
                        <p className={styles.emptyText}>No cards match this search.</p>
                      )}
                    </div>
                  </div>

                  <div className={styles.orderItemsEditor}>
                    {wishlistDraft.items.length > 0 ? wishlistDraft.items.map(item => {
                      const selectedCard = cardsById.get(item.card_id);
                      const cardOptions = wishlistCardSearchTerm
                        ? [
                            ...(selectedCard ? [selectedCard] : []),
                            ...wishlistCardSearchResults.filter(card => card.id !== selectedCard?.id),
                          ]
                        : cards;
                      return (
                        <div key={item.key} className={styles.orderItemEditorRow}>
                          {selectedCard?.image_url ? (
                            <img src={selectedCard.image_url} alt="" className={styles.microImg} />
                          ) : (
                            <div className={styles.microImg} />
                          )}
                          <select
                            value={item.card_id}
                            onChange={event => {
                              const nextCardId = event.target.value;
                              const nextCard = cardsById.get(nextCardId);
                              const nextOption = nextCard
                                ? getDefaultAdminPurchaseOption(nextCard)
                                : undefined;
                              updateWishlistDraftItem(item.key, {
                                card_id: nextCardId,
                                purchase_option_id: getPersistentPurchaseOptionId(nextOption?.id),
                                option_label_snapshot: nextOption?.label || 'Single',
                                unit_price_snapshot: Number(nextOption?.price ?? nextCard?.price ?? 0) || 0,
                                card_title_snapshot: nextCard?.title || '',
                                group_name_snapshot: nextCard?.group_name || '',
                                album_era_snapshot: nextCard?.album_era || '',
                                image_url_snapshot: nextCard?.image_url || '',
                              });
                            }}
                          >
                            <option value="">Select a card</option>
                            {cardOptions.map(card => (
                              <option key={card.id} value={card.id}>
                                {card.title} - ${Number(card.price || 0).toFixed(2)}
                              </option>
                            ))}
                          </select>
                          <select
                            value={item.purchase_option_id || ''}
                            onChange={event => {
                              if (!selectedCard) return;
                              const selectedOption = getSelectedAdminPurchaseOption(
                                selectedCard,
                                event.target.value,
                              );
                              updateWishlistDraftItem(item.key, {
                                purchase_option_id: getPersistentPurchaseOptionId(selectedOption?.id),
                                option_label_snapshot: selectedOption?.label || 'Single',
                                unit_price_snapshot: Number(selectedOption?.price ?? selectedCard.price ?? 0) || 0,
                              });
                            }}
                            aria-label="Purchase option"
                          >
                            {selectedCard ? getPurchasableAdminPurchaseOptions(selectedCard, item.purchase_option_id).map(option => (
                              <option key={option.id || `${selectedCard.id}-fallback`} value={getPersistentPurchaseOptionId(option.id) || ''}>
                                {option.label}{option.status !== 'available' ? ` (${option.status})` : ''} - ${Number(option.price || 0).toFixed(2)}
                              </option>
                            )) : (
                              <option value="">Select a card first</option>
                            )}
                          </select>
                          <span className={styles.orderItemPrice}>
                            ${(Number(item.unit_price_snapshot) || 0).toFixed(2)} × {parseWishlistQuantity(item.quantity)} = $
                            {((Number(item.unit_price_snapshot) || 0) * parseWishlistQuantity(item.quantity)).toFixed(2)}
                          </span>
                          <input
                            type="number"
                            min="1"
                            max={MAX_UNITS_PER_ITEM}
                            step="1"
                            value={item.quantity}
                            onChange={event => updateWishlistDraftItem(item.key, { quantity: event.target.value })}
                            aria-label="Quantity"
                          />
                          <button
                            type="button"
                            className={styles.deleteInlineBtn}
                            onClick={() => removeWishlistDraftItem(item.key)}
                          >
                            Remove
                          </button>
                        </div>
                      );
                    }) : (
                      <p className={styles.emptyText}>No items yet. Add a card to this order.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className={styles.hiddenReceipt}>
              <div ref={wishlistReceiptRef}>
                <WishlistReceipt
                  key={`${editingWishlist.id}-${wishlistRenderMode}`}
                  settings={settings}
                  userIgHandle={wishlistDraft.user_ig_handle}
                  items={wishlistReceiptItems}
                  totalPrice={wishlistDraftTotal}
                  cacheKey={`${editingWishlist.id}-${wishlistReceiptCacheKey}`}
                  mode={wishlistRenderMode}
                />
              </div>
            </div>

            <div className={styles.editorFooter}>
              <span className={styles.smallText}>
                Saving rewrites the order items and recalculates the total.
              </span>
              <div className={styles.footerActions}>
                <button type="button" className={styles.secondaryBtn} onClick={closeWishlistEditor}>
                  Cancel
                </button>
                <button type="submit" className={styles.secondaryBtn} disabled={savingWishlist}>
                  {savingWishlist ? 'Saving...' : 'Save order'}
                </button>
                <button
                  type="button"
                  className={styles.addBtn}
                  onClick={() => void handleSaveWishlistAndGenerate('compact')}
                  disabled={savingWishlist || generatingWishlistImage}
                >
                  {generatingWishlistImage ? 'Generating...' : 'Save & Download Customer Receipt'}
                </button>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => void handleSaveWishlistAndGenerate('packing')}
                  disabled={savingWishlist || generatingWishlistImage}
                >
                  {generatingWishlistImage ? 'Generating...' : 'Save & Download Packing List'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      <aside className={styles.sidebar}>
        <div className={styles.logo}>
          ADMIN <span>PANEL</span>
        </div>
        <nav className={styles.nav}>
          <button
            className={`${styles.navItem} ${activeTab === 'inventory' ? styles.active : ''}`}
            onClick={() => handleTabChange('inventory')}
          >
            Inventory
          </button>
          <button
            className={`${styles.navItem} ${activeTab === 'wishlists' ? styles.active : ''}`}
            onClick={() => handleTabChange('wishlists')}
          >
            Wishlists
          </button>
          <button
            className={`${styles.navItem} ${activeTab === 'analytics' ? styles.active : ''}`}
            onClick={() => handleTabChange('analytics')}
          >
            Analytics
          </button>
          <button
            className={`${styles.navItem} ${activeTab === 'settings' ? styles.active : ''}`}
            onClick={() => handleTabChange('settings')}
          >
            Settings
          </button>
        </nav>
        <button onClick={handleLogout} className={styles.logoutBtn}>Logout</button>
      </aside>

      <main className={styles.content}>
        {statusMessage && <div className={styles.notice}>{statusMessage}</div>}

        {activeTab === 'inventory' ? (
          <>
            <header className={styles.contentHeader}>
              <div>
                <p className={styles.eyebrow}>Inventory control</p>
                <h1>Card Inventory</h1>
              </div>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                {selectedIds.length > 0 && (
                  <>
                    <button
                      className={styles.secondaryBtn}
                      onClick={() => setShowBulkEdit(true)}
                      style={{ background: 'rgba(125, 83, 222, 0.08)', borderColor: 'var(--primary)', color: 'var(--primary)' }}
                    >
                      批量修改 ({selectedIds.length})
                    </button>
                    <button
                      className={styles.secondaryBtn}
                      onClick={() => void handleUpdateAvailability(selectedIds, 'pending')}
                      disabled={bulkAvailabilityUpdating}
                    >
                      {bulkAvailabilityUpdating ? 'Updating...' : `Set Pending (${selectedIds.length})`}
                    </button>
                    <button
                      className={styles.secondaryBtn}
                      onClick={() => void handleUpdateAvailability(selectedIds, 'available')}
                      disabled={bulkAvailabilityUpdating}
                    >
                      Set Available
                    </button>
                    <button
                      className={styles.dangerBtn}
                      onClick={() => void handleDeleteSelected()}
                      disabled={bulkAvailabilityUpdating}
                    >
                      Archive
                    </button>
                  </>
                )}
                <button className={styles.addBtn} onClick={() => setShowUpload(true)}>Add new cards</button>
              </div>
            </header>

            <section className={styles.stats}>
              <div className={styles.statCard}>
                <p>Total Cards</p>
                <h3>{inventoryStats.total}</h3>
              </div>
              <div className={styles.statCard}>
                <p>In Stock</p>
                <h3>{inventoryStats.inStock}</h3>
              </div>
              <div className={styles.statCard}>
                <p>Low Stock</p>
                <h3>{inventoryStats.lowStock}</h3>
              </div>
              <div className={styles.statCard}>
                <p>Stock Value</p>
                <h3>${inventoryStats.totalValue.toFixed(2)}</h3>
              </div>
            </section>

            <div className={styles.searchBar}>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search card title, group, member, POB or album..."
                className={styles.searchInput}
              />
              {searchTerm && (
                <button
                  type="button"
                  className={styles.clearSearchBtn}
                  onClick={() => setSearchTerm('')}
                >
                  Clear
                </button>
              )}
            </div>

            <div className={styles.inventoryList}>
              {loadingCards ? (
                <p className={styles.emptyText}>Loading inventory...</p>
              ) : cards.length > 0 ? (
                filteredCards.length > 0 ? (
                  <table className={styles.table}>
                    <colgroup>
                      <col className={styles.selectCol} />
                      <col className={styles.previewCol} />
                      <col className={styles.titleCol} />
                      <col className={styles.groupCol} />
                      <col className={styles.pobCol} />
                      <col className={styles.priceCol} />
                      <col className={styles.inventoryCol} />
                      <col className={styles.optionsCol} />
                      <col className={styles.availabilityCol} />
                      <col className={styles.actionsCol} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th style={{ width: '45px', textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={filteredCards.length > 0 && selectedIds.length === filteredCards.length}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedIds(filteredCards.map(c => c.id));
                              } else {
                                setSelectedIds([]);
                              }
                            }}
                          />
                        </th>
                        <th>Preview</th>
                        <th>Title</th>
                        <th>Group</th>
                        <th>POB</th>
                        <th>Price</th>
                        <th>Inventory</th>
                        <th>Options</th>
                        <th>Availability</th>
                        <th className={styles.actionsHeader}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCards.map(card => {
                        const inventoryPurchaseOptions = getAdminPurchaseOptions(card);

                        return (
                          <tr key={card.id}>
                            <td style={{ textAlign: 'center' }}>
                              <input
                                type="checkbox"
                                checked={selectedIds.includes(card.id)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedIds(prev => [...prev, card.id]);
                                  } else {
                                    setSelectedIds(prev => prev.filter(id => id !== card.id));
                                  }
                                }}
                              />
                            </td>
                            <td>
                              <img src={card.image_url} alt={card.title} className={styles.miniImg} />
                            </td>
                            <td>
                              <div className={styles.cardTitleCell}>
                                <strong>{card.title}</strong>
                                <span>{card.member_name || card.album_era || 'No extra metadata'}</span>
                              </div>
                            </td>
                            <td>{card.group_name || '-'}</td>
                            <td>{card.pob_name || '-'}</td>
                            <td>${Number(card.price || 0).toFixed(2)}</td>
                            <td>{card.unlimited_inventory !== false ? 'Unlimited' : (card.inventory_count || 0)}</td>
                            <td>
                              <div className={styles.inventoryOptionsList}>
                                {inventoryPurchaseOptions.map((option, index) => (
                                  <div
                                    key={option.id ?? `${option.label}-${index}`}
                                    className={styles.inventoryOption}
                                  >
                                    <span className={styles.inventoryOptionName}>
                                      {option.label || 'Single'}
                                    </span>
                                    <span className={styles.inventoryOptionPrice}>
                                      ${Number(option.price || 0).toFixed(2)}
                                    </span>
                                    {option.is_default && (
                                      <span className={styles.inventoryOptionDefault}>Default</span>
                                    )}
                                    {option.status !== 'available' && (
                                      <span className={styles.inventoryOptionInactiveBadge}>{option.status}</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </td>
                            <td>
                              <span className={`${styles.availabilityBadge} ${styles[`availability_${card.availability_status || 'available'}`]}`}>
                                {card.availability_status || 'available'}
                              </span>
                            </td>

                            <td className={styles.actionsCell}>
                              <div className={styles.actionGroup}>
                                <button className={styles.editBtn} onClick={() => handleEditCard(card)}>
                                  Edit
                                </button>
                                <button
                                  className={styles.deleteInlineBtn}
                                  onClick={() => void handleDeleteCard(card)}
                                  disabled={deletingCardId === card.id}
                                >
                                  {deletingCardId === card.id ? 'Archiving' : 'Archive'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div className={styles.placeholder}>
                    <p>No matching cards found.</p>
                  </div>
                )
              ) : (
                <div className={styles.placeholder}>
                  <p>No cards in inventory yet.</p>
                </div>
              )}
            </div>
          </>
        ) : activeTab === 'wishlists' ? (
          <>
            <header className={styles.contentHeader}>
              <div>
                <p className={styles.eyebrow}>Customer requests</p>
                <h1>User Wishlists</h1>
              </div>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                {selectedWishlistIds.length > 0 && (
                  <>
                    <select
                      value=""
                      onChange={(e) => {
                        const status = e.target.value;
                        if (status) void handleBulkUpdateWishlistStatus(status);
                      }}
                      disabled={updatingWishlists}
                      style={{
                        padding: '0.5rem',
                        borderRadius: '8px',
                        border: '1px solid rgba(125, 83, 222, 0.18)',
                        background: 'rgba(255, 255, 255, 0.8)',
                        fontSize: '0.85rem',
                        height: '40px',
                        fontWeight: '600',
                        color: 'var(--foreground)',
                        outline: 'none'
                      }}
                    >
                      <option value="">更改状态为...</option>
                      <option value="pending">Pending</option>
                      <option value="completed">Completed</option>
                    </select>
                    <button
                      className={styles.dangerBtn}
                      onClick={() => void handleBulkDeleteWishlists()}
                      disabled={updatingWishlists}
                    >
                      {updatingWishlists ? 'Deleting...' : `批量删除 (${selectedWishlistIds.length})`}
                    </button>
                  </>
                )}
                <button className={styles.secondaryBtn} onClick={() => void fetchWishlists()}>Refresh</button>
              </div>
            </header>

            <div className={styles.searchBar}>
              <input
                type="search"
                value={wishlistSearchTerm}
                onChange={event => {
                  setWishlistSearchTerm(event.target.value);
                  setSelectedWishlistIds([]);
                }}
                placeholder="Search wishlists by Instagram handle..."
                className={styles.searchInput}
              />
              {wishlistSearchTerm && (
                <button
                  className={styles.clearSearchBtn}
                  type="button"
                  onClick={() => {
                    setWishlistSearchTerm('');
                    setSelectedWishlistIds([]);
                  }}
                >
                  Clear
                </button>
              )}
            </div>

            <div className={styles.inventoryList}>
              {filteredWishlists.length > 0 ? (
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th style={{ width: '45px', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={
                            filteredWishlists.length > 0 &&
                            filteredWishlists.every(wishlist => selectedWishlistIds.includes(wishlist.id))
                          }
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedWishlistIds(filteredWishlists.map(w => w.id));
                            } else {
                              setSelectedWishlistIds(current =>
                                current.filter(id => !filteredWishlists.some(wishlist => wishlist.id === id)),
                              );
                            }
                          }}
                        />
                      </th>
                      <th>Date</th>
                      <th>IG Handle</th>
                      <th>Items</th>
                      <th>Total</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredWishlists.map(wishlist => (
                      <tr key={wishlist.id}>
                        <td style={{ textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={selectedWishlistIds.includes(wishlist.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedWishlistIds(prev => [...prev, wishlist.id]);
                              } else {
                                setSelectedWishlistIds(prev => prev.filter(id => id !== wishlist.id));
                              }
                            }}
                          />
                        </td>
                        <td className={styles.smallText}>{new Date(wishlist.created_at).toLocaleString()}</td>
                        <td>
                          <a
                            href={`https://instagram.com/${String(wishlist.user_ig_handle || '').replace('@', '')}`}
                            target="_blank"
                            rel="noreferrer"
                            className={styles.linkText}
                          >
                            {wishlist.user_ig_handle}
                          </a>
                        </td>
                        <td>
                          <div className={styles.wishlistItemsPreview}>
                            {wishlist.wishlist_items?.map(item => (
                              <div
                                key={item.id}
                                className={styles.wishlistItemPreview}
                                title={item.card_title_snapshot || item.cards?.title || 'Untitled card'}
                              >
                                {item.image_url_snapshot || item.cards?.image_url ? (
                                  <img
                                    src={item.image_url_snapshot || item.cards?.image_url || ''}
                                    alt=""
                                    className={styles.microImg}
                                  />
                                ) : (
                                  <div className={styles.microImg} />
                                )}
                                <span>
                                  <strong>{item.card_title_snapshot || item.cards?.title || 'Untitled card'}</strong>
                                  <small>
                                    {item.option_label_snapshot || 'Single'} · $
                                    {Number(item.unit_price_snapshot ?? item.cards?.price ?? 0).toFixed(2)}
                                  </small>
                                </span>
                              </div>
                            ))}
                          </div>
                        </td>
                        <td>${Number(wishlist.total_price || 0).toFixed(2)}</td>
                        <td>
                          <span className={styles.statusBadge}>{wishlist.status}</span>
                        </td>
                        <td>
                          <button className={styles.editBtn} onClick={() => handleEditWishlist(wishlist)}>
                            Edit / regenerate
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className={styles.placeholder}>
                  <p>{wishlists.length > 0 ? 'No wishlists match this search.' : 'No wishlists submitted yet.'}</p>
                </div>
              )}
            </div>
          </>
        ) : activeTab === 'analytics' ? (
          <div className={styles.analyticsView}>
            <header className={styles.contentHeader}>
              <div>
                <p className={styles.eyebrow}>Demand signals</p>
                <h1>Analytics</h1>
              </div>
              <div className={styles.analyticsControls}>
                <select
                  value={analyticsDays}
                  onChange={event => {
                    const days = Number(event.target.value) as 7 | 30 | 90;
                    setAnalyticsDays(days);
                    void fetchAnalytics(days);
                  }}
                  aria-label="Analytics time range"
                >
                  <option value={7}>Last 7 days</option>
                  <option value={30}>Last 30 days</option>
                  <option value={90}>Last 90 days</option>
                </select>
                <button className={styles.secondaryBtn} onClick={() => void fetchAnalytics()} disabled={loadingAnalytics}>
                  {loadingAnalytics ? 'Loading...' : 'Refresh'}
                </button>
              </div>
            </header>

            {analytics ? (
              <>
                <section className={styles.stats}>
                  <div className={styles.statCard}><p>Wishlist requests</p><h3>{analytics.overview.request_orders}</h3></div>
                  <div className={styles.statCard}><p>Requested cards</p><h3>{analytics.overview.requested_items}</h3></div>
                  <div className={styles.statCard}><p>Request value</p><h3>${analytics.overview.request_value.toFixed(2)}</h3></div>
                  <div className={styles.statCard}><p>Completed value</p><h3>${analytics.overview.completed_value.toFixed(2)}</h3></div>
                </section>
                <section className={styles.analyticsGrid}>
                  <div className={styles.analyticsPanel}>
                    <div className={styles.analyticsPanelHeader}><h2>Top search keywords</h2><span>{analytics.searches.total} searches</span></div>
                    {analytics.searches.top_queries.length > 0 ? <ol className={styles.rankList}>{analytics.searches.top_queries.map(rank => <li key={rank.label}><strong>{rank.label}</strong><span>{rank.count}</span></li>)}</ol> : <p className={styles.emptyText}>No search data yet.</p>}
                  </div>
                  <div className={styles.analyticsPanel}>
                    <div className={styles.analyticsPanelHeader}><h2>Searches with no results</h2><span>Demand gap</span></div>
                    {analytics.searches.zero_result_queries.length > 0 ? <ol className={styles.rankList}>{analytics.searches.zero_result_queries.map(rank => <li key={rank.label}><strong>{rank.label}</strong><span>{rank.count}</span></li>)}</ol> : <p className={styles.emptyText}>No zero-result searches.</p>}
                  </div>
                  <div className={styles.analyticsPanel}>
                    <div className={styles.analyticsPanelHeader}><h2>Most requested groups</h2><span>All requests</span></div>
                    {analytics.requests.top_groups.length > 0 ? <ol className={styles.rankList}>{analytics.requests.top_groups.map(rank => <li key={rank.label}><strong>{rank.label}</strong><span>{rank.count} · ${Number(rank.revenue ?? 0).toFixed(2)}</span></li>)}</ol> : <p className={styles.emptyText}>No requests yet.</p>}
                  </div>
                  <div className={styles.analyticsPanel}>
                    <div className={styles.analyticsPanelHeader}><h2>Most requested albums / eras</h2><span>All requests</span></div>
                    {analytics.requests.top_albums.length > 0 ? <ol className={styles.rankList}>{analytics.requests.top_albums.map(rank => <li key={rank.label}><strong>{rank.label}</strong><span>{rank.count} · ${Number(rank.revenue ?? 0).toFixed(2)}</span></li>)}</ol> : <p className={styles.emptyText}>No requests yet.</p>}
                  </div>
                  <div className={styles.analyticsPanel}>
                    <div className={styles.analyticsPanelHeader}><h2>Most requested cards</h2><span>All requests</span></div>
                    {analytics.requests.top_cards.length > 0 ? <ol className={styles.rankList}>{analytics.requests.top_cards.map(rank => <li key={rank.label}><strong>{rank.label}</strong><span>{rank.count} · ${Number(rank.revenue ?? 0).toFixed(2)}</span></li>)}</ol> : <p className={styles.emptyText}>No requests yet.</p>}
                  </div>
                  <div className={styles.analyticsPanel}>
                    <div className={styles.analyticsPanelHeader}><h2>Completed sales by group</h2><span>{analytics.overview.completed_orders} orders</span></div>
                    {analytics.completed.top_groups.length > 0 ? <ol className={styles.rankList}>{analytics.completed.top_groups.map(rank => <li key={rank.label}><strong>{rank.label}</strong><span>{rank.count} · ${Number(rank.revenue ?? 0).toFixed(2)}</span></li>)}</ol> : <p className={styles.emptyText}>No completed orders in this period.</p>}
                  </div>
                </section>
              </>
            ) : (
              <div className={styles.placeholder}><p>{loadingAnalytics ? 'Loading analytics...' : 'Open this panel to load search and order analytics.'}</p></div>
            )}
          </div>
        ) : (
          <div className={styles.settingsView}>
            <header className={styles.contentHeader}>
              <div>
                <p className={styles.eyebrow}>Store operations</p>
                <h1>Site Settings</h1>
              </div>
              <button
                className={styles.addBtn}
                type="submit"
                form="admin-settings-form"
                disabled={savingSettings}
              >
                {savingSettings ? 'Saving...' : 'Save settings'}
              </button>
            </header>

            <form id="admin-settings-form" className={styles.settingsGrid} onSubmit={handleSaveSettings}>
              <div className={styles.settingsPanels}>
                <section className={styles.settingsPanel}>
                  <div className={styles.panelHeader}>
                    <span>01</span>
                    <h2>Store Identity</h2>
                  </div>
                  <label className={styles.field}>
                    <span>Store title</span>
                    <input
                      type="text"
                      value={settings.site_title}
                      onChange={event => setSettings({ ...settings, site_title: event.target.value })}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Official Instagram</span>
                    <input
                      type="text"
                      value={settings.official_ig_handle}
                      onChange={event => setSettings({ ...settings, official_ig_handle: event.target.value })}
                    />
                  </label>
                </section>

                <section className={styles.settingsPanel}>
                  <div className={styles.panelHeader}>
                    <span>02</span>
                    <h2>Checkout Copy</h2>
                  </div>
                  <label className={styles.field}>
                    <span>Checkout intro</span>
                    <textarea
                      rows={3}
                      value={settings.checkout_intro}
                      onChange={event => setSettings({ ...settings, checkout_intro: event.target.value })}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Wishlist footer</span>
                    <textarea
                      rows={3}
                      value={settings.wishlist_footer_note}
                      onChange={event => setSettings({ ...settings, wishlist_footer_note: event.target.value })}
                    />
                  </label>
                </section>

                <section className={styles.settingsPanel}>
                  <div className={styles.panelHeader}>
                    <span>03</span>
                    <h2>Inventory Rule</h2>
                  </div>
                  <label className={styles.field}>
                    <span>Low stock threshold</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={settings.low_stock_threshold}
                      onChange={event => setSettings({ ...settings, low_stock_threshold: event.target.value })}
                    />
                  </label>
                </section>

                <section className={styles.settingsPanel}>
                  <div className={styles.panelHeader}>
                    <span>04</span>
                    <h2>Announcement Banner</h2>
                  </div>
                  <label className={styles.checkboxField}>
                    <input
                      type="checkbox"
                      checked={settings.banner_enabled}
                      onChange={event => setSettings({ ...settings, banner_enabled: event.target.checked })}
                    />
                    <span>Show announcement banner</span>
                  </label>
                  <label className={styles.field}>
                    <span>Banner text</span>
                    <textarea
                      rows={3}
                      value={settings.banner_text}
                      onChange={event => setSettings({ ...settings, banner_text: event.target.value })}
                    />
                  </label>
                </section>

                <section className={styles.settingsPanel}>
                  <div className={styles.panelHeader}>
                    <span>05</span>
                    <h2>Instagram Connection</h2>
                  </div>
                  <div className={styles.instagramStatusCard}>
                    <div>
                      <span className={styles.fieldHint}>Current status</span>
                      <strong className={instagramStatus?.configured ? styles.instagramStatusOk : styles.instagramStatusMuted}>
                        {instagramStatus?.configured ? 'Configured' : 'Not configured'}
                      </strong>
                    </div>
                    <div>
                      <span className={styles.fieldHint}>Source</span>
                      <strong>
                        {instagramStatus?.database_session_configured || instagramStatus?.database_settings_configured
                          ? 'Database'
                          : instagramStatus?.environment_fallback_configured ? 'Environment fallback' : 'None'}
                      </strong>
                    </div>
                    <div>
                      <span className={styles.fieldHint}>Last updated</span>
                      <strong>
                        {instagramStatus?.updated_at
                          ? new Date(instagramStatus.updated_at).toLocaleString()
                          : '—'}
                      </strong>
                    </div>
                  </div>
                  <p className={styles.fieldHint}>
                    The session is stored server-side and is never returned to the browser. Leave a field blank to keep its current value.
                  </p>
                  <label className={styles.field}>
                    <span>New Instagram session ID</span>
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={instagramSessionInput}
                      onChange={event => setInstagramSessionInput(event.target.value)}
                      placeholder="Paste a fresh session ID"
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Saved settings JSON (optional)</span>
                    <textarea
                      rows={4}
                      value={instagramSettingsJsonInput}
                      onChange={event => setInstagramSettingsJsonInput(event.target.value)}
                      placeholder='{"cookies": {"sessionid": "..."}}'
                      spellCheck={false}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Proxy URL (optional)</span>
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={instagramProxyInput}
                      onChange={event => setInstagramProxyInput(event.target.value)}
                      placeholder="https://user:password@host:port"
                    />
                  </label>
                  <div className={styles.instagramActions}>
                    <button
                      type="button"
                      className={styles.addBtn}
                      onClick={() => void handleSaveInstagramSettings()}
                      disabled={instagramBusy}
                    >
                      {savingInstagramSettings ? 'Saving...' : 'Save Instagram settings'}
                    </button>
                    <button
                      type="button"
                      className={styles.secondaryBtn}
                      onClick={() => void handleTestInstagramConnection()}
                      disabled={instagramBusy}
                    >
                      {testingInstagramConnection ? 'Testing...' : 'Test connection'}
                    </button>
                  </div>
                  <div className={styles.instagramSyncBox}>
                    <label className={styles.field}>
                      <span>Sync a post or reel URL</span>
                      <input
                        type="url"
                        value={instagramSyncUrl}
                        onChange={event => setInstagramSyncUrl(event.target.value)}
                        placeholder="https://www.instagram.com/p/..."
                      />
                    </label>
                    <button
                      type="button"
                      className={styles.secondaryBtn}
                      onClick={() => void handleSyncInstagram()}
                      disabled={instagramBusy}
                    >
                      {syncingInstagram ? 'Syncing...' : 'Sync post'}
                    </button>
                  </div>
                </section>

                <section className={styles.settingsPanel}>
                  <div className={styles.panelHeader}>
                    <span>06</span>
                    <h2>Instagram Sync History</h2>
                  </div>
                  {instagramSyncLogs.length > 0 ? (
                    <div className={styles.instagramLogList}>
                      {instagramSyncLogs.map(log => (
                        <div key={log.id} className={styles.instagramLogRow}>
                          <div>
                            <strong className={log.status === 'success' ? styles.instagramStatusOk : log.status === 'failed' ? styles.instagramStatusError : styles.instagramStatusMuted}>
                              {log.status.toUpperCase()}
                            </strong>
                            <span>{log.message || 'No message'}</span>
                          </div>
                          <div className={styles.instagramLogMeta}>
                            {log.posts_found == null ? '—' : `${log.posts_found} post${log.posts_found === 1 ? '' : 's'}`}
                            <time dateTime={log.created_at}>{new Date(log.created_at).toLocaleString()}</time>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className={styles.fieldHint}>No Instagram sync attempts recorded yet.</p>
                  )}
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    onClick={() => void fetchInstagramData()}
                  >
                    Refresh Instagram status
                  </button>
                </section>
              </div>

              <aside className={styles.settingsPreview}>
                <div className={styles.previewHeader}>
                  <span>Live Preview</span>
                  <strong>{settings.site_title || defaultAdminSettings.site_title}</strong>
                </div>
                <div className={styles.previewCheckout}>
                  <p>Checkout</p>
                  <h3>Ready to Own Them?</h3>
                  <span>{settings.checkout_intro || defaultAdminSettings.checkout_intro}</span>
                </div>
                <div className={styles.previewFooter}>
                  <span>Total estimated</span>
                  <strong>$42.00</strong>
                  <p>{settings.wishlist_footer_note || defaultAdminSettings.wishlist_footer_note}</p>
                  <small>{settings.official_ig_handle || defaultAdminSettings.official_ig_handle}</small>
                </div>
                <div className={styles.previewInventory}>
                  <span>Low stock marker</span>
                  <strong>{settings.low_stock_threshold || defaultAdminSettings.low_stock_threshold} cards</strong>
                </div>
              </aside>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
