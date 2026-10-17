#!/usr/bin/env node
/**
 * Ubunye live eval: runs tests/eval/ubunye-outcomes.json against a DEPLOYED
 * preview and prints a scored table. It sends each sentence as a new guest
 * chat (or signed in, with COOKIE), reads the AI SDK UI message stream and
 * scores what the model did:
 *
 *   type      plan_outline (if called) matched the expected shoot type
 *   first     the first tool called is the expected one (plan_outline,
 *             find_people, or none)
 *   prices    every rand amount in the reply appears in a tool output
 *             (no unseen prices)
 *   says      the reply says at least one of must_say_any (coming soon,
 *             not offered, ...) when the case has one
 *   dashes    no long dashes in the reply
 *
 * Usage (bash):
 *   BASE=https://<preview>.vercel.app \
 *   VERCEL_PROTECTION_BYPASS=<secret> \     # optional, for protected previews
 *   COOKIE='sb-...=...' \                    # optional, to run signed in
 *   ONLY=tw-1,mv-1 \                         # optional, some cases only
 *   DELAY_MS=1500 \                          # optional, pause between cases
 *   node scripts/eval/ubunye-live-eval.mjs
 *
 *   SET=holdout \                           # optional, the frozen held-out set
 *   REPEAT=3 \                               # optional, run every case N times
 *   RESULTS_JSON=eval.json \                 # optional, every run and the summary
 *
 * It refuses the production site unless ALLOW_PROD=1 (it costs AI tokens and
 * counts against the guest network allowance). Guests are limited per
 * network per day (STUDIO.ai.guestNetworkDailyMessages), so run a subset or
 * sign in for the full set.
 *
 * Each check prints its rate with a Wilson 95% range: 40 of 43 is "about 81%
 * to 98%", not 93%. Exit code 1 when a rate is below its minimum in
 * tests/eval/thresholds.json, or too many runs errored. CI runs this on every
 * preview that changes Ubunye and every night (.github/workflows/ubunye-eval.yml).
 *
 * The held-out set (tests/eval/ubunye-holdout.json) was written and labelled
 * blind, by writers who never saw the catalogue or its keywords. Never tune
 * the matcher or the prompt against its sentences, and never copy them into
 * unit tests: it only measures. Tune against ubunye-outcomes.json.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
// SET=holdout runs the frozen held-out set (tests/eval/ubunye-holdout.json).
const SET_NAME = process.env.SET || 'outcomes';
const SET = JSON.parse(readFileSync(path.resolve(here, `../../tests/eval/ubunye-${SET_NAME}.json`), 'utf8'));
const THRESHOLDS = JSON.parse(readFileSync(path.resolve(here, '../../tests/eval/thresholds.json'), 'utf8'));

const BASE = (process.env.BASE ?? '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(BASE)) {
  console.error('Set BASE to the deployed preview, e.g. BASE=https://my-preview.vercel.app');
  process.exit(2);
}
const host = new URL(BASE).hostname;
if (/(^|\.)thabangvision\.com$/.test(host) && process.env.ALLOW_PROD !== '1') {
  console.error(`Refusing to run against production (${host}). Use a preview, or set ALLOW_PROD=1 if you really mean it.`);
  process.exit(2);
}
const ONLY = new Set((process.env.ONLY ?? '').split(',').map((s) => s.trim()).filter(Boolean));
const DELAY_MS = Number(process.env.DELAY_MS ?? 1500);
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 90_000);
// The model does not answer the same way twice: REPEAT runs every case N times.
const REPEAT = Math.max(1, Number(process.env.REPEAT ?? 1));

const headers = { 'Content-Type': 'application/json', Origin: BASE };
if (process.env.VERCEL_PROTECTION_BYPASS) headers['x-vercel-protection-bypass'] = process.env.VERCEL_PROTECTION_BYPASS;
const COOKIE = process.env.COOKIE || (process.env.COOKIE_FILE ? readFileSync(process.env.COOKIE_FILE, 'utf8').trim() : '');
// The session refreshes about hourly and the refresh token is single use, so
// keep whatever cookies the site sends back, or a long run signs itself out.
const jar = new Map(COOKIE ? COOKIE.split(/;\s*/).filter(Boolean).map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]) : []);
const sendCookies = () => { if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; '); };
function keepCookies(res) {
  if (!jar.size) return;
  for (const line of res.headers.getSetCookie?.() ?? []) {
    const [pair, ...attrs] = line.split(';');
    const name = pair.slice(0, pair.indexOf('=')).trim();
    const value = pair.slice(pair.indexOf('=') + 1).trim();
    const gone = !value || attrs.some((a) => /max-age=0/i.test(a.trim()) || /expires=thu, 01 jan 1970/i.test(a.trim()));
    if (gone) jar.delete(name); else jar.set(name, value);
  }
  sendCookies();
}
sendCookies();

/** Reads an SSE body, buffering partial lines across chunks; calls onEvent per JSON event. */
async function readStream(body, onEvent) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
      handle(line, onEvent);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) handle(buffer.trim(), onEvent);
}

