import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ApprovalCard } from '@/components/ubunye/ApprovalCard';
import { ChatInputBar } from '@/components/ubunye/ChatInputBar';
import { ChatMessageList } from '@/components/ubunye/ChatMessageList';
import type { ChatPhoto } from '@/components/ubunye/useChatPhotos';

// The calm Ubunye chat: the plan approval card, the "Your shoot" card, the
// answer chip and photos. jsdom has no layout, so only words and wiring.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn();

const PROPOSAL = '11111111-2222-4333-8444-555555555555';

const planSummary = {
  title: 'Plan: Traditional wedding in Soweto',
  details: ['Photographer or videographer: not asked yet (do by Saturday 17 October 2026)'],
  period: 'Saturday 14 November 2026',
  lines: [],
  depositCents: 0,
  totalCents: 0,
  collection: null,
  cancellationPolicy: 'Saving a plan books nothing and costs nothing.',
  nextStep: 'Approving saves this plan on your dashboard.',
  noCharge: true,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('ApprovalCard for a plan', () => {
  it('asks one question, hides the parts behind a disclosure, and saves with the same token flow', async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : undefined });
      if (method === 'GET') return json({ state: 'prepared', summary: planSummary });
      if (url.endsWith('/commit')) return json({ message: 'Your plan is saved.', next: '/dashboard/plans/abc' });
      return json({ token: 'tok-1' });
    }));

    render(createElement(ApprovalCard, { proposalId: PROPOSAL }));
    expect(await screen.findByText('Save this as your plan?')).toBeInTheDocument();
    expect(screen.getByText('Saturday 14 November 2026')).toBeInTheDocument();
    expect(screen.getByText('It books nothing and costs nothing.')).toBeInTheDocument();
    // The parts are behind "See what is in it", collapsed by default.
    const details = screen.getByText('See what is in it').closest('details')!;
    expect(details.open).toBe(false);
    expect(screen.queryByText('Approval needed')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
    expect(await screen.findByText('Your plan is saved.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See your plan' })).toHaveAttribute('href', '/dashboard/plans/abc');

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET /api/agent-actions/${PROPOSAL}`,
      `POST /api/agent-actions/${PROPOSAL}`,
      `POST /api/agent-actions/${PROPOSAL}/commit`,
    ]);
    expect(JSON.parse(calls[2].body!)).toEqual({ token: 'tok-1', approved: true });
  });

  it('"Not now" declines it and says nothing was saved', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      (init?.method ?? 'GET') === 'GET' ? json({ state: 'prepared', summary: planSummary }) : json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    render(createElement(ApprovalCard, { proposalId: PROPOSAL }));
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(await screen.findByText('Not saved. Nothing was booked or charged.')).toBeInTheDocument();
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true));
  });

  it('keeps the paid card with its money lines and Approve', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({
      state: 'prepared',
      summary: { ...planSummary, noCharge: false, title: 'Gear hire', lines: [{ label: 'Camera, 2 days', amountCents: 120000 }], totalCents: 120000 },
    })));
    render(createElement(ApprovalCard, { proposalId: PROPOSAL }));
    expect(await screen.findByText('Approval needed')).toBeInTheDocument();
    expect(screen.getByText('Camera, 2 days')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });
});

const outlineOutput = {
  kind: 'plan_outline',
  type: { slug: 'traditional-wedding', name: 'Traditional wedding' },
  date: { iso: '2026-11-14', label: 'Saturday 14 November 2026' },
  place: 'Soweto',
  parts: [
    { key: 'photographer-videographer', kind: 'person', label: 'Photographer or videographer', state: 'listed', count: 2, in_area: 2, from_price: null },
    { key: 'drone-pilot', kind: 'person', label: 'Drone pilot', state: 'coming_soon', count: null, in_area: null, from_price: null },
  ],
  questions: ['About how many guests?'],
  warnings: [],
};

const listBase = {
  isLoading: false,
  error: undefined,
  limitReached: false,
  limitMessage: null,
  isAuthenticated: false,
  mdComponents: {},
  onSend: vi.fn(),
};

describe('ChatMessageList', () => {
  it('draws the "Your shoot" card and one answer chip that fills the box', () => {
    const onPrefill = vi.fn();
    const messages = [
      { id: 'u1', role: 'user' as const, parts: [{ type: 'text' as const, text: 'A wedding in Soweto on 14 November' }] },
      {
        id: 'a1',
        role: 'assistant' as const,
        parts: [
          { type: 'tool-plan_outline', toolCallId: 't1', state: 'output-available', input: {}, output: outlineOutput },
          { type: 'text' as const, text: 'About how many guests?' },
        ],
      },
    ];
    render(createElement(ChatMessageList, { ...listBase, messages: messages as never, onPrefill }));
    const card = screen.getByRole('region', { name: 'Your shoot' });
    expect(card).toHaveTextContent('Traditional wedding');
    expect(card).toHaveTextContent('Saturday 14 November 2026 · Soweto');
    expect(card).toHaveTextContent('2 listed in or near Soweto');
    expect(card).toHaveTextContent('Coming soon');
    fireEvent.click(screen.getByRole('button', { name: /We expect about/ }));
    expect(onPrefill).toHaveBeenCalledWith('We expect about ');
  });

  it('shows the photos in the client bubble and hides our description line', () => {
    const messages = [
      { id: 'u1', role: 'user' as const, parts: [{ type: 'text' as const, text: 'Like this\n\nPhoto the client sent: a gold dress.' }] },
    ];
    render(createElement(ChatMessageList, { ...listBase, messages: messages as never, userPhotos: { u1: ['data:image/jpeg;base64,AAAA'] } }));
    expect(screen.getByText('Like this')).toBeInTheDocument();
    expect(screen.queryByText(/Photo the client sent/)).toBeNull();
    expect(screen.getByRole('img', { name: 'Your photo 1' })).toHaveAttribute('src', 'data:image/jpeg;base64,AAAA');
  });
});

describe('ChatInputBar with photos', () => {
  const base = {
    input: '',
    setInput: vi.fn(),
    onSubmit: vi.fn((e: { preventDefault: () => void }) => e.preventDefault()),
    isLoading: false,
    limitReached: false,
    remaining: 5,
    isAuthenticated: true,
  };
  const photo = (over: Partial<ChatPhoto>): ChatPhoto => ({ id: 'p1', dataUrl: 'data:image/jpeg;base64,AAAA', status: 'ready', text: 'Photo the client sent: x', error: null, ...over });

  it('has no photo button while photos are off', () => {
    render(createElement(ChatInputBar, { ...base, onAddPhotos: vi.fn() }));
    expect(screen.queryByRole('button', { name: 'Add a photo' })).toBeNull();
  });

  it('shows a 44px photo button and lets a photo alone be sent', () => {
    render(createElement(ChatInputBar, { ...base, photosEnabled: true, onAddPhotos: vi.fn(), onRemovePhoto: vi.fn(), photos: [photo({})] }));
    const add = screen.getByRole('button', { name: 'Add a photo' });
    expect(add.className).toMatch(/\bw-11\b/);
    expect(add.className).toMatch(/\bh-11\b/);
    expect(screen.getByRole('button', { name: 'Send message' })).not.toBeDisabled();
  });

  it('waits while a photo is read, and shows a reading error plainly', () => {
    const onRemovePhoto = vi.fn();
    render(createElement(ChatInputBar, {
      ...base,
      input: 'hello',
      photosEnabled: true,
      onAddPhotos: vi.fn(),
      onRemovePhoto,
      photosBusy: true,
      photos: [photo({ status: 'reading', text: null }), photo({ id: 'p2', status: 'error', text: null, error: 'The free photo reader is busy.' })],
    }));
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    expect(screen.getByText('Photo 2: The free photo reader is busy.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo 1' }));
    expect(onRemovePhoto).toHaveBeenCalledWith('p1');
  });
});
