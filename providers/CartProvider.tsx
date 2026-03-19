'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/providers/AuthProvider';

type CartContextValue = {
  count: number;
  loading: boolean;
  addToCart: (rentalId: string, quantity?: number) => Promise<boolean>;
  removeFromCart: (itemId: string) => Promise<void>;
  refresh: () => Promise<void>;
};

const CartContext = createContext<CartContextValue>({
  count: 0,
  loading: false,
  addToCart: async () => false,
  removeFromCart: async () => {},
  refresh: async () => {},
});

export function useCart(): CartContextValue {
  return useContext(CartContext);
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) {
      setCount(0);
      return;
    }
    try {
      const res = await fetch('/api/cart');
      if (res.ok) {
        const data = await res.json();
        setCount(data.count ?? 0);
      }
    } catch {
      // Silently fail — cart count is non-critical
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addToCart = useCallback(
    async (rentalId: string, quantity: number = 1): Promise<boolean> => {
      setLoading(true);
      try {
        const res = await fetch('/api/cart', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rental_id: rentalId, quantity }),
        });
        if (res.ok) {
          const data = await res.json();
          setCount(data.count ?? count + 1);
          return true;
        }
        return false;
      } catch {
        return false;
      } finally {
        setLoading(false);
      }
    },
    [count],
  );

  const removeFromCart = useCallback(
    async (itemId: string) => {
      try {
        const res = await fetch(`/api/cart?item_id=${itemId}`, { method: 'DELETE' });
        if (res.ok) {
          const data = await res.json();
          setCount(data.count ?? Math.max(0, count - 1));
        }
      } catch {
        // Silently fail
      }
    },
    [count],
  );

  return (
    <CartContext.Provider value={{ count, loading, addToCart, removeFromCart, refresh }}>
      {children}
    </CartContext.Provider>
  );
}
