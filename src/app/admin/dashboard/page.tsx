'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { toPng } from 'html-to-image';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import BulkUpload from '@/components/admin/BulkUpload';
import WishlistReceipt, { type ReceiptLineItem } from '@/components/WishlistReceipt';
import { waitForImages } from '@/components/checkoutImageUtils';
import { fetchJsonWithRetry, formatAdminFetchError } from '@/lib/client/adminFetch';
import styles from './page.module.css';
import {
  type AdminSettings,
  type CardEditDraft,
  type CardUpdatePayload,
  type WishlistDraftItem,
  applyCardPatch,
  buildCardUpdatePayload,
  buildSettingsRows,
  buildWishlistItemInsertRows,
  calculateWishlistTotal,
  createCardDraft,
  createWishlistItemsDraft,
  defaultAdminSettings,
  formatAdminError,
  getCardDraftErrors,
  isMissingColumnError,
  normalizeAdminSettings,
  parseWishlistQuantity,
} from './adminDashboardUtils';

type AdminTab = 'inventory' | 'wishlists' | 'settings';

type AdminCard = CardUpdatePayload & {
  id: string;
  created_at?: string;
};

type CardSaveResponse = {
  success?: boolean;
  card?: AdminCard;
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
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string>('');
  const [savingCard, setSavingCard] = useState(false);
  const [deletingCardId, setDeletingCardId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [selectedWishlistIds, setSelectedWishlistIds] = useState<string[]>([]);
  const [updatingWishlists, setUpdatingWishlists] = useState(false);
  const [editingWishlist, setEditingWishlist] = useState<Wishlist | null>(null);
  const [wishlistDraft, setWishlistDraft] = useState<WishlistEditDraft | null>(null);
  const [savingWishlist, setSavingWishlist] = useState(false);
  const [generatingWishlistImage, setGeneratingWishlistImage] = useState(false);
  const [wishlistImagePreview, setWishlistImagePreview] = useState<string | null>(null);
  const [wishlistImageSignature, setWishlistImageSignature] = useState('');
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [bulkEditDraft, setBulkEditDraft] = useState({
    group_name: '',
    album_era: '',
    price: '',
    inventory_count: '',
    update_group_name: false,
    update_album_era: false,
    update_price: false,
    update_inventory_count: false,
  });
  const [statusMessage, setStatusMessage] = useState('');
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [wishlistSearchTerm, setWishlistSearchTerm] = useState('');
  const [wishlistCardSearch, setWishlistCardSearch] = useState('');
  const wishlistReceiptRef = useRef<HTMLDivElement>(null);

  const cardsById = useMemo(() => new Map(cards.map(card => [card.id, card])), [cards]);

  const filteredCards = useMemo(() => {
    if (!searchTerm.trim()) return cards;
    const term = searchTerm.toLowerCase().trim();
    return cards.filter(
      card =>
        card.title?.toLowerCase().includes(term) ||
        card.group_name?.toLowerCase().includes(term) ||
        card.pob_name?.toLowerCase().includes(term) ||
        card.album_era?.toLowerCase().includes(term) ||
        card.member_name?.toLowerCase().includes(term)
    );
  }, [cards, searchTerm]);

  const filteredWishlists = useMemo(() => {
    const term = wishlistSearchTerm.toLowerCase().trim();
    if (!term) return wishlists;
    const termWithoutAt = term.replace(/^@/, '');

    return wishlists.filter(wishlist => {
      const handle = String(wishlist.user_ig_handle || '').toLowerCase();
      const handleWithoutAt = handle.replace(/^@/, '');
      const notes = String(wishlist.notes || '').toLowerCase();
      const status = String(wishlist.status || '').toLowerCase();
      const itemText = (wishlist.wishlist_items ?? [])
        .map(item => item.cards?.title || '')
        .join(' ')
        .toLowerCase();

      return (
        handle.includes(term) ||
        handleWithoutAt.includes(termWithoutAt) ||
        notes.includes(term) ||
        status.includes(term) ||
        itemText.includes(term)
      );
    });
  }, [wishlistSearchTerm, wishlists]);

  const wishlistCardSearchTerm = wishlistCardSearch.trim().toLowerCase();
  const wishlistCardSearchResults = useMemo(() => {
    const matchesSearch = (card: AdminCard) => {
      if (!wishlistCardSearchTerm) return true;

      return [
        card.title,
        card.group_name,
        card.member_name,
        card.album_era,
        card.pob_name,
        card.rarity,
      ].some(value => String(value ?? '').toLowerCase().includes(wishlistCardSearchTerm));
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
      if (!card) continue;

      lineItems.push({
        id: item.key,
        title: card.title || 'Untitled card',
        price: Number(card.price) || 0,
        image_url: card.image_url || '',
        group_name: card.group_name || card.member_name || card.album_era || '',
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
        item.title,
        item.quantity,
        Number(item.price).toFixed(2),
        item.image_url,
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

    setCards(allCards);
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

  const fetchData = useCallback(async () => {
    await Promise.all([fetchCards(), fetchWishlists(), fetchSettings()]);
  }, [fetchCards, fetchSettings, fetchWishlists]);

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
      const price = Number(card.price) || 0;
      const stock = Number(card.inventory_count) || 0;
      return sum + price * stock;
    }, 0);

    return {
      total: cards.length,
      inStock: cards.filter(card => Number(card.inventory_count) > 0).length,
      soldOut: cards.filter(card => Number(card.inventory_count) <= 0).length,
      lowStock: cards.filter(card => {
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



  const handleEditCard = (card: AdminCard) => {
    setEditingCard(card);
    setCardDraft(createCardDraft(card));
    setSelectedImageFile(null);
    setImagePreviewUrl('');
    setStatusMessage('');
  };

  const handleCardDraftChange = (field: keyof CardEditDraft, value: string) => {
    setCardDraft(current => current ? { ...current, [field]: value } : current);
  };

  const closeCardEditor = () => {
    setEditingCard(null);
    setCardDraft(null);
    setSelectedImageFile(null);
    setImagePreviewUrl('');
    setSavingCard(false);
  };

  const handleSaveCard = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingCard || !cardDraft) return;

    const errors = getCardDraftErrors(cardDraft);
    if (errors.length > 0) {
      setStatusMessage(errors.join(' '));
      return;
    }

    setSavingCard(true);
    setStatusMessage('');

    try {
      if (!session?.access_token) {
        throw new Error('Please sign in again before saving.');
      }

      let finalImageUrl = cardDraft.image_url;
      if (selectedImageFile) {
        const formData = new FormData();
        formData.append('file', selectedImageFile);

        const { response: uploadRes, data: uploadResult } = await fetchJsonWithRetry<ImageUploadResponse>('/api/admin/cards/upload-image', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
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

      const { response: saveRes, data: saveResult } = await fetchJsonWithRetry<CardSaveResponse>(`/api/admin/cards/${encodeURIComponent(editingCard.id)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!saveRes.ok || saveResult.error) {
        setStatusMessage(`Error saving card: ${saveResult.error || `Request failed with status ${saveRes.status}`}`);
      } else {
        const savedCard = saveResult.card ?? { ...editingCard, ...payload };
        setCards(current => applyCardPatch(current, editingCard.id, savedCard));
        setStatusMessage('Card updated.');
        closeCardEditor();
      }
    } catch (err: unknown) {
      const errMsg = formatAdminFetchError(err, 'Saving card');
      setStatusMessage(`Error saving card: ${errMsg}`);
    } finally {
      setSavingCard(false);
    }
  };

  const handleDeleteCard = async (card: AdminCard) => {
    const confirmed = window.confirm(`Delete "${card.title}" from inventory?`);
    if (!confirmed) return;

    setDeletingCardId(card.id);
    setStatusMessage('');

    const { error } = await supabase
      .from('cards')
      .delete()
      .eq('id', card.id);

    if (error) {
      setStatusMessage(`Error deleting card: ${error.message}`);
    } else {
      // Clean up storage file if it exists
      if (card.image_url && card.image_url.includes('/storage/v1/object/public/cards/')) {
        const filePath = card.image_url.split('/storage/v1/object/public/cards/')[1];
        if (filePath) {
          await supabase.storage.from('cards').remove([filePath]);
        }
      }
      setCards(current => current.filter(item => item.id !== card.id));
      setStatusMessage('Card deleted.');
      if (editingCard?.id === card.id) closeCardEditor();
    }
    setDeletingCardId(null);
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.length === 0) return;
    const confirmed = window.confirm(`确定要从库存中删除选中的 ${selectedIds.length} 张卡片吗？此操作无法撤销。`);
    if (!confirmed) return;

    setBulkDeleting(true);
    setStatusMessage('');

    try {
      const { error } = await supabase
        .from('cards')
        .delete()
        .in('id', selectedIds);

      if (error) {
        setStatusMessage(`批量删除卡片失败: ${error.message}`);
      } else {
        const cardsToDelete = cards.filter(c => selectedIds.includes(c.id));
        const filePaths = cardsToDelete
          .map(card => {
            if (card.image_url && card.image_url.includes('/storage/v1/object/public/cards/')) {
              return card.image_url.split('/storage/v1/object/public/cards/')[1];
            }
            return null;
          })
          .filter(Boolean) as string[];

        if (filePaths.length > 0) {
          try {
            await supabase.storage.from('cards').remove(filePaths);
          } catch (storageErr) {
            console.error('Error removing storage files:', storageErr);
          }
        }

        setCards(current => current.filter(item => !selectedIds.includes(item.id)));
        setStatusMessage(`成功删除选中的 ${selectedIds.length} 张卡片。`);
        
        if (editingCard && selectedIds.includes(editingCard.id)) {
          closeCardEditor();
        }
        
        setSelectedIds([]);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setStatusMessage(`批量删除发生错误: ${errMsg}`);
    } finally {
      setBulkDeleting(false);
    }
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
    setWishlistCardSearch('');
  };

  const updateWishlistDraftItem = (
    key: string,
    patch: Partial<Pick<WishlistDraftItem, 'card_id' | 'quantity'>>,
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

    setWishlistDraft(current => current ? {
      ...current,
      items: current.items.some(item => item.card_id === targetCardId)
        ? current.items.map(item => item.card_id === targetCardId
          ? { ...item, quantity: String(parseWishlistQuantity(item.quantity) + 1) }
          : item)
        : [
            ...current.items,
            {
              key: createWishlistDraftKey(),
              card_id: targetCardId,
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

      const itemRows = buildWishlistItemInsertRows(editingWishlist.id, validItems);
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

  const generateWishlistImage = async ({ download = false }: { download?: boolean } = {}) => {
    if (!wishlistReceiptRef.current || !wishlistDraft) return false;

    const userHandle = wishlistDraft.user_ig_handle.trim();
    if (!userHandle) {
      setStatusMessage('Instagram handle is required before generating an image.');
      return false;
    }
    if (wishlistReceiptItems.length === 0) {
      setStatusMessage('Order needs at least one valid card before generating an image.');
      return false;
    }

    setGeneratingWishlistImage(true);
    setStatusMessage('');

    try {
      const imageReport = await waitForImages(wishlistReceiptRef.current);
      if (imageReport.failed > 0) {
        console.warn('Some admin receipt images failed to load before export:', imageReport);
      }

      const dataUrl = await toPng(wishlistReceiptRef.current, {
        cacheBust: true,
        includeQueryParams: true,
        quality: 1,
      });

      setWishlistImagePreview(dataUrl);
      setWishlistImageSignature(wishlistReceiptSignature);

      if (download) {
        const safeHandle = userHandle.replace(/[^a-z0-9_-]+/gi, '').replace(/^@/, '') || 'order';
        const link = document.createElement('a');
        link.download = `wishlist-${safeHandle}-updated.png`;
        link.href = dataUrl;
        link.click();
      }

      setStatusMessage(download ? 'New order image downloaded.' : 'New order image preview generated.');
      return true;
    } catch (err: unknown) {
      const errMsg = formatAdminError(err);
      setStatusMessage(`Error generating order image: ${errMsg}`);
      return false;
    } finally {
      setGeneratingWishlistImage(false);
    }
  };

  const handleSaveWishlistAndGenerate = async () => {
    const saved = await saveWishlistDraft();
    if (saved) {
      await generateWishlistImage({ download: true });
    }
  };

  const handleBulkUpdate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (selectedIds.length === 0) return;

    const updatePayload: Partial<Pick<
      CardUpdatePayload,
      'group_name' | 'album_era' | 'price' | 'inventory_count'
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
          update_group_name: false,
          update_album_era: false,
          update_price: false,
          update_inventory_count: false,
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
            }} accessToken={session.access_token} />
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
                {deletingCardId === editingCard.id ? 'Deleting...' : 'Delete card'}
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
                    alt="Updated wishlist receipt"
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
                    onClick={() => void generateWishlistImage()}
                    disabled={generatingWishlistImage}
                  >
                    {generatingWishlistImage ? 'Generating...' : wishlistImagePreview ? 'Regenerate preview' : 'Generate preview'}
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
                            onChange={event => updateWishlistDraftItem(item.key, { card_id: event.target.value })}
                          >
                            <option value="">Select a card</option>
                            {cardOptions.map(card => (
                              <option key={card.id} value={card.id}>
                                {card.title} - ${Number(card.price || 0).toFixed(2)}
                              </option>
                            ))}
                          </select>
                          <input
                            type="number"
                            min="1"
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
                  settings={settings}
                  userIgHandle={wishlistDraft.user_ig_handle}
                  items={wishlistReceiptItems}
                  totalPrice={wishlistDraftTotal}
                  cacheKey={`${editingWishlist.id}-${wishlistDraft.items.length}-${wishlistDraftTotal}`}
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
                  onClick={() => void handleSaveWishlistAndGenerate()}
                  disabled={savingWishlist || generatingWishlistImage}
                >
                  {generatingWishlistImage ? 'Generating...' : 'Save & download image'}
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
                      className={styles.dangerBtn}
                      onClick={() => void handleDeleteSelected()}
                      disabled={bulkDeleting}
                    >
                      {bulkDeleting ? 'Deleting...' : `批量删除 (${selectedIds.length})`}
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
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCards.map(card => (
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

                          <td>
                            <div className={styles.actionGroup}>
                              <button className={styles.editBtn} onClick={() => handleEditCard(card)}>
                                Edit
                              </button>
                              <button
                                className={styles.deleteInlineBtn}
                                onClick={() => void handleDeleteCard(card)}
                                disabled={deletingCardId === card.id}
                              >
                                {deletingCardId === card.id ? 'Deleting' : 'Delete'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
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
                              <img
                                key={item.id}
                                src={item.cards?.image_url}
                                alt=""
                                title={item.cards?.title}
                                className={styles.microImg}
                              />
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
