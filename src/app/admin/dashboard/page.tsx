'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import styles from './page.module.css';
import BulkUpload from '@/components/admin/BulkUpload';

export default function AdminDashboard() {
  const [session, setSession] = useState<any>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [cards, setCards] = useState<any[]>([]);
  const [wishlists, setWishlists] = useState<any[]>([]);
  const [loadingCards, setLoadingCards] = useState(true);
  const [activeTab, setActiveTab] = useState('inventory'); // 'inventory', 'wishlists', 'settings'
  const [settings, setSettings] = useState({
    site_title: 'K-POP CARD',
    official_ig_handle: '@official_account'
  });
  const [savingSettings, setSavingSettings] = useState(false);
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.push('/admin/login');
      } else {
        setSession(session);
        fetchData();
      }
    });
  }, [router]);

  const fetchData = async () => {
    fetchCards();
    fetchWishlists();
    fetchSettings();
  };

  const fetchCards = async () => {
    setLoadingCards(true);
    const { data, error } = await supabase
      .from('cards')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (data) setCards(data);
    setLoadingCards(false);
  };

    if (data) setWishlists(data);
  };

  const fetchSettings = async () => {
    const { data, error } = await supabase
      .from('site_settings')
      .select('*');
    
    if (data) {
      const s = data.reduce((acc: any, curr: any) => ({ ...acc, [curr.key]: curr.value }), {});
      setSettings(prev => ({ ...prev, ...s }));
    }
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    const updates = Object.entries(settings).map(([key, value]) => ({ key, value }));
    
    const { error } = await supabase
      .from('site_settings')
      .upsert(updates);
    
    if (error) alert('Error saving settings: ' + error.message);
    else alert('Settings saved successfully!');
    setSavingSettings(false);
  };

  const handleUpdateStock = async (cardId: string, newCount: number) => {
    const { error } = await supabase
      .from('cards')
      .update({ inventory_count: Math.max(0, newCount) })
      .eq('id', cardId);
    
    if (error) alert('Error updating stock: ' + error.message);
    else fetchCards();
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
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <BulkUpload onComplete={() => {
              setShowUpload(false);
              fetchCards();
            }} />
          </div>
        </div>
      )}
      <aside className={styles.sidebar}>
        <div className={styles.logo}>
          ADMIN <span style={{ color: 'var(--primary)' }}>PANEL</span>
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
        {activeTab === 'inventory' ? (
          <>
            <header className={styles.contentHeader}>
              <h1>Card Inventory</h1>
              <button className={styles.addBtn} onClick={() => setShowUpload(true)}>+ Add New Cards</button>
            </header>

            <section className={styles.stats}>
              <div className="glass" style={{ padding: '1.5rem', borderRadius: '16px' }}>
                <p style={{ color: 'var(--text-muted)' }}>Total Cards</p>
                <h3 style={{ fontSize: '1.5rem' }}>{cards.length}</h3>
              </div>
              <div className="glass" style={{ padding: '1.5rem', borderRadius: '16px' }}>
                <p style={{ color: 'var(--text-muted)' }}>In Stock</p>
                <h3 style={{ fontSize: '1.5rem' }}>{cards.filter(c => c.inventory_count > 0).length}</h3>
              </div>
              <div className="glass" style={{ padding: '1.5rem', borderRadius: '16px' }}>
                <p style={{ color: 'var(--text-muted)' }}>Sold Out</p>
                <h3 style={{ fontSize: '1.5rem' }}>{cards.filter(c => c.inventory_count <= 0).length}</h3>
              </div>
            </section>

            <div className={styles.inventoryList}>
              {loadingCards ? (
                <p>Loading inventory...</p>
              ) : cards.length > 0 ? (
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Preview</th>
                      <th>Title</th>
                      <th>Group</th>
                      <th>Price</th>
                      <th>Stock</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cards.map(card => (
                      <tr key={card.id}>
                        <td>
                          <img src={card.image_url} alt="" className={styles.miniImg} />
                        </td>
                        <td>{card.title}</td>
                        <td>{card.group_name}</td>
                        <td>${card.price}</td>
                    <td>
                      <div className={styles.stockControl}>
                        <button onClick={() => handleUpdateStock(card.id, card.inventory_count - 1)}>-</button>
                        <span>{card.inventory_count}</span>
                        <button onClick={() => handleUpdateStock(card.id, card.inventory_count + 1)}>+</button>
                      </div>
                    </td>
                    <td>
                      <button className={styles.editBtn}>Edit Info</button>
                    </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className={styles.placeholder}>
                  <p>No cards in inventory yet. Click "+ Add New Cards" to start.</p>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <header className={styles.contentHeader}>
              <h1>User Wishlists</h1>
              <button className={styles.secondaryBtn} onClick={fetchWishlists}>Refresh</button>
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
                    {wishlists.map(w => (
                      <tr key={w.id}>
                        <td style={{ fontSize: '0.8rem' }}>{new Date(w.created_at).toLocaleString()}</td>
                        <td>
                          <a 
                            href={`https://instagram.com/${w.user_ig_handle.replace('@', '')}`} 
                            target="_blank" 
                            rel="noreferrer"
                            style={{ color: 'var(--primary)', fontWeight: 'bold' }}
                          >
                            {w.user_ig_handle}
                          </a>
                        </td>
                        <td>
                          <div className={styles.wishlistItemsPreview}>
                            {w.wishlist_items?.map((item: any) => (
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
                        <td>${w.total_price}</td>
                        <td>
                          <span className={styles.statusBadge}>{w.status}</span>
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
              <h1>Site Settings</h1>
            </header>

            <div className={`${styles.settingsCard} glass`}>
              <div className={styles.inputGroup}>
                <label>Site Title</label>
                <input 
                  type="text" 
                  value={settings.site_title}
                  onChange={e => setSettings({ ...settings, site_title: e.target.value })}
                  placeholder="e.g. MY K-POP SHOP"
                />
                <p className={styles.helpText}>This appears in the header and the generated wishlist image.</p>
              </div>

              <div className={styles.inputGroup}>
                <label>Official Instagram Handle</label>
                <input 
                  type="text" 
                  value={settings.official_ig_handle}
                  onChange={e => setSettings({ ...settings, official_ig_handle: e.target.value })}
                  placeholder="@your_ins_account"
                />
                <p className={styles.helpText}>Users will be instructed to DM this account with their wishlist image.</p>
              </div>

              <button 
                className={styles.addBtn} 
                onClick={handleSaveSettings}
                disabled={savingSettings}
              >
                {savingSettings ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
