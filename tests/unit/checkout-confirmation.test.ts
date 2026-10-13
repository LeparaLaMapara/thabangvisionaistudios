import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';

/**
 * After payment the renter lands on My Rentals with ?checkout=<order>&payment=success.
 * The page says whether the payment is confirmed yet and what happens next,
 * and never claims a confirmation the payment provider has not given.
 */

let search = '';
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ push: vi.fn() }),
}));

import { CheckoutConfirmation } from '@/app/(platform)/dashboard/bookings/CheckoutConfirmation';

const ORDER = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

afterEach(() => cleanup());

const show = (bookings: Parameters<typeof CheckoutConfirmation>[0]['bookings']) => {
  const onOrder = vi.fn();
  render(createElement(CheckoutConfirmation, { bookings, onOrder, onRefresh: vi.fn() }));
  return { onOrder };
};

describe('CheckoutConfirmation', () => {
  it('renders nothing without an order', () => {
    search = '';
    show([]);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('while the provider has not confirmed: says so, and what happens next', () => {
    search = `checkout=${ORDER}&payment=success`;
    const { onOrder } = show([{ id: 'b1', status: 'pending', checkout_group_id: ORDER, requires_manual_approval: true }]);
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('We are confirming your payment');
    expect(banner).toHaveTextContent(/do not pay again/i);
    expect(banner).toHaveTextContent(/collection details/i);
    expect(banner).toHaveTextContent(/A person approves this booking/);
    expect(onOrder).toHaveBeenCalledTimes(1);
  });

  it('once confirmed: says the booking is confirmed', () => {
    search = `checkout=${ORDER}&payment=success`;
    show([{ id: 'b1', status: 'confirmed', checkout_group_id: ORDER, fulfilment_method: 'delivery' }]);
    expect(screen.getByRole('status')).toHaveTextContent('Payment confirmed. Your booking is confirmed.');
    expect(screen.getByRole('status')).toHaveTextContent(/arrange the delivery/i);
  });
});

describe('CheckoutConfirmation: a slow confirmation after paying', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('never offers to release the dates on the payment=success page; offers "check again" and the booking', async () => {
    vi.useFakeTimers();
    search = `checkout=${ORDER}&payment=success`;
    const onRefresh = vi.fn();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(createElement(CheckoutConfirmation, { bookings: [{ id: 'b1', status: 'pending', checkout_group_id: ORDER }], onOrder: vi.fn(), onRefresh }));

    // Polling runs out (about 35 seconds) without a confirmation.
    await act(async () => {
      vi.advanceTimersByTime(40_000);
    });
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent(/still being confirmed/i);
    expect(screen.queryByRole('button', { name: /cancel|release|back to my cart/i })).toBeNull();
    expect(banner).not.toHaveTextContent(/release these dates/i);
    expect(screen.getByRole('link', { name: /see your booking/i })).toHaveAttribute('href', '/dashboard/bookings/b1');

    const refreshesBefore = onRefresh.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /check again/i }));
    expect(onRefresh.mock.calls.length).toBe(refreshesBefore + 1);
    // Looking again: the button goes until the next round runs out.
    expect(screen.queryByRole('button', { name: /check again/i })).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onRefresh.mock.calls.length).toBeGreaterThan(refreshesBefore + 1);
    // Nothing on this page ever asks the server to release the hold.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
