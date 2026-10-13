'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

/**
 * "Continue with Google" through Google's own button (Google Identity
 * Services). Google hands the page an ID token and Supabase signs in with it
 * (signInWithIdToken), so the person never passes through
 * <project>.supabase.co and Google's sheet names this site, not Supabase.
 *
 * Needs NEXT_PUBLIC_GOOGLE_CLIENT_ID (the same web client Supabase's Google
 * provider uses), and the site's address listed under that client's
 * "Authorised JavaScript origins". Google does not accept wildcards there, so
 * the variable is set only where the origin is listed (production, localhost).
 * Without it, or if Google's script does not load, `fallback` (the redirect
 * button) is shown instead.
 */

const GSI_SRC = 'https://accounts.google.com/gsi/client';

type CredentialResponse = { credential?: string };
type GoogleId = {
  initialize: (config: Record<string, unknown>) => void;
  renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
  cancel: () => void;
};
type GoogleWindow = Window & { google?: { accounts?: { id?: GoogleId } } };

let gsiLoading: Promise<GoogleId> | null = null;

function loadGsi(): Promise<GoogleId> {
  const ready = (): GoogleId | undefined => (window as GoogleWindow).google?.accounts?.id;
  const existing = ready();
  if (existing) return Promise.resolve(existing);
  gsiLoading ??= new Promise<GoogleId>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GSI_SRC;
    script.async = true;
    script.onload = () => {
      const id = ready();
      if (id) resolve(id);
      else reject(new Error('Google sign-in did not start'));
    };
    script.onerror = () => {
      gsiLoading = null;
      script.remove();
      reject(new Error('Google sign-in could not load'));
    };
    document.head.appendChild(script);
  });
  return gsiLoading;
}

/** A random nonce, and its SHA-256 hex digest. Google gets the digest; Supabase checks the raw value against it. */
async function makeNonce(): Promise<{ raw: string; hashed: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const raw = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const hashed = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return { raw, hashed };
}

export type GoogleSignInError = { message: string; status?: number; code?: string };

export function GoogleSignInButton({
  fallback,
  onSignedIn,
  onError,
  onBusy,
}: {
  /** The redirect button, shown when Google's own button is not available here. */
  fallback: ReactNode;
  onSignedIn: (user: User) => void;
  onError: (error: GoogleSignInError) => void;
  onBusy?: () => void;
}) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const holder = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  // Every sign-in attempt uses a fresh nonce, so the button is set up again after each one.
  const [round, setRound] = useState(0);

  const handlers = useRef({ onSignedIn, onError, onBusy });
  useEffect(() => {
    handlers.current = { onSignedIn, onError, onBusy };
  });

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    let gsi: GoogleId | null = null;

    (async () => {
      try {
        const [id, nonce] = await Promise.all([loadGsi(), makeNonce()]);
        if (cancelled || !holder.current) return;
        gsi = id;
        id.initialize({
          client_id: clientId,
          nonce: nonce.hashed,
          auto_select: false,
          cancel_on_tap_outside: true,
          itp_support: true,
          use_fedcm_for_button: true,
          callback: async (response: CredentialResponse) => {
            if (!response.credential) {
              handlers.current.onError({ message: 'Google did not send a sign-in. Please try again.' });
              return;
            }
            handlers.current.onBusy?.();
            const { data, error } = await createClient().auth.signInWithIdToken({
              provider: 'google',
              token: response.credential,
              nonce: nonce.raw,
            });
            if (error || !data.user) {
              handlers.current.onError(error ?? { message: 'Google sign-in did not finish.' });
              setRound((r) => r + 1);
              return;
            }
            handlers.current.onSignedIn(data.user);
          },
        });
        holder.current.replaceChildren();
        id.renderButton(holder.current, {
          type: 'standard',
          theme: 'filled_black',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          logo_alignment: 'center',
          // Google's maximum; the holder centres it on wider cards.
          width: Math.min(400, Math.max(200, holder.current.clientWidth || 400)),
        });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      gsi?.cancel();
    };
  }, [clientId, round]);

  if (!clientId || failed) return <>{fallback}</>;
  return <div ref={holder} className="w-full min-h-[44px] flex justify-center" data-testid="google-signin" />;
}
