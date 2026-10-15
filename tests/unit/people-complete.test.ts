import { describe, it, expect } from 'vitest';
import {
  applyPeopleNaming,
  footerSectionsSync,
} from '@/lib/nav';
import {
  audioBecomes,
  blindLabel,
  referenceLabel,
  buildExtractPrompt,
  buildProfileDocument,
  classifyIntakeFile,
  documentHash,
  durationLabel,
  EMPTY_FACTS,
  findIdentityFields,
  finishTodo,
  firstName,
  initials,
  inlineLegalAsks,
  parseComesWith,
  photoLooksLikeCv,
  rankMatches,
  recordLine,
  reliabilityScore,
  reveal,
  sanitizeFacts,
  selfieIsProof,
  stripIdentityWords,
  stripPII,
  type MatchCandidate,
  type ProfileRecord,
} from '@/lib/roles';

const NO_RECORD: ProfileRecord = { jobs: 0, onTime: 0, rebooked: 0, reviewCount: 0, averageRating: 0, vouches: 0, bookedCredits: [] };

describe('PII stripping', () => {
  it('removes ID numbers, phones, emails, links, birth dates and street addresses', () => {
    const t = stripPII('ID 9001015800087, call 072 123 4567 or +27 82 555 1234, thandi@mail.co.za, https://x.co, born 1990-01-01 / 01/01/1990, lives at 12 Vilakazi Street');
    for (const bad of ['9001015800087', '072', '555', 'thandi', 'https', '1990', 'Vilakazi Street']) expect(t).not.toContain(bad);
    expect(stripPII('Make-up for weddings')).toBe('Make-up for weddings');
  });

  it('removes words about who someone is, not what they do', () => {
    expect(stripIdentityWords('She is a black woman, 28 years old, who does bridal make-up')).not.toMatch(/\b(she|black|woman|years old)\b/i);
  });
});

describe('facts schema', () => {
  it('keeps only known keys, strips PII from every string, bounds numbers', () => {
    const f = sanitizeFacts({
      skills: ['Bridal make-up', 'call 0721234567', 'x', 'Bridal make-up'],
      years_experience: 99,
      languages: ['isiZulu', 'English'],
      credits: [{ project: 'Music video for Artist', role: 'MUA', year: 2024 }, { project: '' }],
      phone: '0721234567',
      references: [{ name: 'Jane', phone: '0821234567' }],
    });
    expect(Object.keys(f).sort()).toEqual(Object.keys(EMPTY_FACTS).sort());
    expect(f.skills).toEqual(['Bridal make-up', 'call']);
    expect(f.years_experience).toBeNull();
    expect(f.credits).toEqual([{ project: 'Music video for Artist', role: 'MUA', year: 2024 }]);
    expect(JSON.stringify(f)).not.toMatch(/0721234567|0821234567|Jane/);
  });

  it('a garbage answer becomes empty facts', () => {
    expect(sanitizeFacts('nonsense')).toEqual(EMPTY_FACTS);
    expect(sanitizeFacts(null)).toEqual(EMPTY_FACTS);
  });

  it('the prompt forbids personal details and asks for the strict shape', () => {
    const p = buildExtractPrompt('cv');
    expect(p).toMatch(/NEVER include names of people, ID numbers, phone numbers/);
    expect(p).toContain('"years_experience"');
    expect(buildExtractPrompt('text', 'I do make-up')).toContain('I do make-up');
  });
});

describe('equal chance: blind labels and identity guard', () => {
  it('a neutral label: role and area, never a name and never the internal code', () => {
    expect(blindLabel('Make-up artist', 'Soweto')).toBe('Make-up artist in Soweto');
    expect(blindLabel('Model', null)).toBe('Model');
    expect(blindLabel('Photographer', '  ')).toBe('Photographer');
  });

  it('the code shows only as a booking reference', () => {
    expect(referenceLabel('Make-up artist', 'Soweto', 'MA-1042')).toBe('Make-up artist in Soweto (ref MA-1042)');
    expect(referenceLabel('Model', null, null)).toBe('Model');
  });

  it('initials for reviews, first name only for the reveal', () => {
    expect(initials('Thandi Mokoena')).toBe('T.M.');
    expect(initials('Naledi M. (demo)')).toBe('N.M.');
    expect(initials(null)).toBe('');
    expect(firstName('Sipho D. (demo)')).toBe('Sipho');
  });

  it('finds identity fields anywhere in a payload', () => {
    expect(findIdentityFields({ label: 'x', personRole: { id: 'a', area: 'Soweto' } })).toEqual([]);
    expect(findIdentityFields({ who: { display_name: 'T', faceUrl: null }, personRole: { user_id: 'u' } })).toEqual(['who.display_name', 'personRole.user_id']);
  });

  it('selfies are proof only for models', () => {
    expect(selfieIsProof('model')).toBe(true);
    expect(selfieIsProof('makeup-artist')).toBe(false);
  });
});

