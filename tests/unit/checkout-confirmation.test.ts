import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, cleanup } from '@testing-library/react';

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
