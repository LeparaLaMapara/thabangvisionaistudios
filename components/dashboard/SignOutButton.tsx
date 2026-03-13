'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function SignOutButton() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/');
    router.refresh();
  }

  return (
    <button
      onClick={handleSignOut}
      disabled={signingOut}
      className="block w-full text-left text-[10px] font-mono uppercase tracking-widest text-red-400 hover:text-red-300 py-2 px-3 hover:bg-red-400/5 transition-colors disabled:opacity-50"
    >
      {signingOut ? 'Signing Out...' : 'Sign Out'}
    </button>
  );
}