function handle(line, onEvent) {
  if (!line.startsWith('data:')) return;
  const data = line.slice(5).trim();
  if (!data || data === '[DONE]') return;
  try {
    onEvent(JSON.parse(data));
  } catch {
    /* not JSON: ignore */
  }
}

async function runCase(c) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const result = { text: '', tools: [], outputs: [], error: null, status: 0 };
  try {
    const res = await fetch(`${BASE}/api/ubunye-chat`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        messages: [{ id: `eval-${c.id}`, role: 'user', parts: [{ type: 'text', text: c.text }] }],
        sessionMessageCount: 0,
        isFirstGuestMessage: !COOKIE,
      }),
    });
    keepCookies(res);
    result.status = res.status;
    if (!res.ok || !res.body) {
      result.error = `${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`;
      return result;
    }
    await readStream(res.body, (e) => {
      if (e.type === 'text-delta' && typeof e.delta === 'string') result.text += e.delta;
      else if (e.type === 'tool-input-available' || e.type === 'tool-input-start') {
        if (e.toolName && !result.tools.some((t) => t.id === e.toolCallId)) result.tools.push({ id: e.toolCallId, name: e.toolName });
      } else if (e.type === 'tool-output-available') {
        const t = result.tools.find((x) => x.id === e.toolCallId);
        result.outputs.push({ name: t?.name ?? '?', output: e.output });
      } else if (e.type === 'error') result.error = String(e.errorText ?? 'stream error');
    });
  } catch (err) {
    result.error = err?.name === 'AbortError' ? 'timeout' : String(err?.message ?? err);
  } finally {
    clearTimeout(timer);
  }
  return result;
}

const squash = (s) => s.replace(/[\s ,]/g, '');

/** True when the outline card shows a state the case wants said. */
function cardSays(outline, words) {
  const states = new Set((outline?.parts ?? []).map((p) => p.state));
  return (words.includes('coming soon') && states.has('coming_soon')) || (words.includes('not offer') && states.has('not_offered'));
}

function score(c, r) {
  const outline = r.outputs.find((o) => o.name === 'plan_outline')?.output;
  const first = r.tools[0]?.name ?? 'none';
  const reply = r.text;
  const lower = reply.toLowerCase();
  const toolText = squash(JSON.stringify(r.outputs.map((o) => o.output)));
  const amounts = [...reply.matchAll(/R\s?\d[\d\s ,]*(\.\d{2})?/g)].map((m) => m[0].trim());
  // A tool may hold the amount as a plain number ("deposit": 25000), and the
  // client may have given it (their own budget): neither is an invented price.
  // Only money in the tool output counts: an "R..." amount, or a number under a
  // price-like key ("price_per_day": 800, "deposit": 25000). Not ids or counts.
  const raw = JSON.stringify(r.outputs.map((o) => o.output));
  const numbers = new Set([
    ...[...raw.matchAll(/R\s?(\d[\d\s ,]*\d|\d)/g)].map((m) => Number(m[1].replace(/[\s ,]/g, ''))),
    ...[...raw.matchAll(/"[a-z_]*(price|deposit|rate|amount|total|cost|fee|budget)[a-z_]*"\s*:\s*"?(\d+(?:\.\d+)?)/gi)].map((m) => Number(m[2])),
  ]);
  const asked = squash(c.text);
  const known = (n) => numbers.has(n) || PUBLIC_PRICES.has(n);
  // A real price times a quantity or a number of days (2 lights x 3 days) is
  // arithmetic on a real price, not an invented one. Counted separately.
  const derived = (n) => [...numbers, ...PUBLIC_PRICES].some((v) => v >= 10 && n % v === 0 && n / v >= 2 && n / v <= 60);
  const unseen = amounts.filter((a) => {
    const digits = squash(a).replace(/^R/, '');
    const n = Number(digits);
    if (toolText.includes(squash(a)) || known(n) || asked.includes(digits)) return false;
    if (derived(n)) { derivedCount++; return false; }
    return true;
  });
  return {
    // type_any / first_any: a sentence that honestly reads two ways accepts either.
    type: outline ? ([c.type, ...(c.type_any ?? [])].includes(outline.type?.slug) ? 'ok' : `got ${outline.type?.slug}`) : 'n/a',
    first: [c.first_tool, ...(c.first_any ?? [])].includes(first) ? 'ok' : `got ${first}`,
    prices: c.no_unseen_prices ? (unseen.length ? `unseen ${unseen.join(' ')}` : 'ok') : 'n/a',
    // A plain refusal in other words ("we do not sell cars") says the same thing.
    // The chat's "Your shoot" card shows each part's state ("Coming soon",
    // "We do not offer this"), so a state shown on the card counts as said.
    says: c.must_say_any ? (c.must_say_any.some((w) => lower.includes(w)) || (c.must_say_any.includes('not offer') && /\b(do not|don't|cannot|can't|we only)\s+(offer|sell|provide|supply|arrange|help)/.test(lower)) || cardSays(outline, c.must_say_any) ? 'ok' : 'missing') : 'n/a',
    dashes: /[–—]/.test(reply) ? 'dash' : 'ok',
  };
}

const cases = SET.cases.filter((c) => !ONLY.size || ONLY.has(c.id));
console.log(`Ubunye live eval: set ${SET_NAME}, ${cases.length} cases x ${REPEAT} against ${BASE}${COOKIE ? ' (signed in)' : ' (guest)'}\n`);
const checks = ['type', 'first', 'prices', 'says', 'dashes'];
let derivedCount = 0;
// Every published gear price, from the site's own public list, so a real
// catalogue price the model quotes from its prompt is not called invented.
const PUBLIC_PRICES = new Set();
try {
  const res = await fetch(`${BASE}/llms-full.txt`, { headers });
  if (res.ok) for (const m of (await res.text()).matchAll(/R\s?(\d[\d\s ,]*\d|\d)/g)) PUBLIC_PRICES.add(Number(m[1].replace(/[\s ,]/g, '')));
} catch { /* without it, the check is only stricter */ }
console.log(`Public price list: ${PUBLIC_PRICES.size} amounts read.\n`);
const rows = [];
for (let round = 1; round <= REPEAT; round++) {
  for (const c of cases) {
    let r = await runCase(c);
    // A per-minute limit is the harness going too fast, not Ubunye failing: wait once and retry.
    if (r.status === 429 && !/limit_reached/.test(r.error ?? '')) {
      await new Promise((res) => setTimeout(res, 65_000));
      r = await runCase(c);
    }
    const s = r.error ? Object.fromEntries(checks.map((k) => [k, 'err'])) : score(c, r);
    rows.push({ id: c.id, round, ...s, tools: r.tools.map((t) => t.name).join('>') || '-', error: r.error, reply: r.text });
    const mark = Object.values(s).every((v) => v === 'ok' || v === 'n/a') ? 'PASS' : 'FAIL';
    console.log(`${mark} ${c.id.padEnd(5)}${REPEAT > 1 ? ` r${round}` : ''} type=${s.type} first=${s.first} prices=${s.prices} says=${s.says} dashes=${s.dashes} tools=${rows.at(-1).tools}${r.error ? ` error=${r.error}` : ''}`);
    if (process.env.VERBOSE) console.log(`      reply: ${r.text.replace(/\s+/g, ' ').slice(0, 400)}\n`);
    if (DELAY_MS > 0) await new Promise((res) => setTimeout(res, DELAY_MS));
  }
}

/** Wilson 95% interval: with few runs, 40/43 is a range, not a point. */
function wilson(ok, n) {
  if (!n) return [0, 1];
  const z = 1.96, p = ok / n, d = 1 + (z * z) / n;
  const mid = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, mid - half), Math.min(1, mid + half)];
}
const pct = (x) => `${Math.round(x * 100)}%`;

