'use client';

import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

export function LogoutButton() {
  const [loading, setLoading] = useState(false);

  const handleSignOut = async () => {
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  return (
    <button
      onClick={handleSignOut}
      disabled={loading}
      className="
        flex items-center gap-2
        px-3 py-1.5
        text-[9px] font-mono font-bold uppercase tracking-widest
        text-neutral-400 hover:text-white
        border border-white/10 hover:border-white/30
        transition-all disabled:opacity-40 disabled:cursor-not-allowed
      "
    >
      {loading ? (
        <span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />
      ) : (
        <LogOut className="w-3 h-3" />
      )}
      Sign Out
    </button>
  );
}
