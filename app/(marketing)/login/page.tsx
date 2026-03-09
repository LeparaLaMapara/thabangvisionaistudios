'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';
import { STUDIO } from '@/lib/constants';

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  // Forgot password state
  const [showForgot, setShowForgot] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);

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

  const handleResetPassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setResetLoading(true);
    setResetError(null);

    if (!resetEmail.trim()) {
      setResetError('Please enter your email address.');
      setResetLoading(false);
      return;
    }

    const supabase = createClient();
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(resetEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (resetErr) {
      setResetError(resetErr.message);
    } else {
      setResetSent(true);
    }
    setResetLoading(false);
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
            {STUDIO.shortName.toUpperCase()}
          </p>
          <h1 className="text-3xl font-display font-medium uppercase tracking-tight text-black dark:text-white">
            {showForgot ? 'Reset Password' : 'Sign In'}
          </h1>
          <div className="w-8 h-px bg-black dark:bg-white mt-5" />
        </div>

        {/* Card */}
        <div className="bg-neutral-50 dark:bg-[#0A0A0B] border border-black/10 dark:border-white/10 p-8">

          {showForgot ? (
            /* ── Forgot Password Form ── */
            resetSent ? (
              <div className="space-y-5">
                <div className="bg-emerald-500/10 border border-emerald-500/30 px-4 py-3">
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 font-mono leading-relaxed">
                    Check your email for a password reset link.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowForgot(false);
                    setResetSent(false);
                    setResetEmail('');
                    setResetError(null);
                  }}
                  className="w-full bg-black dark:bg-white text-white dark:text-black py-3.5 text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity flex items-center justify-center gap-2"
                >
                  Back to Sign In
                </button>
              </div>
            ) : (
              <form onSubmit={handleResetPassword} noValidate className="space-y-5">
                <p className="text-xs font-mono text-neutral-500 leading-relaxed">
                  Enter your email address and we&apos;ll send you a link to reset your password.
                </p>

                <div>
                  <label
                    htmlFor="resetEmail"
                    className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2"
                  >
                    Email
                  </label>
                  <input
                    id="resetEmail"
                    type="email"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    required
                    autoComplete="email"
                    placeholder={STUDIO.email}
                    className="w-full bg-white dark:bg-neutral-900 border border-black/10 dark:border-white/10 text-black dark:text-white px-4 py-3 text-sm font-mono placeholder:text-neutral-300 dark:placeholder:text-neutral-700 focus:outline-none focus:border-black dark:focus:border-white transition-colors"
                  />
                </div>

                {resetError && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="overflow-hidden"
                  >
                    <div className="bg-red-500/10 border border-red-500/30 px-4 py-3">
                      <p className="text-xs text-red-600 dark:text-red-400 font-mono leading-relaxed">
                        {resetError}
                      </p>
                    </div>
                  </motion.div>
                )}

                <button
                  type="submit"
                  disabled={resetLoading}
                  className="w-full bg-black dark:bg-white text-white dark:text-black py-3.5 text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {resetLoading ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white/40 dark:border-black/40 border-t-white dark:border-t-black rounded-full animate-spin" />
                      Sending...
                    </>
                  ) : (
                    'Send Reset Link'
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowForgot(false);
                    setResetError(null);
                  }}
                  className="w-full text-xs font-mono text-neutral-500 hover:text-black dark:hover:text-white transition-colors uppercase tracking-widest"
                >
                  Back to Sign In
                </button>
              </form>
            )
          ) : (
            /* ── Sign In Form ── */
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
                  placeholder={STUDIO.email}
                  className="w-full bg-white dark:bg-neutral-900 border border-black/10 dark:border-white/10 text-black dark:text-white px-4 py-3 text-sm font-mono placeholder:text-neutral-300 dark:placeholder:text-neutral-700 focus:outline-none focus:border-black dark:focus:border-white transition-colors"
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
                  className="w-full bg-white dark:bg-neutral-900 border border-black/10 dark:border-white/10 text-black dark:text-white px-4 py-3 text-sm font-mono placeholder:text-neutral-300 dark:placeholder:text-neutral-700 focus:outline-none focus:border-black dark:focus:border-white transition-colors"
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
                className="w-full bg-black dark:bg-white text-white dark:text-black py-3.5 text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white/40 dark:border-black/40 border-t-white dark:border-t-black rounded-full animate-spin" />
                    Authenticating...
                  </>
                ) : (
                  'Sign In'
                )}
              </button>
            </form>
          )}
        </div>

        {/* Forgot password */}
        {!showForgot && (
          <div className="text-center mt-5">
            <button
              type="button"
              onClick={() => {
                setShowForgot(true);
                setResetEmail(email);
              }}
              className="text-xs font-mono text-neutral-500 hover:text-black dark:hover:text-white underline underline-offset-2 transition-colors"
            >
              Forgot Password?
            </button>
          </div>
        )}

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
