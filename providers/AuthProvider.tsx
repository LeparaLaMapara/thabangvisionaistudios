'use client';

import { createContext, useContext, useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
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

export function AuthProvider({
  initialUser,
  children,
}: {
  initialUser: SerializedUser;
  children: React.ReactNode;
}) {
  const [user, setUser] = useState<User | null>(initialUser as User | null);
  const [loading, setLoading] = useState(false);

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

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {children}
    </AuthContext.Provider>
  );
}
