'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';
import { STUDIO } from '@/lib/constants';

// Google "G" icon
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

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [magicLoading, setMagicLoading] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        window.location.href = '/dashboard';
      } else {
        setChecking(false);
      }
    });
  }, []);

  const handleGoogleSignIn = async () => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  };

  const handleMagicLink = async () => {
    setError(null);
    setMessage(null);

    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }

    setMagicLoading(true);
    const supabase = createClient();
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
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
    setError(null);

    if (!agreedToTerms) {
      setError('You must agree to the Terms of Service and Privacy Policy.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (password.length < STUDIO.platform.minPasswordLength) {
      setError(`Password must be at least ${STUDIO.platform.minPasswordLength} characters.`);
      return;
    }

    setLoading(true);

    const supabase = createClient();
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    window.location.href = '/dashboard';
  };

  if (checking) {
    return (
      <div className="flex items-center justify-center py-40">
        <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
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
          <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-neutral-600 mb-3">
            {STUDIO.shortName.toUpperCase()}
          </p>
          <h1 className="text-3xl font-display font-medium uppercase tracking-tight text-white">
            Create Account
          </h1>
          <div className="w-8 h-px bg-[#D4A843] mt-5" />
        </div>

        {/* Card */}
        <div className="bg-[#0A0A0B] border border-white/10 p-8">
          <div className="space-y-5">

            {/* Google OAuth */}
            <button
              type="button"
              onClick={handleGoogleSignIn}
              className="w-full flex items-center justify-center gap-3 bg-white border border-neutral-700 text-neutral-800 py-3.5 text-xs font-mono font-medium tracking-wide hover:bg-neutral-50 transition-colors min-h-[44px]"
            >
              <GoogleIcon />
              Sign up with Google
            </button>

            {/* Divider */}
            <div className="flex items-center gap-3 py-1">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-[9px] font-mono uppercase tracking-widest text-neutral-600">
                or
              </span>
              <div className="flex-1 h-px bg-white/10" />
            </div>

            {/* Email + Password form */}
            <form onSubmit={handleSubmit} noValidate className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  className="w-full bg-neutral-900 border border-white/10 text-white px-4 py-3 min-h-[44px] text-sm font-mono placeholder:text-neutral-700 focus:outline-none focus:border-[#D4A843] transition-colors"
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
                  onChange={e => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  placeholder={`Min ${STUDIO.platform.minPasswordLength} characters`}
                  className="w-full bg-neutral-900 border border-white/10 text-white px-4 py-3 min-h-[44px] text-sm font-mono placeholder:text-neutral-700 focus:outline-none focus:border-[#D4A843] transition-colors"
                />
              </div>
              <div>
                <label htmlFor="confirmPassword" className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2">
                  Confirm Password
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  placeholder="Repeat password"
                  className="w-full bg-neutral-900 border border-white/10 text-white px-4 py-3 min-h-[44px] text-sm font-mono placeholder:text-neutral-700 focus:outline-none focus:border-[#D4A843] transition-colors"
                />
              </div>
              <div>
                <label className="flex items-start gap-3 cursor-pointer group min-h-[44px] py-2">
                  <input
                    type="checkbox"
                    checked={agreedToTerms}
                    onChange={(e) => setAgreedToTerms(e.target.checked)}
                    className="mt-0.5 w-5 h-5 min-w-[20px] border border-white/20 bg-neutral-900 accent-[#D4A843] cursor-pointer"
                  />
                  <span className="text-xs font-mono text-neutral-500 leading-relaxed">
                    I agree to the{' '}
                    <Link href="/legal" className="text-white underline underline-offset-2 hover:opacity-70 transition-opacity">
                      Terms of Service
                    </Link>{' '}
                    and{' '}
                    <Link href="/privacy" className="text-white underline underline-offset-2 hover:opacity-70 transition-opacity">
                      Privacy Policy
                    </Link>
                  </span>
                </label>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-[#D4A843] text-black py-3.5 text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-black/40 border-t-black rounded-full animate-spin" />
                    Creating Account...
                  </>
                ) : (
                  'Create Account'
                )}
              </button>
            </form>

            {/* Magic link alternative */}
            <button
              type="button"
              onClick={handleMagicLink}
              disabled={magicLoading}
              className="w-full text-xs font-mono text-neutral-500 hover:text-white transition-colors uppercase tracking-widest py-2 disabled:opacity-40"
            >
              {magicLoading ? 'Sending Link...' : 'Send Me a Sign-In Link Instead'}
            </button>

            {/* Success / Error messages */}
            {message && (
              <div className="bg-emerald-500/10 border border-emerald-500/30 px-4 py-3">
                <p className="text-xs text-emerald-400 font-mono leading-relaxed">{message}</p>
              </div>
            )}
            {error && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="overflow-hidden">
                <div className="bg-red-500/10 border border-red-500/30 px-4 py-3">
                  <p className="text-xs text-red-400 font-mono leading-relaxed">{error}</p>
                </div>
              </motion.div>
            )}
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-[9px] font-mono uppercase tracking-[0.2em] text-neutral-600 mt-6">
          Already have an account?{' '}
          <Link
            href="/login"
            className="text-white underline underline-offset-2 hover:opacity-70 transition-opacity"
          >
            Sign In
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
