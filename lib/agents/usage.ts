/**
 * Daily Ubunye message counting for signed-in people (`ubunye_usage`).
 *
 * The limit is checked before the model is called, but a message is only
 * COUNTED once a reply has started streaming (the runtime calls this from
 * `onServed`). A failed reply, an outage or a budget refusal never uses up one
 * of the day's messages.
 */

interface UsageDb {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
}

export async function recordAnsweredMessage(
  db: UsageDb,
  p: { userId: string; date: string },
): Promise<void> {
  // Re-read the count: other turns may have been answered since the check.
  const { data: row, error } = await db
    .from('ubunye_usage')
    .select('id, message_count')
    .eq('user_id', p.userId)
    .eq('date', p.date)
    .maybeSingle();
  if (error) throw new Error(`ubunye_usage read failed: ${error.message}`);
  const current = row as { id: string; message_count: number | null } | null;
  if (current) {
    const { error: upErr } = await db
      .from('ubunye_usage')
      .update({ message_count: (current.message_count ?? 0) + 1 })
      .eq('id', current.id);
    if (upErr) throw new Error(`ubunye_usage update failed: ${upErr.message}`);
    return;
  }
  const { error: insErr } = await db.from('ubunye_usage').insert({ user_id: p.userId, date: p.date, message_count: 1 });
  if (insErr) throw new Error(`ubunye_usage insert failed: ${insErr.message}`);
}
