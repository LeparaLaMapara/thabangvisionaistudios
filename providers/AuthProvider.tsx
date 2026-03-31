'use client';

import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { STUDIO } from '@/lib/constants';
import type { User } from '@supabase/supabase-js';

type AuthContextValue = {
  user: User | null;
  loading: boolean;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

type SerializedUser = {
  id: string;
  email?: string;
  [key: string]: unknown;
} | null;

const IDLE_TIMEOUT_MS = STUDIO.session.idleTimeoutMinutes * 60 * 1000;
const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = ['mousedown', 'keydown', 'touchstart', 'scroll'];

export function AuthProvider({
  initialUser,
  children,
}: {
  initialUser: SerializedUser;
  children: React.ReactNode;
}) {
  const [user, setUser] = useState<User | null>(initialUser as User | null);
  const [loading, setLoading] = useState(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const signOut = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setUser(null);
    window.location.href = '/login?reason=idle';
  }, []);

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(signOut, IDLE_TIMEOUT_MS);
  }, [signOut]);

  // Auth state listener
  useEffect(() => {
    const supabase = createClient();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Idle timeout — only when user is signed in
  useEffect(() => {
    if (!user) {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      return;
    }

    // Start the timer
    resetIdleTimer();

    // Reset on user activity
    const handler = () => resetIdleTimer();
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, handler, { passive: true });
    }

    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, handler);
      }
    };
  }, [user, resetIdleTimer]);

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {children}
    </AuthContext.Provider>
  );
}
