import type { createAdminClient } from '@/lib/supabase/server';
import { firstNameFrom } from '@/lib/greetings/welcome';
import { roleOf, type TailoredProfile } from './templates';
import type { HistoryRow, Intent, PersonFacts, Verification } from './types';

/**
 * Reads what the lifecycle rules need, in batches (one query per table per
 * 150 people). Counts and dates only, except loadTailoredProfile, which reads
 * the few profile fields the tailored note may use and nothing else.
 */

type Admin = ReturnType<typeof createAdminClient>;

export interface AuthUserLite {
  id: string;
  email: string | null;
  emailConfirmedAt: string | null;
  createdAt: string;
  meta: Record<string, unknown>;
}

const BATCH = 150;

function chunks<T>(xs: T[], n = BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** Rows from a query, or [] when the table is missing (logged, never thrown). */
async function rows<T>(label: string, q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) {
    console.warn(`[engagement] ${label} unavailable:`, error.message);
    return [];
  }
  return (data ?? []) as T[];
}

function toLite(u: { id: string; email?: string | null; email_confirmed_at?: string | null; created_at: string; user_metadata?: Record<string, unknown> | null }): AuthUserLite {
  return {
    id: u.id,
    email: u.email ?? null,
    emailConfirmedAt: u.email_confirmed_at ?? null,
    createdAt: u.created_at,
    meta: (u.user_metadata ?? {}) as Record<string, unknown>,
  };
}

/** Every account, newest pages first as Supabase returns them (bounded). */
export async function listAuthUsers(admin: Admin, maxPages = 25): Promise<AuthUserLite[]> {
  const out: AuthUserLite[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const users = data?.users ?? [];
    out.push(...users.map(toLite));
    if (users.length < 200) break;
  }
  return out;
}

export async function getAuthUsers(admin: Admin, ids: string[]): Promise<AuthUserLite[]> {
  const out: AuthUserLite[] = [];
  for (const id of [...new Set(ids)]) {
    const { data } = await admin.auth.admin.getUserById(id);
    if (data?.user) out.push(toLite(data.user));
  }
  return out;
}

function intentOf(meta: Record<string, unknown>): Intent {
  const v = meta.intent;
  return v === 'rent' || v === 'hire' || v === 'list' || v === 'supply' || v === 'browse' ? v : null;
}

function verificationOf(v: unknown): Verification {
  return v === 'pending' || v === 'verified' || v === 'rejected' ? v : 'none';
}

function latest(a: string | null, b: string | null | undefined): string | null {
  if (!b) return a;
  if (!a) return b;
  return new Date(b).getTime() > new Date(a).getTime() ? b : a;
}

interface ProfileRow {
  id: string;
  first_name: string | null;
  display_name: string | null;
  verification_status: string | null;
  verification_reviewed_at: string | null;
  onboarding_completed_at: string | null;
  is_suspended: boolean | null;
  marketing_opt_in: boolean | null;
  email_lifecycle_opt_out: boolean | null;
}

export async function loadFacts(
  admin: Admin,
  users: AuthUserLite[],
): Promise<{ facts: Map<string, PersonFacts>; history: Map<string, HistoryRow[]> }> {
  const facts = new Map<string, PersonFacts>();
  const history = new Map<string, HistoryRow[]>();

  for (const batch of chunks(users)) {
    const ids = batch.map((u) => u.id);
    const [profiles, onboarding, cart, listings, gear, service, welcomes, subs, outbox] = await Promise.all([
      rows<ProfileRow>('profiles', admin.from('profiles')
        .select('id, first_name, display_name, verification_status, verification_reviewed_at, onboarding_completed_at, is_suspended, marketing_opt_in, email_lifecycle_opt_out')
        .in('id', ids)),
      rows<{ creator_id: string; current_step: number | null; updated_at: string | null; completed_at: string | null }>('onboarding',
        admin.from('onboarding_progress').select('creator_id, current_step, updated_at, completed_at').in('creator_id', ids)),
      rows<{ user_id: string; created_at: string }>('cart', admin.from('cart_items').select('user_id, created_at').in('user_id', ids)),
      rows<{ owner_id: string; listing_status: string | null; updated_at: string | null }>('listings',
        admin.from('smart_rentals').select('owner_id, listing_status, updated_at').in('owner_id', ids).is('deleted_at', null)),
      rows<{ user_id: string }>('gear bookings', admin.from('equipment_bookings').select('user_id').in('user_id', ids)),
      rows<{ client_id: string }>('service bookings', admin.from('bookings').select('client_id').in('client_id', ids)),
      rows<{ user_id: string; status: NonNullable<PersonFacts['welcome']>['status'] }>('welcomes',
        admin.from('welcome_messages').select('user_id, status').in('user_id', ids)),
      rows<{ user_id: string }>('push subscriptions', admin.from('push_subscriptions').select('user_id').in('user_id', ids)),
      rows<{ user_id: string; dedupe_key: string; kind: string; channel: string; status: string; created_at: string; sent_at: string | null }>('outbox',
        admin.from('notification_outbox').select('user_id, dedupe_key, kind, channel, status, created_at, sent_at').in('user_id', ids).like('kind', 'engage_%')),
    ]);

    const profileBy = new Map(profiles.map((p) => [p.id, p]));
    const onboardingBy = new Map(onboarding.map((o) => [o.creator_id, o]));
    const welcomeBy = new Map(welcomes.map((w) => [w.user_id, w.status]));
    const pushUsers = new Set(subs.map((s) => s.user_id));

    for (const u of batch) {
      const p = profileBy.get(u.id);
      const ob = onboardingBy.get(u.id);
      const myCart = cart.filter((c) => c.user_id === u.id);
      const myListings = listings.filter((l) => l.owner_id === u.id);
      const drafts = myListings.filter((l) => l.listing_status === 'draft');
      facts.set(u.id, {
        userId: u.id,
        email: u.email,
        emailConfirmed: Boolean(u.emailConfirmedAt),
        createdAt: u.createdAt,
        firstName: firstNameFrom([
          p?.first_name,
          u.meta.first_name as string | undefined,
          u.meta.given_name as string | undefined,
          u.meta.full_name as string | undefined,
          u.meta.name as string | undefined,
          p?.display_name,
        ]),
        intent: intentOf(u.meta),
        suspended: Boolean(p?.is_suspended),
        optedOut: Boolean(p?.email_lifecycle_opt_out),
        marketingOptIn: Boolean(p?.marketing_opt_in),
        verification: verificationOf(p?.verification_status),
        verificationDecidedAt: p?.verification_reviewed_at ?? null,
        onboarding: ob ? { finishedStep: Number(ob.current_step ?? 0) || 0, updatedAt: ob.updated_at, completedAt: ob.completed_at } : null,
        onboardingCompletedAt: p?.onboarding_completed_at ?? null,
        cart: { items: myCart.length, newestAt: myCart.reduce<string | null>((a, c) => latest(a, c.created_at), null) },
        draftListings: { count: drafts.length, latestAt: drafts.reduce<string | null>((a, l) => latest(a, l.updated_at), null) },
        publishedListings: myListings.filter((l) => l.listing_status === 'published' || l.listing_status === 'pending_review').length,
        bookingsAsClient: gear.filter((g) => g.user_id === u.id).length + service.filter((s) => s.client_id === u.id).length,
        welcome: welcomeBy.has(u.id) ? { status: welcomeBy.get(u.id)! } : null,
        hasPush: pushUsers.has(u.id),
      });
      history.set(
        u.id,
        outbox
          .filter((o) => o.user_id === u.id)
          .map((o) => ({ dedupeKey: o.dedupe_key, kind: o.kind, channel: o.channel, status: o.status, createdAt: o.created_at, sentAt: o.sent_at })),
      );
    }
  }
  return { facts, history };
}

