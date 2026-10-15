import { DELIVERY_CHECKOUT } from '@/lib/constants';
import { formatRand } from '@/lib/format/money';
import { PAYOUT_BLOCK_WORDS } from '@/lib/core/services/fulfilment';
import type { CountKey, SectionId } from './sections';

/**
 * The Today page, worked out from rows already read. Pure: no database, no
 * clock of its own, so every rule here is tested (tests/unit/admin-today.test.ts).
 *
 * Every list arrives as `null` when its table is not on this database yet
 * (migrations 067 to 081 are still waiting on production). The page then says
 * so instead of pretending nothing is waiting.
 */

// ─── What the loader hands over ──────────────────────────────────────────────

export interface IdCheckRow { id: string; name: string; submittedAt: string | null }
export interface DisputeRow { id: string; kind: string; reason: string; filedBy: string; filedAt: string | null; status: string }
export interface RequestRow { id: string; client: string; what: string; createdAt: string }
export interface ServiceBookingRow {
  id: string;
  reference: string | null;
  status: string;
  payoutStatus: string | null;
  refundStatus: string | null;
  client: string;
  creator: string;
  /** Rands. */
  total: number;
  /** Rands. */
  creatorAmount: number;
  /** Rands. */
  refundAmount: number | null;
  shootDate: string | null;
  location: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string | null;
  /** When the creator's payout may go (after the client's dispute window). Null where not recorded. */
  payoutDueAt?: string | null;
  /** Why the last payout attempt was refused, as recorded by the payout run. */
  payoutError?: string | null;
}
export interface GearBookingRow {
  id: string;
  status: string;
  paymentMethod: string | null;
  fulfilment: string | null;
  /** YYYY-MM-DD */
  start: string;
  /** YYYY-MM-DD */
  end: string;
  gear: string;
  renter: string;
  /** Rands. */
  total: number;
  /** Rands still to pay, when the booking is paid in parts or by EFT. */
  amountDue: number | null;
  createdAt: string;
  /** The renter passed the ID check; only then may gear leave. */
  renterVerified?: boolean;
  /** For a cancelled booking: the refund still to settle. */
  refundStatus?: string | null;
  /** Rands. */
  refundAmount?: number | null;
  /** Paid by EFT or cash (a manual: payment reference). */
  handPaid?: boolean;
}
export interface BugRow { id: string; title: string; severity: string | null; createdAt: string }
export interface DraftRow { id: string; title: string; updatedAt: string | null }
export interface FindingRow { id: string; severity: string; title: string; lastSeen: string }
export interface OwnerPayoutRow { id: string; owner: string; amountCents: number; holdReasons: string[]; scheduledAt: string }
export interface RefundRow { id: string; state: string; amountCents: number; reason: string; createdAt: string }
export interface ListingRow { id: string; title: string; owner: string; createdAt: string }
export interface ChatRow { agentId: string | null; startedAt: string }
export interface SignupRow { id: string; name: string; createdAt: string }
/** A People request still waiting on us (095): requested (answer it) or accepted (watch for the EFT). */
export interface PeopleRequestRow { id: string; status: 'requested' | 'accepted'; client: string; roleName: string; firstDate: string; area: string; createdAt: string; respondedAt: string | null }
/** A People profile sent for review. */
export interface PeopleProfileRow { id: string; person: string; roleName: string; submittedAt: string | null }

export interface TodayFacts {
  now: Date;
  idChecks: IdCheckRow[] | null;
  disputes: DisputeRow[] | null;
  requests: RequestRow[] | null;
  serviceBookings: ServiceBookingRow[] | null;
  gearBookings: GearBookingRow[] | null;
  welcomeDrafts: number | null;
  bugs: BugRow[] | null;
  pressDrafts: DraftRow[] | null;
  findings: FindingRow[] | null;
  lastCheckRun: string | null;
  /** null: the rental money system (migration 070) is not on this database. */
  ownerPayouts: OwnerPayoutRow[] | null;
  refunds: RefundRow[] | null;
  /** null: listing review (migration 072) is not on this database. */
  listings: ListingRow[] | null;
  ai: { spent: number; budget: number } | null;
  chats: ChatRow[] | null;
  signups: SignupRow[] | null;
  payments: 'live' | 'test' | 'off';
  /** Lifecycle emails and push (087). Undefined or null: not on this database. */
  engagement?: { sentToday: number; waiting: number; failed: number } | null;
  /** People (roles_v1). Undefined or null: People is off or not on this database. */
  peopleRequests?: PeopleRequestRow[] | null;
  peopleProfiles?: PeopleProfileRow[] | null;
}