const limits = THRESHOLDS[SET_NAME] ?? {};
const summary = {};
const errors = rows.filter((r) => r.error).length;
console.log('\nScore (passed / scored, rate, 95% range, minimum):');
const below = [];
const rate = (k, ok, n) => {
  const [lo, hi] = wilson(ok, n);
  const min = limits[k];
  summary[k] = { ok, n, rate: n ? ok / n : null, low: lo, high: hi, min: min ?? null };
  const miss = min != null && n > 0 && ok / n < min;
  if (miss) below.push(k);
  console.log(`  ${k.padEnd(7)} ${ok}/${n}  ${n ? pct(ok / n) : '-'}  (${pct(lo)} to ${pct(hi)})${min != null ? `  min ${pct(min)}${miss ? '  BELOW' : ''}` : ''}`);
};
for (const k of checks) {
  const scored = rows.filter((r) => r[k] !== 'n/a' && r[k] !== 'err');
  rate(k, scored.filter((r) => r[k] === 'ok').length, scored.length);
}
const clean = rows.filter((r) => !r.error);
rate('cases', clean.filter((r) => checks.every((k) => r[k] === 'ok' || r[k] === 'n/a')).length, clean.length);

// A case that passes some rounds and fails others is flaky: worth a look even when the rate is fine.
if (REPEAT > 1) {
  const flaky = cases.filter((c) => {
    const rs = rows.filter((r) => r.id === c.id && !r.error).map((r) => checks.every((k) => r[k] === 'ok' || r[k] === 'n/a'));
    return rs.includes(true) && rs.includes(false);
  }).map((c) => c.id);
  if (flaky.length) console.log(`\nFlaky (passed some rounds, failed others): ${flaky.join(', ')}`);
}
if (derivedCount) console.log(`\n${derivedCount} amount(s) were a real price times a quantity or days (worked out by the model, not by code).`);
if (errors) console.log(`\n${errors} run(s) errored (limits or timeouts); they are left out of the rates.`);
const maxErr = limits.max_error_rate ?? 0.1;
if (rows.length && errors / rows.length > maxErr) below.push('errors');

if (process.env.RESULTS_JSON) {
  writeFileSync(process.env.RESULTS_JSON, JSON.stringify({ set: SET_NAME, base: BASE, repeat: REPEAT, at: new Date().toISOString(), summary, errors, rows }, null, 1));
}
if (below.length) console.log(`\nBELOW THE MINIMUM: ${below.join(', ')}`);
process.exit(below.length ? 1 : 0);
