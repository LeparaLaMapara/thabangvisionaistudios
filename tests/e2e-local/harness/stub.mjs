// Local fake Paystack + Nominatim for end-to-end tests. TEST HARNESS ONLY.
import http from 'node:http';
import crypto from 'node:crypto';
const PORT = Number(process.env.STUB_PORT ?? 4010);
const SECRET = process.env.PAYSTACK_SECRET_KEY ?? 'sk_test_local_stub';
const APP = process.env.APP_URL ?? 'http://localhost:3000';
// The app only sends a browser to an allow-listed payment host
// (lib/payments/hosts.ts), so the stub hands out checkout.paystack.com links.
// The journey specs route that host in the browser to this stub
// (tests/e2e-local/helpers/pay.ts). Override for manual poking.
const CHECKOUT_BASE = process.env.STUB_CHECKOUT_BASE ?? 'https://checkout.paystack.com';
const tx = new Map(); const refunds = []; const uploads = []; let m0; const transfers = new Map(); const log = [];
// Unique across stub restarts: the app keeps provider transaction ids unique.
let nextId = Date.now();
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });
async function webhook(event, data) {
  const body = JSON.stringify({ event, data });
  const sig = crypto.createHmac('sha512', SECRET).update(body).digest('hex');
  try { const r = await fetch(`${APP}/api/webhooks/paystack`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-paystack-signature': sig }, body }); log.push({ webhook: event, ref: data.reference, status: r.status }); return r.status; }
  catch (e) { log.push({ webhook: event, error: String(e) }); return 0; }
}
const txData = (t) => ({ id: t.id, reference: t.reference, amount: t.amount, currency: 'ZAR', status: t.status, paid_at: t.paidAt ?? null, channel: 'card', metadata: t.metadata ?? {}, customer: { email: t.email }, gateway_response: t.status === 'success' ? 'Approved' : 'Abandoned', requested_amount: t.amount });
http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`); const p = u.pathname; const raw = req.method === 'POST' ? await readBody(req) : '';
  let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
  log.push({ m: req.method, p, q: u.search });
  if (p === '/__log') return json(res, 200, { log, tx: [...tx.values()], refunds, transfers: [...transfers.values()], uploads });
  if (p === '/__reset') { tx.clear(); refunds.length = 0; uploads.length = 0; transfers.clear(); log.length = 0; return json(res, 200, { ok: true }); }
  // Time passes at the provider: every pending refund is processed and Paystack
  // tells the app (signed refund.processed webhook), as it does in real life.
  if (p === '/__refunds/settle') {
    const settled = [];
    for (const r of refunds.filter((x) => x.status === 'pending')) {
      r.status = 'processed';
      const status = await webhook('refund.processed', { id: r.id, status: 'processed', transaction_reference: r.transaction.reference, transaction: r.transaction.id, amount: r.amount, currency: 'ZAR', refund_reference: `rf_${r.id}` });
      settled.push({ id: r.id, webhook: status });
    }
    return json(res, 200, { settled });
  }
  // Transfers the provider has finished: transfer.success webhooks (the stub's transfers succeed at once).
  if (p === '/__transfers/notify') {
    const sent = [];
    for (const t of transfers.values()) {
      if (t.notified) continue;
      t.notified = true;
      sent.push({ reference: t.reference, webhook: await webhook(`transfer.${t.status}`, { reference: t.reference, transfer_code: t.transfer_code, amount: t.amount, status: t.status, currency: 'ZAR' }) });
    }
    return json(res, 200, { sent });
  }
  // Nominatim
  if (p === '/search') {
    const q = u.searchParams.get('q') ?? '';
    if (/nowhere|cape town/i.test(q)) return json(res, 200, /cape town/i.test(q) ? [{ lat: '-33.92', lon: '18.42', display_name: '1 Long St, Cape Town, Western Cape, 8001, South Africa', address: { house_number: '1', road: 'Long Street', suburb: 'City Centre', city: 'Cape Town', state: 'Western Cape', postcode: '8001', country: 'South Africa', country_code: 'za' } }] : []);
    return json(res, 200, [{ lat: '-26.1076', lon: '28.0567', display_name: '10 Rivonia Road, Sandton, Johannesburg, Gauteng, 2196, South Africa', address: { house_number: '10', road: 'Rivonia Road', suburb: 'Sandton', city: 'Johannesburg', state: 'Gauteng', postcode: '2196', country: 'South Africa', country_code: 'za' } }]);
  }
  // Cloudinary upload API (server via preload.cjs, browser via helpers/storage.ts).
  if ((m0 = p.match(/^\/cloudinary\/v1_1\/([^/]+)\/(image|video|raw|auto)\/(upload|destroy)$/))) {
    const [, cloud, type, action] = m0;
    if (action === 'destroy') return json(res, 200, { result: 'ok' });
    const folder = (raw.match(/name="folder"\r\n\r\n([^\r\n]*)/) ?? [])[1] ?? 'uploads';
    const id = `${folder}/stub_${crypto.randomUUID().slice(0, 12)}`;
    uploads.push({ cloud, folder, public_id: id });
    return json(res, 200, { public_id: id, secure_url: `https://res.cloudinary.com/${cloud}/${type === 'auto' ? 'image' : type}/upload/v1700000000/${id}.jpg`, resource_type: type === 'auto' ? 'image' : type, format: 'jpg', bytes: 1024, width: 800, height: 600 });
  }
  // Paystack
  if (p === '/transaction/initialize') {
    const ref = body.reference ?? `stub_${crypto.randomUUID()}`;
    const metadata = typeof body.metadata === 'string' ? JSON.parse(body.metadata) : body.metadata;
    tx.set(ref, { id: nextId++, reference: ref, amount: Number(body.amount), email: body.email, metadata, callback: body.callback_url, status: 'abandoned' });
    return json(res, 200, { status: true, message: 'Authorization URL created', data: { authorization_url: `${CHECKOUT_BASE}/checkout/${encodeURIComponent(ref)}`, access_code: 'ac_' + ref, reference: ref } });
  }
  let m;
  if ((m = p.match(/^\/checkout\/([^/]+)$/))) {
    const t = tx.get(decodeURIComponent(m[1])); if (!t) return json(res, 404, {});
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(`<!doctype html><title>Stub Paystack</title><h1>Pay R${(t.amount / 100).toFixed(2)}</h1><a id="pay" href="/checkout/${m[1]}/pay">Pay</a> <a id="cancel" href="/checkout/${m[1]}/cancel">Cancel</a>`);
  }
  if ((m = p.match(/^\/checkout\/([^/]+)\/(pay|cancel)$/))) {
    const t = tx.get(decodeURIComponent(m[1])); if (!t) return json(res, 404, {});
    if (m[2] === 'cancel') { res.writeHead(302, { location: t.metadata?.cancel_action ?? t.callback }); return res.end(); }
    t.status = 'success'; t.paidAt = new Date().toISOString();
    if (u.searchParams.get('webhook') !== 'skip') await webhook('charge.success', txData(t));
    const cb = new URL(t.callback); cb.searchParams.set('reference', t.reference); cb.searchParams.set('trxref', t.reference);
    res.writeHead(302, { location: cb.toString() }); return res.end();
  }
  if ((m = p.match(/^\/transaction\/verify\/(.+)$/))) {
    const t = tx.get(decodeURIComponent(m[1])); if (!t) return json(res, 404, { status: false, message: 'Transaction reference not found' });
    return json(res, 200, { status: true, message: 'Verification successful', data: txData(t) });
  }
  if (p === '/refund' && req.method === 'POST') {
    const t = [...tx.values()].find((x) => x.reference === String(body.transaction) || String(x.id) === String(body.transaction));
    if (!t) return json(res, 400, { status: false, message: 'Transaction not found' });
    const r = { id: nextId++, transaction: { id: t.id, reference: t.reference }, amount: Number(body.amount ?? t.amount), currency: 'ZAR', status: 'pending', merchant_note: body.merchant_note, customer_note: body.customer_note };
    refunds.push(r); return json(res, 200, { status: true, message: 'Refund has been queued for processing', data: r });
  }
  if (p === '/refund' && req.method === 'GET') {
    const key = u.searchParams.get('transaction');
    return json(res, 200, { status: true, data: refunds.filter((r) => r.transaction.reference === key || String(r.transaction.id) === key) });
  }
  if (p === '/transferrecipient') return json(res, 200, { status: true, data: { recipient_code: 'RCP_stub_' + crypto.randomUUID().slice(0, 8), active: true, details: { account_number: body.account_number, bank_code: body.bank_code } } });
  if (p === '/bank/validate') return json(res, 200, { status: true, data: { verified: true, verificationMessage: 'Account is verified successfully' } });
  if (p === '/bank/resolve') return json(res, 200, { status: true, data: { account_number: u.searchParams.get('account_number'), account_name: 'TEST ACCOUNT' } });
  if (p === '/bank') return json(res, 200, { status: true, data: [{ name: 'Test Bank', code: '632005', type: 'basa', currency: 'ZAR' }] });
  if (p === '/transfer' && req.method === 'POST') { const t = { id: nextId++, reference: body.reference, amount: body.amount, recipient: body.recipient, status: 'success', transfer_code: 'TRF_' + nextId }; transfers.set(body.reference, t); return json(res, 200, { status: true, data: t }); }
  if ((m = p.match(/^\/transfer\/verify\/(.+)$/))) { const t = transfers.get(decodeURIComponent(m[1])); return t ? json(res, 200, { status: true, data: t }) : json(res, 404, { status: false, message: 'Transfer not found' }); }
  return json(res, 404, { status: false, message: `stub: no route ${req.method} ${p}` });
}).listen(PORT, () => console.log(`stub on ${PORT}`));