// ─── What the page shows ─────────────────────────────────────────────────────

export type Urgency = 'now' | 'today' | 'soon';
export type Tone = 'good' | 'watch' | 'bad' | 'quiet';

export interface NeedItem {
  id: string;
  urgency: Urgency;
  area: SectionId;
  title: string;
  detail: string;
  action: { label: string; href: string };
  since: string | null;
  /** "3 hours ago", worked out on the server so the page reads the same everywhere. */
  waiting?: string;
}

export interface Movement {
  id: string;
  day: 'today' | 'tomorrow';
  kind: 'out' | 'back' | 'shoot';
  what: string;
  who: string;
  how: string;
  late: boolean;
  href: string;
  /** Something to sort before this can happen, e.g. "ID not checked". */
  warn?: string;
}

export interface MoneyTile {
  label: string;
  value: string;
  note: string;
  href: string;
  tone: Tone;
}

export interface HealthLight {
  label: string;
  tone: Tone;
  detail: string;
  href?: string;
}

export interface ActivityItem {
  id: string;
  at: string;
  text: string;
  href: string;
  /** "2 hours ago" */
  ago?: string;
}

export interface AgentLine {
  id: string;
  name: string;
  today: number;
  month: number;
}

export interface TodayView {
  greeting: string;
  dateLabel: string;
  needs: NeedItem[];
  movements: Movement[];
  money: MoneyTile[];
  health: HealthLight[];
  activity: ActivityItem[];
  agents: AgentLine[];
  ai: { spent: number; budget: number; ratio: number } | null;
  counts: Partial<Record<CountKey, number>>;
  /** How many "needs you" items belong to each menu section. */
  areas: Partial<Record<SectionId, number>>;
  /** Parts of the business this database cannot show yet. */
  notSetUp: string[];
}

// ─── Dates in South African time ─────────────────────────────────────────────

const ZONE = DELIVERY_CHECKOUT.timeZone;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** YYYY-MM-DD for a moment, in South African time. */
export function saDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function saHour(d: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', hourCycle: 'h23' }).format(d));
}

function ageMs(now: Date, iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? now.getTime() - t : 0;
}

/** "3 hours ago", "2 days ago": short and plain. */
export function ago(now: Date, iso: string | null | undefined): string {
  if (!iso) return '';
  const ms = ageMs(now, iso);
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  const mo = Math.floor(d / 30);
  return `${mo} month${mo === 1 ? '' : 's'} ago`;
}

const rand = (n: number): string => formatRand(n);

const HOLD_WORDS: Record<string, string> = {
  ...PAYOUT_BLOCK_WORDS,
  owner_not_verified: 'the owner has not passed the ID check',
  inspection_not_completed: 'the returned gear is not checked yet',
  deposit_not_settled: 'the deposit is not settled yet',
  payout_already_started: 'a payout is already under way',
  delay_not_elapsed: 'the waiting period after the return has not passed',
};

/** Turns codes like payout_account_not_validated into plain words, leaving other text alone. */
export function payoutWords(text: string): string {
  return text.replace(/\b[a-z]+(?:_[a-z]+)+\b/g, (code) => HOLD_WORDS[code] ?? code.replace(/_/g, ' '));
}
const randCents = (c: number): string => formatRand(c / 100);
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

// ─── Needs you ───────────────────────────────────────────────────────────────

const URGENCY_ORDER: Record<Urgency, number> = { now: 0, today: 1, soon: 2 };

/** Why a rental refund exists (refund_obligations.reason), in plain words. */
const REFUND_REASON: Record<string, string> = {
  deposit_settlement: 'The deposit back after a return',
  cancellation: 'A refund for a cancelled booking',
  late_payment: 'A refund for a payment that came in too late',
  overpayment: 'A refund of money paid twice or too much',
  manual: 'A refund staff gave on a cancellation',
};

