import { email as emailProvider } from '@/lib/email';
import type { SendEmailOptions } from '@/lib/email/types';
import { appUrl } from '@/lib/app-url';
import { STUDIO } from '@/lib/constants';
import { createAdminClient } from '@/lib/supabase/server';
import { loadRequest, type LoadedRequest } from '@/lib/supabase/queries/role-requests';
import {
  clientAcceptedEmail,
  clientDeclinedEmail,
  clientRequestReceivedEmail,
  confirmedEmail,
  ownerNewRequestEmail,
  personClosedEmail,
  personNewRequestEmail,
  profileApprovedEmail,
  profileSentBackEmail,
  requestStatusLabel,
} from './request-loop';

/**
 * Who is told what in the People loop (server only). Every function here
 * never throws: a failed email is logged and the request or decision still
 * stands. Dependencies are passed in so tests can see exactly who is told.
 */

export interface BellRow {
  user_id: string;
  type: 'people_request' | 'people_request_update' | 'people_profile_update';
  title: string;
  body: string;
  link: string;
}

export interface NotifyDeps {
  send: (o: SendEmailOptions) => Promise<void>;
  bell: (row: BellRow) => Promise<void>;
  load: (requestId: string) => Promise<LoadedRequest | null>;
  baseUrl: string;
  ownerEmail: string;
}

function defaultDeps(): NotifyDeps {
  return {
    send: (o) => emailProvider.sendEmail(o),
    bell: async (row) => {
      const { error } = await createAdminClient().from('notifications').insert(row);
      if (error) throw new Error(error.message);
    },
    load: loadRequest,
    baseUrl: appUrl(STUDIO.meta.url),
    ownerEmail: STUDIO.bookingEmail,
  };
}

async function quietly(label: string, fn: () => Promise<void>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (err) {
    console.error(`[people-loop] ${label} failed:`, err instanceof Error ? err.message : err);
    return false;
  }
}

export interface Told {
  owner: boolean;
  person: boolean;
  client: boolean;
}

/** A new request: the owner (everything), the person asked (blind) and the client (what happens next). */
export async function notifyNewRequest(requestId: string, deps: Partial<NotifyDeps> = {}): Promise<Told> {
  const d = { ...defaultDeps(), ...deps };
  const told: Told = { owner: false, person: false, client: false };
  const r = await d.load(requestId).catch(() => null);
  if (!r) return told;
  const link = `/people/requests/${requestId}`;

  told.owner = await quietly('owner email', () =>
    d.send({ to: d.ownerEmail, ...ownerNewRequestEmail({ ...r.facts, client: r.client, person: r.person, address: r.address, note: r.note }, d.baseUrl) }),
  );
  if (r.person.email) told.person = await quietly('person email', () => d.send({ to: r.person.email!, ...personNewRequestEmail(r.facts, d.baseUrl) }));
  await quietly('person bell', () =>
    d.bell({ user_id: r.person.userId, type: 'people_request', title: 'New request', body: `${r.facts.roleName} on ${r.facts.dates[0]} in ${r.facts.area}. Can you do it?`, link }),
  );
  if (r.client.email) told.client = await quietly('client email', () => d.send({ to: r.client.email!, ...clientRequestReceivedEmail(r.facts, d.baseUrl) }));
  return told;
}

export type Decision = 'accepted' | 'declined' | 'confirmed';

/** Staff answered: the client always; the person on a decline or once it is paid. */
export async function notifyRequestDecision(requestId: string, decision: Decision, note: string | null = null, deps: Partial<NotifyDeps> = {}): Promise<Told> {
  const d = { ...defaultDeps(), ...deps };
  const told: Told = { owner: false, person: false, client: false };
  const r = await d.load(requestId).catch(() => null);
  if (!r) return told;
  const link = `/people/requests/${requestId}`;

  const clientMail =
    decision === 'accepted' ? clientAcceptedEmail(r.facts, d.baseUrl) : decision === 'declined' ? clientDeclinedEmail(r.facts, d.baseUrl, note) : confirmedEmail(r.facts, d.baseUrl, 'client');
  if (r.client.email) told.client = await quietly('client decision email', () => d.send({ to: r.client.email!, ...clientMail }));
  await quietly('client bell', () =>
    d.bell({ user_id: r.client.userId, type: 'people_request_update', title: requestStatusLabel(decision, 'client'), body: `${r.facts.roleName} on ${r.facts.dates[0]}.`, link }),
  );

  if (decision !== 'accepted') {
    const personMail = decision === 'declined' ? personClosedEmail(r.facts, d.baseUrl) : confirmedEmail(r.facts, d.baseUrl, 'person');
    if (r.person.email) told.person = await quietly('person decision email', () => d.send({ to: r.person.email!, ...personMail }));
    await quietly('person bell', () =>
      d.bell({ user_id: r.person.userId, type: 'people_request_update', title: requestStatusLabel(decision, 'person'), body: `${r.facts.roleName} on ${r.facts.dates[0]} in ${r.facts.area}.`, link }),
    );
  }
  return told;
}

/** A profile decision reaches the person by email and the bell; the note also shows on /offer. */
export async function notifyProfileDecision(
  p: { userId: string; roleName: string; personRoleId: string; decision: 'approved' | 'changes'; note: string | null },
  deps: Partial<Omit<NotifyDeps, 'load'>> & { emailOf?: (userId: string) => Promise<string | null> } = {},
): Promise<boolean> {
  const d = { ...defaultDeps(), ...deps };
  const emailOf =
    deps.emailOf ??
    (async (id: string) => {
      const { data } = await createAdminClient().auth.admin.getUserById(id);
      return data.user?.email ?? null;
    });
  const mail = p.decision === 'approved' ? profileApprovedEmail(p.roleName, p.personRoleId, d.baseUrl) : profileSentBackEmail(p.roleName, p.note ?? '', d.baseUrl);
  await quietly('profile bell', () =>
    d.bell({
      user_id: p.userId,
      type: 'people_profile_update',
      title: p.decision === 'approved' ? 'Your profile is live' : 'One change to your profile',
      body: p.decision === 'approved' ? `Your ${p.roleName.toLowerCase()} profile is live on People.` : (p.note ?? '').slice(0, 300),
      link: p.decision === 'approved' ? `/people/${p.personRoleId}` : '/offer',
    }),
  );
  const to = await emailOf(p.userId).catch(() => null);
  if (!to) return false;
  return quietly('profile email', () => d.send({ to, ...mail }));
}
