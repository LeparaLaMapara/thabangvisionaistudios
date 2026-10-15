/**
 * The People request loop (migration 095, journeys audit 2026-10-15 B1 to B8,
 * C2, C11, C21): who is told about a request and a profile decision, the
 * status words each side reads, what a person earns, the Offer status
 * screen, and that every change sits behind roles_v1.
 */
import { describe, expect, it } from 'vitest';
import { ROLES_POLICY, STUDIO } from '@/lib/constants';
import {
  clientAcceptedEmail,
  clientDeclinedEmail,
  clientRequestReceivedEmail,
  earningsLine,
  idCheckLine,
  identityState,
  offerStatusView,
  ownerNewRequestEmail,
  personEarnings,
  personNewRequestEmail,
  profileApprovedEmail,
  profileSentBackEmail,
  profileToShow,
  REQUEST_NEXT_STEPS,
  requestHeading,
  requestReference,
  requestStatusLabel,
  requestStatusWords,
  reveal,
  showPaymentDetails,
  type RequestFacts,
  type RequestStatus,
} from '@/lib/roles';
import { notifyNewRequest, notifyProfileDecision, notifyRequestDecision, type BellRow } from '@/lib/roles/request-notify-server';
import type { LoadedRequest } from '@/lib/supabase/queries/role-requests';
import type { SendEmailOptions } from '@/lib/email/types';
import { nudgeContent, tailoredSteps, type TailoredProfile } from '@/lib/engagement/templates';
import { sidebarGroups } from '@/components/dashboard/DashboardSidebar';
import { buildNeeds, buildToday, type TodayFacts } from '@/lib/admin/control-room/today';
import { sectionForPath, toolForPath } from '@/lib/admin/control-room/sections';
import { onlyOnSiteItems, studioUseNote } from '@/lib/rental/on-site';
import { buildSystemPrompt, type CachedData } from '@/lib/ubunye/system-prompt';

const DASH = /[–—]/;
const RID = '0b6f2c1e-1111-4a2b-9c3d-123456789abc';

const facts: RequestFacts = {
  requestId: RID,
  roleName: 'Make-up artist',
  personLabel: 'Make-up artist in Soweto (ref MA-1042)',
  dates: ['2026-11-02', '2026-11-03'],
  arrival: '08:00',
  durationHours: 6,
  area: 'Soweto',
  totalCents: 300_000,
};

const loaded: LoadedRequest = {
  facts,
  status: 'requested',
  address: '12 Vilakazi Street',
  note: 'Call me on 082 000 0000',
  isDemo: false,
  client: { userId: 'client-1', name: 'Lerato', email: 'lerato@example.com' },
  person: { userId: 'person-1', name: 'Naledi', email: 'naledi@example.com' },
};

function fakes(r: LoadedRequest | null = loaded) {
  const sent: SendEmailOptions[] = [];
  const bells: BellRow[] = [];
  return {
    sent,
    bells,
    deps: {
      send: async (o: SendEmailOptions) => void sent.push(o),
      bell: async (b: BellRow) => void bells.push(b),
      load: async () => r,
      baseUrl: 'https://tv.test',
      ownerEmail: 'owner@tv.test',
    },
  };
}

// ─── Notification triggers ───────────────────────────────────────────────────

