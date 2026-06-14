'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import BulkUpload from '@/components/admin/BulkUpload';
import styles from './page.module.css';
import {
  type AdminSettings,
  type CardEditDraft,
  type CardUpdatePayload,
  applyCardPatch,
  buildCardUpdatePayload,
  buildSettingsRows,
  createCardDraft,
  defaultAdminSettings,
  getCardDraftErrors,
  normalizeAdminSettings,
} from './adminDashboardUtils';

type AdminTab = 'inventory' | 'wishlists' | 'settings';

type AdminCard = CardUpdatePayload & {
  id: string;
  created_at?: string;
};

type WishlistItem = {
  card_id: string;
  cards?: {
    image_url?: string;
    title?: string;
  };
};

type Wishlist = {
  id: string;
  created_at: string;
  user_ig_handle: string;
  total_price: number;
  status: string;
  wishlist_items?: WishlistItem[];
};

export default function AdminDashboard() {
  const [session, setSession] = useState<unknown>(null);
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
  const [statusMessage, setStatusMessage] = useState('');
  const router = useRouter();

  const fetchCards = useCallback(async () => {
    setLoadingCards(true);
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
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.push('/admin/login');
      } else {
        setSession(session);
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
      let finalImageUrl = cardDraft.image_url;
      if (selectedImageFile) {
        const fileExt = selectedImageFile.name.split('.').pop();
        const fileName = `${Math.random()}.${fileExt}`;
        const filePath = `card-images/${fileName}`;
        const { error: uploadError } = await supabase.storage
          .from('cards')
          .upload(filePath, selectedImageFile);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('cards')
          .getPublicUrl(filePath);
        finalImageUrl = publicUrl;
      }

      const payload = {
        ...buildCardUpdatePayload(cardDraft),
        image_url: finalImageUrl,
      };

      const { error } = await supabase
        .from('cards')
        .update(payload)
        .eq('id', editingCard.id);

      if (error) {
        setStatusMessage(`Error saving card: ${error.message}`);
      } else {
        setCards(current => applyCardPatch(current, editingCard.id, payload));
        setStatusMessage('Card updated.');
        closeCardEditor();
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setStatusMessage(`Error saving card image: ${errMsg}`);
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

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/admin/login');
  };

  if (!session) return <div className={styles.loading}>Checking session...</div>;

  return (
    <div className={styles.dashboard}>
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
                <img src={imagePreviewUrl || cardDraft.image_url || editingCard.image_url} alt={cardDraft.title} className={styles.editorImage} />
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

      <aside className={styles.sidebar}>
        <div className={styles.logo}>
          ADMIN <span>PANEL</span>
        </div>
        <nav className={styles.nav}>
          <button
            className={`${styles.navItem} ${activeTab === 'inventory' ? styles.active : ''}`}
            onClick={() => setActiveTab('inventory')}
          >
            Inventory
          </button>
          <button
            className={`${styles.navItem} ${activeTab === 'wishlists' ? styles.active : ''}`}
            onClick={() => setActiveTab('wishlists')}
          >
            Wishlists
          </button>
          <button
            className={`${styles.navItem} ${activeTab === 'settings' ? styles.active : ''}`}
            onClick={() => setActiveTab('settings')}
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
              <button className={styles.addBtn} onClick={() => setShowUpload(true)}>Add new cards</button>
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

            <div className={styles.inventoryList}>
              {loadingCards ? (
                <p className={styles.emptyText}>Loading inventory...</p>
              ) : cards.length > 0 ? (
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Preview</th>
                      <th>Title</th>
                      <th>Group</th>
                      <th>POB</th>
                      <th>Price</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cards.map(card => (
                      <tr key={card.id}>
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
              <button className={styles.secondaryBtn} onClick={() => void fetchWishlists()}>Refresh</button>
            </header>

            <div className={styles.inventoryList}>
              {wishlists.length > 0 ? (
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>IG Handle</th>
                      <th>Items</th>
                      <th>Total</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wishlists.map(wishlist => (
                      <tr key={wishlist.id}>
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
                                key={item.card_id}
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className={styles.placeholder}>
                  <p>No wishlists submitted yet.</p>
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
