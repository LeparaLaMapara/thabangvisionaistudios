/**
 * Daily Ubunye message slots for signed-in people (`ubunye_usage`, 078).
 *
 * A slot is RESERVED atomically before the model is called
 * (`ubunye_reserve_message`: one INSERT ... ON CONFLICT DO UPDATE ... WHERE
 * count < limit), so parallel prompts can never pass the day's limit and no
 * increment is lost. If no reply ever starts (every provider failed, the AI
 * budget refused, the request broke before streaming), the slot is RELEASED
 * (`ubunye_release_message`, never below 0). A failed reply does not use up a
 * message (D-68); an answered one always does.
 */

type DbError = { code?: string; message?: string } | null;

/** The table calls the pre-078 fallback needs (a Supabase client provides them). */
interface UsageTable {
  select: (cols: string) => {
    eq: (c: string, v: string) => { eq: (c: string, v: string) => { maybeSingle: () => PromiseLike<{ data: { id: string; message_count: number } | null; error: DbError }> } };
  };
  update: (v: Record<string, unknown>) => { eq: (c: string, v: string) => PromiseLike<{ error: DbError }> };
  insert: (v: Record<string, unknown>) => PromiseLike<{ error: DbError }>;
}

interface RpcDb {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: DbError }>;
  /** A Supabase client's `from`; used only by the pre-078 fallback. */
  from?: (table: string) => unknown;
}

export type Reservation =
  | { kind: 'reserved'; count: number }
  | { kind: 'limit_reached' }
  /** 078 is not applied and no table client was given: nothing was reserved (logged loudly). */
  | { kind: 'not_tracked' };

const missingFunction = (e: { code?: string; message?: string }): boolean =>
  e.code === 'PGRST202' || e.code === '42883' || /could not find the function/i.test(e.message ?? '');

export async function reserveMessage(db: RpcDb, p: { userId: string; date: string; limit: number }): Promise<Reservation> {
  const { data, error } = await db.rpc('ubunye_reserve_message', { p_user: p.userId, p_date: p.date, p_limit: p.limit });
  if (error) {
    if (missingFunction(error)) {
      // 078 not applied yet: keep counting the old (non-atomic) way rather
      // than not at all, so a deploy ahead of the migration never means
      // unlimited messages. Logged loudly so the migration gets applied.
      console.error('[ubunye-usage] ubunye_reserve_message missing: apply lib/migrations/078-ubunye-usage-reserve.sql. Using the pre-078 count.');
      return legacyReserve(db, p);
    }
    throw new Error(`ubunye_reserve_message failed: ${error.message ?? 'unknown'}`);
  }
  return typeof data === 'number' ? { kind: 'reserved', count: data } : { kind: 'limit_reached' };
}

export async function releaseMessage(db: RpcDb, p: { userId: string; date: string }): Promise<void> {
  const { error } = await db.rpc('ubunye_release_message', { p_user: p.userId, p_date: p.date });
  if (!error) return;
  if (missingFunction(error) && db.from) {
    const row = await legacyRow(db, p);
    if (row && row.message_count > 0) {
      const { error: e } = await usageTable(db)!.update({ message_count: row.message_count - 1 }).eq('id', row.id);
      if (e) throw new Error(`ubunye usage release failed: ${e.message ?? 'unknown'}`);
    }
    return;
  }
  throw new Error(`ubunye_release_message failed: ${error.message ?? 'unknown'}`);
}

/** A fresh query builder per call: Supabase builders are single-use. */
function usageTable(db: RpcDb): UsageTable | null {
  return db.from ? (db.from('ubunye_usage') as UsageTable) : null;
}

async function legacyRow(db: RpcDb, p: { userId: string; date: string }): Promise<{ id: string; message_count: number } | null> {
  const { data, error } = await usageTable(db)!.select('id, message_count').eq('user_id', p.userId).eq('date', p.date).maybeSingle();
  if (error) throw new Error(`ubunye usage read failed: ${error.message ?? 'unknown'}`);
  return data;
}

/** Before 078: check and count with the table directly (not atomic, as before this change). */
async function legacyReserve(db: RpcDb, p: { userId: string; date: string; limit: number }): Promise<Reservation> {
  if (!db.from) return { kind: 'not_tracked' };
  const row = await legacyRow(db, p);
  const count = row?.message_count ?? 0;
  if (count >= p.limit) return { kind: 'limit_reached' };
  const { error } = row
    ? await usageTable(db)!.update({ message_count: count + 1 }).eq('id', row.id)
    : await usageTable(db)!.insert({ user_id: p.userId, date: p.date, message_count: 1 });
  if (error) throw new Error(`ubunye usage count failed: ${error.message ?? 'unknown'}`);
  return { kind: 'reserved', count: count + 1 };
}
