'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';
import { STUDIO } from '@/lib/constants';
import { authCallbackUrl, bannedMessage, signInErrorMessage } from '@/lib/auth/redirect';
import { readNextParam } from '@/lib/auth/next-path';
import { destinationAfterSignIn } from '@/components/auth/afterSignIn';
import { GoogleIcon } from '@/components/auth/GoogleIcon';
import { GoogleSignInButton, type GoogleSignInError } from '@/components/auth/GoogleSignInButton';
import { TermsNotice } from '@/components/auth/TermsNotice';

/**
 * One screen for signing in and creating an account (spec 9.1):
 * "Continue with Google" or "Continue with email". The email path is
 * passwordless: Supabase sends one email that works both as a link and as a
 * code typed here (so it works across devices and in in-app mail browsers).
 * Password sign-in stays available, one tap away, for existing password users.
 *
 * Nothing on this page records consent. Anyone whose acceptance of the
 * current Terms and Privacy Policy is not on record is sent to /welcome
 * after signing in, which records it with one explicit tap.
 */
export default function LoginPage() {
  return (
    // The fallback holds a full screen of space, so the footer does not jump
    // up and then down again while the form loads.
    <Suspense fallback={<div className="min-h-screen" aria-hidden="true" />}>
      <LoginForm />
    </Suspense>
  );
}

type Step = 'email' | 'code' | 'forgot';
type Field = 'email' | 'password' | 'code' | 'resetEmail' | null;
type Busy = null | 'google' | 'email' | 'password' | 'code' | 'resend' | 'reset' | 'leaving';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Supabase email codes are digits only; the length is a project setting (6 by default). */
const CODE_RE = /^\d{6,10}$/;
const ERROR_ID = 'login-error';

const inputClass = (invalid: boolean): string =>
  `w-full bg-neutral-900 border ${invalid ? 'border-red-500/70' : 'border-white/10'} text-white px-4 py-3 min-h-[44px] text-base md:text-sm font-mono placeholder:text-neutral-400 focus:outline-none focus:border-[#D4A843] transition-colors`;
const primaryButton =
  'w-full min-h-[44px] bg-[#D4A843] text-black py-3.5 text-xs font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2';
const quietButton =
  'w-full min-h-[44px] text-xs font-mono text-neutral-400 hover:text-white transition-colors uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed';
const labelClass = 'block text-xs font-bold uppercase tracking-widest text-neutral-400 mb-2';

