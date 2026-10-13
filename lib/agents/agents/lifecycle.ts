import type { UbunyeAgent } from '../types';

/**
 * Writes the tailored note once a person's profile is complete
 * (lib/engagement/tailored.ts). Open model first: the 'gemma' route of the AI
 * gateway, with the gateway's failover behind it. Not a chat agent: nobody
 * messages it, so every rate limit is 0.
 */
export const lifecycleAgent: UbunyeAgent = {
  id: 'lifecycle',
  name: 'Ubunye Lifecycle',
  description: 'Reads a completed profile and writes a short, tailored email with concrete next steps',
  provider: 'gemma',
  model: 'gemma-4-26b-a4b-it',
  tools: [],
  rateLimit: { guest: 0, free: 0, pro: 0, studio: 0 },
  costTier: 'free',
};