/**
 * Everything that waits on a person, one line each with one button.
 * Order: most urgent first, then the oldest first (it has waited longest).
 */
export function buildNeeds(f: TodayFacts): NeedItem[] {
  const out: NeedItem[] = [];
  const today = saDay(f.now);

  for (const d of f.disputes ?? []) {
    out.push({
      id: `dispute:${d.id}`,
      urgency: d.status === 'escalated' || ageMs(f.now, d.filedAt) > DAY ? 'now' : 'today',
      area: 'help',
      title: `${d.filedBy} opened a dispute`,
      detail: [d.kind === 'equipment' ? 'Gear hire' : d.kind === 'service' ? 'Crew booking' : null, d.reason].filter(Boolean).join(': '),
      action: { label: 'Look into it', href: '/admin/disputes' },
      since: d.filedAt,
    });
  }

  for (const b of f.gearBookings ?? []) {
    if (b.status === 'cancelled') {
      if (b.refundStatus === 'pending' && b.handPaid && (b.refundAmount ?? 0) > 0) {
        out.push({
          id: `handrefund:${b.id}`,
          urgency: 'today',
          area: 'money',
          title: `Pay ${b.renter} back ${rand(b.refundAmount ?? 0)}`,
          detail: `Their ${b.gear} booking was cancelled and they paid by EFT or cash, so the refund goes from the bank. Record it once paid.`,
          action: { label: 'Record refund', href: `/admin/bookings?open=${b.id}` },
          since: null,
        });
      }
      continue;
    }
    if (b.status === 'return_pending') {
      out.push({
        id: `return:${b.id}`,
        urgency: 'now',
        area: 'bookings',
        title: `Check the ${b.gear} that came back`,
        detail: `Returned by ${b.renter}. The deposit waits until you check it.`,
        action: { label: 'Check return', href: `/admin/rentals/${b.id}/return` },
        since: null,
      });
    } else if (b.status === 'overdue' || ((b.status === 'active' || b.status === 'confirmed') && b.end < today && b.start <= today)) {
      out.push({
        id: `late:${b.id}`,
        urgency: 'now',
        area: 'bookings',
        title: `${b.gear} is late back`,
        detail: `${b.renter} was due to return it on ${dayLabel(b.end, today)}.`,
        action: { label: 'Open booking', href: `/admin/bookings?open=${b.id}` },
        since: null,
      });
    } else if (b.status === 'pending' && b.paymentMethod === 'eft') {
      const owed = b.amountDue ?? b.total;
      out.push({
        id: `eft:${b.id}`,
        urgency: b.start <= addDays(today, 1) ? 'now' : 'today',
        area: 'money',
        title: `Confirm ${b.renter}'s EFT of ${rand(owed)}`,
        detail: `For ${b.gear}, from ${dayLabel(b.start, today)}. Check the bank, then mark it paid.`,
        action: { label: 'Mark paid', href: `/admin/bookings?open=${b.id}` },
        since: b.createdAt,
      });
    }
  }

  for (const s of f.serviceBookings ?? []) {
    const ref = s.reference ? ` (${s.reference})` : '';
    if (s.status === 'pending_reassignment') {
      out.push({
        id: `reassign:${s.id}`,
        urgency: 'now',
        area: 'bookings',
        title: `Find a new creator for ${s.client}`,
        detail: `${s.creator} cannot do this booking${ref}.`,
        action: { label: 'Choose creator', href: `/admin/service-bookings?open=${s.id}` },
        since: s.updatedAt,
      });
    }
    if (s.refundStatus === 'failed' || s.refundStatus === 'manual_review') {
      out.push({
        id: `srefund:${s.id}`,
        urgency: 'now',
        area: 'money',
        title: `Refund ${s.client}${s.refundAmount ? ` ${rand(s.refundAmount)}` : ''}`,
        detail: s.refundStatus === 'failed' ? `The automatic refund failed${ref}.` : `This refund needs a person to decide${ref}.`,
        action: { label: 'Sort refund', href: `/admin/service-bookings?open=${s.id}` },
        since: s.updatedAt,
      });
    }
    // A creator is paid once the client's dispute window has passed (payout_due_at).
    // Before that nothing needs doing; a refused attempt says why in plain words.
    const payoutDue = !s.payoutDueAt || new Date(s.payoutDueAt).getTime() <= f.now.getTime();
    if (s.status === 'completed' && (s.payoutStatus === 'pending' || s.payoutStatus === 'failed') && (payoutDue || s.payoutStatus === 'failed')) {
      const blocked = Boolean(s.payoutError) || s.payoutStatus === 'failed';
      out.push({
        id: `spayout:${s.id}`,
        urgency: blocked ? 'now' : 'today',
        area: 'money',
        title: blocked ? `${s.creator}'s payout of ${rand(s.creatorAmount)} is held up` : `Pay ${s.creator} ${rand(s.creatorAmount)}`,
        detail: s.payoutError
          ? `Waiting for: ${payoutWords(s.payoutError.replace(/^[^:]*:\s*/, ''))}${ref}.`
          : s.payoutStatus === 'failed'
            ? `The last payout attempt failed${ref}.`
            : `The work for ${s.client} is done and the client's time to complain has passed${ref}.`,
        action: { label: blocked ? 'See why' : 'Pay creator', href: `/admin/service-bookings?open=${s.id}` },
        since: s.updatedAt,
      });
    }
    if (s.status === 'paid' && ageMs(f.now, s.paidAt) > DAY) {
      out.push({
        id: `accept:${s.id}`,
        urgency: 'today',
        area: 'bookings',
        title: `${s.creator} has not accepted ${s.client}'s booking`,
        detail: `Paid ${ago(f.now, s.paidAt)}${ref}. Remind them or find someone else.`,
        action: { label: 'Open booking', href: `/admin/service-bookings?open=${s.id}` },
        since: s.paidAt,
      });
    }
  }

  for (const p of f.ownerPayouts ?? []) {
    const ready = p.holdReasons.length === 0;
    out.push({
      id: `opayout:${p.id}`,
      urgency: ready ? 'today' : 'soon',
      area: 'money',
      title: ready ? `Approve ${p.owner}'s payout of ${randCents(p.amountCents)}` : `${p.owner}'s payout of ${randCents(p.amountCents)} is on hold`,
      detail: ready ? 'Every check passed. It goes out once you approve.' : `Waiting for: ${p.holdReasons.map(payoutWords).join(', ')}.`,
      action: { label: ready ? 'Approve' : 'See why', href: '/admin/rental-ops' },
      since: p.scheduledAt,
    });
  }

  for (const r of f.refunds ?? []) {
    if (r.state !== 'failed' && r.state !== 'needs_attention') continue;
    out.push({
      id: `refund:${r.id}`,
      urgency: 'now',
      area: 'money',
      title: `A refund of ${randCents(r.amountCents)} did not go through`,
      detail: `${REFUND_REASON[r.reason] ?? 'A refund'} could not be sent. Retry it, or check the payment provider first.`,
      action: { label: 'Retry refund', href: '/admin/rental-ops' },
      since: r.createdAt,
    });
  }

  for (const v of f.idChecks ?? []) {
    out.push({
      id: `id:${v.id}`,
      urgency: ageMs(f.now, v.submittedAt) > DAY ? 'now' : 'today',
      area: 'people',
      title: `Check ${v.name}'s ID`,
      detail: 'They cannot take bookings until you approve it.',
      action: { label: 'Check ID', href: '/admin/verifications' },
      since: v.submittedAt,
    });
  }

  for (const r of f.requests ?? []) {
    out.push({
      id: `request:${r.id}`,
      urgency: ageMs(f.now, r.createdAt) > DAY ? 'now' : 'today',
      area: 'bookings',
      title: `${r.client} wants to book a creator`,
      detail: r.what,
      action: { label: 'Reply', href: `/admin/creator-requests?open=${r.id}` },
      since: r.createdAt,
    });
  }

  for (const r of f.peopleRequests ?? []) {
    if (r.status === 'requested') {
      out.push({
        id: `peoplereq:${r.id}`,
        urgency: ageMs(f.now, r.createdAt) > DAY ? 'now' : 'today',
        area: 'bookings',
        title: `${r.client} asked to book a ${r.roleName.toLowerCase()}`,
        detail: `${r.firstDate} in ${r.area}. Check the date with them, then answer the client. Nothing is paid yet.`,
        action: { label: 'Answer', href: '/admin/roles/requests' },
        since: r.createdAt,
      });
    } else {
      out.push({
        id: `peoplepay:${r.id}`,
        urgency: 'soon',
        area: 'money',
        title: `Watch for ${r.client}'s EFT`,
        detail: `${r.roleName}, ${r.firstDate}. Mark it paid when it shows, so the booking is confirmed.`,
        action: { label: 'Open', href: '/admin/roles/requests?group=accepted' },
        since: r.respondedAt ?? r.createdAt,
      });
    }
  }

  for (const p of f.peopleProfiles ?? []) {
    out.push({
      id: `peopleprofile:${p.id}`,
      urgency: ageMs(f.now, p.submittedAt) > 2 * DAY ? 'now' : 'today',
      area: 'people',
      title: `Check ${p.person}'s ${p.roleName.toLowerCase()} profile`,
      detail: 'Sent for review. We promise an answer within 2 working days.',
      action: { label: 'Review', href: '/admin/roles' },
      since: p.submittedAt,
    });
  }

  for (const l of f.listings ?? []) {
    out.push({
      id: `listing:${l.id}`,
      urgency: 'today',
      area: 'gear',
      title: `Approve ${l.owner}'s ${l.title}`,
      detail: 'New gear listed for hire. It stays hidden until you approve it.',
      action: { label: 'Review', href: '/admin/listings' },
      since: l.createdAt,
    });
  }

  if (f.welcomeDrafts && f.welcomeDrafts > 0) {
    out.push({
      id: 'welcomes',
      urgency: 'soon',
      area: 'people',
      title: `${plural(f.welcomeDrafts, 'welcome message')} ready to send`,
      detail: 'New people are waiting for their hello. Read, then send.',
      action: { label: 'Send', href: '/admin/welcomes' },
      since: null,
    });
  }

  for (const b of f.bugs ?? []) {
    out.push({
      id: `bug:${b.id}`,
      urgency: b.severity === 'critical' || b.severity === 'high' ? 'today' : 'soon',
      area: 'help',
      title: `Bug report: ${b.title}`,
      detail: b.severity ? `Marked ${b.severity}.` : 'Someone found a problem on the site.',
      action: { label: 'Read it', href: '/admin/bug-reports' },
      since: b.createdAt,
    });
  }

  for (const p of f.pressDrafts ?? []) {
    out.push({
      id: `press:${p.id}`,
      urgency: 'soon',
      area: 'content',
      title: `Press story draft: ${p.title || 'Untitled'}`,
      detail: p.updatedAt ? `Last edited ${ago(f.now, p.updatedAt)}.` : 'Not published yet.',
      action: { label: 'Finish', href: '/admin/press' },
      since: p.updatedAt,
    });
  }

  return out
    .sort((a, b) => {
      const u = URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency];
      if (u !== 0) return u;
      return ageMs(f.now, b.since) - ageMs(f.now, a.since);
    })
    .map((n) => ({ ...n, waiting: n.since ? ago(f.now, n.since) : '' }));
}

