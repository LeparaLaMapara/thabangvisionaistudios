import { jsonSchema } from 'ai';
import { PLAN_POLICY, SHOOT_PLAN_POLICY } from '@/lib/constants';
import { prepareAction, type AgentDeps } from '@/lib/core/agent/use-cases';
import { buildPlanProposal, type PlanLookups, type ProposePlanInput } from '@/lib/core/projects/propose';
import { checkMove, type PlanMoveStore } from '@/lib/core/projects/use-cases';
import { formatSaDay, isIsoDate, resolveDate, saToday } from '@/lib/dates/johannesburg';
import { SHOOT_TYPES } from '@/lib/ubunye/shoot-types';
import type { LinkablePart } from '@/lib/projects/live';
import type { MoveCheck } from '@/lib/projects/move';

/**
 * Ubunye plans (flag ubunye_projects, signed-in only).
 *
 * propose_plan PREPARES a plan for the client to approve on the chat card
 * (agent_actions kind project_create): it writes nothing else. The server
 * decides what each part is and refuses ids no tool returned, someone else's
 * bookings and single-part "plans" (lib/core/projects/propose.ts). The
 * approval commit creates the plan (lib/projects/agent.ts).
 *
 * my_plan_parts lists the client's own open People requests and gear orders
 * that are in no plan yet, blind, so a plan can point at them.
 */

export interface PlanToolDeps {
  getUser: () => Promise<{ id: string } | null>;
  agentDeps: () => AgentDeps | null;
  lookups: (conversationId: string | null) => PlanLookups;
  listParts: (userId: string) => Promise<LinkablePart[]>;
  /** "Move my shoot" (098). Optional so older fakes still fit; the server always supplies them. */
  moveCheck?: (userId: string, planId: string, date: string, dateEnd: string | null) => Promise<MoveCheck>;
  moveStore?: () => PlanMoveStore;
  /** The plan meant when none is named: the open plan from this chat, else the newest open plan. */
  defaultPlan?: (userId: string, conversationId: string | null) => Promise<{ id: string; title: string } | null>;
  now?: () => Date;
}

/** A date from the model: ISO as given, or words read in Johannesburg time. */
function readMoveDate(raw: unknown, now: Date): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const t = raw.trim();
  return isIsoDate(t) ? t : resolveDate(t, now)?.iso ?? null;
}

const SIGN_IN = { error: 'The client must sign in first (/login), then I can save a plan.' };

export function planForModel(id: string, title: string, details: string[] | undefined, expiresAt: string): Record<string, unknown> {
  return {
    approval_required: true,
    proposal_id: id,
    title,
    parts: details ?? [],
    cost: 'Nothing. A plan books nothing and costs nothing.',
    expires_at: expiresAt,
    message: 'Shown to the client on an approval card. The plan is saved only when they press Approve there; you cannot approve it for them. Each part is still requested, booked and paid on its own.',
  };
}