function Spinner({ dark = false }: { dark?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`w-3.5 h-3.5 border-2 rounded-full animate-spin ${dark ? 'border-black/40 border-t-black' : 'border-white/30 border-t-white'}`}
    />
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  // Where they were going (?next=, or the older ?redirect=), never off the site.
  const next = readNextParam(searchParams);
  const isSignup = searchParams.get('mode') === 'signup';
  const reason = searchParams.get('reason');

  const [step, setStep] = useState<Step>('email');
  const [usePassword, setUsePassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);
  // A failed Google or email-link sign-in comes back as ?error=auth.
  const [error, setError] = useState<{ text: string; field: Field } | null>(() => {
    const text = signInErrorMessage(searchParams.get('error'));
    return text ? { text, field: null } : null;
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Already signed in? Move on, without holding the form behind a spinner.
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user || cancelled) return;
      const destination = await destinationAfterSignIn(user, next);
      if (!cancelled) window.location.replace(destination);
    }).catch(() => { /* not signed in: stay on the form */ });
    return () => { cancelled = true; };
  }, [next]);

  // Coming Back from Google (or after leaving to another page), the browser
  // may restore this page from its back/forward cache with every button still
  // disabled. Re-enable them.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent): void => {
      if (e.persisted) setBusy(null);
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  // Move focus to the new heading when the step changes, so screen readers
  // announce where they are.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    headingRef.current?.focus();
  }, [step]);

  const fail = (text: string, field: Field = null): void => {
    setError({ text, field });
    setBusy(null);
  };
  const clearMessages = (): void => {
    setError(null);
    setNotice(null);
  };
  const invalid = (field: Field): boolean => error?.field === field;
  const describedBy = (field: Field): string | undefined => (invalid(field) ? ERROR_ID : undefined);

  const finish = async (user: Parameters<typeof destinationAfterSignIn>[0]): Promise<void> => {
    setBusy('leaving');
    window.location.assign(await destinationAfterSignIn(user, next));
  };

  const handleGoogle = async (): Promise<void> => {
    clearMessages();
    setBusy('google');
    const supabase = createClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: authCallbackUrl(window.location.origin, next) },
    });
    if (oauthError) fail('Could not open Google sign-in. Please try again, or continue with your email.');
  };

  /** Google's own button signed in on this page (no trip through supabase.co). */
  const googleFailed = (err: GoogleSignInError): void => {
    setBusy(null);
    const banned = bannedMessage(err, STUDIO.email);
    fail(banned ?? 'Google sign-in did not finish. Please try again, or continue with your email.');
  };

  /**
   * Send the sign-in email (link + code). The same answer is shown whether or
   * not an account exists for the address: a new address gets an account.
   * Supabase rate-limits these sends per address and per project.
   */
  const sendEmail = async (kind: 'email' | 'resend'): Promise<void> => {
    clearMessages();
    const address = email.trim();
    if (!EMAIL_RE.test(address)) {
      fail('Please enter a valid email address.', 'email');
      if (kind === 'resend') setStep('email');
      return;
    }
    setBusy(kind);
    const supabase = createClient();
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: address,
      options: { emailRedirectTo: authCallbackUrl(window.location.origin, next) },
    });
    if (otpError) {
      const banned = bannedMessage(otpError, STUDIO.email);
      if (banned) return fail(banned, 'email');
      const tooSoon =
        otpError.status === 429 ||
        otpError.code === 'over_email_send_rate_limit' ||
        /rate limit|security purposes/i.test(otpError.message);
      if (tooSoon) {
        fail("We've just sent you an email. Check your inbox and spam folder, or wait a minute and try again.");
      } else if (otpError.code === 'email_address_invalid' || /invalid/i.test(otpError.message)) {
        fail('Please enter a valid email address.', 'email');
        if (kind === 'resend') setStep('email');
      } else {
        fail("We couldn't send the email just now. Please try again, or continue with Google.");
      }
      return;
    }
    setBusy(null);
    setCode('');
    setStep('code');
    if (kind === 'resend') setNotice('We sent you a new email. Use the newest code or link.');
  };

  const handlePassword = async (): Promise<void> => {
    clearMessages();
    const address = email.trim();
    if (!EMAIL_RE.test(address)) return fail('Please enter a valid email address.', 'email');
    if (!password) return fail('Please enter your password.', 'password');
    setBusy('password');
    const supabase = createClient();
    const { data, error: authError } = await supabase.auth.signInWithPassword({ email: address, password });
    if (authError || !data.user) {
      return fail(bannedMessage(authError, STUDIO.email) ?? authError?.message ?? 'Sign-in failed. Please try again.', 'password');
    }
    await finish(data.user);
  };

  const handleEmailForm = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (busy) return;
    if (usePassword) void handlePassword();
    else void sendEmail('email');
  };

  const handleCode = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    clearMessages();
    const token = code.replace(/\s+/g, '');
    if (!CODE_RE.test(token)) return fail('Enter the code from the email (numbers only).', 'code');
    setBusy('code');
    const supabase = createClient();
    const { data, error: verifyError } = await supabase.auth.verifyOtp({ email: email.trim(), token, type: 'email' });
    if (verifyError || !data.user) {
      const banned = bannedMessage(verifyError, STUDIO.email);
      if (banned) return fail(banned, 'code');
      return fail(
        "That code didn't work. It may have expired, or a newer email may have replaced it. Check your latest email, or send a new one.",
        'code',
      );
    }
    await finish(data.user);
  };

  const handleReset = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    clearMessages();
    const address = resetEmail.trim();
    if (!EMAIL_RE.test(address)) return fail('Please enter your email address.', 'resetEmail');
    setBusy('reset');
    const supabase = createClient();
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(address, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    // Same answer whether or not the address has an account.
    if (resetErr && /rate limit|security purposes/i.test(resetErr.message)) {
      return fail("We've already sent a reset link. Please check your inbox and spam folder, or try again later.");
    }
    setBusy(null);
    setResetSent(true);
  };

  const goTo = (target: Step): void => {
    clearMessages();
    setBusy(null);
    setStep(target);
  };

  const heading =
    step === 'code' ? 'Check your email'
      : step === 'forgot' ? 'Reset password'
        : isSignup ? 'Create your account'
          : 'Sign in or create an account';

  const errorBox = error && (
    <div id={ERROR_ID} role="alert" className="bg-red-500/10 border border-red-500/30 px-4 py-3">
      <p className="text-xs text-red-400 font-mono leading-relaxed">{error.text}</p>
    </div>
  );
  const noticeBox = notice && (
    <div role="status" className="bg-emerald-500/10 border border-emerald-500/30 px-4 py-3">
      <p className="text-xs text-emerald-400 font-mono leading-relaxed">{notice}</p>
    </div>
  );

  return (
    <div className="flex items-center justify-center px-4 sm:px-6 py-16 sm:py-24">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="w-full max-w-sm"
      >
        {/* Header */}
        <div className="mb-8">
          <p className="text-xs font-mono uppercase tracking-[0.2em] text-neutral-400 mb-3">
            {STUDIO.shortName.toUpperCase()}
          </p>
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-3xl font-display font-medium uppercase tracking-tight text-white focus:outline-none"
          >
            {heading}
          </h1>
          <div className="w-8 h-px bg-[#D4A843] mt-5" />
          {step === 'email' && (
            <p className="text-xs font-mono text-neutral-400 leading-relaxed mt-5">
              No password needed. New here? We&apos;ll create your account as you continue.
            </p>
          )}
        </div>

        {/* Sent here from a booking: say what the sign-in is for */}
        {reason === 'book' && step === 'email' && (
          <div className="bg-[#D4A843]/10 border border-[#D4A843]/30 px-4 py-3 mb-6">
            <p className="text-xs text-[#D4A843] font-mono leading-relaxed">
              Sign in to send your request. New here? Continue below and we&apos;ll set up your free account.
            </p>
          </div>
        )}

        {/* Idle logout notice */}
        {reason === 'idle' && step === 'email' && (
          <div className="bg-amber-500/10 border border-amber-500/30 px-4 py-3 mb-6">
            <p className="text-xs text-amber-400 font-mono leading-relaxed">
              You were signed out due to inactivity. Please sign in again.
            </p>
          </div>
        )}

        <div className="bg-[#0A0A0B] border border-white/10 p-6 sm:p-8">
          {step === 'email' && (
            <div className="space-y-5">
              <GoogleSignInButton
                onBusy={() => { clearMessages(); setBusy('google'); }}
                onSignedIn={(user) => void finish(user)}
                onError={googleFailed}
                fallback={
                <button
                  type="button"
                  onClick={handleGoogle}
                  disabled={busy !== null}
                  aria-busy={busy === 'google'}
                  className="w-full min-h-[44px] flex items-center justify-center gap-3 bg-[#131314] border border-[#8E918F] text-[#E3E3E3] py-3.5 text-sm font-medium hover:border-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {busy === 'google' ? <Spinner /> : <GoogleIcon />}
                  Continue with Google
                </button>
                }
              />

              <div className="flex items-center gap-3 py-1" aria-hidden="true">
                <div className="flex-1 h-px bg-white/10" />
                <span className="text-xs font-mono uppercase tracking-widest text-neutral-400">or</span>
                <div className="flex-1 h-px bg-white/10" />
              </div>

              <form onSubmit={handleEmailForm} noValidate className="space-y-4">
                <div>
                  <label htmlFor="email" className={labelClass}>Email</label>
                  <input
                    id="email"
                    type="email"
                    inputMode="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="you@example.com"
                    aria-invalid={invalid('email') || undefined}
                    aria-describedby={describedBy('email')}
                    className={inputClass(invalid('email'))}
                  />
                </div>

                {usePassword && (
                  <div>
                    <label htmlFor="password" className={labelClass}>Password</label>
                    <input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                      aria-invalid={invalid('password') || undefined}
                      aria-describedby={describedBy('password')}
                      className={inputClass(invalid('password'))}
                    />
                  </div>
                )}

                <button
                  type="submit"
                  disabled={busy !== null}
                  aria-busy={busy === 'email' || busy === 'password' || busy === 'leaving'}
                  className={primaryButton}
                >
                  {busy === 'email' ? (<><Spinner dark />Sending email...</>)
                    : busy === 'password' || busy === 'leaving' ? (<><Spinner dark />Signing in...</>)
                      : usePassword ? 'Sign In' : 'Continue with email'}
                </button>
              </form>

              {errorBox}

              <button
                type="button"
                onClick={() => { clearMessages(); setPassword(''); setUsePassword((v) => !v); }}
                disabled={busy !== null}
                className={quietButton}
              >
                {usePassword ? 'Email me a sign-in code instead' : 'Use a password instead'}
              </button>

              {usePassword && (
                <button
                  type="button"
                  onClick={() => { setResetEmail(email); setResetSent(false); goTo('forgot'); }}
                  disabled={busy !== null}
                  className={`${quietButton} underline underline-offset-2 normal-case tracking-normal`}
                >
                  Forgot password?
                </button>
              )}

              <TermsNotice className="pt-1 border-t border-white/10" />
            </div>
          )}

          {step === 'code' && (
            <div className="space-y-5">
              <p className="text-xs font-mono text-neutral-300 leading-relaxed">
                We sent an email to <span className="text-white break-all">{email.trim()}</span>. Tap the link in
                it, or enter the code from it here.
              </p>

              <form onSubmit={handleCode} noValidate className="space-y-4">
                <div>
                  <label htmlFor="code" className={labelClass}>Code from the email</label>
                  <input
                    id="code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]*"
                    maxLength={10}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/[^\d\s]/g, ''))}
                    required
                    autoFocus
                    aria-invalid={invalid('code') || undefined}
                    aria-describedby={invalid('code') ? `${ERROR_ID} code-hint` : 'code-hint'}
                    className={`${inputClass(invalid('code'))} tracking-[0.4em]`}
                  />
                  <p id="code-hint" className="text-xs font-mono text-neutral-400 mt-2 leading-relaxed">
                    It can take a minute to arrive. Check your spam folder too.
                  </p>
                </div>
                <button
                  type="submit"
                  disabled={busy !== null}
                  aria-busy={busy === 'code' || busy === 'leaving'}
                  className={primaryButton}
                >
                  {busy === 'code' || busy === 'leaving' ? (<><Spinner dark />Signing in...</>) : 'Continue'}
                </button>
              </form>

              {errorBox}
              {noticeBox}

              <button
                type="button"
                onClick={() => void sendEmail('resend')}
                disabled={busy !== null}
                aria-busy={busy === 'resend'}
                className={quietButton}
              >
                {busy === 'resend' ? 'Sending...' : 'Send a new email'}
              </button>
              <button
                type="button"
                onClick={() => { setCode(''); goTo('email'); }}
                disabled={busy === 'code' || busy === 'leaving'}
                className={quietButton}
              >
                Use a different email
              </button>
            </div>
          )}

          {step === 'forgot' && (
            resetSent ? (
              <div className="space-y-5">
                <div role="status" className="bg-emerald-500/10 border border-emerald-500/30 px-4 py-3">
                  <p className="text-xs text-emerald-400 font-mono leading-relaxed">
                    If this email has a password, we&apos;ve sent a reset link. Check your inbox and spam folder.
                  </p>
                </div>
                <button type="button" onClick={() => goTo('email')} className={primaryButton}>
                  Back to Sign In
                </button>
              </div>
            ) : (
              <form onSubmit={handleReset} noValidate className="space-y-5">
                <p className="text-xs font-mono text-neutral-400 leading-relaxed">
                  Enter your email and we&apos;ll send you a link to set a new password. You can also skip
                  passwords and sign in with an email code.
                </p>
                <div>
                  <label htmlFor="resetEmail" className={labelClass}>Email</label>
                  <input
                    id="resetEmail"
                    type="email"
                    inputMode="email"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    required
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="you@example.com"
                    aria-invalid={invalid('resetEmail') || undefined}
                    aria-describedby={describedBy('resetEmail')}
                    className={inputClass(invalid('resetEmail'))}
                  />
                </div>
                {errorBox}
                <button type="submit" disabled={busy !== null} aria-busy={busy === 'reset'} className={primaryButton}>
                  {busy === 'reset' ? (<><Spinner dark />Sending...</>) : 'Send Reset Link'}
                </button>
                <button type="button" onClick={() => goTo('email')} className={quietButton}>
                  Back to Sign In
                </button>
              </form>
            )
          )}
        </div>
      </motion.div>
    </div>
  );
}
