import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, forwardRef, type ReactNode } from 'react';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';

/**
 * The gear page keeps the quantity from the cart's "Edit dates" link while
 * dates are changed (also through an incomplete range), in the address and in
 * the sign-in / ID check return link; and dates that arrive in the address
 * (an older cart item, a shared link) are checked against the lead time
 * before anything else.
 */

let search = '';
let authUser: { id: string } | null = null;
// The address follows router.replace, as in the browser.
const replace = vi.fn((url: string) => {
  search = url.includes('?') ? url.split('?')[1] : '';
});
const push = vi.fn();
const addToCart = vi.fn(async () => true);
const fetchSpy = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => '/rentals/cameras/test-camera',
  useRouter: () => ({ replace, push }),
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement('a', { href, ...rest }, children),
}));
vi.mock('framer-motion', () => {
  const MOTION_PROPS = ['initial', 'animate', 'exit', 'transition', 'layout'];
  const strip = (props: Record<string, unknown>) => Object.fromEntries(Object.entries(props).filter(([k]) => !MOTION_PROPS.includes(k)));
  return {
    motion: { div: forwardRef<HTMLDivElement, Record<string, unknown>>(function MotionDiv(p, ref) { return createElement('div', { ...strip(p), ref }); }) },
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
  };
});
vi.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: authUser, loading: false }) }));
vi.mock('@/providers/CartProvider', () => ({ useCart: () => ({ addToCart, loading: false }) }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { verification_status: 'verified' } }) }) }) }) }),
}));
vi.mock('@/lib/analytics/client', () => ({ reportFunnel: vi.fn() }));

function day(daysAhead: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + daysAhead);
  return d;
}
function ymd(daysAhead: number): string {
  const d = day(daysAhead);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// A stand-in picker: buttons that pick a start only, or a whole range.
vi.mock('@/components/ui/DateRangePicker', () => ({
  DateRangePicker: ({ onChange, hint }: { onChange: (r: { start: Date | null; end: Date | null }) => void; hint?: string }) =>
    createElement(
      'div',
      null,
      createElement('button', { type: 'button', onClick: () => onChange({ start: day(20), end: null }) }, 'pick start only'),
      createElement('button', { type: 'button', onClick: () => onChange({ start: day(20), end: day(23) }) }, 'pick range'),
      hint ? createElement('p', { 'data-testid': 'range-hint' }, hint) : null,
    ),
}));

import { BookingWidget, pageHref } from '@/components/booking/BookingWidget';
import type { SmartRental } from '@/lib/supabase/queries/smartRentals';

const RENTAL = {
  id: 'r-1',
  slug: 'test-camera',
  title: 'Test Camera',
  category: 'cameras',
  price_per_day: 500,
  price_per_week: null,
  deposit_amount: 0,
  replacement_value: 20_000,
  is_available: true,
} as unknown as SmartRental;

const READY = {
  ok: true, code: null, tier: 'contactable', limitCents: 200_000, checklist: [], missing: [],
  collectionRequired: false, collectionReasons: [], requiresManualApproval: false, phoneChecksAvailable: true,
};

beforeEach(() => {
  search = '';
  authUser = null;
  for (const m of [replace, push, addToCart, fetchSpy]) m.mockClear();
  fetchSpy.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/rentals/eligibility')) return authUser ? new Response(JSON.stringify(READY), { status: 200 }) : new Response('{}', { status: 401 });
    if (url.includes('/availability')) return new Response(JSON.stringify({ available: true, booked_count: 0, total_quantity: 5 }), { status: 200 });
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderWidget = () => render(createElement(BookingWidget, { rental: RENTAL, paymentsOpen: true }));

describe('pageHref', () => {
  it('keeps the quantity with or without dates', () => {
    expect(pageHref('/p', '2030-01-01', '2030-01-03', 3)).toBe('/p?start=2030-01-01&end=2030-01-03&qty=3');
    expect(pageHref('/p', null, null, 3)).toBe('/p?qty=3');
    expect(pageHref('/p', '2030-01-01', null, 1)).toBe('/p');
  });
});

describe('BookingWidget: quantity survives "Edit dates"', () => {
  it('an incomplete range keeps qty in the address, and the cart gets the same quantity', async () => {
    authUser = { id: 'u-1' };
    search = `start=${ymd(10)}&end=${ymd(12)}&qty=3`;
    renderWidget();

    fireEvent.click(screen.getByRole('button', { name: 'pick start only' }));
    expect(replace).toHaveBeenLastCalledWith('/rentals/cameras/test-camera?qty=3', { scroll: false });

    fireEvent.click(screen.getByRole('button', { name: 'pick range' }));
    expect(replace).toHaveBeenLastCalledWith(`/rentals/cameras/test-camera?start=${ymd(20)}&end=${ymd(23)}&qty=3`, { scroll: false });

    const book = await screen.findByRole('button', { name: /^Book for/ });
    await waitFor(() => expect(book).not.toBeDisabled());
    fireEvent.click(book);
    await waitFor(() => expect(addToCart).toHaveBeenCalledWith('r-1', 3, ymd(20), ymd(23)));
  });

  it('the sign-in link keeps the quantity, with or without dates', async () => {
    search = 'qty=2';
    renderWidget();
    const signIn = await screen.findByRole('link', { name: /book these dates/i });
    expect(decodeURIComponent(signIn.getAttribute('href') ?? '')).toBe('/login?redirect=/rentals/cameras/test-camera?qty=2');
  });

  it('a quantity above the per-item maximum is ignored', async () => {
    authUser = { id: 'u-1' };
    search = `start=${ymd(10)}&end=${ymd(12)}&qty=99`;
    renderWidget();
    const book = await screen.findByRole('button', { name: /^Book for/ });
    await waitFor(() => expect(book).not.toBeDisabled());
    fireEvent.click(book);
    await waitFor(() => expect(addToCart).toHaveBeenCalledWith('r-1', 1, ymd(10), ymd(12)));
  });
});

describe('BookingWidget: dates from the address meet the lead time', () => {
  it.each([
    ['already past', -3, -1],
    ['too soon (inside the notice period)', 0, 2],
  ])('%s: "Choose new dates", no availability check, cannot book', async (_label, from, to) => {
    authUser = { id: 'u-1' };
    search = `start=${ymd(from)}&end=${ymd(to)}`;
    renderWidget();
    expect(await screen.findByTestId('range-hint')).toHaveTextContent(/Choose new dates/);
    expect(screen.queryByText(/checking availability/i)).toBeNull();
    const book = await screen.findByRole('button', { name: /choose your dates/i });
    expect(book).toBeDisabled();
    expect(fetchSpy.mock.calls.some(([u]) => String(u).includes('/availability'))).toBe(false);
  });
});