describe('a new People request reaches the owner, the person and the client', () => {
  it('emails all three and rings the person', async () => {
    const f = fakes();
    const told = await notifyNewRequest(RID, f.deps);
    expect(told).toEqual({ owner: true, person: true, client: true });
    expect(f.sent.map((s) => s.to)).toEqual(['owner@tv.test', 'naledi@example.com', 'lerato@example.com']);
    expect(f.bells).toEqual([expect.objectContaining({ user_id: 'person-1', type: 'people_request', link: `/people/requests/${RID}` })]);
  });

  it('the owner email carries everything needed to answer, and the admin link', async () => {
    const f = fakes();
    await notifyNewRequest(RID, f.deps);
    const owner = f.sent[0];
    expect(owner.subject).toMatch(/^\[People request\] Make-up artist/);
    for (const s of ['lerato@example.com', 'naledi@example.com', '12 Vilakazi Street', 'Call me on', 'R3', 'https://tv.test/admin/roles/requests', requestReference(RID)]) {
      expect(owner.text).toContain(s);
    }
  });

  it('the person email is blind: no client name, email, address or note', async () => {
    const f = fakes();
    await notifyNewRequest(RID, f.deps);
    const person = f.sent[1].text;
    for (const s of ['Lerato', 'lerato@example.com', 'Vilakazi', '082 000 0000']) expect(person).not.toContain(s);
    expect(person).toContain('Soweto');
    expect(person).toContain('Can you do it?');
    expect(person).toContain('You get: R2');
  });

  it('a failed email does not stop the others', async () => {
    const f = fakes();
    let n = 0;
    const told = await notifyNewRequest(RID, { ...f.deps, send: async (o) => { if (n++ === 0) throw new Error('smtp down'); f.sent.push(o); } });
    expect(told).toEqual({ owner: false, person: true, client: true });
  });

  it('a request that is gone tells nobody', async () => {
    const f = fakes(null);
    expect(await notifyNewRequest(RID, f.deps)).toEqual({ owner: false, person: false, client: false });
    expect(f.sent).toEqual([]);
  });
});

describe('staff decisions reach the right people', () => {
  it('accepted: only the client, with the bank details and reference', async () => {
    const f = fakes();
    await notifyRequestDecision(RID, 'accepted', null, f.deps);
    expect(f.sent.map((s) => s.to)).toEqual(['lerato@example.com']);
    expect(f.sent[0].text).toContain(STUDIO.bank.accountNumber);
    expect(f.sent[0].text).toContain(requestReference(RID));
    expect(f.bells.map((b) => b.user_id)).toEqual(['client-1']);
  });

  it('declined: the client (with the note) and the person', async () => {
    const f = fakes();
    await notifyRequestDecision(RID, 'declined', 'They are away that week.', f.deps);
    expect(f.sent.map((s) => s.to)).toEqual(['lerato@example.com', 'naledi@example.com']);
    expect(f.sent[0].text).toContain('They are away that week.');
    expect(f.sent[0].text).toContain('Nothing was paid');
  });

  it('confirmed (paid): both sides', async () => {
    const f = fakes();
    await notifyRequestDecision(RID, 'confirmed', null, f.deps);
    expect(f.sent.map((s) => s.to)).toEqual(['lerato@example.com', 'naledi@example.com']);
    expect(f.bells.map((b) => b.user_id)).toEqual(['client-1', 'person-1']);
  });
});

describe('profile decisions reach the person (B7)', () => {
  it('approved: email and bell with the profile link', async () => {
    const f = fakes();
    const ok = await notifyProfileDecision(
      { userId: 'person-1', roleName: 'Make-up artist', personRoleId: 'pr-1', decision: 'approved', note: null },
      { ...f.deps, emailOf: async () => 'naledi@example.com' },
    );
    expect(ok).toBe(true);
    expect(f.sent[0]).toEqual(expect.objectContaining({ to: 'naledi@example.com' }));
    expect(f.sent[0].text).toContain('https://tv.test/people/pr-1');
    expect(f.bells[0]).toEqual(expect.objectContaining({ type: 'people_profile_update', link: '/people/pr-1' }));
  });

  it('sent back: the reviewer note in the email and the bell', async () => {
    const f = fakes();
    const note = 'Retake the before photo by a window, same angle as the after.';
    await notifyProfileDecision(
      { userId: 'person-1', roleName: 'Make-up artist', personRoleId: 'pr-1', decision: 'changes', note },
      { ...f.deps, emailOf: async () => 'naledi@example.com' },
    );
    expect(f.sent[0].text).toContain(note);
    expect(f.sent[0].text).toContain('https://tv.test/offer');
    expect(f.bells[0]).toEqual(expect.objectContaining({ body: note, link: '/offer' }));
  });
});

// ─── Words ───────────────────────────────────────────────────────────────────

