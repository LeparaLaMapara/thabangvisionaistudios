import { createAdminClient } from '@/lib/supabase/server';
import { SHOOT_PLAN_POLICY } from '@/lib/constants';
import { addDays, formatSaDay, isIsoDate, saToday } from '@/lib/dates/johannesburg';
import { checkAvailability } from '@/lib/rental/availability';
import { blockedUnits, loadHolds } from '@/lib/rental/availability-server';
import { meetsLeadTime } from '@/lib/rental/leadTime';
import { whatsappLink } from '@/lib/payments/eft';
import { partView, type PlanBrief } from '@/lib/core/projects/plan';
import { checkMove } from '@/lib/core/projects/use-cases';
import { moveAdvice, moveSay, type MoveAdvice, type MoveFacts } from '@/lib/core/projects/move';
import { validateNeed } from '@/lib/core/projects/use-cases';
import { liveParts, readItems } from './live';
import { SupabasePlanMoveStore } from './store';

/**
 * "Move my shoot": the read-only check, from live data. For every part of the
 * client's plan it reads where the part stands now and, for gear, whether it
 * is free on the new dates with the same availability code checkout uses
 * (the client's own current hold is not counted against them). It changes
 * nothing; the move itself is movePlanDate after the client approves.
 * Blind: People parts carry the public profile id only (for a prefilled
 * request link), never a user id, name or contact.
 */

type Admin = ReturnType<typeof createAdminClient>;

const PAID_GEAR = new Set(['confirmed', 'active', 'overdue', 'return_pending', 'return_reviewed', 'disputed']);

export type MoveCheck =
  | {
      kind: 'plan_move_check';
      plan_id: string;
      title: string;
      from: string | null;
      to: string;
      shift_days: number;
      parts: MoveAdvice[];
      can_move: boolean;
      say: string;
    }
  | { kind: 'plan_move_unavailable'; code: string; message: string };

/** Units free for a listing over the dates, not counting the client's own bookings in `ownIds`. Null when it cannot be read. */
async function freeOn(rentalId: string, stock: number | null, start: string, end: string, ownIds: Set<string>, requested: number): Promise<boolean | null> {
  try {
    const [holds, blocked] = await Promise.all([loadHolds(rentalId, start, end), blockedUnits(rentalId, start, end)]);
    const others = holds.filter((h) => !ownIds.has(h.id));
    if (blocked > 0) others.push({ id: 'rental_blocks', quantity: blocked, status: 'confirmed', createdAt: new Date(0).toISOString(), paymentReference: null });
    return checkAvailability({ stock: stock ?? 1, holds: others, requested }).available;
  } catch {
    return null;
  }
}