async function defaultDeps(supabase: { auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> } }): Promise<PlanToolDeps> {
  const [{ agentDeps }, { planLookups }, live, { planMoveCheck }, { SupabasePlanMoveStore }] = await Promise.all([
    import('@/lib/agent/deps'),
    import('@/lib/projects/agent'),
    import('@/lib/projects/live'),
    import('@/lib/projects/move'),
    import('@/lib/projects/store'),
  ]);
  return {
    getUser: async () => (await supabase.auth.getUser()).data.user,
    agentDeps,
    lookups: (conversationId) => planLookups({ conversationId }),
    listParts: (userId) => live.listLinkableParts(userId),
    moveCheck: (userId, planId, date, dateEnd) => planMoveCheck(userId, planId, date, dateEnd),
    moveStore: () => new SupabasePlanMoveStore(),
    defaultPlan: async (userId, conversationId) => {
      const fromChat = conversationId ? await live.openPlanForConversation(userId, conversationId) : null;
      const open = (await live.listPlans(userId)).filter((x) => x.status === 'open');
      const pick = (fromChat && open.find((x) => x.id === fromChat.id)) || open[0];
      return pick ? { id: pick.id, title: pick.title } : null;
    },
    now: () => new Date(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createPlanTools(p: { supabase: any; conversationId: string | null; seenIds: Set<string>; deps?: PlanToolDeps }): Record<string, any> {
  const deps = async (): Promise<PlanToolDeps> => p.deps ?? defaultDeps(p.supabase);
  return {
    propose_plan: {
      description:
        'Save a multi-part outcome as a PLAN for the client to approve, ONLY when it needs coordination: two or more parts (people, gear, an existing booking) or something we cannot fill yet that must be remembered (a role that is coming soon). ' +
        'Never for one thing (one photographer is a request, not a plan). Call find_people and search_gear first and use only ids they (or my_plan_parts) returned. ' +
        'The server decides what each part is from our data and shows the client an approval card; nothing is booked or paid by a plan.',
      inputSchema: jsonSchema({
        type: 'object' as const,
        properties: {
          title: { type: 'string', description: 'A short title in the client\'s words, e.g. "Music video in Soweto".' },
          outcome: { type: 'string', description: 'What the client wants, in one sentence.' },
          place: { type: 'string', description: 'Where, in their words.' },
          date: { type: 'string', description: 'The day (or first day), YYYY-MM-DD or their words, e.g. "next weekend".' },
          date_end: { type: 'string', description: 'The last day, if it runs over several days.' },
          budget: { type: 'number', description: 'Their budget in rands, if they gave one.' },
          shoot_type: { type: 'string', enum: SHOOT_TYPES.map((t) => t.slug), description: 'The shoot type plan_outline returned (type.slug), so the plan gets its timeline.' },
          parts: {
            type: 'array',
            maxItems: PLAN_POLICY.maxParts,
            description: 'One entry per thing they need.',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: 'What they called it, e.g. "videographer", "lights", "editor", "catering".' },
                type: { type: 'string', enum: ['person', 'gear', 'other', 'existing'], description: 'person: someone to book; gear: equipment or the studio; other: anything else (the server checks if we offer it); existing: a booking or request they already have (from my_plan_parts).' },
                role: { type: 'string', description: 'For a person: the role as find_people understood it.' },
                person_id: { type: 'string', description: 'For a person: a card id find_people returned, if they chose one.' },
                rental_id: { type: 'string', description: 'For gear: an id search_gear returned, if one fits.' },
                category: { type: 'string', description: 'For gear: the rental category slug (the plan_outline part key), e.g. "lighting-power", "studios".' },
                existing_kind: { type: 'string', enum: ['people_request', 'gear_order', 'service_booking'] },
                existing_id: { type: 'string', description: 'For existing: the id my_plan_parts returned.' },
              },
              required: ['label', 'type'],
            },
          },
        },
        required: ['title', 'parts'],
      }),
      execute: async (input: ProposePlanInput) => {
        const d = await deps();
        const user = await d.getUser().catch(() => null);
        if (!user) return SIGN_IN;
        const agent = d.agentDeps();
        if (!agent) return { error: 'Plans through Ubunye are not available right now.' };
        try {
          const built = await buildPlanProposal(input, { clientId: user.id, conversationId: p.conversationId, seenIds: p.seenIds }, d.lookups(p.conversationId));
          if (!built.ok) return { no_plan: true, code: built.code, message: built.message };
          const prepared = await prepareAction(agent, { userId: user.id, conversationId: p.conversationId, kind: 'project_create', payload: { ...built.payload }, summary: built.summary });
          return planForModel(prepared.actionId, built.payload.title, prepared.summary.details, prepared.expiresAt);
        } catch {
          return { error: 'Could not prepare the plan just now. Try again in a moment.' };
        }
      },
    },
    my_plan_parts: {
      description: 'List the client\'s own open People requests and gear orders that are in no plan yet (blind: role, dates, where each stands). Use before propose_plan when they want a booking they already have in the plan.',
      inputSchema: jsonSchema({ type: 'object' as const, properties: {} }),
      execute: async () => {
        const d = await deps();
        const user = await d.getUser().catch(() => null);
        if (!user) return SIGN_IN;
        try {
          const parts = await d.listParts(user.id);
          return {
            parts: parts.map((x) => ({ existing_kind: x.kind, existing_id: x.refId, line: x.line })),
            message: parts.length ? 'Their own open bookings and requests that are in no plan yet.' : 'They have no open bookings or requests outside a plan.',
          };
        } catch {
          return { error: 'Could not load their bookings just now.' };
        }
      },
    },
    plan_move_check: {
      description:
        'The client wants to MOVE their shoot or plan to another date. Read-only: for each part of their plan, says what happens on the new date from live data (a People request is never moved for them: a new request is prefilled; a paid booking or order is never changed by Ubunye: our team on WhatsApp; unbooked gear is checked for the new dates; parts not booked yet just move their do by date). Then use propose_plan_move if they want the plan moved.',
      inputSchema: jsonSchema({
        type: 'object' as const,
        properties: {
          new_date: { type: 'string', description: 'The new (first) day, YYYY-MM-DD or their words.' },
          new_date_end: { type: 'string', description: 'The new last day, if it runs over several days.' },
          plan_id: { type: 'string', description: 'The plan id, if known. Leave out for the plan from this chat (or their newest open plan).' },
        },
        required: ['new_date'],
      }),
      execute: async (input: { new_date?: string; new_date_end?: string; plan_id?: string }) => {
        const d = await deps();
        const user = await d.getUser().catch(() => null);
        if (!user) return SIGN_IN;
        if (!d.moveCheck || !d.defaultPlan) return { error: 'Moving a plan is not available right now.' };
        const now = d.now ? d.now() : new Date();
        const date = readMoveDate(input.new_date, now);
        if (!date) return { error: `I could not read that as one date. Today is ${formatSaDay(saToday(now))}. Ask which day they mean.` };
        try {
          const planId = typeof input.plan_id === 'string' && input.plan_id ? input.plan_id : (await d.defaultPlan(user.id, p.conversationId))?.id;
          if (!planId) return { no_plan: true, message: 'They have no open plan to move. The date of a booking is changed only by our team.' };
          return await d.moveCheck(user.id, planId, date, readMoveDate(input.new_date_end, now));
        } catch {
          return { error: 'Could not check the move just now. Try again in a moment.' };
        }
      },
    },
    propose_plan_move: {
      description:
        "Prepare moving the client's plan to a new date, for them to approve on a card. It moves ONLY the plan date and the do by dates of parts not booked yet; it changes no booking, request or payment. Call plan_move_check first and tell them what happens to each part.",
      inputSchema: jsonSchema({
        type: 'object' as const,
        properties: {
          new_date: { type: 'string', description: 'The new (first) day, YYYY-MM-DD or their words.' },
          new_date_end: { type: 'string', description: 'The new last day, if several days.' },
          plan_id: { type: 'string', description: 'The plan id plan_move_check used.' },
        },
        required: ['new_date'],
      }),
      execute: async (input: { new_date?: string; new_date_end?: string; plan_id?: string }) => {
        const d = await deps();
        const user = await d.getUser().catch(() => null);
        if (!user) return SIGN_IN;
        const agent = d.agentDeps();
        if (!agent || !d.moveStore || !d.defaultPlan) return { error: 'Moving a plan is not available right now.' };
        const now = d.now ? d.now() : new Date();
        const date = readMoveDate(input.new_date, now);
        if (!date) return { error: `I could not read that as one date. Today is ${formatSaDay(saToday(now))}. Ask which day they mean.` };
        try {
          const plan = typeof input.plan_id === 'string' && input.plan_id ? { id: input.plan_id, title: '' } : await d.defaultPlan(user.id, p.conversationId);
          if (!plan) return { no_plan: true, message: 'They have no open plan to move.' };
          const checked = await checkMove(d.moveStore(), { clientId: user.id, projectId: plan.id, date, dateEnd: readMoveDate(input.new_date_end, now), today: saToday(now), maxDays: SHOOT_PLAN_POLICY.maxMoveDays, label: formatSaDay });
          if (!checked.ok) return { no_move: true, code: checked.code, message: checked.message };
          const m = checked.move;
          const to = m.dateEnd && m.dateEnd !== m.date ? `${formatSaDay(m.date)} to ${formatSaDay(m.dateEnd)}` : formatSaDay(m.date);
          const prepared = await prepareAction(agent, {
            userId: user.id,
            conversationId: p.conversationId,
            kind: 'project_update',
            payload: { project_id: m.projectId, date: m.date, date_end: m.dateEnd },
            summary: {
              title: `Move plan${plan.title ? `: ${plan.title}` : ''}`.slice(0, 140),
              details: [`New date: ${to}`, 'The do by dates of parts not booked yet move with it.', 'Bookings and requests are not changed: each is moved only by you or our team.'],
              period: to,
              lines: [],
              depositCents: 0,
              totalCents: 0,
              collection: null,
              cancellationPolicy: 'Moving a plan books nothing, cancels nothing and costs nothing.',
              nextStep: 'Approving moves the plan on your dashboard.',
              noCharge: true,
              doneMessage: 'Your plan is moved.',
            },
          });
          return {
            approval_required: true,
            proposal_id: prepared.actionId,
            title: prepared.summary.title,
            to,
            cost: 'Nothing.',
            expires_at: prepared.expiresAt,
            message: 'Shown to the client on an approval card. The plan moves only when they press Approve there; you cannot approve it for them. No booking or request changes.',
          };
        } catch {
          return { error: 'Could not prepare the move just now. Try again in a moment.' };
        }
      },
    },
  };
}