describe('reveal on a confirmed booking', () => {
  const booking = { client_id: 'client', person_user_id: 'person' };
  it('nobody sees a face or name before confirmation', () => {
    for (const viewer of ['client', 'person', 'stranger', null]) {
      const d = reveal({ ...booking, status: 'requested' }, viewer);
      expect(d.personIdentity || d.clientFirstName || d.address).toBe(false);
    }
  });
  it('after confirmation: the client sees who is coming; the person sees the client and the address', () => {
    expect(reveal({ ...booking, status: 'confirmed' }, 'client')).toMatchObject({ viewer: 'client', personIdentity: true, address: false });
    expect(reveal({ ...booking, status: 'confirmed' }, 'person')).toMatchObject({ viewer: 'person', personIdentity: false, clientFirstName: true, address: true });
    expect(reveal({ ...booking, status: 'confirmed' }, 'stranger')).toMatchObject({ viewer: 'other', personIdentity: false });
  });
  it('labels', () => {
    expect(durationLabel(4)).toBe('4 hours');
    expect(durationLabel(1)).toBe('1 hour');
    expect(durationLabel(2.5)).toBe('2.5 hours');
  });
});

describe('profile document (what gets embedded)', () => {
  const input = {
    roleName: 'Make-up artist',
    headline: 'She does soft glam',
    about: 'Thandi here, call 0721234567. I am a 28 years old woman.',
    area: 'Soweto',
    facts: sanitizeFacts({ skills: ['soft glam'], languages: ['isiZulu'] }),
    comesWith: null,
    record: { ...NO_RECORD, jobs: 4, onTime: 4 },
  };

  it('never includes the name, face, contact details or demographics', () => {
    const doc = buildProfileDocument({ ...input, ...({ display_name: 'Thandi Mokoena', face_url: 'https://x/face.jpg' } as object) });
    expect(doc).not.toMatch(/Mokoena|face\.jpg|0721234567|\bshe\b|woman|years old/i);
    expect(doc).toContain('Role: Make-up artist');
    expect(doc).toContain('Languages spoken: isiZulu');
    expect(doc).toContain('4 jobs done');
  });

  it('changes when the record grows, so the vector improves', () => {
    const a = documentHash(buildProfileDocument(input));
    const b = documentHash(buildProfileDocument({ ...input, record: { ...input.record, jobs: 5, onTime: 5 } }));
    expect(a).not.toBe(b);
    expect(documentHash(buildProfileDocument(input))).toBe(a);
  });
});

describe('ranking with the record and fair new slots', () => {
  const cand = (id: string, similarity: number, jobs: number, area = 'Soweto'): MatchCandidate => ({
    id,
    similarity,
    area,
    available: true,
    record: { ...NO_RECORD, jobs, onTime: jobs, reviewCount: jobs ? 3 : 0, averageRating: jobs ? 4.8 : 0 },
  });

  it('a newcomer is neutral, never zero', () => {
    expect(reliabilityScore(NO_RECORD)).toBe(0.5);
  });

  it('keeps fair places for people with no jobs yet', () => {
    const pros = Array.from({ length: 12 }, (_, i) => cand(`pro${i}`, 0.9, 12));
    const newbies = [cand('new1', 0.5, 0), cand('new2', 0.4, 0)];
    const ranked = rankMatches([...pros, ...newbies], { limit: 10, newSlots: 2 });
    expect(ranked).toHaveLength(10);
    expect(ranked.filter((r) => r.isNew).map((r) => r.id).sort()).toEqual(['new1', 'new2']);
  });

  it('area and fit move people up; unavailable people are left out', () => {
    const ranked = rankMatches([cand('far', 0.8, 3, 'Pretoria'), cand('near', 0.8, 3, 'Soweto'), { ...cand('off', 0.99, 9), available: false }], { areaWords: ['soweto'] });
    expect(ranked.map((r) => r.id)).toEqual(['near', 'far']);
  });
});

