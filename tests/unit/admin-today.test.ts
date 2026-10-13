import { describe, expect, it } from 'vitest';
import {
  buildActivity,
  buildHealth,
  buildMoney,
  buildMovements,
  buildNeeds,
  buildToday,
  saDay,
  type GearBookingRow,
  type ServiceBookingRow,
  type TodayFacts,
} from '@/lib/admin/control-room/today';
import { ADMIN_SECTIONS, sectionForPath, toolForPath } from '@/lib/admin/control-room/sections';

// 10:00 in Johannesburg on Tue 13 Oct 2026.
const NOW = new Date('2026-10-13T08:00:00Z');
const TODAY = '2026-10-13';
const TOMORROW = '2026-10-14';
const YESTERDAY = '2026-10-12';
const hoursAgo = (h: number): string => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function facts(over: Partial<TodayFacts> = {}): TodayFacts {
  return {
    now: NOW,
    idChecks: [],
    disputes: [],
    requests: [],
    serviceBookings: [],
    gearBookings: [],
    welcomeDrafts: 0,
    bugs: [],
    pressDrafts: [],
    findings: [],
    lastCheckRun: hoursAgo(2),
    ownerPayouts: [],
    refunds: [],
    listings: [],
    ai: { spent: 100, budget: 500 },
    chats: [],
    signups: [],
    payments: 'live',
    ...over,
  };
}

function gear(over: Partial<GearBookingRow>): GearBookingRow {
  return {
    id: 'g1',
    status: 'confirmed',
    paymentMethod: 'card',
    fulfilment: 'collection',
    start: TODAY,
    end: TOMORROW,
    gear: 'Sony FX3',
    renter: 'Lerato M',
    total: 1200,
    amountDue: null,
    createdAt: hoursAgo(30),
    ...over,
  };
}

function service(over: Partial<ServiceBookingRow>): ServiceBookingRow {
  return {
    id: 's1',
    reference: 'TV-1001',
    status: 'paid',
    payoutStatus: 'pending',
    refundStatus: null,
    client: 'Kagiso',
    creator: 'Naledi',
    total: 3000,
    creatorAmount: 2400,
    refundAmount: null,
    shootDate: null,
    location: null,
    paidAt: hoursAgo(2),
    createdAt: hoursAgo(3),
    updatedAt: hoursAgo(1),
    ...over,
  };
}

describe('saDay', () => {
  it('uses South African time, not UTC', () => {
    // 23:30 UTC on the 12th is already 01:30 on the 13th in Johannesburg.
    expect(saDay(new Date('2026-10-12T23:30:00Z'))).toBe('2026-10-13');
  });
});

