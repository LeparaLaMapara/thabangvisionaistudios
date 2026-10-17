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
 * It refuses the production site unless ALLOW_PROD=1 (it costs AI tokens and
 * counts against the guest network allowance). Guests are limited per
 * network per day (STUDIO.ai.guestNetworkDailyMessages), so run a subset or
 * sign in for the full set. Exit code 1 when any scored check fails.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const SET = JSON.parse(readFileSync(path.resolve(here, '../../tests/eval/ubunye-outcomes.json'), 'utf8'));

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

const headers = { 'Content-Type': 'application/json', Origin: BASE };
if (process.env.VERCEL_PROTECTION_BYPASS) headers['x-vercel-protection-bypass'] = process.env.VERCEL_PROTECTION_BYPASS;
if (process.env.COOKIE) headers.Cookie = process.env.COOKIE;

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
        isFirstGuestMessage: !process.env.COOKIE,
      }),
    });
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

function score(c, r) {
  const outline = r.outputs.find((o) => o.name === 'plan_outline')?.output;
  const first = r.tools[0]?.name ?? 'none';
  const reply = r.text;
  const lower = reply.toLowerCase();
  const toolText = squash(JSON.stringify(r.outputs.map((o) => o.output)));
  const amounts = [...reply.matchAll(/R\s?\d[\d\s ,]*(\.\d{2})?/g)].map((m) => m[0].trim());
  // A tool may hold the amount as a plain number ("deposit": 25000), and the
  // client may have given it (their own budget): neither is an invented price.
  const numbers = new Set([...toolText.matchAll(/\d+(?:\.\d+)?/g)].map((m) => String(Number(m[0]))));
  const asked = squash(c.text);
  const unseen = amounts.filter((a) => {
    const digits = squash(a).replace(/^R/, '');
    return !toolText.includes(squash(a)) && !numbers.has(String(Number(digits))) && !asked.includes(digits);
  });
  return {
    type: outline ? (outline.type?.slug === c.type ? 'ok' : `got ${outline.type?.slug}`) : 'n/a',
    first: first === c.first_tool ? 'ok' : `got ${first}`,
    prices: c.no_unseen_prices ? (unseen.length ? `unseen ${unseen.join(' ')}` : 'ok') : 'n/a',
    says: c.must_say_any ? (c.must_say_any.some((w) => lower.includes(w)) ? 'ok' : 'missing') : 'n/a',
    dashes: /[–—]/.test(reply) ? 'dash' : 'ok',
  };
}

const cases = SET.cases.filter((c) => !ONLY.size || ONLY.has(c.id));
console.log(`Ubunye live eval: ${cases.length} cases against ${BASE}${process.env.COOKIE ? ' (signed in)' : ' (guest)'}\n`);
const rows = [];
for (const c of cases) {
  const r = await runCase(c);
  const s = r.error ? { type: 'err', first: 'err', prices: 'err', says: 'err', dashes: 'err' } : score(c, r);
  rows.push({ id: c.id, ...s, tools: r.tools.map((t) => t.name).join('>') || '-', error: r.error });
  const mark = Object.values(s).every((v) => v === 'ok' || v === 'n/a') ? 'PASS' : 'FAIL';
  console.log(`${mark} ${c.id.padEnd(5)} type=${s.type} first=${s.first} prices=${s.prices} says=${s.says} dashes=${s.dashes} tools=${rows.at(-1).tools}${r.error ? ` error=${r.error}` : ''}`);
  if (process.env.VERBOSE) console.log(`      reply: ${r.text.replace(/\s+/g, ' ').slice(0, 400)}\n`);
  if (DELAY_MS > 0) await new Promise((res) => setTimeout(res, DELAY_MS));
}

const checks = ['type', 'first', 'prices', 'says', 'dashes'];
console.log('\nScore (passed / scored):');
let failed = 0;
for (const k of checks) {
  const scored = rows.filter((r) => r[k] !== 'n/a');
  const ok = scored.filter((r) => r[k] === 'ok').length;
  failed += scored.length - ok;
  console.log(`  ${k.padEnd(7)} ${ok}/${scored.length}`);
}
const full = rows.filter((r) => checks.every((k) => r[k] === 'ok' || r[k] === 'n/a')).length;
console.log(`  cases   ${full}/${rows.length} fully passed`);
process.exit(failed ? 1 : 0);