describe('request status words', () => {
  const all: RequestStatus[] = ['requested', 'accepted', 'confirmed', 'completed', 'declined', 'withdrawn'];

  it('an unconfirmed request is never called a booking', () => {
    expect(requestHeading('requested', 'client')).toBe('Your request');
    expect(requestHeading('accepted', 'client')).toBe('Your request');
    expect(requestHeading('confirmed', 'client')).toBe('Your booking');
    expect(requestHeading('requested', 'person')).toBe('A request for you');
  });

  it('nothing promises held payment, refunds or replacements', () => {
    for (const s of all) {
      for (const v of ['client', 'person'] as const) {
        const w = requestStatusWords(s, v) + requestStatusLabel(s, v);
        expect(w).not.toMatch(/held|hold your payment|refund|replacement/i);
        expect(w).not.toMatch(DASH);
      }
    }
    expect(ROLES_POLICY.copy.promise).not.toMatch(/hold your payment|refund|replacement/i);
  });

  it('the client is told when they hear back and how they pay', () => {
    const w = requestStatusWords('requested', 'client');
    expect(w).toContain(`within ${ROLES_POLICY.requests.replyWithinWorkingDays} working day`);
    expect(w).toContain('EFT');
    expect(w).toContain('Nothing is paid now');
  });

  it('each side reads its own words', () => {
    expect(requestStatusWords('requested', 'person')).not.toBe(requestStatusWords('requested', 'client'));
    expect(requestStatusLabel('accepted', 'person')).toBe('Waiting for the client to pay');
    expect(requestStatusLabel('accepted', 'client')).toBe('They can do it: pay to confirm');
  });

  it('bank details only for the client, only once accepted', () => {
    expect(showPaymentDetails('accepted', 'client')).toBe(true);
    expect(showPaymentDetails('requested', 'client')).toBe(false);
    expect(showPaymentDetails('accepted', 'person')).toBe(false);
  });

  it('accepted stays blind: names and faces only once paid', () => {
    const b = { client_id: 'c', person_user_id: 'p' };
    expect(reveal({ ...b, status: 'accepted' }, 'c').personIdentity).toBe(false);
    expect(reveal({ ...b, status: 'confirmed' }, 'c').personIdentity).toBe(true);
  });

  it('emails use no dashes and end in plain next steps', () => {
    const mails = [
      ownerNewRequestEmail({ ...facts, client: loaded.client, person: loaded.person, address: null, note: null }, 'https://x'),
      personNewRequestEmail(facts, 'https://x'),
      clientRequestReceivedEmail(facts, 'https://x'),
      clientAcceptedEmail(facts, 'https://x'),
      clientDeclinedEmail(facts, 'https://x', null),
      profileApprovedEmail('Make-up artist', 'pr', 'https://x'),
      profileSentBackEmail('Make-up artist', 'note', 'https://x'),
    ];
    for (const m of mails) {
      expect(m.subject).not.toMatch(DASH);
      expect(m.text).not.toMatch(DASH);
    }
    for (const s of REQUEST_NEXT_STEPS) expect(clientRequestReceivedEmail(facts, 'https://x').text).toContain(s);
  });
});

describe('what a person earns (B8): 15% of the price before VAT', () => {
  it('R1 500 a day: the client pays R1 500, the person gets R1 275', () => {
    expect(STUDIO.creators.commissionRate).toBe(15);
    expect(personEarnings(150_000)).toEqual({ clientPaysCents: 150_000, cutCents: 22_500, youGetCents: 127_500, percent: 15 });
    const line = earningsLine('day', 150_000);
    expect(line).toContain('Clients see and pay R1');
    expect(line).toContain('You get R1');
    expect(line).toContain('15% of the price before VAT');
  });
});

