'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';
import { STUDIO } from '@/lib/constants';
import { PASSWORD_RULE, newPasswordProblem } from '@/lib/auth/password-auth';

const ERROR_ID = 'reset-error';

/**
 * Set a new password from the reset email. One password field with a
 * "Show" toggle instead of a second "confirm" field (spec 9.1: no
 * unnecessary password confirmation).
 */
export default function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
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
        timeout = setTimeout(() => {
          setTokenError(true);
        }, 3000);
      }
    });

    return () => {
      subscription.unsubscribe();
      if (timeout) clearTimeout(timeout);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    const problem = newPasswordProblem(password);
    if (problem) {
      setError(problem);
      return;
    }

    setLoading(true);

    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError(updateError.message);
      setLoading(false);
    } else {
      setSuccess(true);
      setLoading(false);
    }
  };

  const primary =
    'w-full min-h-[44px] bg-[#D4A843] text-black py-3.5 text-xs font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2';

  // Waiting for the token exchange
  if (!ready && !tokenError) {
    return (
      <div className="flex items-center justify-center py-40" role="status" aria-label="Checking your reset link">
        <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center px-4 sm:px-6 py-16 sm:py-24">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="w-full max-w-sm"
      >
        {/* Header */}
        <div className="mb-10">
          <p className="text-xs font-mono uppercase tracking-[0.2em] text-neutral-400 mb-3">
            {STUDIO.shortName.toUpperCase()}
          </p>
          <h1 className="text-3xl font-display font-medium uppercase tracking-tight text-white">
            Set New Password
          </h1>
          <div className="w-8 h-px bg-[#D4A843] mt-5" />
        </div>

        {/* Card */}
        <div className="bg-[#0A0A0B] border border-white/10 p-6 sm:p-8">
          {tokenError && !ready ? (
            /* Invalid or expired token */
            <div className="space-y-5">
              <div role="alert" className="bg-red-500/10 border border-red-500/30 px-4 py-3">
                <p className="text-xs text-red-400 font-mono leading-relaxed">
                  This password reset link is invalid or has expired. Request a new one from the
                  sign-in page (Forgot password), or continue with Google.
                </p>
              </div>
              <Link href="/login" className={primary}>
                Back to Sign In
              </Link>
            </div>
          ) : success ? (
            /* Password updated successfully */
            <div className="space-y-5">
              <div role="status" className="bg-emerald-500/10 border border-emerald-500/30 px-4 py-3">
                <p className="text-xs text-emerald-400 font-mono leading-relaxed">
                  Your password has been updated.
                </p>
              </div>
              <Link href="/dashboard" className={primary}>
                Continue
              </Link>
            </div>
          ) : (
            /* Reset password form */
            <form onSubmit={handleSubmit} noValidate className="space-y-5">
              <div>
                <div className="flex items-end justify-between mb-2">
                  <label
                    htmlFor="password"
                    className="block text-xs font-bold uppercase tracking-widest text-neutral-400"
                  >
                    New Password
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-controls="password"
                    aria-pressed={showPassword}
                    className="min-h-[44px] min-w-[44px] -my-3 text-xs font-mono uppercase tracking-widest text-neutral-400 hover:text-white transition-colors"
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  minLength={STUDIO.platform.minPasswordLength}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? `${ERROR_ID} password-hint` : 'password-hint'}
                  className={`w-full bg-neutral-900 border ${error ? 'border-red-500/70' : 'border-white/10'} text-white px-4 py-3 min-h-[44px] text-base md:text-sm font-mono placeholder:text-neutral-400 focus:outline-none focus:border-[#D4A843] transition-colors`}
                />
                <p id="password-hint" className="text-xs font-mono text-neutral-400 mt-2">
                  {PASSWORD_RULE}
                </p>
              </div>

              {error && (
                <div id={ERROR_ID} role="alert" className="bg-red-500/10 border border-red-500/30 px-4 py-3">
                  <p className="text-xs text-red-400 font-mono leading-relaxed">{error}</p>
                </div>
              )}

              <button type="submit" disabled={loading} aria-busy={loading} className={primary}>
                {loading ? (
                  <>
                    <span aria-hidden="true" className="w-3.5 h-3.5 border-2 border-black/40 border-t-black rounded-full animate-spin" />
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
        <p className="text-center text-xs font-mono uppercase tracking-[0.2em] text-neutral-400 mt-6">
          Remember your password?{' '}
          <Link
            href="/login"
            className="inline-flex items-center min-h-[44px] text-white underline underline-offset-2 hover:opacity-70 transition-opacity"
          >
            Sign In
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
