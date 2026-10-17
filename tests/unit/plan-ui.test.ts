import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

import nextConfig from '@/next.config';
import { MAIN_NAVIGATION, PLAN } from '@/lib/constants';
import { applyPeopleNaming, filterNavSync } from '@/lib/nav';
import { SITEMAP_ROUTES } from '@/lib/seo/sitemap-registry';
import { MODE_SEGMENTS, modeSegments, outlineCard } from '@/lib/ubunye/outline-card';
import { noChargeButton, proposalKind } from '@/lib/ubunye/approval-labels';
import { ShootOutlineCard } from '@/components/ubunye/ShootOutlineCard';
import { PeopleResults, bestMatchIds } from '@/components/ubunye/PeopleResults';
import { ApprovalCard } from '@/components/ubunye/ApprovalCard';
import { HeaderPlanLink } from '@/components/ubunye/HeaderPlanLink';
import { ChatMessageList } from '@/components/ubunye/ChatMessageList';

if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn();

// Plan (owner 2026-10-17): the page, the menu, the redirect from the old
// address, and the new parts of the shoot card and approval card.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Plan address', () => {
  it('redirects the old address permanently to /plan and lets the query through', async () => {
    const redirects = await nextConfig.redirects!();
    const old = redirects.find((r) => r.source === PLAN.legacyHref);
    expect(PLAN.legacyHref).toBe('/ubunye-ai-studio');
    expect(old).toMatchObject({ source: '/ubunye-ai-studio', destination: '/plan', permanent: true });
    // A destination without its own query and no has/missing condition: Next.js
    // appends the request's query string (?prompt=, ?c=) unchanged.
    expect(old!.destination).not.toContain('?');
    expect('has' in old! || 'missing' in old!).toBe(false);
    expect(redirects.find((r) => r.source === '/ubunye-ai-studio/:path*')).toMatchObject({ destination: '/plan', permanent: true });
  });

  it('is in the sitemap at /plan, and the old address is not', () => {
    expect(SITEMAP_ROUTES['/plan']).toBe('static');
    expect(SITEMAP_ROUTES['/ubunye-ai-studio']).toBeUndefined();
  });

  it('reads People, Rentals, Plan in the menu with roles_v1 on', () => {
    const on = applyPeopleNaming(filterNavSync(MAIN_NAVIGATION, { smart_productions: true, creative_tools: false }), true).map((i) => i.label);
    expect(on.slice(0, 3)).toEqual(['People', 'Rentals', 'Plan']);
    expect(MAIN_NAVIGATION.find((i) => i.label === 'Plan')?.href).toBe('/plan');
    expect(MAIN_NAVIGATION.some((i) => /ubunye/i.test(i.label))).toBe(false);
  });

  it('shows "Plan" in the phone header, linking to /plan', () => {
    render(createElement(HeaderPlanLink));
    expect(screen.getByRole('link', { name: 'Plan' })).toHaveAttribute('href', '/plan');
  });
});

const outline = (over: Record<string, unknown> = {}) => ({
  kind: 'plan_outline',
  type: { slug: 'traditional-wedding', name: 'Traditional wedding', group: 'weddings' },
  date: { iso: '2026-11-14', label: 'Saturday 14 November 2026' },
  place: 'Soweto',
  parts: [
    { key: 'photographer-videographer', kind: 'person', label: 'Photographer or videographer', state: 'listed', count: 2, in_area: 2, from_price: null, use: 'crew' },
    { key: 'sound-reinforcement', kind: 'gear', label: 'PA for speeches', state: 'available', count: 3, in_area: null, from_price: 'R450/day', extra: true, use: 'event' },
  ],
  questions: [],
  warnings: [],
  ...over,
});

function cardFor(over: Record<string, unknown> = {}) {
  const card = outlineCard(outline(over));
  if (!card) throw new Error('no card');
  return card;
}

