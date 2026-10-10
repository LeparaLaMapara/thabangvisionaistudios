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

interface RpcDb {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
}

export type Reservation =
  | { kind: 'reserved'; count: number }
  | { kind: 'limit_reached' }
  /** 078 is not applied in this database: nothing was reserved (logged loudly). */
  | { kind: 'not_tracked' };

const missingFunction = (e: { code?: string; message?: string }): boolean =>
  e.code === 'PGRST202' || e.code === '42883' || /could not find the function/i.test(e.message ?? '');

export async function reserveMessage(db: RpcDb, p: { userId: string; date: string; limit: number }): Promise<Reservation> {
  const { data, error } = await db.rpc('ubunye_reserve_message', { p_user: p.userId, p_date: p.date, p_limit: p.limit });
  if (error) {
    if (missingFunction(error)) {
      // Deploy order: 078 must be applied before this build (docs/database/README.md).
      console.error('[ubunye-usage] ubunye_reserve_message missing: apply lib/migrations/078-ubunye-usage-reserve.sql. Message not counted.');
      return { kind: 'not_tracked' };
    }
    throw new Error(`ubunye_reserve_message failed: ${error.message ?? 'unknown'}`);
  }
  return typeof data === 'number' ? { kind: 'reserved', count: data } : { kind: 'limit_reached' };
}

export async function releaseMessage(db: RpcDb, p: { userId: string; date: string }): Promise<void> {
  const { error } = await db.rpc('ubunye_release_message', { p_user: p.userId, p_date: p.date });
  if (error) throw new Error(`ubunye_release_message failed: ${error.message ?? 'unknown'}`);
}