// ─── Today's movements ───────────────────────────────────────────────────────

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dayLabel(day: string, today: string): string {
  if (day === today) return 'today';
  if (day === addDays(today, 1)) return 'tomorrow';
  if (day === addDays(today, -1)) return 'yesterday';
  const d = new Date(`${day}T12:00:00Z`);
  return d.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

const LIVE_GEAR = new Set(['confirmed', 'active', 'overdue']);
const LIVE_SHOOT = new Set(['paid', 'accepted']);

/** What leaves, what comes back and which shoots happen, today and tomorrow. */
export function buildMovements(f: TodayFacts): Movement[] {
  const today = saDay(f.now);
  const tomorrow = addDays(today, 1);
  const out: Movement[] = [];

  for (const b of f.gearBookings ?? []) {
    if (!LIVE_GEAR.has(b.status)) continue;
    const delivery = b.fulfilment === 'delivery';
    if ((b.start === today || b.start === tomorrow) && b.status === 'confirmed') {
      const checked = b.renterVerified !== false;
      out.push({
        id: `out:${b.id}`,
        day: b.start === today ? 'today' : 'tomorrow',
        kind: 'out',
        what: b.gear,
        who: b.renter,
        how: delivery ? 'We deliver' : 'They collect',
        late: false,
        // A collection is handed over at the counter; a delivery and anything to sort first open the booking.
        href: delivery || !checked ? `/admin/bookings?open=${b.id}` : `/admin/rentals/${b.id}/handover`,
        ...(checked ? {} : { warn: 'ID not checked' }),
      });
    }
    if (b.end === today || b.end === tomorrow || (b.end < today && b.start <= today)) {
      out.push({
        id: `back:${b.id}`,
        day: b.end === tomorrow ? 'tomorrow' : 'today',
        kind: 'back',
        what: b.gear,
        who: b.renter,
        how: delivery ? 'We collect' : 'They drop off',
        late: b.end < today || b.status === 'overdue',
        href: delivery ? `/admin/bookings?open=${b.id}` : `/admin/rentals/${b.id}/return`,
      });
    }
  }

  for (const s of f.serviceBookings ?? []) {
    if (!s.shootDate || !LIVE_SHOOT.has(s.status)) continue;
    const day = s.shootDate.slice(0, 10);
    if (day !== today && day !== tomorrow) continue;
    out.push({
      id: `shoot:${s.id}`,
      day: day === today ? 'today' : 'tomorrow',
      kind: 'shoot',
      what: `Shoot for ${s.client}`,
      who: s.creator,
      how: s.location ?? (s.status === 'paid' ? 'Not accepted yet' : 'Confirmed'),
      late: false,
      href: `/admin/service-bookings?open=${s.id}`,
      ...(s.status === 'paid' ? { warn: 'Not accepted yet' } : {}),
    });
  }

  const order = { today: 0, tomorrow: 1 } as const;
  const kinds = { back: 0, out: 1, shoot: 2 } as const;
  return out.sort((a, b) => order[a.day] - order[b.day] || Number(b.late) - Number(a.late) || kinds[a.kind] - kinds[b.kind]);
}

// ─── Money ───────────────────────────────────────────────────────────────────

const PAID_GEAR = new Set(['confirmed', 'active', 'return_pending', 'return_reviewed', 'completed', 'overdue']);

export function buildMoney(f: TodayFacts): MoneyTile[] {
  const weekAgo = f.now.getTime() - 7 * DAY;
  const tiles: MoneyTile[] = [];

  let takings = 0;
  let paidCount = 0;
  for (const s of f.serviceBookings ?? []) {
    if (s.paidAt && new Date(s.paidAt).getTime() >= weekAgo) {
      takings += s.total;
      paidCount++;
    }
  }
  for (const b of f.gearBookings ?? []) {
    if (PAID_GEAR.has(b.status) && new Date(b.createdAt).getTime() >= weekAgo) {
      takings += b.total;
      paidCount++;
    }
  }
  tiles.push({
    label: 'Paid bookings, last 7 days',
    value: rand(takings),
    note: paidCount ? plural(paidCount, 'booking') : 'No paid bookings this week',
    href: '/admin/bookings',
    tone: paidCount ? 'good' : 'quiet',
  });

  let owed = 0;
  let owedCount = 0;
  for (const s of f.serviceBookings ?? []) {
    if ((s.status === 'completed' || s.status === 'delivered') && s.payoutStatus !== 'paid') {
      owed += s.creatorAmount;
      owedCount++;
    }
  }
  for (const p of f.ownerPayouts ?? []) {
    owed += p.amountCents / 100;
    owedCount++;
  }
  tiles.push({
    label: 'Owed to creators and owners',
    value: rand(owed),
    note: owedCount ? plural(owedCount, 'payout') + ' waiting' : 'Nobody is waiting to be paid',
    // Owner payouts live in Payouts and refunds; creator payouts on the crew bookings page.
    href: (f.ownerPayouts ?? []).length ? '/admin/rental-ops' : '/admin/service-bookings',
    tone: owedCount ? 'watch' : 'quiet',
  });

  let refunds = 0;
  let refundCount = 0;
  for (const s of f.serviceBookings ?? []) {
    if (s.refundStatus === 'pending' || s.refundStatus === 'failed' || s.refundStatus === 'manual_review') {
      refunds += s.refundAmount ?? 0;
      refundCount++;
    }
  }
  for (const b of f.gearBookings ?? []) {
    if (b.status === 'cancelled' && b.refundStatus === 'pending' && b.handPaid) {
      refunds += b.refundAmount ?? 0;
      refundCount++;
    }
  }
  for (const r of f.refunds ?? []) {
    refunds += r.amountCents / 100;
    refundCount++;
  }
  tiles.push({
    label: 'Refunds not finished',
    value: rand(refunds),
    note: refundCount ? plural(refundCount, 'refund') : 'None',
    href: '/admin/rental-ops',
    tone: refundCount ? 'bad' : 'quiet',
  });

  if (f.ai) {
    const ratio = f.ai.budget > 0 ? f.ai.spent / f.ai.budget : 0;
    tiles.push({
      label: 'AI spend this month',
      value: rand(f.ai.spent),
      note: `of ${rand(f.ai.budget)} limit (${Math.round(ratio * 100)}%)`,
      href: '/admin/ai',
      tone: ratio >= 1 ? 'bad' : ratio >= 0.8 ? 'watch' : 'good',
    });
  }

  return tiles;
}

// ─── Health ──────────────────────────────────────────────────────────────────

export function buildHealth(f: TodayFacts): HealthLight[] {
  const lights: HealthLight[] = [];

  lights.push(
    f.payments === 'live'
      ? { label: 'Payments', tone: 'good', detail: 'Customers can pay.' }
      : f.payments === 'test'
        ? { label: 'Payments', tone: 'bad', detail: 'Test mode: nobody can really pay yet. Live keys are needed.' }
        : { label: 'Payments', tone: 'bad', detail: 'Not connected. Customers cannot pay.' },
  );

  if (f.findings) {
    const bad = f.findings.filter((x) => x.severity === 'critical' || x.severity === 'error');
    const warn = f.findings.length - bad.length;
    const ran = f.lastCheckRun ? `Last check ${ago(f.now, f.lastCheckRun)}.` : 'The checks have not run yet.';
    if (!f.lastCheckRun && !f.findings.length) {
      lights.push({ label: 'Site checks', tone: 'watch', detail: 'The automatic checks have never run here, so problems would go unseen.' });
    } else lights.push({
      label: 'Site checks',
      tone: bad.length ? 'bad' : warn ? 'watch' : 'good',
      detail: bad.length
        ? `${plural(bad.length, 'serious problem')}: ${bad[0].title}. ${ran}`
        : warn
          ? `${plural(warn, 'thing')} to watch: ${f.findings[0].title}. ${ran}`
          : `All clear. ${ran}`,
    });
  }

  if (f.ai) {
    const ratio = f.ai.budget > 0 ? f.ai.spent / f.ai.budget : 0;
    lights.push({
      label: 'AI helpers',
      tone: ratio >= 1 ? 'bad' : ratio >= 0.8 ? 'watch' : 'good',
      detail:
        ratio >= 1
          ? 'Stopped: this month’s AI limit is used up.'
          : `${Math.round(ratio * 100)}% of this month’s limit used.`,
      href: '/admin/ai',
    });
  }

  if (f.engagement) {
    const e = f.engagement;
    lights.push({
      label: 'Customer emails',
      tone: e.failed > 0 ? 'watch' : 'good',
      detail: `${e.sentToday} sent in the last day, ${e.waiting} waiting${e.failed ? `, ${e.failed} failed` : ''}.`,
      href: '/admin/engagement',
    });
  }

  if (f.ownerPayouts === null) {
    lights.push({
      label: 'Rental money system',
      tone: 'watch',
      detail: 'Not switched on yet: the database updates (067 to 081) still need to be applied.',
    });
  }

  return lights;
}

// ─── Latest activity ─────────────────────────────────────────────────────────

export function buildActivity(f: TodayFacts, limit = 12): ActivityItem[] {
  const out: ActivityItem[] = [];
  for (const s of f.signups ?? []) out.push({ id: `signup:${s.id}`, at: s.createdAt, text: `${s.name} joined`, href: '/admin/users' });
  for (const b of f.gearBookings ?? []) {
    out.push({ id: `gear:${b.id}`, at: b.createdAt, text: `${b.renter} booked ${b.gear} for ${rand(b.total)}`, href: `/admin/bookings?open=${b.id}` });
  }
  for (const s of f.serviceBookings ?? []) {
    out.push({ id: `svc:${s.id}`, at: s.createdAt, text: `${s.client} booked ${s.creator} for ${rand(s.total)}`, href: `/admin/service-bookings?open=${s.id}` });
  }
  for (const r of f.requests ?? []) out.push({ id: `req:${r.id}`, at: r.createdAt, text: `${r.client} asked to book a creator`, href: `/admin/creator-requests?open=${r.id}` });
  for (const r of f.peopleRequests ?? []) out.push({ id: `preq:${r.id}`, at: r.createdAt, text: `${r.client} asked to book a ${r.roleName.toLowerCase()}`, href: '/admin/roles/requests' });
  for (const b of f.bugs ?? []) out.push({ id: `bug:${b.id}`, at: b.createdAt, text: `Bug reported: ${b.title}`, href: '/admin/bug-reports' });
  return out
    .filter((a) => a.at && Number.isFinite(new Date(a.at).getTime()))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, limit)
    .map((a) => ({ ...a, ago: ago(f.now, a.at) }));
}

