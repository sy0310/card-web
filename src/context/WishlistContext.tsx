'use client';

import { createContext, useContext, useState, useEffect } from 'react';

type Card = {
  id: string;
  title: string;
  price: number;
  image_url: string;
  group_name: string;
};

type WishlistContextType = {
  items: Card[];
  addToWishlist: (card: Card) => void;
  removeFromWishlist: (id: string) => void;
  clearWishlist: () => void;
  totalPrice: number;
};

const WishlistContext = createContext<WishlistContextType | undefined>(undefined);

export function WishlistProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Card[]>([]);

  const addToWishlist = (card: Card) => {
    if (!items.find(item => item.id === card.id)) {
      setItems([...items, card]);
    }
  };

  const removeFromWishlist = (id: string) => {
    setItems(items.filter(item => item.id !== id));
  };

  const clearWishlist = () => setItems([]);

  const totalPrice = items.reduce((sum, item) => sum + Number(item.price), 0);

  return (
    <WishlistContext.Provider value={{ items, addToWishlist, removeFromWishlist, clearWishlist, totalPrice }}>
      {children}
    </WishlistContext.Provider>
  );
}

export function useWishlist() {
  const context = useContext(WishlistContext);
  if (!context) throw new Error('useWishlist must be used within WishlistProvider');
  return context;
}
