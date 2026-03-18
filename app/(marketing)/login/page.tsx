'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';
import { STUDIO } from '@/lib/constants';

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-40">
        <div className="w-5 h-5 border-2 border-black/20 dark:border-white/20 border-t-black dark:border-t-white rounded-full animate-spin" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}

// Google "G" icon as inline SVG
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirect') || '/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [showPassword, setShowPassword] = useState(false);

  // Magic link state
  const [magicEmail, setMagicEmail] = useState('');
  const [magicLoading, setMagicLoading] = useState(false);

  // Forgot password state
  const [showForgot, setShowForgot] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        window.location.href = redirectTo;
      } else {
        setChecking(false);
      }
    });
  }, [redirectTo]);

  const handleGoogleSignIn = async () => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  };

  const handleMagicLink = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (!magicEmail.trim()) {
      setError('Please enter your email address.');
      return;
    }

    setMagicLoading(true);
    const supabase = createClient();
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: magicEmail,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (otpError) {
      if (otpError.message.toLowerCase().includes('rate limit')) {
        setError("We've already sent a sign-in link. Please check your inbox and spam folder. You can try again in 60 minutes.");
      } else {
        setError(otpError.message);
      }
    } else {
      setMessage('Check your email for a sign-in link. No password needed.');
    }
    setMagicLoading(false);
  };

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
      window.location.href = redirectTo;
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
      if (resetErr.message.toLowerCase().includes('rate limit')) {
        setResetError("We've already sent a reset link. Please check your inbox and spam folder. You can try again in 60 minutes.");
      } else {
        setResetSent(true);
      }
    } else {
      setResetSent(true);
    }
    setResetLoading(false);
  };

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
                    If this email exists, we&apos;ve sent a reset link. Check your inbox and spam folder.
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
                  <label htmlFor="resetEmail" className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2">
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
                    className="w-full bg-white dark:bg-neutral-900 border border-black/10 dark:border-white/10 text-black dark:text-white px-4 py-3 min-h-[44px] text-sm font-mono placeholder:text-neutral-300 dark:placeholder:text-neutral-700 focus:outline-none focus:border-black dark:focus:border-white transition-colors"
                  />
                </div>
                {resetError && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="overflow-hidden">
                    <div className="bg-red-500/10 border border-red-500/30 px-4 py-3">
                      <p className="text-xs text-red-600 dark:text-red-400 font-mono leading-relaxed">{resetError}</p>
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
                  onClick={() => { setShowForgot(false); setResetError(null); }}
                  className="w-full text-xs font-mono text-neutral-500 hover:text-black dark:hover:text-white transition-colors uppercase tracking-widest"
                >
                  Back to Sign In
                </button>
              </form>
            )
          ) : (
            /* ── Main Sign In ── */
            <div className="space-y-5">

              {/* Google OAuth */}
              {/* TODO: Configure Google OAuth in Supabase Dashboard → Authentication → Providers → Google.
                  Requires Google Cloud Console OAuth credentials (client ID + secret). */}
              <button
                type="button"
                onClick={handleGoogleSignIn}
                className="w-full flex items-center justify-center gap-3 bg-white border border-neutral-300 dark:border-neutral-700 text-neutral-800 py-3.5 text-xs font-mono font-medium tracking-wide hover:bg-neutral-50 transition-colors min-h-[44px]"
              >
                <GoogleIcon />
                Sign in with Google
              </button>

              {/* Magic Link */}
              <form onSubmit={handleMagicLink} noValidate className="space-y-3">
                <div>
                  <label htmlFor="magicEmail" className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2">
                    Email
                  </label>
                  <input
                    id="magicEmail"
                    type="email"
                    value={magicEmail}
                    onChange={(e) => setMagicEmail(e.target.value)}
                    autoComplete="email"
                    placeholder="you@example.com"
                    className="w-full bg-white dark:bg-neutral-900 border border-black/10 dark:border-white/10 text-black dark:text-white px-4 py-3 min-h-[44px] text-sm font-mono placeholder:text-neutral-300 dark:placeholder:text-neutral-700 focus:outline-none focus:border-black dark:focus:border-white transition-colors"
                  />
                </div>
                <button
                  type="submit"
                  disabled={magicLoading}
                  className="w-full bg-black dark:bg-white text-white dark:text-black py-3.5 text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {magicLoading ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white/40 dark:border-black/40 border-t-white dark:border-t-black rounded-full animate-spin" />
                      Sending...
                    </>
                  ) : (
                    'Send Me a Sign In Link'
                  )}
                </button>
              </form>

              {/* Success / Error messages */}
              {message && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 px-4 py-3">
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 font-mono leading-relaxed">{message}</p>
                </div>
              )}
              {error && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="overflow-hidden">
                  <div className="bg-red-500/10 border border-red-500/30 px-4 py-3">
                    <p className="text-xs text-red-600 dark:text-red-400 font-mono leading-relaxed">{error}</p>
                  </div>
                </motion.div>
              )}

              {/* Divider */}
              <div className="flex items-center gap-3 py-1">
                <div className="flex-1 h-px bg-neutral-200 dark:bg-white/10" />
                <span className="text-[9px] font-mono uppercase tracking-widest text-neutral-400 dark:text-neutral-600">
                  or sign in with password
                </span>
                <div className="flex-1 h-px bg-neutral-200 dark:bg-white/10" />
              </div>

              {/* Password form (collapsible) */}
              {!showPassword ? (
                <button
                  type="button"
                  onClick={() => setShowPassword(true)}
                  className="w-full text-xs font-mono text-neutral-500 hover:text-black dark:hover:text-white transition-colors uppercase tracking-widest py-2"
                >
                  Use Password
                </button>
              ) : (
                <form onSubmit={handleSubmit} noValidate className="space-y-4">
                  <div>
                    <label htmlFor="email" className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2">
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
                      className="w-full bg-white dark:bg-neutral-900 border border-black/10 dark:border-white/10 text-black dark:text-white px-4 py-3 min-h-[44px] text-sm font-mono placeholder:text-neutral-300 dark:placeholder:text-neutral-700 focus:outline-none focus:border-black dark:focus:border-white transition-colors"
                    />
                  </div>
                  <div>
                    <label htmlFor="password" className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2">
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
                      className="w-full bg-white dark:bg-neutral-900 border border-black/10 dark:border-white/10 text-black dark:text-white px-4 py-3 min-h-[44px] text-sm font-mono placeholder:text-neutral-300 dark:placeholder:text-neutral-700 focus:outline-none focus:border-black dark:focus:border-white transition-colors"
                    />
                  </div>
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
          )}
        </div>

        {/* Forgot password */}
        {!showForgot && (
          <div className="text-center mt-5">
            <button
              type="button"
              onClick={() => {
                setShowForgot(true);
                setResetEmail(magicEmail || email);
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
