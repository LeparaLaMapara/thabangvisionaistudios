import type { UbunyeAgent } from './types';
import { assistantAgent } from './agents/assistant';
import { bookingAgent } from './agents/booking';
import { bioWriterAgent } from './agents/bio-writer';
import { listingDescriberAgent } from './agents/listing-describer';
import { productionDescriberAgent } from './agents/production-describer';
import { contentRepurposerAgent } from './agents/content-repurposer';
import { outreachAgent } from './agents/outreach';
import { lifecycleAgent } from './agents/lifecycle';

export const UBUNYE_AGENTS: Record<string, UbunyeAgent> = {
  assistant: assistantAgent,

  booking: bookingAgent,

  'bio-writer': bioWriterAgent,

  'listing-describer': listingDescriberAgent,

  'production-describer': productionDescriberAgent,

  'content-repurposer': contentRepurposerAgent,

  outreach: outreachAgent,

  lifecycle: lifecycleAgent,

  onboarding: {
    id: 'onboarding',
    name: 'Ubunye Onboarding',
    description: 'Helps creators complete onboarding — ID capture, gear identification, category mapping',
    provider: 'gemma',
    model: 'gemma-4-31b-it',
    tools: [], // Tools registered separately
    rateLimit: { guest: 0, free: 50, pro: 50, studio: 50 },
    costTier: 'free',
  },
  portfolios: {
    id: 'portfolios',
    name: 'Ubunye Portfolios',
    description: 'Portfolio creation, image tagging, scene classification, skills detection',
    provider: 'gemma',
    model: 'gemma-4-31b-it',
    tools: [],
    rateLimit: { guest: 0, free: 50, pro: 100, studio: 100 },
    costTier: 'free',
  },
  rates: {
    id: 'rates',
    name: 'Ubunye Rates',
    description: 'Market-aligned rate suggestions for creators',
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    tools: [],
    rateLimit: { guest: 0, free: 10, pro: 20, studio: 20 },
    costTier: 'medium',
  },
  // Many roles (TASK-085): suggests one or two roles from what a person types
  // or one photo of their work. Suggests only; the person confirms.
  'role-match': {
    id: 'role-match',
    name: 'Ubunye Role Match',
    description: 'Suggests the role (make-up artist, model, driver, ...) that fits what a person says they do',
    provider: 'gemma',
    model: 'gemma-4-31b-it',
    tools: [],
    rateLimit: { guest: 0, free: 10, pro: 10, studio: 10 },
    costTier: 'free',
  },
  // People (TASK-085): reads a CV (PDF, Word, a photo of it), a voice note or
  // a few typed lines into the strict facts schema, with personal details
  // stripped. The person reviews the facts before anything is saved.
  'profile-extract': {
    id: 'profile-extract',
    name: 'Ubunye Profile Facts',
    description: 'Turns a CV, voice note or typed lines into work facts (no personal details)',
    provider: 'google',
    model: 'gemini-3.6-flash',
    tools: [],
    rateLimit: { guest: 0, free: 6, pro: 6, studio: 6 },
    costTier: 'low',
  },
};