describe('buildNeeds', () => {
  it('is empty when nothing waits', () => {
    expect(buildNeeds(facts())).toEqual([]);
  });

  it('asks to check gear that came back, with a direct link', () => {
    const [n] = buildNeeds(facts({ gearBookings: [gear({ id: 'abc', status: 'return_pending' })] }));
    expect(n.title).toBe('Check the Sony FX3 that came back');
    expect(n.action.href).toBe('/admin/rentals/abc/return');
    expect(n.urgency).toBe('now');
  });

  it('flags gear that is past its return day as late', () => {
    const needs = buildNeeds(facts({ gearBookings: [gear({ status: 'active', start: '2026-10-10', end: YESTERDAY })] }));
    expect(needs).toHaveLength(1);
    expect(needs[0].title).toBe('Sony FX3 is late back');
    expect(needs[0].detail).toContain('yesterday');
  });

  it('asks to confirm an EFT with the amount still owed', () => {
    const [n] = buildNeeds(facts({ gearBookings: [gear({ id: 'e1', status: 'pending', paymentMethod: 'eft', amountDue: 900 })] }));
    expect(n.title).toContain('EFT');
    expect(n.title).toContain('900');
    expect(n.action.href).toBe('/admin/bookings?open=e1');
  });

  it('does not list a card booking that is simply pending', () => {
    expect(buildNeeds(facts({ gearBookings: [gear({ status: 'pending' })] }))).toEqual([]);
  });

  it('asks to pay a creator once the work is done, and says when the last try failed', () => {
    const done = buildNeeds(facts({ serviceBookings: [service({ status: 'completed' })] }));
    expect(done[0].title).toMatch(/^Pay Naledi /);
    expect(done[0].urgency).toBe('today');
    const failed = buildNeeds(facts({ serviceBookings: [service({ status: 'completed', payoutStatus: 'failed' })] }));
    expect(failed[0].urgency).toBe('now');
    expect(failed[0].action.label).toBe('See why');
  });

  it('waits for the payout date, and says in plain words why a payout is held up', () => {
    const notDue = buildNeeds(facts({ serviceBookings: [service({ status: 'completed', payoutDueAt: new Date(NOW.getTime() + 86_400_000).toISOString() })] }));
    expect(notDue).toEqual([]);
    const held = buildNeeds(
      facts({
        serviceBookings: [
          service({ status: 'completed', payoutDueAt: hoursAgo(1), payoutError: 'blocked: payout_account_not_validated, payment_not_confirmed' }),
        ],
      }),
    );
    expect(held[0].title).toMatch(/payout of .* is held up$/);
    expect(held[0].detail).toContain('the creator has no validated bank account');
    expect(held[0].detail).toContain('the payment provider does not confirm the payment');
    expect(held[0].action.href).toBe('/admin/service-bookings?open=s1');
  });

  it('asks to pay back a cancelled booking that was paid by hand', () => {
    const needs = buildNeeds(
      facts({ gearBookings: [gear({ id: 'c1', status: 'cancelled', refundStatus: 'pending', refundAmount: 600, handPaid: true })] }),
    );
    expect(needs).toHaveLength(1);
    expect(needs[0].title).toMatch(/^Pay Lerato M back R/);
    expect(needs[0].action.href).toBe('/admin/bookings?open=c1');
    // A card refund is the provider's job, not a hand payment.
    expect(buildNeeds(facts({ gearBookings: [gear({ status: 'cancelled', refundStatus: 'pending', refundAmount: 600, handPaid: false })] }))).toEqual([]);
  });

  it('nudges when a creator has not accepted a paid booking after a day', () => {
    expect(buildNeeds(facts({ serviceBookings: [service({ paidAt: hoursAgo(2) })] }))).toEqual([]);
    const late = buildNeeds(facts({ serviceBookings: [service({ paidAt: hoursAgo(30) })] }));
    expect(late[0].title).toBe("Naledi has not accepted Kagiso's booking");
  });

  it('separates payouts that are ready from ones on hold', () => {
    const needs = buildNeeds(
      facts({
        ownerPayouts: [
          { id: 'p1', owner: 'Thabo', amountCents: 250000, holdReasons: [], scheduledAt: hoursAgo(5) },
          { id: 'p2', owner: 'Zola', amountCents: 10000, holdReasons: ['bank not verified'], scheduledAt: hoursAgo(5) },
        ],
      }),
    );
    expect(needs.find((n) => n.id === 'opayout:p1')?.title).toMatch(/^Approve Thabo's payout of /);
    expect(needs.find((n) => n.id === 'opayout:p2')?.detail).toBe('Waiting for: bank not verified.');
  });

  it('puts urgent things first, then the ones that waited longest', () => {
    const needs = buildNeeds(
      facts({
        pressDrafts: [{ id: 'd1', title: 'Launch story', updatedAt: hoursAgo(100) }],
        idChecks: [
          { id: 'new', name: 'New person', submittedAt: hoursAgo(1) },
          { id: 'old', name: 'Old person', submittedAt: hoursAgo(48) },
        ],
        disputes: [{ id: 'x', kind: 'equipment', reason: 'damage', filedBy: 'Sipho', filedAt: hoursAgo(3), status: 'open' }],
      }),
    );
    expect(needs.map((n) => n.id)).toEqual(['id:old', 'dispute:x', 'id:new', 'press:d1']);
    expect(needs[0].waiting).toBe('2 days ago');
  });
});

describe('buildMovements', () => {
  it('lists what goes out and comes back, today and tomorrow, late first', () => {
    const moves = buildMovements(
      facts({
        gearBookings: [
          gear({ id: 'out', start: TODAY, end: '2026-10-16', fulfilment: 'delivery' }),
          gear({ id: 'late', status: 'overdue', start: '2026-10-08', end: '2026-10-11' }),
          gear({ id: 'tom', status: 'confirmed', start: TOMORROW, end: '2026-10-20' }),
          gear({ id: 'gone', status: 'completed', start: TODAY, end: TODAY }),
        ],
      }),
    );
    expect(moves.map((m) => m.id)).toEqual(['back:late', 'out:out', 'out:tom']);
    expect(moves[0].late).toBe(true);
    expect(moves[1].how).toBe('We deliver');
    expect(moves[2].day).toBe('tomorrow');
  });

  it('flags a handover whose renter is not ID-checked, and sends deliveries to the booking', () => {
    const moves = buildMovements(
      facts({
        gearBookings: [
          gear({ id: 'u', start: TODAY, renterVerified: false }),
          gear({ id: 'd', start: TODAY, fulfilment: 'delivery', renterVerified: true }),
        ],
      }),
    );
    const byId = Object.fromEntries(moves.map((m) => [m.id, m]));
    expect(byId['out:u'].warn).toBe('ID not checked');
    expect(byId['out:u'].href).toBe('/admin/bookings?open=u');
    expect(byId['out:d'].warn).toBeUndefined();
    expect(byId['out:d'].href).toBe('/admin/bookings?open=d');
  });

  it('includes shoots on the day', () => {
    const moves = buildMovements(facts({ serviceBookings: [service({ status: 'accepted', shootDate: TODAY, location: 'Soweto' })] }));
    expect(moves).toEqual([expect.objectContaining({ kind: 'shoot', how: 'Soweto', day: 'today' })]);
  });
});

describe('buildMoney', () => {
  it('adds up paid bookings this week and what is owed', () => {
    const tiles = buildMoney(
      facts({
        gearBookings: [gear({ status: 'active', total: 1000, createdAt: hoursAgo(24) }), gear({ id: 'old', status: 'completed', total: 5000, createdAt: hoursAgo(24 * 20) })],
        serviceBookings: [service({ status: 'completed', total: 3000, creatorAmount: 2400, paidAt: hoursAgo(48) })],
        ownerPayouts: [{ id: 'p', owner: 'T', amountCents: 60000, holdReasons: [], scheduledAt: hoursAgo(1) }],
      }),
    );
    const byLabel = Object.fromEntries(tiles.map((t) => [t.label, t]));
    expect(byLabel['Paid bookings, last 7 days'].note).toBe('2 bookings');
    expect(byLabel['Paid bookings, last 7 days'].value.replace(/\s/g, '')).toContain('4000');
    expect(byLabel['Owed to creators and owners'].value.replace(/\s/g, '')).toContain('3000');
  });

  it('warns as AI spend nears the limit', () => {
    const tile = buildMoney(facts({ ai: { spent: 450, budget: 500 } })).find((t) => t.label === 'AI spend this month');
    expect(tile?.tone).toBe('watch');
  });
});

describe('buildHealth', () => {
  it('says plainly when payments are in test mode', () => {
    const pay = buildHealth(facts({ payments: 'test' })).find((l) => l.label === 'Payments');
    expect(pay?.tone).toBe('bad');
    expect(pay?.detail).toContain('Test mode');
  });

  it('turns red for a serious site check finding', () => {
    const light = buildHealth(facts({ findings: [{ id: 'f', severity: 'critical', title: 'Paid booking did not move', lastSeen: hoursAgo(1) }] })).find(
      (l) => l.label === 'Site checks',
    );
    expect(light?.tone).toBe('bad');
    expect(light?.detail).toContain('Paid booking did not move');
  });

  it('warns when the automatic checks have never run, instead of saying all clear', () => {
    const light = buildHealth(facts({ findings: [], lastCheckRun: null })).find((l) => l.label === 'Site checks');
    expect(light?.tone).toBe('watch');
    expect(light?.detail).toContain('never run');
  });

  it('says when the rental money system is not on this database yet', () => {
    const lights = buildHealth(facts({ ownerPayouts: null }));
    expect(lights.some((l) => l.label === 'Rental money system')).toBe(true);
  });
});

describe('buildActivity', () => {
  it('shows the newest first with plain sentences', () => {
    const items = buildActivity(
      facts({
        signups: [{ id: 'u', name: 'Ayanda', createdAt: hoursAgo(5) }],
        gearBookings: [gear({ createdAt: hoursAgo(1) })],
      }),
    );
    expect(items[0].text).toMatch(/^Lerato M booked Sony FX3 for /);
    expect(items[1]).toEqual(expect.objectContaining({ text: 'Ayanda joined', ago: '5 hours ago' }));
  });
});

describe('buildToday', () => {
  it('counts what waits in each menu place', () => {
    const view = buildToday(
      facts({
        idChecks: [{ id: 'a', name: 'A', submittedAt: hoursAgo(1) }],
        welcomeDrafts: 3,
        listings: null,
        ownerPayouts: null,
      }),
      {},
    );
    expect(view.counts.idChecks).toBe(1);
    expect(view.counts.welcomes).toBe(3);
    expect(view.areas).toEqual({ people: 2 });
    expect(view.notSetUp).toEqual(['owner payouts and rental refunds', 'gear listing review']);
    expect(view.greeting).toBe('Good morning');
  });
});

describe('admin sections', () => {
  it('has the eight sections in order', () => {
    expect(ADMIN_SECTIONS.map((s) => s.label)).toEqual(['Today', 'Bookings', 'Money', 'People', 'Gear', 'Content', 'Help and safety', 'Settings']);
  });

  it('finds the section and screen for a page, preferring the longest link', () => {
    expect(sectionForPath('/admin')).toBe('today');
    // The handover and take-back checklists belong to bookings, not to the gear editor.
    expect(sectionForPath('/admin/rentals/abc/return')).toBe('bookings');
    expect(toolForPath('/admin/rentals/abc/handover')?.label).toBe('Gear hire bookings');
    expect(sectionForPath('/admin/rentals')).toBe('gear');
    expect(toolForPath('/admin/rentals/import')?.label).toBe('Import a rate card');
    expect(sectionForPath('/admin/verifications')).toBe('people');
  });

  it('links every existing admin screen from the menu', () => {
    const hrefs = new Set(ADMIN_SECTIONS.flatMap((s) => s.tools.map((t) => t.href)));
    for (const page of ['bookings', 'bug-reports', 'careers', 'content-repurpose', 'creator-requests', 'delivery-ops', 'disputes', 'faqs', 'flags', 'funnel', 'listings', 'outreach', 'press', 'production-categories', 'projects', 'rental-ops', 'rentals', 'service-bookings', 'users', 'verifications', 'welcomes', 'ai']) {
      expect(hrefs.has(`/admin/${page}`)).toBe(true);
    }
  });
});