describe('the Offer status screen (B5, B6, B7)', () => {
  const base = { reviewerNote: null, personRoleId: 'pr-1', roleName: 'Make-up artist', identity: 'verified' as const };

  it('a draft shows the form', () => {
    expect(offerStatusView({ ...base, status: 'draft' })).toBeNull();
  });

  it('in review: with our team, 2 working days', () => {
    const v = offerStatusView({ ...base, status: 'submitted' })!;
    expect(v.title).toBe('With our team');
    expect(v.lines.join(' ')).toContain('2 working days');
  });

  it('approved: live, with a link to the profile', () => {
    const v = offerStatusView({ ...base, status: 'approved' })!;
    expect(v.title).toBe('Approved: your profile is live');
    expect(v.primary).toEqual({ label: 'See your profile', href: '/people/pr-1' });
  });

  it('sent back: shows the reviewer note', () => {
    const v = offerStatusView({ ...base, status: 'changes_requested', reviewerNote: 'Retake the photo.' })!;
    expect(v.title).toBe('Sent back: here is what to change');
    expect(v.note).toBe('Retake the photo.');
  });

  it('asks for the ID check until it is done, and says approval waits for it', () => {
    expect(idCheckLine('verified')).toEqual({ text: 'Your ID check is done.', action: null });
    expect(idCheckLine('none').action).toEqual({ label: 'Do my ID check', href: '/dashboard/verification' });
    expect(idCheckLine('none').text).toContain('approve your profile only once it passes');
    expect(idCheckLine('rejected').action?.href).toBe('/dashboard/verification');
    expect(idCheckLine('pending').action).toBeNull();
    expect(identityState('verified')).toBe('verified');
    expect(identityState(null)).toBe('none');
  });

  it('picks the profile that needs them most; a draft-only person gets the form', () => {
    const mine = [
      { status: 'approved' as const, role_slug: 'driver' },
      { status: 'changes_requested' as const, role_slug: 'make-up-artist' },
    ];
    expect(profileToShow(mine, null)?.role_slug).toBe('make-up-artist');
    expect(profileToShow([{ status: 'draft' as const, role_slug: 'model' }], null)).toBeNull();
    expect(profileToShow(mine, 'driver')?.status).toBe('approved');
    expect(profileToShow(mine, 'model')).toBeNull();
  });
});

// ─── Flag gating ─────────────────────────────────────────────────────────────

describe('reminder emails follow roles_v1 (C21)', () => {
  const base = { nudge: 1, firstName: 'Sipho', cartItems: 0 };

  it('People on: supply goes to /offer, hire to /people', () => {
    const supply = nudgeContent({ ...base, reason: 'onboarding_step_1', intent: 'supply', people: true });
    expect(supply.cta?.href).toBe('/offer');
    expect(supply.subject).not.toContain('Step 1 of 4');
    const hire = nudgeContent({ ...base, reason: 'intent_only', intent: 'hire', people: true });
    expect(hire.cta).toEqual({ label: 'See people', href: '/people' });
    expect(JSON.stringify(hire)).not.toContain('package');
  });

  it('People off: unchanged', () => {
    expect(nudgeContent({ ...base, reason: 'onboarding_step_1', intent: 'supply' }).cta?.href).toBe('/onboarding');
    expect(nudgeContent({ ...base, reason: 'intent_only', intent: 'hire' }).cta?.href).toBe('/studio');
  });

  it('tailored steps point at People when it is on', () => {
    const p: TailoredProfile = {
      userId: 'u', firstName: null, intent: 'hire', role: 'renter', skills: [], specializations: [], area: null, bio: null,
      yearsExperience: null, hasAvatar: false, hasRate: false, availableForHire: false, portfolioItems: 0, verified: true,
      listingTitles: [], publishedListings: 0, draftListings: 0, bookingsAsClient: 0, gigs: 0, categories: [],
    };
    expect(tailoredSteps({ ...p, people: true }).map((s) => s.href)).toContain('/people');
    expect(tailoredSteps(p).map((s) => s.href)).toContain('/studio');
    const creator = tailoredSteps({ ...p, role: 'creator', people: true }).map((s) => s.href);
    expect(creator).toEqual(['/offer']);
  });
});

describe('old creator dashboard areas hide with People on (C11)', () => {
  it('People on: one People profile entry, no Gigs, Portfolio or Pricing Guide', () => {
    const studio = sidebarGroups(true, true, true).find((g) => g.title === 'Studio')!.items.map((i) => i.label);
    expect(studio).toEqual(['My People profile', 'Listings', 'Orders']);
    const account = sidebarGroups(false, true, true).find((g) => g.title === 'Account')!.items.map((i) => i.href);
    expect(account).toContain('/offer');
  });

  it('People off: unchanged', () => {
    const studio = sidebarGroups(true, true).find((g) => g.title === 'Studio')!.items.map((i) => i.label);
    expect(studio).toEqual(['Gigs', 'Portfolio', 'Listings', 'Orders', 'Pricing Guide']);
  });
});