describe('one box: what each file is', () => {
  it('sorts by type, CV by name', () => {
    expect(classifyIntakeFile('application/pdf', 'cv.pdf')).toBe('cv');
    expect(classifyIntakeFile('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'me.docx')).toBe('cv');
    expect(classifyIntakeFile('image/jpeg', 'look.jpg')).toBe('photo');
    expect(classifyIntakeFile('audio/mp4', 'note.m4a')).toBe('audio');
    expect(classifyIntakeFile('video/mp4', 'clip.mp4')).toBe('video');
    expect(classifyIntakeFile('application/zip', 'x.zip')).toBe('unknown');
    expect(photoLooksLikeCv('my_CV.jpg')).toBe(true);
    expect(photoLooksLikeCv('wedding.jpg')).toBe(false);
  });

  it('audio is Listen for listen roles, a voice note otherwise', () => {
    expect(audioBecomes('listen')).toBe('listen');
    expect(audioBecomes('look')).toBe('voice');
  });

  it('asks only the legal photo, only for those roles', () => {
    const driver = [
      { code: 'drivers_licence', label: 'Licence', required: true, basis: 'law' },
      { code: 'prdp', label: 'PrDP', required: true, basis: 'law', when: 'carries_passengers' },
      { code: 'licence_disc', label: 'Disc', required: true, basis: 'law' },
      { code: 'roadworthy', label: 'Roadworthy', required: true, basis: 'law', when: 'carries_passengers' },
      { code: 'commercial_insurance', label: 'Insurance', required: true, basis: 'platform' },
    ];
    expect(inlineLegalAsks(driver, 'driver-with-vehicle').map((a) => a.code)).toEqual(['drivers_licence', 'prdp', 'licence_disc']);
    expect(inlineLegalAsks([{ code: 'age_18', label: '18+', required: true, basis: 'law' }], 'model').map((a) => a.code)).toEqual(['age_18']);
    expect(inlineLegalAsks([], 'makeup-artist')).toEqual([]);
  });

  it('Done needs the face, proof for the format, the legal photo and a price', () => {
    const base = { hasFace: true, roleLive: true, proofFormat: 'look' as const, workCount: 2, listenCount: 0, factsCount: 0, missingLegal: 0, priceCents: 50000 };
    expect(finishTodo(base)).toEqual([]);
    expect(finishTodo({ ...base, hasFace: false })).toContain('your photo');
    expect(finishTodo({ ...base, proofFormat: 'listen' })).toContain('a sound clip');
    expect(finishTodo({ ...base, proofFormat: 'trust', workCount: 0, factsCount: 3 })).toEqual([]);
    expect(finishTodo({ ...base, missingLegal: 1, priceCents: null }).length).toBe(2);
  });
});

describe('record line and comes with', () => {
  it('never invents a record', () => {
    expect(recordLine(0, null)).toMatch(/^New on /);
    expect(recordLine(5, 5)).toBe('5 jobs · on time 5/5');
    expect(recordLine(3, null)).toBe('3 jobs');
  });
  it('comes with: one label, optional evidence ids', () => {
    expect(parseComesWith({ label: 'Toyota Quantum, 14 seats', evidence_ids: ['bad', '00000000-0000-4000-8000-000000000001'] })).toEqual({ label: 'Toyota Quantum, 14 seats', evidenceIds: ['00000000-0000-4000-8000-000000000001'] });
    expect(parseComesWith({})).toBeNull();
  });
});

describe('names with roles_v1', () => {
  const nav = [
    { label: 'Rentals', href: '/rentals' },
    { label: 'Studio', href: '/studio' },
    { label: 'Apps', href: '/tools' },
    { label: 'Help', href: '/faq' },
  ];
  it('People replaces Studio and comes first; off means unchanged', () => {
    expect(applyPeopleNaming(nav, true).map((i) => i.label)).toEqual(['People', 'Rentals', 'Apps', 'Help']);
    expect(applyPeopleNaming(nav, false)).toEqual(nav);
  });
  it('the footer sends Creators to People and the offer link to Earn', () => {
    const on = footerSectionsSync(true).flatMap((s) => s.links);
    expect(on.some((l) => l.href === '/smart-creators')).toBe(false);
    expect(on.find((l) => l.href === '/people')?.label).toBe('People');
    expect(on.find((l) => l.href === '/offer')?.label).toMatch(/^Earn with /);
    expect(footerSectionsSync(false).flatMap((s) => s.links).some((l) => l.href === '/smart-creators')).toBe(true);
  });
});
