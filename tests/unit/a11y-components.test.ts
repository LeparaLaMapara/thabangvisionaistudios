import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, useState } from 'react';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';

// Spec 9.5 (keyboard and screen-reader support): unit-level checks on the
// components fixed in this phase. Layout-dependent behaviour (focus trapping
// with real geometry, touch-target sizes) is covered by tests/e2e/a11y.spec.ts
// and tests/e2e/mobile.spec.ts instead -- jsdom has no layout.

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

import { BookingForm } from '@/app/(platform)/book/BookingForm';
import AddressAutocomplete, { type AddressResult } from '@/components/ui/AddressAutocomplete';
import { ChatInputBar } from '@/components/ubunye/ChatInputBar';
import { ChatMessageList } from '@/components/ubunye/ChatMessageList';
import { Modal } from '@/components/ui/Modal';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('BookingForm', () => {
  const props = {
    creatorId: null,
    creatorName: null,
    creatorRate: null,
    creatorSpecializations: [],
    initialCategory: '',
    initialHours: 2,
    initialLocation: '',
    initialDates: '',
    hourlyRate: 500,
    minHours: 2,
    maxHours: 12,
    paymentsOpen: true,
  };

  it('ties every label to its field', () => {
    render(createElement(BookingForm, props));
    expect(screen.getByLabelText(/type of shoot/i).tagName).toBe('SELECT');
    expect(screen.getByLabelText(/how many hours/i)).toHaveAttribute('type', 'number');
    expect(screen.getByLabelText(/when\?/i)).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText(/where\?/i)).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText(/what do you need back/i).tagName).toBe('SELECT');
  });

  it('uses 16px inputs on phones so iOS does not zoom', () => {
    render(createElement(BookingForm, props));
    expect(screen.getByLabelText(/where\?/i).className).toMatch(/\btext-base\b/);
    expect(screen.getByLabelText(/where\?/i).className).not.toMatch(/placeholder-neutral-600/);
  });
});

describe('AddressAutocomplete', () => {
  const nominatim = [
    { place_id: 1, display_name: '1 Main Road, Sandton', lat: '-26.1', lon: '28.0', address: { house_number: '1', road: 'Main Road', city: 'Sandton', state: 'Gauteng', postcode: '2196' } },
    { place_id: 2, display_name: '2 Main Road, Rosebank', lat: '-26.2', lon: '28.1', address: { house_number: '2', road: 'Main Road', city: 'Rosebank', state: 'Gauteng', postcode: '2196' } },
  ];

  async function typeAndWait(input: HTMLElement, value: string): Promise<void> {
    fireEvent.change(input, { target: { value } });
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    // Let the mocked fetch promise chain settle.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('labels its fields and exposes a combobox', () => {
    render(createElement(AddressAutocomplete, { onSelect: vi.fn() }));
    const street = screen.getByRole('combobox', { name: /street address/i });
    expect(street).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByLabelText(/city/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/province/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/postal code/i)).toBeInTheDocument();
  });

  it('moves through suggestions with the arrow keys and picks with Enter', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => nominatim })));
    const onSelect = vi.fn();
    render(createElement(AddressAutocomplete, { onSelect }));
    const street = screen.getByRole('combobox', { name: /street address/i });

    await typeAndWait(street, 'Main Road');
    expect(street).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('option')).toHaveLength(2);

    fireEvent.keyDown(street, { key: 'ArrowDown' });
    fireEvent.keyDown(street, { key: 'ArrowDown' });
    const active = street.getAttribute('aria-activedescendant');
    expect(active).toBeTruthy();
    expect(document.getElementById(active!)).toHaveTextContent('Rosebank');

    fireEvent.keyDown(street, { key: 'Enter' });
    const picked = onSelect.mock.calls.at(-1)?.[0] as AddressResult;
    expect(picked.city).toBe('Rosebank');
    expect(picked.lat).toBe(-26.2);
    expect(street).toHaveAttribute('aria-expanded', 'false');
  });

  it('says so when the address service fails, with a retry', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    render(createElement(AddressAutocomplete, { onSelect: vi.fn() }));
    await typeAndWait(screen.getByRole('combobox', { name: /street address/i }), '12 Long Street');
    expect(screen.getByRole('alert')).toHaveTextContent(/address search is unavailable/i);
    expect(screen.getByRole('alert')).toHaveTextContent(/choose collect/i);
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('passes a hand-typed street to the parent', () => {
    const onSelect = vi.fn();
    render(createElement(AddressAutocomplete, { onSelect }));
    fireEvent.change(screen.getByRole('combobox', { name: /street address/i }), { target: { value: '9 Side St' } });
    expect((onSelect.mock.calls.at(-1)?.[0] as AddressResult).streetAddress).toBe('9 Side St');
  });
});

describe('ChatInputBar', () => {
  const base = {
    input: 'hello',
    setInput: vi.fn(),
    onSubmit: vi.fn((e: { preventDefault: () => void }) => e.preventDefault()),
    isLoading: false,
    limitReached: false,
    remaining: 5,
    isAuthenticated: false,
  };

  it('has a labelled textbox and send button, and no dead "coming soon" buttons', () => {
    render(createElement(ChatInputBar, base));
    expect(screen.getByRole('textbox', { name: 'Message Ubunye' })).toBeInTheDocument();
    const send = screen.getByRole('button', { name: 'Send message' });
    expect(send.className).toMatch(/\bw-11\b/);
    expect(send.className).toMatch(/\bh-11\b/);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});

describe('ChatMessageList', () => {
  // jsdom has no scrolling; the list scrolls to the newest message on render.
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn();

  const base = {
    messages: [{ id: 'u1', role: 'user' as const, parts: [{ type: 'text' as const, text: 'Hi' }] }],
    isLoading: false,
    limitReached: false,
    limitMessage: null,
    isAuthenticated: false,
    mdComponents: {},
    onSend: vi.fn(),
  };

  it('is a polite live log', () => {
    render(createElement(ChatMessageList, { ...base, error: undefined }));
    const log = screen.getByRole('log');
    expect(log).toHaveAttribute('aria-live', 'polite');
  });

  it('offers Retry after a failed request', () => {
    const onRetry = vi.fn();
    render(createElement(ChatMessageList, { ...base, error: new Error('network'), onRetry }));
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('Modal', () => {
  function Harness(): React.ReactElement {
    const [open, setOpen] = useState(false);
    return createElement(
      'div',
      null,
      createElement('button', { onClick: () => setOpen(true) }, 'Open'),
      createElement(
        Modal,
        { isOpen: open, onClose: () => setOpen(false), title: 'Details' } as React.ComponentProps<typeof Modal>,
        createElement('p', null, 'Body'),
      ),
    );
  }

  it('is a labelled dialog that closes on Escape and returns focus to the opener', async () => {
    render(createElement(Harness));
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    fireEvent.click(opener);

    const dialog = await screen.findByRole('dialog', { name: 'Details' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const close = screen.getByRole('button', { name: /close/i });
    expect(close.className).toMatch(/\bw-11\b/);

    fireEvent.keyDown(document, { key: 'Escape' });
    // AnimatePresence keeps the panel for its exit animation; the trap's
    // cleanup has already run, so focus is back on the opener.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(document.activeElement).toBe(opener);
  });
});
