'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';
import { STUDIO, CREATOR_JOIN } from '@/lib/constants';
import { authCallbackUrl, bannedMessage, signInErrorMessage } from '@/lib/auth/redirect';
import { readNextParam } from '@/lib/auth/next-path';
import { destinationAfterSignIn } from '@/components/auth/afterSignIn';
import { GoogleIcon } from '@/components/auth/GoogleIcon';
import { GoogleSignInButton, type GoogleSignInError } from '@/components/auth/GoogleSignInButton';
import { TermsNotice } from '@/components/auth/TermsNotice';
import {
  EMAIL_RE,
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULE,
  isExistingAccount,
  newPasswordProblem,
  signInFailure,
  signUpFailure,
} from '@/lib/auth/password-auth';

/**
 * One screen for signing in and creating an account. Owner decision
 * 2026-10-14: the ONLY ways in are "Continue with Google" and email +
 * password. There is no magic link and no emailed sign-in code.
 *
 * - Sign in: email + password (signInWithPassword).
 * - Create account (?mode=signup, and /register): email + password; Supabase
 *   emails a confirmation link that returns through /auth/callback.
 * - Forgot password: resetPasswordForEmail, then /reset-password. People who
 *   used an email link before set a password this way.
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

type Step = 'signin' | 'signup' | 'check' | 'forgot';
type Field = 'email' | 'password' | 'resetEmail' | null;
type Busy = null | 'google' | 'password' | 'signup' | 'resend' | 'reset' | 'leaving';

const ERROR_ID = 'login-error';
const PASSWORD_HINT_ID = 'password-hint';

const inputClass = (invalid: boolean): string =>
  `w-full bg-neutral-900 border ${invalid ? 'border-red-500/70' : 'border-white/10'} text-white px-4 py-3 min-h-[44px] text-base md:text-sm font-mono placeholder:text-neutral-400 focus:outline-none focus:border-[#D4A843] transition-colors`;
const primaryButton =
  'w-full min-h-[44px] bg-[#D4A843] text-black py-3.5 text-xs font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2';
const quietButton =
  'w-full min-h-[44px] text-xs font-mono text-neutral-400 hover:text-white transition-colors uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed';
const labelClass = 'block text-xs font-bold uppercase tracking-widest text-neutral-400';

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
  const reason = searchParams.get('reason');

  const [step, setStep] = useState<Step>(() => (searchParams.get('mode') === 'signup' ? 'signup' : 'signin'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);
  /** Why the "check your email" screen shows: a new account, or a sign-in before confirming. */
  const [checkReason, setCheckReason] = useState<'created' | 'unconfirmed'>('created');
  // A failed Google sign-in or confirmation link comes back as ?error=auth.
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

  // Coming back from Google (or after leaving to another page), the browser
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
    if (oauthError) fail('Could not open Google sign-in. Please try again, or use your email and password.');
  };

  /** Google's own button signed in on this page (no trip through supabase.co). */
  const googleFailed = (err: GoogleSignInError): void => {
    setBusy(null);
    const banned = bannedMessage(err, STUDIO.email);
    fail(banned ?? 'Google sign-in did not finish. Please try again, or use your email and password.');
  };

  const handleSignIn = async (): Promise<void> => {
    const address = email.trim();
    if (!EMAIL_RE.test(address)) return fail('Please enter a valid email address.', 'email');
    if (!password) return fail('Please enter your password.', 'password');
    setBusy('password');
    const supabase = createClient();
    const { data, error: authError } = await supabase.auth.signInWithPassword({ email: address, password });
    if (authError || !data.user) {
      const failure = signInFailure(authError, STUDIO.email);
      if (failure.unconfirmed) {
        setBusy(null);
        setCheckReason('unconfirmed');
        setStep('check');
        setNotice(null);
        setError({ text: failure.text, field: null });
        return;
      }
      return fail(failure.text, failure.field);
    }
    await finish(data.user);
  };

  /**
   * Create an account. Supabase emails a confirmation link that returns
   * through /auth/callback (carrying ?next=), and /welcome then records
   * consent.
   */
  const handleSignUp = async (): Promise<void> => {
    const address = email.trim();
    if (!EMAIL_RE.test(address)) return fail('Please enter a valid email address.', 'email');
    const problem = newPasswordProblem(password);
    if (problem) return fail(problem, 'password');
    setBusy('signup');
    const supabase = createClient();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: address,
      password,
      options: { emailRedirectTo: authCallbackUrl(window.location.origin, next) },
    });
    if (signUpError) {
      const failure = signUpFailure(signUpError, STUDIO.email);
      return fail(failure.text, failure.field);
    }
    // Email confirmation switched off in Supabase: they are signed in already.
    if (data.session && data.user) return finish(data.user);
    setBusy(null);
    setPassword('');
    setShowPassword(false);
    setCheckReason('created');
    setStep('check');
    if (isExistingAccount(data.user)) {
      setNotice('If this email already has an account, no new email is sent: sign in instead, or use Forgot password.');
    }
  };

  const handleEmailForm = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (busy) return;
    clearMessages();
    if (step === 'signup') void handleSignUp();
    else void handleSignIn();
  };

  /** Send the account confirmation link again (a link, never a sign-in code). */
  const resendConfirmation = async (): Promise<void> => {
    clearMessages();
    const address = email.trim();
    if (!EMAIL_RE.test(address)) return;
    setBusy('resend');
    const supabase = createClient();
    const { error: resendError } = await supabase.auth.resend({
      type: 'signup',
      email: address,
      options: { emailRedirectTo: authCallbackUrl(window.location.origin, next) },
    });
    if (resendError && /rate limit|security purposes/i.test(resendError.message)) {
      return fail("We've just sent you an email. Check your inbox and spam folder, or wait a minute and try again.");
    }
    setBusy(null);
    setNotice('We sent the confirmation email again. Use the newest one.');
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
    setShowPassword(false);
    setStep(target);
  };
  const openForgot = (): void => {
    setResetEmail(email);
    setResetSent(false);
    goTo('forgot');
  };

  const heading =
    step === 'check' ? 'Check your email'
      : step === 'forgot' ? 'Reset password'
        : step === 'signup' ? 'Create your account'
          : 'Sign in';

  const onForm = step === 'signin' || step === 'signup';
  const passwordDescribedBy =
    [invalid('password') ? ERROR_ID : null, step === 'signup' ? PASSWORD_HINT_ID : null].filter(Boolean).join(' ') ||
    undefined;

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
          {step === 'signup' && (
            <p className="text-xs font-mono text-neutral-400 leading-relaxed mt-5">
              Use Google, or your email and a password. We&apos;ll email you a link to confirm your address.
            </p>
          )}
        </div>

        {/* Sent here from a booking: say what the sign-in is for */}
        {reason === 'book' && onForm && (
          <div className="bg-[#D4A843]/10 border border-[#D4A843]/30 px-4 py-3 mb-6">
            <p className="text-xs text-[#D4A843] font-mono leading-relaxed">
              Sign in to send your request. New here? Create your free account below.
            </p>
          </div>
        )}

        {/* Idle logout notice */}
        {reason === 'idle' && onForm && (
          <div className="bg-amber-500/10 border border-amber-500/30 px-4 py-3 mb-6">
            <p className="text-xs text-amber-400 font-mono leading-relaxed">
              You were signed out due to inactivity. Please sign in again.
            </p>
          </div>
        )}

        <div className="bg-[#0A0A0B] border border-white/10 p-6 sm:p-8">
          {onForm && (
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
                  <label htmlFor="email" className={`${labelClass} mb-2`}>Email</label>
                  <input
                    id="email"
                    type="email"
                    inputMode="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete={step === 'signup' ? 'email' : 'username'}
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="you@example.com"
                    aria-invalid={invalid('email') || undefined}
                    aria-describedby={describedBy('email')}
                    className={inputClass(invalid('email'))}
                  />
                </div>

                <div>
                  <div className="flex items-end justify-between mb-2">
                    <label htmlFor="password" className={labelClass}>Password</label>
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-controls="password"
                      aria-pressed={showPassword}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
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
                    autoComplete={step === 'signup' ? 'new-password' : 'current-password'}
                    minLength={step === 'signup' ? PASSWORD_MIN_LENGTH : undefined}
                    aria-invalid={invalid('password') || undefined}
                    aria-describedby={passwordDescribedBy}
                    className={inputClass(invalid('password'))}
                  />
                  {step === 'signup' && (
                    <p id={PASSWORD_HINT_ID} className="text-xs font-mono text-neutral-400 mt-2">
                      {PASSWORD_RULE}
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={busy !== null}
                  aria-busy={busy === 'password' || busy === 'signup' || busy === 'leaving'}
                  className={primaryButton}
                >
                  {busy === 'signup' ? (<><Spinner dark />Creating account...</>)
                    : busy === 'password' || busy === 'leaving' ? (<><Spinner dark />Signing in...</>)
                      : step === 'signup' ? 'Create Account' : 'Sign In'}
                </button>
              </form>

              {errorBox}

              {step === 'signin' && (
                <button
                  type="button"
                  onClick={openForgot}
                  disabled={busy !== null}
                  className={`${quietButton} underline underline-offset-2 normal-case tracking-normal`}
                >
                  Forgot password?
                </button>
              )}

              <button
                type="button"
                onClick={() => goTo(step === 'signup' ? 'signin' : 'signup')}
                disabled={busy !== null}
                className={quietButton}
              >
                {step === 'signup' ? 'Already have an account? Sign in' : 'New here? Create account'}
              </button>

              {step === 'signin' && (
                <p className="text-xs font-mono text-neutral-400 leading-relaxed text-center">
                  Signed up with an email link before? Use Forgot password to set a password.
                </p>
              )}

              <TermsNotice className="pt-1 border-t border-white/10" />
            </div>
          )}

          {step === 'check' && (
            <div className="space-y-5">
              {checkReason === 'created' && (
                <p className="text-xs font-mono text-neutral-300 leading-relaxed">
                  We sent an email to <span className="text-white break-all">{email.trim()}</span>. Tap the link
                  in it to confirm your address, and you&apos;re in. It can take a minute to arrive. Check your
                  spam folder too.
                </p>
              )}

              {errorBox}
              {noticeBox}

              <button
                type="button"
                onClick={() => void resendConfirmation()}
                disabled={busy !== null}
                aria-busy={busy === 'resend'}
                className={quietButton}
              >
                {busy === 'resend' ? 'Sending...' : 'Send the confirmation email again'}
              </button>
              <button type="button" onClick={() => goTo('signin')} className={primaryButton}>
                Back to Sign In
              </button>
            </div>
          )}

          {step === 'forgot' && (
            resetSent ? (
              <div className="space-y-5">
                <div role="status" className="bg-emerald-500/10 border border-emerald-500/30 px-4 py-3">
                  <p className="text-xs text-emerald-400 font-mono leading-relaxed">
                    If this email has an account, we&apos;ve sent a link to set a new password. Check your inbox
                    and spam folder.
                  </p>
                </div>
                <button type="button" onClick={() => goTo('signin')} className={primaryButton}>
                  Back to Sign In
                </button>
              </div>
            ) : (
              <form onSubmit={handleReset} noValidate className="space-y-5">
                <p className="text-xs font-mono text-neutral-400 leading-relaxed">
                  Enter your email and we&apos;ll send you a link to set a new password. This also works if you
                  signed up with an email link before and never had a password.
                </p>
                <div>
                  <label htmlFor="resetEmail" className={`${labelClass} mb-2`}>Email</label>
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
                <button type="button" onClick={() => goTo('signin')} className={quietButton}>
                  Back to Sign In
                </button>
              </form>
            )
          )}
        </div>

        {/* The creator's way in (not in the header, see CREATOR_JOIN). Hidden when they are already on their way there. */}
        {onForm && next !== CREATOR_JOIN.href && (
          <p className="text-xs font-mono text-neutral-400 text-center mt-6">
            {CREATOR_JOIN.loginLine}{' '}
            <Link href={CREATOR_JOIN.href} className="text-[#D4A843] hover:underline">
              {CREATOR_JOIN.ctaLabel}
            </Link>
          </p>
        )}
      </motion.div>
    </div>
  );
}
