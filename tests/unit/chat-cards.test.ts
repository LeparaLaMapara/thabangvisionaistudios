import { describe, it, expect } from 'vitest';
import { blindPeopleOutput, cardsFromSteps, cardsFromUiParts, cardsToUiParts, collectIds, readCards } from '@/lib/ubunye/chat-cards';
import { findIdentityFields, IDENTITY_FIELDS } from '@/lib/roles';

/** Chat cards survive a reload: blind fields only, checked on the way in and out. */

const ID = '340c1c52-0000-4000-8000-000000000011';
const PROPOSAL = '00000000-0000-4000-8000-000000000001';

const PEOPLE = {
  kind: 'people_results',
  status: 'found',
  role: { slug: 'photographer-videographer', name: 'Photographer or videographer' },
  date: { iso: '2026-10-24', label: 'Saturday 24 October 2026', rule: 'next weekend' },
  matches: [
    {
      id: ID, role: 'Photographer or videographer', area: 'Soweto', area_fit: 'Works in Soweto', profile_url: `/people/${ID}`, request_url: `/people/${ID}/request?date=2026-10-24`,
      price: 'R2 500 a day', total: 'R2 500', total_cents: 250000, total_label: 'R2 500 x 1 day', cover_url: 'https://res.cloudinary.com/demo/work.jpg', work_count: 8, verified: true,
      record: 'New', usual_days_note: null, budget_note: null,
      // Must never survive:
      user_id: 'u-secret', display_name: 'Thandi Mokoena', email: 'thandi@example.com', phone: '0821234567', face_url: 'https://x/face.jpg',
    },
    { id: 'not-an-id', request_url: '/people/x/request' },
    { id: ID, request_url: 'https://evil.example/people' },
  ],
  availability: 'Needs confirmation.',
  short_notice: null,
  browse_url: '/people?role=photographer-videographer',
  whatsapp_url: 'https://wa.me/27000000000?text=hi',
  data_note: 'x',
  say: 'instructions for the model',
  display_name: 'Thandi Mokoena',
};

describe('blind People card', () => {
  it('keeps the allow-listed fields only', () => {
    const out = blindPeopleOutput(PEOPLE)!;
    const json = JSON.stringify(out);
    expect(findIdentityFields(out)).toEqual([]);
    for (const f of IDENTITY_FIELDS) expect(json).not.toContain(`"${f}"`);
    expect(json).not.toMatch(/Thandi|u-secret|0821234567|face\.jpg|evil\.example|instructions for the model/);
    expect((out.matches as unknown[]).length).toBe(1);
  });
  it('drops anything that is not a People result', () => {
    expect(blindPeopleOutput({ kind: 'something' })).toBeNull();
    expect(blindPeopleOutput(null)).toBeNull();
  });
});

describe('cards: steps -> storage -> UI parts', () => {
  const steps = [{ toolResults: [
    { toolName: 'find_people', output: PEOPLE },
    { toolName: 'search_gear', output: { results: [] } },
    { toolName: 'propose_plan', output: { approval_required: true, proposal_id: PROPOSAL, title: 'x' } },
    { toolName: 'prepare_gear_booking', output: { approval_required: true, proposal_id: 'not-an-id' } },
  ] }];

  it('makes one People card and one proposal card', () => {
    const cards = cardsFromSteps(steps);
    expect(cards.map((c) => c.type)).toEqual(['people', 'proposal']);
    expect(cards[1]).toEqual({ type: 'proposal', proposal_id: PROPOSAL });
  });

  it('round-trips through UI parts and storage unchanged, still blind', () => {
    const cards = cardsFromSteps(steps);
    const parts = cardsToUiParts(cards, 'm1');
    expect(parts[0]).toMatchObject({ type: 'tool-find_people', state: 'output-available' });
    expect(parts[1]).toMatchObject({ type: 'tool-propose_plan', output: { approval_required: true, proposal_id: PROPOSAL } });
    expect(cardsFromUiParts(parts)).toEqual(cards);
    expect(readCards(JSON.parse(JSON.stringify(cards)))).toEqual(cards);
  });

  it('stored junk is dropped on the way back', () => {
    expect(readCards([{ type: 'people', output: { kind: 'people_results', matches: [{ display_name: 'Thandi' }] } }, { type: 'proposal', proposal_id: 'x' }, { type: 'script' }])).toEqual([
      { type: 'people', output: expect.objectContaining({ matches: [] }) },
    ]);
    expect(readCards('nope')).toEqual([]);
  });
});

describe('collectIds', () => {
  it('collects id-shaped values only, lower-cased', () => {
    const ids = collectIds({ a: ID.toUpperCase(), b: [{ c: PROPOSAL }], url: `/people/${ID}`, n: 5 }, new Set());
    expect([...ids].sort()).toEqual([PROPOSAL, ID].sort());
  });
});
