'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';
import { STUDIO } from '@/lib/constants';

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [ready, setReady] = useState(false);
  const [tokenError, setTokenError] = useState(false);

  useEffect(() => {
    // Supabase includes the recovery token in the URL hash/query.
    // The @supabase/ssr client automatically picks up the token from the URL
    // and establishes a session. We verify that a recovery session exists.
    const supabase = createClient();

    supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setReady(true);
      }
    });

    // Also check if we already have a session (e.g. token was already exchanged)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setReady(true);
      } else {
        // Give the auth state change listener a moment to fire
        const timeout = setTimeout(() => {
          setTokenError(true);
        }, 3000);
        return () => clearTimeout(timeout);
      }
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (password.length < STUDIO.platform.minPasswordLength) {
      setError(
        `Password must be at least ${STUDIO.platform.minPasswordLength} characters.`,
      );
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);

    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({
      password,
    });

    if (updateError) {
      setError(updateError.message);
      setLoading(false);
    } else {
      setSuccess(true);
      setLoading(false);
    }
  };

  // Show spinner while waiting for token exchange
  if (!ready && !tokenError) {
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
            Set New Password
          </h1>
          <div className="w-8 h-px bg-black dark:bg-white mt-5" />
        </div>

        {/* Card */}
        <div className="bg-neutral-50 dark:bg-[#0A0A0B] border border-black/10 dark:border-white/10 p-8">
          {tokenError && !ready ? (
            /* Invalid or expired token */
            <div className="space-y-5">
              <div className="bg-red-500/10 border border-red-500/30 px-4 py-3">
                <p className="text-xs text-red-600 dark:text-red-400 font-mono leading-relaxed">
                  This password reset link is invalid or has expired. Please request a new one.
                </p>
              </div>
              <Link
                href="/login"
                className="w-full bg-black dark:bg-white text-white dark:text-black py-3.5 text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity flex items-center justify-center gap-2"
              >
                Back to Sign In
              </Link>
            </div>
          ) : success ? (
            /* Password updated successfully */
            <div className="space-y-5">
              <div className="bg-emerald-500/10 border border-emerald-500/30 px-4 py-3">
                <p className="text-xs text-emerald-600 dark:text-emerald-400 font-mono leading-relaxed">
                  Your password has been updated successfully.
                </p>
              </div>
              <Link
                href="/login"
                className="w-full bg-black dark:bg-white text-white dark:text-black py-3.5 text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity flex items-center justify-center gap-2"
              >
                Sign In
              </Link>
            </div>
          ) : (
            /* Reset password form */
            <form onSubmit={handleSubmit} noValidate className="space-y-5">
              {/* New Password */}
              <div>
                <label
                  htmlFor="password"
                  className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2"
                >
                  New Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  placeholder={`Min ${STUDIO.platform.minPasswordLength} characters`}
                  className="w-full bg-white dark:bg-neutral-900 border border-black/10 dark:border-white/10 text-black dark:text-white px-4 py-3 text-sm font-mono placeholder:text-neutral-300 dark:placeholder:text-neutral-700 focus:outline-none focus:border-black dark:focus:border-white transition-colors"
                />
              </div>

              {/* Confirm Password */}
              <div>
                <label
                  htmlFor="confirmPassword"
                  className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2"
                >
                  Confirm Password
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  placeholder="Repeat password"
                  className="w-full bg-white dark:bg-neutral-900 border border-black/10 dark:border-white/10 text-black dark:text-white px-4 py-3 text-sm font-mono placeholder:text-neutral-300 dark:placeholder:text-neutral-700 focus:outline-none focus:border-black dark:focus:border-white transition-colors"
                />
              </div>

              {/* Error */}
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
                    Updating...
                  </>
                ) : (
                  'Update Password'
                )}
              </button>
            </form>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-[9px] font-mono uppercase tracking-[0.2em] text-neutral-400 dark:text-neutral-600 mt-6">
          Remember your password?{' '}
          <Link
            href="/login"
            className="text-black dark:text-white underline underline-offset-2 hover:opacity-70 transition-opacity"
          >
            Sign In
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
