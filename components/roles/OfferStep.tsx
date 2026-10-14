'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, ImagePlus, Loader2, Package, Sparkles, X } from 'lucide-react';
import { LIST_GEAR_HREF, offerRolePath } from '@/lib/welcome';
import { isGearSlug, keywordMatch, type MatchRole, type RoleGroup } from '@/lib/roles';
import { photoForMatch } from '@/lib/roles/client';
import { RoleIcon } from './RoleIcon';
import { InterestForm } from './InterestForm';

/**
 * OFFER: "What do you want to offer?". Describe it in your own words and/or
 * add one photo; we suggest where it fits (a role, or gear to rent out); one
 * tap to confirm. Or pick yourself. Skills go to the profile maker
 * (/offer/<role>), gear to the photo-first listing, a vehicle to driver with
 * vehicle.
 */

export interface OfferRole {
  slug: string;
  name: string;
  description: string;
  status: 'live' | 'coming_soon';
  role_group: RoleGroup;
}

interface Suggestion {
  slug: string;
  name: string;
  status: 'live' | 'coming_soon';
  kind: 'role' | 'gear';
}

export function OfferStep({
  roles,
  candidates,
  initialText,
}: {
  roles: OfferRole[];
  /** Roles plus gear categories, for the offline keyword match. */
  candidates: MatchRole[];
  /** Skills already on the account: matched straight away, never assigned. */
  initialText: string;
}) {
  const [text, setText] = useState(initialText);
  const [photo, setPhoto] = useState<{ base64: string; preview: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toSuggestions = (list: { slug: string }[]): Suggestion[] =>
    list.flatMap((s): Suggestion[] => {
      const r = roles.find((x) => x.slug === s.slug);
      if (r) return [{ slug: r.slug, name: r.name, status: r.status, kind: 'role' as const }];
      const c = candidates.find((x) => x.slug === s.slug);
      return c && isGearSlug(c.slug) ? [{ slug: c.slug, name: c.name, status: 'live' as const, kind: 'gear' as const }] : [];
    });

  const instant = useMemo(() => (initialText ? keywordMatch(initialText, candidates, 'offer') : []), [initialText, candidates]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>(() => toSuggestions(instant));
  const [asked, setAsked] = useState(instant.length > 0);

  const live = roles.filter((r) => r.status === 'live');
  const soon = roles.filter((r) => r.status === 'coming_soon');

  async function addPhoto(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    setError(null);
    try {
      const base64 = await photoForMatch(f);
      setPhoto({ base64, preview: `data:image/jpeg;base64,${base64}` });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that photo.');
    }
  }

  async function match() {
    setError(null);
    // Clear the last answer so an old suggestion never shows for new words.
    setAsked(false);
    setSuggestions([]);
    setBusy(true);
    try {
      const res = await fetch('/api/roles/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'offer', text, image: photo?.base64 ?? null }),
      });
      const body = (await res.json().catch(() => ({}))) as { suggestions?: Suggestion[]; error?: string };
      if (!res.ok) {
        // No AI or too many tries: the words still work without it.
        const local = toSuggestions(keywordMatch(text, candidates, 'offer'));
        setSuggestions(local);
        if (!local.length) setError(body.error ?? 'Could not match right now. Pick below.');
      } else {
        setSuggestions(body.suggestions ?? []);
      }
      setAsked(true);
    } catch {
      setError('No connection. Pick below.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 pt-28 pb-16">
      <p className="text-xs font-mono text-accent-gold uppercase tracking-[0.3em] mb-3">Offer</p>
      <h1 className="text-3xl md:text-4xl font-display font-medium text-white tracking-tight">What do you want to offer?</h1>
      <p className="text-neutral-400 mt-3">Say it in your own words, or add a photo. You do not need a portfolio or a certificate.</p>

      <label className="block mt-6">
        <span className="sr-only">What you offer</span>
        <textarea
          value={text}
          maxLength={300}
          onChange={(e) => setText(e.target.value)}
          placeholder="I do make-up for weddings. Or: I have a Quantum and drive crews. Or: a Sony camera to rent out."
          className="w-full min-h-[104px] p-3 bg-black/40 border border-white/15 text-white placeholder:text-neutral-500 focus:border-accent-gold outline-none"
        />
      </label>

      <div className="mt-3 flex items-center gap-3">
        {photo ? (
          <span className="relative w-16 h-16 bg-white/5 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.preview} alt="Your photo" className="w-full h-full object-cover" />
            <button type="button" onClick={() => setPhoto(null)} aria-label="Remove photo" className="absolute right-0 top-0 w-11 h-11 flex items-start justify-end p-1 text-white">
              <X className="w-4 h-4 bg-black/70" aria-hidden="true" />
            </button>
          </span>
        ) : (
          <label className="min-h-[48px] px-4 border border-white/15 text-neutral-200 text-xs font-mono uppercase tracking-widest flex items-center gap-2 cursor-pointer hover:border-accent-gold">
            <ImagePlus className="w-4 h-4" aria-hidden="true" /> Add a photo
            <input type="file" accept="image/*" className="sr-only" onChange={(e) => { void addPhoto(e.target.files); e.target.value = ''; }} />
          </label>
        )}
      </div>

      <button
        type="button"
        onClick={match}
        disabled={busy || (!text.trim() && !photo)}
        className="mt-5 w-full min-h-[52px] bg-accent-gold text-black text-sm font-mono font-bold uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-40"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Sparkles className="w-4 h-4" aria-hidden="true" />}
        Find where I fit
      </button>

      {error && <p className="mt-3 text-sm text-red-300" role="alert">{error}</p>}

      {asked && (
        <section aria-live="polite" className="mt-8">
          {suggestions.length > 0 ? (
            <>
              <p className="text-sm text-neutral-300 mb-3">{suggestions.length > 1 ? 'Sounds like one of these. Tap the right one.' : 'Sounds like:'}</p>
              <ul className="space-y-3">
                {suggestions.map((s) => {
                  const r = roles.find((x) => x.slug === s.slug);
                  return (
                    <li key={s.slug} className="border border-accent-gold/50 bg-accent-gold/5 p-4">
                      <div className="flex items-center gap-3">
                        <span className="flex items-center justify-center w-11 h-11 rounded-full bg-accent-gold/15 text-accent-gold">
                          {r ? <RoleIcon group={r.role_group} /> : <Package className="w-6 h-6" aria-hidden="true" />}
                        </span>
                        <span className="flex-1">
                          <span className="block text-white text-lg">{s.kind === 'gear' ? `Gear to rent out: ${s.name.replace(' (gear)', '')}` : s.name}</span>
                          {r && <span className="block text-xs text-neutral-400">{r.description}</span>}
                        </span>
                      </div>
                      {s.kind === 'gear' ? (
                        <Link href={LIST_GEAR_HREF} className="mt-3 w-full min-h-[48px] bg-accent-gold text-black text-xs font-mono font-bold uppercase tracking-widest flex items-center justify-center gap-2">
                          <Check className="w-4 h-4" aria-hidden="true" /> Yes, list my gear
                        </Link>
                      ) : s.status === 'live' ? (
                        <Link href={offerRolePath(s.slug)} className="mt-3 w-full min-h-[48px] bg-accent-gold text-black text-xs font-mono font-bold uppercase tracking-widest flex items-center justify-center gap-2">
                          <Check className="w-4 h-4" aria-hidden="true" /> Yes, that&apos;s me
                        </Link>
                      ) : (
                        <div className="mt-3">
                          <p className="text-xs text-neutral-400 mb-2">This opens soon.</p>
                          <InterestForm roleSlug={s.slug} roleName={s.name} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <p className="text-sm text-neutral-300">We could not tell from that. Pick below.</p>
          )}
        </section>
      )}

      <section className="mt-10" aria-labelledby="pick-heading">
        <h2 id="pick-heading" className="text-sm font-mono uppercase tracking-widest text-neutral-400 mb-3">Or choose yourself</h2>
        <ul className="grid gap-2">
          {live.map((r) => (
            <li key={r.slug}>
              <Link href={offerRolePath(r.slug)} className="flex items-center gap-3 min-h-[56px] px-4 border border-white/10 hover:border-accent-gold/60">
                <RoleIcon group={r.role_group} className="w-5 h-5 text-accent-gold" />
                <span className="flex-1 text-white">{r.name}</span>
                <ArrowRight className="w-4 h-4 text-neutral-500" aria-hidden="true" />
              </Link>
            </li>
          ))}
          <li>
            <Link href={LIST_GEAR_HREF} className="flex items-center gap-3 min-h-[56px] px-4 border border-white/10 hover:border-accent-gold/60">
              <Package className="w-5 h-5 text-accent-gold" aria-hidden="true" />
              <span className="flex-1 text-white">Gear to rent out</span>
              <ArrowRight className="w-4 h-4 text-neutral-500" aria-hidden="true" />
            </Link>
          </li>
        </ul>
        {soon.length > 0 && (
          <details className="mt-4">
            <summary className="min-h-[44px] flex items-center cursor-pointer text-sm text-neutral-400">Coming soon: {soon.map((r) => r.name).join(', ')}</summary>
            <ul className="grid gap-3 mt-2">
              {soon.map((r) => (
                <li key={r.slug} className="p-3 border border-white/10">
                  <p className="text-white text-sm mb-2">{r.name}</p>
                  <InterestForm roleSlug={r.slug} roleName={r.name} />
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
