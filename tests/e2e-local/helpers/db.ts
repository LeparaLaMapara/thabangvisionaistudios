/**
 * LOCAL STACK ONLY. Reads and writes the local Supabase Postgres through the
 * psql client, so journey specs can check what the app actually stored
 * (the UI alone proves very little about money and state).
 *
 * Never point LOCAL_DB_URL at a hosted database.
 */
import { execFileSync } from 'node:child_process';

const DB_URL = process.env.LOCAL_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

if (!/@(127\.0\.0\.1|localhost)[:/]/.test(DB_URL)) {
  throw new Error('tests/e2e-local only runs against a local database (LOCAL_DB_URL must be localhost).');
}

function psql(text: string): string {
  return execFileSync('psql', [DB_URL, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-A', '-t', '-c', text], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Rows of a SELECT as plain objects. */
export function rows<T = Record<string, unknown>>(query: string): T[] {
  const out = psql(`select coalesce(json_agg(t), '[]'::json) from (${query}) t`).trim();
  return JSON.parse(out || '[]') as T[];
}

/** The first row of a SELECT, or undefined. */
export function one<T = Record<string, unknown>>(query: string): T | undefined {
  return rows<T>(query)[0];
}

/** A single scalar value. */
export function value<T = unknown>(query: string): T {
  const r = one<{ v: T }>(`select (${query}) as v`);
  return r?.v as T;
}

/** Run statements (insert/update/delete/DDL-free fixtures). */
export function exec(statements: string): void {
  psql(statements);
}

/** SQL string literal. */
export function lit(v: string | number | boolean | null): string {
  if (v === null) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return `'${v.replace(/'/g, "''")}'`;
}

/** Journals whose debits and credits do not balance (should always be empty). */
export function unbalancedJournals(): Array<{ journal_id: string; debits: number; credits: number }> {
  return rows(`
    select journal_id::text, sum(debit_cents)::bigint as debits, sum(credit_cents)::bigint as credits
      from ledger_lines
     group by journal_id
    having sum(debit_cents) <> sum(credit_cents)`);
}
