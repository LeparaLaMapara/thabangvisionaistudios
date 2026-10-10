import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Migrations are applied by hand with psql, which commits each statement on
// its own unless the file opens a transaction. Every migration from 067 on is
// one transaction, so a failure leaves the file unapplied (the launch
// checklist's rollback guidance relies on it).
const DIR = join(process.cwd(), 'lib/migrations');
const files = readdirSync(DIR).filter((f) => /^\d{3}-.*\.sql$/.test(f) && !f.endsWith('.test.sql') && Number(f.slice(0, 3)) >= 67);

describe('hand-applied migrations are atomic', () => {
  it.each(files)('%s opens and commits one transaction', (f) => {
    const sql = readFileSync(join(DIR, f), 'utf8');
    expect(sql).toMatch(/^\s*begin\s*;/im);
    expect(sql).toMatch(/^\s*commit\s*;\s*$/im);
    expect(sql).not.toMatch(/\bconcurrently\b/i);
  });
});
