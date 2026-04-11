import type { UbunyeAgent } from './types';

export const UBUNYE_AGENTS: Record<string, UbunyeAgent> = {
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
    model: 'claude-sonnet-4-20250514',
    tools: [],
    rateLimit: { guest: 0, free: 10, pro: 20, studio: 20 },
    costTier: 'medium',
  },
};
