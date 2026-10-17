#!/usr/bin/env node
/**
 * Signs the eval account in and writes its session cookie to a file, for
 * ubunye-live-eval.mjs (COOKIE_FILE). Used by .github/workflows/ubunye-eval.yml.
 *
 *   SUPABASE_URL, SUPABASE_ANON_KEY   the DEV project (previews use dev)
 *   EVAL_USER_EMAIL, EVAL_USER_PASSWORD
 *   node scripts/eval/eval-session.mjs <cookie-file>
 *
 * Refuses the production project. Never prints the cookie.
 */
import { writeFileSync } from 'node:fs';
import { createServerClient } from '@supabase/ssr';

const PROD_REF = 'zbdsqvpxpsygbuqnuekm';
const { SUPABASE_URL: url, SUPABASE_ANON_KEY: anon, EVAL_USER_EMAIL: email, EVAL_USER_PASSWORD: password } = process.env;
const out = process.argv[2];
if (!url || !anon || !email || !password || !out) {
  console.error('Set SUPABASE_URL, SUPABASE_ANON_KEY, EVAL_USER_EMAIL, EVAL_USER_PASSWORD and pass a cookie file.');
  process.exit(2);
}
if (url.includes(PROD_REF)) {
  console.error('Refusing the production project: the eval account lives on dev.');
  process.exit(2);
}
const jar = new Map();
const sb = createServerClient(url, anon, {
  cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (cs) => cs.forEach((c) => jar.set(c.name, c.value)) },
});
const { error } = await sb.auth.signInWithPassword({ email, password });
if (error) {
  console.error(`Sign in failed: ${error.message}`);
  process.exit(1);
}
writeFileSync(out, [...jar].map(([k, v]) => `${k}=${v}`).join('; '), { mode: 0o600 });
console.log('Signed in; cookie written.');
