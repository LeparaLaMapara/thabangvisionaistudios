'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ShoppingCart, LogIn, Check, Info } from 'lucide-react';
import { useAuth } from '@/providers/AuthProvider';
import { useCart } from '@/providers/CartProvider';
import type { SmartRental } from '@/lib/supabase/queries/smartRentals';

interface Props {
  rental: SmartRental;
}

export function BookingWidget({ rental }: Props) {
  const pathname = usePathname();
  const { user, loading: authLoading } = useAuth();
  const { addToCart, loading: cartLoading } = useCart();
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLoggedIn = !!user;

  const handleAddToCart = async () => {
    setError(null);
    const ok = await addToCart(rental.id);
    if (ok) {
      setAdded(true);
    } else {
      setError('Failed to add to cart. It may be full or unavailable.');
    }
  };

  if (!rental.is_available) {
    return (
      <div className="border border-dashed border-white/10 p-6 text-center">
        <p className="text-sm text-neutral-500 font-mono">
          This item is currently unavailable.
        </p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-4"
    >
      {/* Pricing info */}
      <div className="border border-white/10 p-4 space-y-2 bg-[#0A0A0B]">
        <div className="flex justify-between text-sm">
          <span className="text-neutral-500 font-mono">Daily rate</span>
          <span className="font-mono font-bold text-white">
            {rental.currency} {(rental.price_per_day ?? 0).toLocaleString()}/day
          </span>
        </div>
        {rental.price_per_week && (
          <div className="flex justify-between text-sm">
            <span className="text-neutral-500 font-mono">Weekly rate</span>
            <span className="font-mono font-bold text-white">
              {rental.currency} {rental.price_per_week.toLocaleString()}/week
            </span>
          </div>
        )}
        {(rental.deposit_amount ?? 0) > 0 && (
          <div className="flex justify-between text-sm border-t border-white/5 pt-2">
            <span className="text-neutral-500 font-mono">Refundable deposit</span>
            <span className="font-mono text-neutral-400">
              {rental.currency} {(rental.deposit_amount ?? 0).toLocaleString()}
            </span>
          </div>
        )}
      </div>

      {error && (
        <p className="text-[10px] font-mono text-red-400">{error}</p>
      )}

      {/* Add to Cart / Sign In */}
      {authLoading ? (
        <div className="h-12" />
      ) : !isLoggedIn ? (
        <div className="space-y-3">
          <Link
            href={`/login?redirect=${encodeURIComponent(pathname)}`}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-white text-black text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-all"
          >
            <LogIn className="w-4 h-4" />
            Sign In to Rent
          </Link>
          <p className="text-[9px] font-mono text-neutral-500 text-center">
            Sign in to add equipment to your cart
          </p>
        </div>
      ) : added ? (
        <div className="space-y-3">
          <div className="w-full flex items-center justify-center gap-2 px-6 py-3 border border-emerald-500/30 text-emerald-400 text-[10px] font-mono font-bold uppercase tracking-widest">
            <Check className="w-4 h-4" />
            Added to Cart
          </div>
          <Link
            href="/dashboard/cart"
            className="w-full flex items-center justify-center gap-2 px-6 py-2.5 bg-[#D4A843] text-black text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-all"
          >
            <ShoppingCart className="w-3.5 h-3.5" />
            View Cart
          </Link>
        </div>
      ) : (
        <button
          onClick={handleAddToCart}
          disabled={cartLoading}
          className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-white text-black text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-80 disabled:opacity-50 transition-all"
        >
          <ShoppingCart className="w-4 h-4" />
          {cartLoading ? 'Adding...' : 'Add to Cart'}
        </button>
      )}

      {/* Info line */}
      <div className="flex items-start gap-2 text-[9px] font-mono text-neutral-600">
        <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
        <span>
          Select rental dates and complete payment from your cart.
          Bulk discounts apply when renting 3+ items.
        </span>
      </div>
    </motion.div>
  );
}
