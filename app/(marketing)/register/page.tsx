'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';
import { STUDIO } from '@/lib/constants';

export default function RegisterPage() {
  const router = useRouter();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        router.replace('/dashboard');
      } else {
        setChecking(false);
      }
    });
  }, [router]);

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

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    // Create profile row
    if (data.user) {
      const { error: profileError } = await supabase.from('profiles').insert({
        id: data.user.id,
        display_name: displayName.trim() || null,
      });

      if (profileError) {
        console.error('[register] profile insert failed:', profileError.message);
      }
    }

    router.push('/dashboard');
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
            Create Account
          </h1>
          <div className="w-8 h-px bg-black dark:bg-white mt-5" />
        </div>

        {/* Card */}
        <div className="bg-neutral-50 dark:bg-[#0A0A0B] border border-black/10 dark:border-white/10 p-8">
          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            {/* Display Name */}
            <div>
              <label
                htmlFor="displayName"
                className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2"
              >
                Display Name
              </label>
              <input
                id="displayName"
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                autoComplete="name"
                placeholder="Your name"
                className="w-full bg-white dark:bg-neutral-900 border border-black/10 dark:border-white/10 text-black dark:text-white px-4 py-3 min-h-[44px] text-sm font-mono placeholder:text-neutral-300 dark:placeholder:text-neutral-700 focus:outline-none focus:border-black dark:focus:border-white transition-colors"
              />
            </div>

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
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@example.com"
                className="w-full bg-white dark:bg-neutral-900 border border-black/10 dark:border-white/10 text-black dark:text-white px-4 py-3 min-h-[44px] text-sm font-mono placeholder:text-neutral-300 dark:placeholder:text-neutral-700 focus:outline-none focus:border-black dark:focus:border-white transition-colors"
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
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="new-password"
                placeholder={`Min ${STUDIO.platform.minPasswordLength} characters`}
                className="w-full bg-white dark:bg-neutral-900 border border-black/10 dark:border-white/10 text-black dark:text-white px-4 py-3 min-h-[44px] text-sm font-mono placeholder:text-neutral-300 dark:placeholder:text-neutral-700 focus:outline-none focus:border-black dark:focus:border-white transition-colors"
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
                onChange={e => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                placeholder="Repeat password"
                className="w-full bg-white dark:bg-neutral-900 border border-black/10 dark:border-white/10 text-black dark:text-white px-4 py-3 min-h-[44px] text-sm font-mono placeholder:text-neutral-300 dark:placeholder:text-neutral-700 focus:outline-none focus:border-black dark:focus:border-white transition-colors"
              />
            </div>

            {/* Terms checkbox */}
            <div>
              <label className="flex items-start gap-3 cursor-pointer group min-h-[44px] py-2">
                <input
                  type="checkbox"
                  checked={agreedToTerms}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                  className="mt-0.5 w-5 h-5 min-w-[20px] border border-black/20 dark:border-white/20 bg-white dark:bg-neutral-900 accent-black dark:accent-white cursor-pointer"
                />
                <span className="text-xs font-mono text-neutral-500 leading-relaxed">
                  I agree to the{' '}
                  <Link
                    href="/legal"
                    className="text-black dark:text-white underline underline-offset-2 hover:opacity-70 transition-opacity"
                  >
                    Terms of Service
                  </Link>{' '}
                  and{' '}
                  <Link
                    href="/privacy"
                    className="text-black dark:text-white underline underline-offset-2 hover:opacity-70 transition-opacity"
                  >
                    Privacy Policy
                  </Link>
                </span>
              </label>
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
                  Creating Account...
                </>
              ) : (
                'Create Account'
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-[9px] font-mono uppercase tracking-[0.2em] text-neutral-400 dark:text-neutral-600 mt-6">
          Already have an account?{' '}
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
