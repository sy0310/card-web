'use client';

import { createContext, useContext, useState } from 'react';

export type WishlistItem = {
  id: string;
  title: string;
  price: number;
  image_url: string;
  group_name: string;
  quantity: number;
};

type WishlistContextType = {
  items: WishlistItem[];
  addToWishlist: (card: Omit<WishlistItem, 'quantity'>) => void;
  removeFromWishlist: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  clearWishlist: () => void;
  totalPrice: number;
};

const WishlistContext = createContext<WishlistContextType | undefined>(undefined);

export function WishlistProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<WishlistItem[]>([]);

  const addToWishlist = (card: Omit<WishlistItem, 'quantity'>) => {
    setItems(prev => {
      const existing = prev.find(item => item.id === card.id);
      if (existing) {
        return prev.map(item => item.id === card.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { ...card, quantity: 1 }];
    });
  };

  const removeFromWishlist = (id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
  };

  const updateQuantity = (id: string, quantity: number) => {
    const validQty = Math.max(1, Math.floor(quantity));
    setItems(prev => prev.map(item => item.id === id ? { ...item, quantity: validQty } : item));
  };

  const clearWishlist = () => setItems([]);

  const totalPrice = items.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0);

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