interface TailoredRow {
  skills: string[] | null;
  specializations: string[] | null;
  city: string | null;
  province: string | null;
  location: string | null;
  bio: string | null;
  crew_bio: string | null;
  years_experience: number | null;
  avatar_url: string | null;
  hourly_rate: number | null;
  available_for_hire: boolean | null;
  portfolio_projects: unknown;
}

/** The profile fields the tailored note may use. Selected by name: nothing sensitive is ever read. */
export async function loadTailoredProfile(admin: Admin, person: PersonFacts): Promise<TailoredProfile> {
  const id = person.userId;
  const [profile, listings, gigs, cart, booked] = await Promise.all([
    admin.from('profiles')
      .select('skills, specializations, city, province, location, bio, crew_bio, years_experience, avatar_url, hourly_rate, available_for_hire, portfolio_projects')
      .eq('id', id).maybeSingle().then(({ data }) => data as TailoredRow | null),
    rows<{ title: string | null; listing_status: string | null }>('listings', admin.from('smart_rentals').select('title, listing_status').eq('owner_id', id).is('deleted_at', null).limit(10)),
    admin.from('bookings').select('id', { count: 'exact', head: true }).eq('creator_id', id).eq('status', 'completed').then(({ count }) => count ?? 0),
    rows<{ rental_id: string | null }>('cart', admin.from('cart_items').select('rental_id').eq('user_id', id).limit(20)),
    rows<{ rental_id: string | null }>('gear bookings', admin.from('equipment_bookings').select('rental_id').eq('user_id', id).limit(20)),
  ]);

  const rentalIds = [...new Set([...cart, ...booked].map((r) => r.rental_id).filter((x): x is string => Boolean(x)))];
  const categories = rentalIds.length
    ? [...new Set((await rows<{ category: string | null }>('categories', admin.from('smart_rentals').select('category').in('id', rentalIds)))
        .map((r) => r.category).filter((c): c is string => Boolean(c)))]
    : [];

  const portfolio = Array.isArray(profile?.portfolio_projects) ? profile!.portfolio_projects.length : 0;
  const published = listings.filter((l) => l.listing_status === 'published' || l.listing_status === 'pending_review').length;
  const drafts = listings.filter((l) => l.listing_status === 'draft').length;
  return {
    userId: id,
    firstName: person.firstName,
    intent: person.intent,
    role: roleOf({ intent: person.intent, onboardingCompleted: Boolean(person.onboardingCompletedAt), publishedListings: published, draftListings: drafts }),
    skills: profile?.skills ?? [],
    specializations: profile?.specializations ?? [],
    area: profile?.city || profile?.province || profile?.location || null,
    bio: profile?.crew_bio || profile?.bio || null,
    yearsExperience: profile?.years_experience ?? null,
    hasAvatar: Boolean(profile?.avatar_url),
    hasRate: Boolean(profile?.hourly_rate),
    availableForHire: Boolean(profile?.available_for_hire),
    portfolioItems: portfolio,
    verified: person.verification === 'verified',
    listingTitles: listings.map((l) => l.title ?? '').filter(Boolean),
    publishedListings: published,
    draftListings: drafts,
    bookingsAsClient: person.bookingsAsClient,
    gigs,
    categories,
  };
}