// ─── AI helpers ──────────────────────────────────────────────────────────────

export function buildAgents(f: TodayFacts, names: Record<string, string>): AgentLine[] {
  const today = saDay(f.now);
  const lines = new Map<string, AgentLine>();
  for (const [id, name] of Object.entries(names)) lines.set(id, { id, name, today: 0, month: 0 });
  for (const c of f.chats ?? []) {
    const id = c.agentId ?? 'assistant';
    const line = lines.get(id) ?? { id, name: names[id] ?? id, today: 0, month: 0 };
    line.month++;
    if (saDay(new Date(c.startedAt)) === today) line.today++;
    lines.set(id, line);
  }
  return [...lines.values()].sort((a, b) => b.month - a.month || a.name.localeCompare(b.name));
}

// ─── The whole page ──────────────────────────────────────────────────────────

function greetingFor(now: Date): string {
  const h = saHour(now);
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function buildToday(f: TodayFacts, agentNames: Record<string, string>): TodayView {
  const needs = buildNeeds(f);
  const count = (prefix: string): number => needs.filter((n) => n.id.startsWith(prefix)).length;
  const notSetUp: string[] = [];
  if (f.ownerPayouts === null) notSetUp.push('owner payouts and rental refunds');
  if (f.listings === null) notSetUp.push('gear listing review');

  return {
    greeting: greetingFor(f.now),
    dateLabel: f.now.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', timeZone: ZONE }),
    needs,
    movements: buildMovements(f),
    money: buildMoney(f),
    health: buildHealth(f),
    activity: buildActivity(f),
    agents: buildAgents(f, agentNames),
    ai: f.ai ? { ...f.ai, ratio: f.ai.budget > 0 ? f.ai.spent / f.ai.budget : 0 } : null,
    counts: {
      idChecks: count('id:'),
      disputes: count('dispute:'),
      requests: count('request:'),
      returns: count('return:'),
      payouts: count('opayout:') + count('spayout:'),
      refunds: count('refund:') + count('srefund:') + count('handrefund:'),
      welcomes: f.welcomeDrafts ?? 0,
      bugs: count('bug:'),
      pressDrafts: count('press:'),
      listings: count('listing:'),
      peopleRequests: count('peoplereq:'),
      peopleProfiles: count('peopleprofile:'),
    },
    areas: needs.reduce<Partial<Record<SectionId, number>>>((m, n) => ({ ...m, [n.area]: (m[n.area] ?? 0) + 1 }), {}),
    notSetUp,
  };
}