export async function planMoveCheck(clientId: string, projectId: unknown, newDate: unknown, newDateEnd: unknown = null, now: Date = new Date(), db: Admin = createAdminClient()): Promise<MoveCheck> {
  const today = saToday(now);
  const checked = await checkMove(new SupabasePlanMoveStore(db), { clientId, projectId, date: newDate, dateEnd: newDateEnd, today, maxDays: SHOOT_PLAN_POLICY.maxMoveDays, label: formatSaDay });
  if (!checked.ok) return { kind: 'plan_move_unavailable', code: checked.code, message: checked.message };
  const move = checked.move;

  const { data: plan, error } = await db.from('projects').select('id, title, brief, status').eq('id', move.projectId).eq('client_id', clientId).maybeSingle();
  if (error || !plan) return { kind: 'plan_move_unavailable', code: 'not_found', message: 'That plan does not exist.' };
  const brief = (plan.brief ?? {}) as Partial<PlanBrief>;
  const rows = await readItems(db, move.projectId);
  const items = rows.map((r) => ({ itemId: r.id, kind: r.kind, refId: r.ref_id, need: r.kind === 'need' ? validateNeed(r.need) : null }));
  const live = await liveParts(clientId, items, now, db);

  // The hire window on the new dates: the same length as the plan's, from the new start.
  const oldStart = brief.date && isIsoDate(brief.date) ? brief.date : null;
  const oldEnd = brief.date_end && isIsoDate(brief.date_end) ? brief.date_end : oldStart;
  const span = oldStart && oldEnd ? Math.max(0, Math.round((Date.parse(oldEnd) - Date.parse(oldStart)) / 86_400_000)) : 0;
  const newStart = move.date;
  const newEnd = move.dateEnd ?? addDays(newStart, span);

  // Gear orders: their own lines, to check each listing on the new dates.
  const groups = live.filter((l) => l.kind === 'gear_order' && l.found).map((l) => items.find((i) => i.itemId === l.itemId)?.refId).filter((x): x is string => !!x);
  type Line = { id: string; checkout_group_id: string; rental_id: string; quantity: number | null; start_date: string; end_date: string; smart_rentals: { title: string; slug: string; category: string; quantity: number | null } | { title: string; slug: string; category: string; quantity: number | null }[] | null };
  let lines: Line[] = [];
  if (groups.length) {
    const { data, error: e } = await db.from('equipment_bookings').select('id, checkout_group_id, rental_id, quantity, start_date, end_date, smart_rentals(title, slug, category, quantity)').in('checkout_group_id', groups).eq('user_id', clientId);
    if (e) return { kind: 'plan_move_unavailable', code: 'check_failed', message: 'Could not check the gear just now. Try again in a moment.' };
    lines = (data ?? []) as unknown as Line[];
  }
  const ownIds = new Set(lines.map((l) => l.id));
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

  // Gear chosen on the plan but not booked: the listing's stock.
  const rentalIds = items.map((i) => i.need?.rental_id).filter((x): x is string => !!x);
  const stock = new Map<string, { quantity: number | null; title: string; href: string }>();
  if (rentalIds.length) {
    const { data, error: e } = await db.from('smart_rentals').select('id, title, slug, category, quantity').in('id', rentalIds).eq('is_published', true).is('deleted_at', null);
    if (!e) for (const r of (data ?? []) as { id: string; title: string; slug: string; category: string; quantity: number | null }[]) stock.set(r.id, { quantity: r.quantity, title: r.title, href: `/rentals/${r.category}/${r.slug}` });
  }

  const facts: MoveFacts[] = await Promise.all(
    live.map(async (l, i): Promise<MoveFacts> => {
      const it = items[i];
      const line = partView(l, move.projectId, brief).line;
      if (l.kind === 'people_request') {
        if (!l.found) return { kind: 'missing', itemId: l.itemId, line };
        return { kind: 'people_request', itemId: l.itemId, line, status: l.status, personRoleId: l.personRoleId ?? null, roleSlug: l.roleSlug };
      }
      if (l.kind === 'gear_order') {
        if (!l.found) return { kind: 'missing', itemId: l.itemId, line };
        const state: 'paid' | 'hold' | 'over' = l.statuses.some((s) => PAID_GEAR.has(s)) ? 'paid' : l.statuses.includes('pending') ? 'hold' : 'over';
        const mine = lines.filter((x) => x.checkout_group_id === it.refId);
        const checked = state === 'over' ? [] : await Promise.all(
          mine.map(async (x) => {
            const r = one(x.smart_rentals);
            const len = Math.max(0, Math.round((Date.parse(x.end_date) - Date.parse(x.start_date)) / 86_400_000));
            const start = move.shiftDays && oldStart ? addDays(x.start_date, move.shiftDays) : newStart;
            return { title: r?.title ?? 'Gear', href: r ? `/rentals/${r.category}/${r.slug}` : null, available: await freeOn(x.rental_id, r?.quantity ?? null, start, addDays(start, len), ownIds, x.quantity ?? 1) };
          }),
        );
        return { kind: 'gear_order', itemId: l.itemId, line, state, items: checked };
      }
      if (l.kind === 'service_booking') {
        if (!l.found) return { kind: 'missing', itemId: l.itemId, line };
        return { kind: 'service_booking', itemId: l.itemId, line, over: ['cancelled', 'declined', 'completed'].includes(l.status) };
      }
      const n = l.need;
      const s = n.rental_id ? stock.get(n.rental_id) : undefined;
      const rental = n.rental_id && s ? { title: s.title, href: s.href, available: await freeOn(n.rental_id, s.quantity, newStart, newEnd, new Set(), 1) } : null;
      return { kind: 'need', itemId: l.itemId, line, need: n, dueDate: rows[i]?.due_date ?? null, rental };
    }),
  );

  const area = typeof brief.place === 'string' && brief.place ? brief.place : null;
  const parts = moveAdvice(facts, {
    projectId: move.projectId,
    newDate: newStart,
    newDateEnd: move.dateEnd,
    shiftDays: oldStart ? move.shiftDays : null,
    gearNoticeOk: meetsLeadTime(newStart, now),
    whatsappUrl: whatsappLink(`Hi, my plan "${String(plan.title).slice(0, 80)}" is moving to ${formatSaDay(newStart)}. Can you help with my bookings?`),
    area,
  });
  return {
    kind: 'plan_move_check',
    plan_id: move.projectId,
    title: String(plan.title),
    from: oldStart ? formatSaDay(oldStart) : null,
    to: formatSaDay(newStart),
    shift_days: move.shiftDays,
    parts,
    can_move: plan.status === 'open',
    say: moveSay(parts, plan.status === 'open'),
  };
}
