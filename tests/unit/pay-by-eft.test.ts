import { describe, it, expect } from 'vitest';
import { bankDetailsText, paymentReference, whatsappLink, BANK_LINES } from '@/lib/payments/eft';
import { gearNoticeText, type NoticeBooking } from '@/lib/rental/notices';
import { isExpiredHold } from '@/lib/rental/availability';

describe('paying by EFT', () => {
  it('gives each order a short readable reference', () => {
    expect(paymentReference('3f9a2c10-1111-2222-3333-444455556666')).toBe('TV-3F9A2C');
  });

  it('shows the business account from the bank letter', () => {
    const text = bankDetailsText('TV-3F9A2C');
    expect(text).toContain('THABANGVISION STUDIO (PTY) LTD');
    expect(text).toContain('1055250166');
    expect(text).toContain('450105');
    expect(text).toContain('Reference: TV-3F9A2C');
    expect(BANK_LINES.length).toBe(5);
  });

  it('opens WhatsApp with the message ready', () => {
    expect(whatsappLink('Hi, proof for TV-3F9A2C')).toBe('https://wa.me/27639905802?text=Hi%2C%20proof%20for%20TV-3F9A2C');
  });
});

describe('messages while an order waits for payment', () => {
  const items: NoticeBooking[] = [{ id: 'b1', user_id: 'u', start_date: '2026-10-05', end_date: '2026-10-07', title: 'Sony FX3' }];

  it('EFT: amount, reference, bank details, proof, and the scam warning', () => {
    const t = gearNoticeText('awaiting_payment', items, { amountDue: 2400, reference: 'TV-3F9A2C', method: 'eft' });
    expect(t.title).toMatch(/Pay R2.400 by EFT/);
    expect(t.body).toContain('1055250166');
    expect(t.body).toContain('TV-3F9A2C');
    expect(t.body).toMatch(/063 990 5802/);
    expect(t.body).toMatch(/never change/);
  });

  it('cash: what to bring and where', () => {
    const t = gearNoticeText('awaiting_payment', items, { amountDue: 2400, reference: 'TV-3F9A2C', method: 'cash' });
    expect(t.body).toMatch(/in cash when you collect at 99 Smith Street/);
    expect(t.body).toMatch(/ID card/);
  });
});

describe('holding dates', () => {
  const base = { id: 'h', quantity: 1, status: 'pending', createdAt: '2026-09-01T08:00:00Z', paymentReference: null };
  const now = new Date('2026-09-10T08:00:00Z');
  it('an unpaid EFT booking is released after the hold window', () => {
    expect(isExpiredHold({ ...base, method: 'eft' }, now, 48 * 60)).toBe(true);
  });
  it('a cash booking keeps its dates until collection', () => {
    expect(isExpiredHold({ ...base, method: 'cash' }, now, 48 * 60)).toBe(false);
  });
});
