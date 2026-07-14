'use client';

import { createContext, useContext, useState } from 'react';

import { MAX_UNITS_PER_ITEM } from '@/lib/wishlistLimits';

export type WishlistItem = {
  id: string;
  card_id: string;
  purchase_option_id: string;
  option_label: string;
  unit_price: number;
  price: number;
  title: string;
  image_url: string;
  group_name: string;
  quantity: number;
  min_quantity: number;
  max_quantity: number | null;
};

type WishlistItemInput = Omit<WishlistItem, 'quantity'>;

type WishlistContextType = {
  items: WishlistItem[];
  addToWishlist: (card: WishlistItemInput) => void;
  removeFromWishlist: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  clearWishlist: () => void;
  totalPrice: number;
};

const WishlistContext = createContext<WishlistContextType | undefined>(undefined);

export function WishlistProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<WishlistItem[]>([]);

  const clampQuantity = (item: Pick<WishlistItem, 'min_quantity' | 'max_quantity'>, quantity: number) => {
    const minQuantity = Math.max(1, Math.floor(Number(item.min_quantity) || 1));
    const normalizedMinimum = Math.min(MAX_UNITS_PER_ITEM, minQuantity);

    const maxQuantity = item.max_quantity == null
      ? null
      : Math.max(minQuantity, Math.floor(Number(item.max_quantity) || minQuantity));
    
    const optionMaximum = maxQuantity == null ? MAX_UNITS_PER_ITEM : maxQuantity;
    
    const effectiveMaximum = Math.max(
      normalizedMinimum,
      Math.min(MAX_UNITS_PER_ITEM, optionMaximum)
    );

    const requestedQuantity = Number.isFinite(Number(quantity)) ? Math.floor(quantity) : normalizedMinimum;
    
    return Math.max(
      normalizedMinimum,
      Math.min(effectiveMaximum, requestedQuantity)
    );
  };

  const addToWishlist = (card: WishlistItemInput) => {
    setItems(prev => {
      const existing = prev.find(item => item.id === card.id);
      if (existing) {
        return prev.map(item => item.id === card.id
          ? { ...item, quantity: clampQuantity(item, item.quantity + 1) }
          : item);
      }

      const unitPrice = Number.isFinite(Number(card.unit_price)) ? Number(card.unit_price) : 0;
      const normalizedItem = {
        ...card,
        unit_price: unitPrice,
        price: unitPrice,
      };

      return [...prev, {
        ...normalizedItem,
        quantity: clampQuantity(normalizedItem, normalizedItem.min_quantity),
      }];
    });
  };

  const removeFromWishlist = (id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
  };

  const updateQuantity = (id: string, quantity: number) => {
    setItems(prev => prev.map(item => item.id === id
      ? { ...item, quantity: clampQuantity(item, quantity) }
      : item));
  };

  const clearWishlist = () => setItems([]);

  const totalPrice = items.reduce((sum, item) => sum + Number(item.unit_price) * item.quantity, 0);

  return (
    <WishlistContext.Provider value={{ items, addToWishlist, removeFromWishlist, updateQuantity, clearWishlist, totalPrice }}>
      {children}
    </WishlistContext.Provider>
  );
}

export function useWishlist() {
  const context = useContext(WishlistContext);
  if (!context) throw new Error('useWishlist must be used within WishlistProvider');
  return context;
}
