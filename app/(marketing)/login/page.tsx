'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  // Auto-redirect if session already exists
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        router.replace('/admin');
      } else {
        setChecking(false);
      }
    });
  }, [router]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
    } else {
      router.push('/admin');
    }
  };

  // Show a minimal spinner while checking existing session
  if (checking) {
    return (
      <div className="flex items-center justify-center py-40">
        <div className="w-5 h-5 border-2 border-black/20 dark:border-white/20 border-t-black dark:border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center px-6 py-24">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="w-full max-w-sm"
      >
        {/* Header */}
        <div className="mb-10">
          <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-neutral-400 dark:text-neutral-600 mb-3">
            THABANGVISION
          </p>
          <h1 className="text-3xl font-display font-medium uppercase tracking-tight text-black dark:text-white">
            Admin Login
          </h1>
          <div className="w-8 h-px bg-black dark:bg-white mt-5" />
        </div>

        {/* Card */}
        <div className="bg-neutral-50 dark:bg-[#0A0A0B] border border-black/10 dark:border-white/10 p-8">
          <form onSubmit={handleSubmit} noValidate className="space-y-5">

            {/* Email */}
            <div>
              <label
                htmlFor="email"
                className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="admin@thabangvision.com"
                className="
                  w-full bg-white dark:bg-neutral-900
                  border border-black/10 dark:border-white/10
                  text-black dark:text-white
                  px-4 py-3 text-sm font-mono
                  placeholder:text-neutral-300 dark:placeholder:text-neutral-700
                  focus:outline-none focus:border-black dark:focus:border-white
                  transition-colors
                "
              />
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="password"
                className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="
                  w-full bg-white dark:bg-neutral-900
                  border border-black/10 dark:border-white/10
                  text-black dark:text-white
                  px-4 py-3 text-sm font-mono
                  placeholder:text-neutral-300 dark:placeholder:text-neutral-700
                  focus:outline-none focus:border-black dark:focus:border-white
                  transition-colors
                "
              />
            </div>

            {/* Error message */}
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="overflow-hidden"
              >
                <div className="bg-red-500/10 border border-red-500/30 px-4 py-3">
                  <p className="text-xs text-red-600 dark:text-red-400 font-mono leading-relaxed">
                    {error}
                  </p>
                </div>
              </motion.div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="
                w-full bg-black dark:bg-white
                text-white dark:text-black
                py-3.5
                text-[10px] font-mono font-bold uppercase tracking-widest
                hover:opacity-80 transition-opacity
                disabled:opacity-40 disabled:cursor-not-allowed
                flex items-center justify-center gap-2
              "
            >
              {loading ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/40 dark:border-black/40 border-t-white dark:border-t-black rounded-full animate-spin" />
                  Authenticating…
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        </div>

        {/* Footer note */}
        <p className="text-center text-[9px] font-mono uppercase tracking-[0.2em] text-neutral-400 dark:text-neutral-600 mt-6">
          Don&apos;t have an account?{' '}
          <Link
            href="/register"
            className="text-black dark:text-white underline underline-offset-2 hover:opacity-70 transition-opacity"
          >
            Create One
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
