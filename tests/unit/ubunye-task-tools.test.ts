import { describe, it, expect } from 'vitest';
import { createBookingTools } from '@/lib/agents/tools/booking';

describe('Ubunye can complete tasks, not only answer', () => {
  const tools = createBookingTools({}, false);

  it('has tools to book a package, reserve gear and report on bookings', () => {
    expect(Object.keys(tools)).toEqual(expect.arrayContaining(['create_service_booking', 'add_gear_to_cart', 'my_bookings', 'check_availability']));
  });

  it('asks a signed-out person to sign in before reserving or reporting', async () => {
    const reserve = await tools.add_gear_to_cart.execute({ rental_id: 'x', start_date: '2026-11-01', end_date: '2026-11-02' });
    expect(reserve.error).toMatch(/sign in/i);
    const mine = await tools.my_bookings.execute({});
    expect(mine.error).toMatch(/sign in/i);
  });

  it('create_service_booking accepts a studio package id', () => {
    const schema = JSON.stringify(tools.create_service_booking.inputSchema);
    expect(schema).toContain('package_id');
  });
});
