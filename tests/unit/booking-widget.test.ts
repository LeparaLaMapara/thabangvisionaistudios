import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, forwardRef, type ReactNode } from 'react';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';

/**
 * The gear page booking widget (spec §9): requirements before payment, dates
 * required before the cart, honest phone-check status, and the funnel
 * reports ids only. Rendered in jsdom with the app's providers mocked.
 */

let search = '';
let authUser: { id: string } | null = null;
const replace = vi.fn();
const push = vi.fn();
const addToCart = vi.fn(async () => true);
const reportFunnel = vi.fn();

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
vi.mock('@/lib/analytics/client', () => ({ reportFunnel: (...a: unknown[]) => reportFunnel(...a) }));

import { BookingWidget } from '@/components/booking/BookingWidget';
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

function ymd(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type Readiness = Record<string, unknown>;
let readiness: Readiness | null = null;

beforeEach(() => {
  search = '';
  authUser = null;
  readiness = null;
  for (const m of [replace, push, addToCart, reportFunnel]) m.mockClear();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/rentals/eligibility')) {
      return readiness ? new Response(JSON.stringify(readiness), { status: 200 }) : new Response('{}', { status: 401 });
    }
    if (url.includes('/availability')) return new Response(JSON.stringify({ available: true, booked_count: 0, total_quantity: 1 }), { status: 200 });
    return new Response('{}', { status: 404 });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderWidget = () => render(createElement(BookingWidget, { rental: RENTAL, paymentsOpen: true }));

describe('BookingWidget', () => {
  it('signed out: shows what renting needs, and reports the view with ids only', async () => {
    renderWidget();
    const summary = await screen.findByRole('region', { name: 'What you need to rent' });
    expect(summary).toHaveTextContent(/ID check/);
    expect(summary).toHaveTextContent(/phone number/);
    expect(summary).toHaveTextContent(/first hire is collected in person/i);
    expect(screen.getByText('Choose your dates above to see the price.')).toBeInTheDocument();
    expect(reportFunnel).toHaveBeenCalledWith('rental_viewed', { rentalId: 'r-1', surface: 'gear_page' });
  });

  it('a same-day range from the address explains the rule instead of getting stuck', async () => {
    const day = ymd(10);
    search = `start=${day}&end=${day}`;
    renderWidget();
    expect((await screen.findAllByText(/returned the next day/i)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/checking availability/i)).toBeNull();
  });

  it('signed in but not ready: the full checklist with fix links; the cart needs dates first', async () => {
    authUser = { id: 'u-1' };
    readiness = {
      ok: false,
      code: 'ID_REQUIRED',
      tier: 'none',
      limitCents: 0,
      checklist: [
        { code: 'verify_email', label: 'Email address confirmed', href: null, status: 'done' },
        { code: 'verify_phone', label: 'Confirm your phone number', href: '/contact', status: 'unavailable', detail: 'Phone checks are not available online yet.' },
        { code: 'verify_id', label: 'One-time ID check (ID and selfie)', href: '/dashboard/verification', status: 'missing' },
      ],
      missing: [],
      collectionRequired: true,
      collectionReasons: ['first_hire'],
      requiresManualApproval: false,
      phoneChecksAvailable: false,
    };
    readiness.missing = (readiness.checklist as { status: string }[]).filter((c) => c.status !== 'done');
    renderWidget();
    const list = await screen.findByRole('region', { name: 'Before you pay' });
    expect(list).toHaveTextContent('Confirm your phone number');
    expect(list).toHaveTextContent(/WhatsApp/);
    const idLink = screen.getAllByRole('link').find((a) => a.getAttribute('href')?.startsWith('/dashboard/verification?redirect='));
    expect(idLink).toBeTruthy();
    const save = screen.getByRole('button', { name: /choose dates to add to cart/i });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(addToCart).not.toHaveBeenCalled();
  });

  it('signed in and ready, with dates: books into the cart with those dates', async () => {
    authUser = { id: 'u-1' };
    readiness = {
      ok: true, code: null, tier: 'contactable', limitCents: 200_000, checklist: [], missing: [],
      collectionRequired: true, collectionReasons: ['first_hire'], requiresManualApproval: false, phoneChecksAvailable: true,
    };
    const start = ymd(10);
    const end = ymd(12);
    search = `start=${start}&end=${end}`;
    renderWidget();
    const book = await screen.findByRole('button', { name: /^Book for/ });
    await waitFor(() => expect(book).not.toBeDisabled());
    fireEvent.click(book);
    await waitFor(() => expect(addToCart).toHaveBeenCalledWith('r-1', 1, start, end));
    expect(reportFunnel).toHaveBeenCalledWith('dates_chosen', { rentalId: 'r-1', days: 2, surface: 'gear_page' });
    expect(screen.getByText(/You collect this in person/)).toBeInTheDocument();
  });
});