describe('"Who\'s shooting?" switch', () => {
  it('is not drawn when the outline has no mode (older outputs)', () => {
    render(createElement(ShootOutlineCard, { card: cardFor(), onSend: vi.fn() }));
    expect(screen.queryByText("Who's shooting?")).toBeNull();
    expect(screen.queryByRole('button', { name: 'Someone for me' })).toBeNull();
  });

  it('selects the current mode and sends exactly the sentence for another one', () => {
    const onSend = vi.fn();
    render(createElement(ShootOutlineCard, { card: cardFor({ mode: 'hire', mode_sure: true }), onSend }));
    expect(screen.getByText("Who's shooting?")).toBeInTheDocument();
    const hire = screen.getByRole('button', { name: 'Someone for me' });
    const rent = screen.getByRole('button', { name: 'I am, I need gear' });
    expect(hire).toHaveAttribute('aria-pressed', 'true');
    expect(rent).toHaveAttribute('aria-pressed', 'false');
    // A wedding is not film or TV, and the mode is not produce: no third segment.
    expect(screen.queryByRole('button', { name: "I'm producing" })).toBeNull();

    fireEvent.click(hire);
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.click(rent);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('I am shooting it myself, I only need the gear.');
  });

  it('uses the three exact client sentences', () => {
    expect(MODE_SEGMENTS.map((s) => s.message)).toEqual([
      'Someone else shoots it for me.',
      'I am shooting it myself, I only need the gear.',
      'I am producing it, I need people and gear.',
    ]);
  });

  it('is disabled while a reply is streaming', () => {
    const onSend = vi.fn();
    render(createElement(ShootOutlineCard, { card: cardFor({ mode: 'rent' }), onSend, busy: true }));
    const hire = screen.getByRole('button', { name: 'Someone for me' });
    expect(hire).toBeDisabled();
    fireEvent.click(hire);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('shows "I\'m producing" only for a film or TV shoot or when producing now', () => {
    expect(modeSegments({ mode: 'hire', group: 'weddings' }).map((s) => s.mode)).toEqual(['hire', 'rent']);
    expect(modeSegments({ mode: 'hire', group: 'film' }).map((s) => s.mode)).toEqual(['hire', 'rent', 'produce']);
    expect(modeSegments({ mode: 'produce', group: 'music' }).map((s) => s.mode)).toEqual(['hire', 'rent', 'produce']);
    expect(modeSegments({ mode: null, group: 'film' })).toEqual([]);

    const onSend = vi.fn();
    render(createElement(ShootOutlineCard, {
      card: cardFor({ mode: 'hire', type: { slug: 'short-film', name: 'Short film', group: 'film' } }),
      onSend,
    }));
    fireEvent.click(screen.getByRole('button', { name: "I'm producing" }));
    expect(onSend).toHaveBeenCalledWith('I am producing it, I need people and gear.');
  });

  it('sends through the chat page path from the message list', () => {
    const onSend = vi.fn();
    const messages = [
      { id: 'a1', role: 'assistant', parts: [{ type: 'tool-plan_outline', toolCallId: 't1', state: 'output-available', input: {}, output: outline({ mode: 'rent' }) }] },
    ];
    const base = { error: undefined, limitReached: false, limitMessage: null, isAuthenticated: false, mdComponents: {}, onSend, messages: messages as never };
    const { rerender } = render(createElement(ChatMessageList, { ...base, isLoading: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Someone for me' }));
    expect(onSend).toHaveBeenCalledWith('Someone else shoots it for me.');
    rerender(createElement(ChatMessageList, { ...base, isLoading: true }));
    expect(screen.getByRole('button', { name: 'Someone for me' })).toBeDisabled();
  });
});

describe('Shoot card extras and estimate', () => {
  it('draws an event extra as a quieter row that says Optional', () => {
    const card = cardFor();
    expect(card.rows.map((r) => r.optional)).toEqual([false, true]);
    expect(card.rows[1].note).toBe('Optional · 3 listed, from R450/day');
    render(createElement(ShootOutlineCard, { card }));
    const row = screen.getByText('PA for speeches').closest('li')!;
    expect(row).toHaveAttribute('data-optional', 'true');
    expect(within(row).getByText(/^Optional/)).toBeInTheDocument();
    expect(screen.getByText('Photographer or videographer').closest('li')).not.toHaveAttribute('data-optional');
  });

  it('shows the estimate line exactly as the tool gave it', () => {
    const text = 'About R6 500 to R9 000 for the day, before any extras. Prices are confirmed when booked.';
    const card = cardFor({ estimate: { text } });
    expect(card.estimate).toBe(text);
    render(createElement(ShootOutlineCard, { card }));
    expect(screen.getByText(text, { normalizer: (s) => s })).toBeInTheDocument();
  });

  it('has no estimate line when the tool gives none', () => {
    expect(cardFor({ estimate: null }).estimate).toBeNull();
    expect(cardFor().estimate).toBeNull();
    expect(cardFor({ estimate: { text: '  ' } }).estimate).toBeNull();
  });
});

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const match = (n: number, role: string) => ({
  id: id(n),
  role,
  area: 'Soweto',
  area_fit: '',
  request_url: `/people/${id(n)}/request`,
  price: 'R800/hour',
  total: '',
  total_label: '',
  cover_url: null,
  verified: false,
  record: '',
});

describe('Best match', () => {
  it('labels only the first card for each role', () => {
    const matches = [match(1, 'Photographer'), match(2, 'Photographer'), match(3, 'Makeup artist'), match(4, 'Makeup artist')];
    expect([...bestMatchIds(matches)]).toEqual([id(1), id(3)]);
    render(createElement(PeopleResults, { output: { kind: 'people_results', matches } }));
    const labels = screen.getAllByText('Best match');
    expect(labels).toHaveLength(2);
    const cards = screen.getAllByRole('listitem');
    expect(within(cards[0]).queryByText('Best match')).not.toBeNull();
    expect(within(cards[1]).queryByText('Best match')).toBeNull();
    expect(within(cards[2]).queryByText('Best match')).not.toBeNull();
    expect(within(cards[3]).queryByText('Best match')).toBeNull();
  });
});

const PROPOSAL = '11111111-2222-4333-8444-555555555555';
const noCharge = (title: string) => ({
  title,
  details: ['Photographer: Soweto'],
  period: 'Saturday 14 November 2026',
  lines: [],
  depositCents: 0,
  totalCents: 0,
  collection: null,
  cancellationPolicy: 'Nothing is booked or charged.',
  nextStep: 'Approving sends it.',
  noCharge: true,
});
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('Approval card button per kind', () => {
  it('names the gold button for each kind, and keeps the default otherwise', () => {
    expect(noChargeButton('project_create').label).toBe('Save plan');
    expect(noChargeButton('project_update').label).toBe('Move plan');
    expect(noChargeButton('people_requests').label).toBe('Ask them');
    expect(noChargeButton(null).label).toBe('Save plan');
  });

  it('reads the kind from the tool that made the proposal', () => {
    expect(proposalKind('propose_plan', { approval_required: true })).toBe('project_create');
    expect(proposalKind('propose_plan_move', { approval_required: true })).toBe('project_update');
    expect(proposalKind('propose_people_requests', {})).toBe('people_requests');
    expect(proposalKind('anything', { kind: 'people_requests' })).toBe('people_requests');
    expect(proposalKind('prepare_gear_booking', { kind: 'gear_rental' })).toBeNull();
  });

  it.each([
    ['project_create', 'Plan: Wedding in Soweto', 'Save plan'],
    ['project_update', 'Move plan: Wedding in Soweto', 'Move plan'],
    ['people_requests', 'Ask 2 people?', 'Ask them'],
  ])('shows a %s proposal by its server title with "%s"', async (kind, title, label) => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ state: 'prepared', summary: noCharge(title) })));
    render(createElement(ApprovalCard, { proposalId: PROPOSAL, kind }));
    expect(await screen.findByText(title)).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: label });
    expect(btn.className).toMatch(/bg-\[#D4A843\]/);
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument();
  });

  it('takes the kind from the server when it names one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ state: 'prepared', kind: 'people_requests', summary: noCharge('Ask 2 people?') })));
    render(createElement(ApprovalCard, { proposalId: PROPOSAL }));
    expect(await screen.findByRole('button', { name: 'Ask them' })).toBeInTheDocument();
  });

  it('keeps "Save plan" when the kind is unknown, and asking people says "Not sent" on Not now', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) =>
      (init?.method ?? 'GET') === 'GET' ? json({ state: 'prepared', summary: noCharge('Plan: Shoot') }) : json({ ok: true })));
    render(createElement(ApprovalCard, { proposalId: PROPOSAL }));
    expect(await screen.findByRole('button', { name: 'Save plan' })).toBeInTheDocument();
    cleanup();

    render(createElement(ApprovalCard, { proposalId: PROPOSAL, kind: 'people_requests' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(await screen.findByText('Not sent. Nothing was booked or charged.')).toBeInTheDocument();
  });
});