describe('Today shows People work (C17)', () => {
  const NOW = new Date('2026-10-13T08:00:00Z');
  const ago = (h: number): string => new Date(NOW.getTime() - h * 3_600_000).toISOString();
  const today = (over: Partial<TodayFacts>): TodayFacts => ({
    now: NOW, idChecks: [], disputes: [], requests: [], serviceBookings: [], gearBookings: [], welcomeDrafts: 0, bugs: [],
    pressDrafts: [], findings: [], lastCheckRun: ago(1), ownerPayouts: [], refunds: [], listings: [], ai: null, chats: [],
    signups: [], payments: 'live', ...over,
  });

  it('a waiting request and a profile in review are on Today, with menu counts', () => {
    const f = today({
      peopleRequests: [{ id: 'r1', status: 'requested', client: 'Lerato', roleName: 'Make-up artist', firstDate: '2026-11-02', area: 'Soweto', createdAt: ago(2), respondedAt: null }],
      peopleProfiles: [{ id: 'p1', person: 'Naledi', roleName: 'Driver', submittedAt: ago(3) }],
    });
    const needs = buildNeeds(f);
    expect(needs.find((n) => n.id === 'peoplereq:r1')).toEqual(expect.objectContaining({ title: 'Lerato asked to book a make-up artist', action: { label: 'Answer', href: '/admin/roles/requests' } }));
    expect(needs.find((n) => n.id === 'peopleprofile:p1')?.title).toBe("Check Naledi's driver profile");
    const view = buildToday(f, {});
    expect(view.counts.peopleRequests).toBe(1);
    expect(view.counts.peopleProfiles).toBe(1);
  });

  it('an accepted request waits on the EFT, under money', () => {
    const [n] = buildNeeds(today({ peopleRequests: [{ id: 'r2', status: 'accepted', client: 'Lerato', roleName: 'Driver', firstDate: '2026-11-02', area: 'Soweto', createdAt: ago(30), respondedAt: ago(5) }] }));
    expect(n).toEqual(expect.objectContaining({ id: 'peoplepay:r2', area: 'money' }));
  });

  it('People off (null): nothing extra', () => {
    expect(buildNeeds(today({ peopleRequests: null, peopleProfiles: null }))).toEqual([]);
  });

  it('the menu has the People requests screen', () => {
    expect(sectionForPath('/admin/roles/requests')).toBe('bookings');
    expect(toolForPath('/admin/roles/requests')?.label).toBe('People requests');
  });
});

describe('a studio-only cart asks no collect or deliver question (C2)', () => {
  it('only studios', () => {
    expect(onlyOnSiteItems([{ rental: { category: 'studios' } }])).toBe(true);
    expect(onlyOnSiteItems([{ rental: { category: 'studios' } }, { rental: { category: 'cameras-optics' } }])).toBe(false);
    expect(onlyOnSiteItems([])).toBe(false);
    const note = studioUseNote('Dainfern', 'Johannesburg');
    expect(note).toContain('nothing to collect or deliver');
    expect(note).not.toMatch(DASH);
  });
});

describe('Ubunye carries no package prices or /book links with People on (B4)', () => {
  const data: CachedData = {
    rentals: '', productions: 'Wedding day (2026) [wedding] View: /studio/wedding', press: '', careers: '', creators: '', listings: '', plans: '', services: '', crew: '',
  };
  it('People on: no /book and no fixed package line', () => {
    const p = buildSystemPrompt(data, null, { smart_productions: true, roles_v1: true, payments_open: true });
    expect(p).not.toContain('/book');
    expect(p).not.toContain('have the fixed price shown there');
  });
  it('People off: the package rules stay', () => {
    expect(buildSystemPrompt(data, null, { smart_productions: true })).toContain('/book?production=');
  });
});
