import type { UbunyeAgent } from '../types';

export const outreachAgent: UbunyeAgent = {
  id: 'outreach',
  name: 'Ubunye Outreach',
  description: 'Drafts personalized outreach emails for wedding planners, event companies, and agencies',
  provider: 'anthropic',
  model: 'claude-sonnet-5',
  tools: [],
  rateLimit: { guest: 0, free: 0, pro: 0, studio: 0 },
  costTier: 'medium',
};

export interface OutreachInput {
  recipientName: string;
  recipientCompany: string;
  recipientRole: string;
  industry: string;
  servicesFit: string[];
  customContext?: string;
}

export interface OutreachOutput {
  subject: string;
  body: string;
  followUpSubject: string;
  followUpBody: string;
}

export function buildOutreachPrompt(input: OutreachInput): string {
  const services = input.servicesFit.join(', ');

  return `You are drafting a B2B outreach email on behalf of ThabangVision AI Studios, a technology creative studio in Johannesburg, South Africa.

ThabangVision offers:
- Professional photography and video production (from R1,500/session)
- Equipment rentals (cameras, lighting, audio, grip)
- AI-powered booking and instant quoting via Ubunye AI assistant
- Verified, vetted creative professionals across South Africa
- End-to-end production: shoot → edit → deliver

RECIPIENT:
Name: ${input.recipientName}
Company: ${input.recipientCompany}
Role: ${input.recipientRole}
Industry: ${input.industry}
Services that fit: ${services}
${input.customContext ? `Context: ${input.customContext}` : ''}

Draft TWO emails:

**EMAIL 1 — INITIAL OUTREACH**
- Subject line (under 50 chars, curiosity-driven, no spam words)
- Body: 3-4 short paragraphs
  - Opening: reference their company/industry specifically (not generic)
  - Value: one concrete way ThabangVision solves a problem they likely have
  - Social proof: mention AI-powered quoting, verified creators, or SA-wide coverage
  - CTA: suggest a specific next step (reply, book a call, visit the site)
- Sign off as the ThabangVision Business Development team

**EMAIL 2 — FOLLOW-UP (sent 5 days later if no reply)**
- Subject line (reference the first email naturally)
- Body: 2 short paragraphs, different angle, lighter tone
- Include a direct link: https://thabangvision.com/contact

Rules:
- South African English spelling
- Professional but human — not stiff, not salesy
- Never use "synergy", "leverage", "circle back", "touch base"
- Keep each email under 150 words
- Return labelled outputs: SUBJECT_1, BODY_1, SUBJECT_2, BODY_2`;
}
