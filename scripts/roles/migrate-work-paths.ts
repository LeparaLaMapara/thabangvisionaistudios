/**
 * Move People work files out of user-id folders (security M1b).
 *
 * Before 2026-10-15 a work photo or clip was filed with the URL the browser
 * uploaded to: <userRoot>/<user id>/..., so the blind /people page showed the
 * person's user id in <img src>. New uploads are moved when filed
 * (lib/roles/work-path.ts). This moves the ones filed before that.
 *
 * For every role_evidence row whose url or storage_ref still carries
 * users/<uuid>/, it renames the Cloudinary asset to
 * <roleWorkRoot>/<person_role id>/m<hash> and updates url + storage_ref.
 *
 * Idempotent: rows already moved no longer match. The new id is derived from
 * the row (not random), so a run that renamed a file but died before the
 * database write is finished by the next run (the target already exists).
 * The row update is compare-and-set on the old url.
 *
 *   npx tsx scripts/roles/migrate-work-paths.ts            # dry run: lists what would move
 *   npx tsx scripts/roles/migrate-work-paths.ts --apply    # moves and updates
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and the
 * CLOUDINARY_* keys from the environment or .env.local. Refuses the
 * production database unless --allow-prod is passed (run on prod only after
 * the release that moves new uploads is live).
 */
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { cloudinary } from '@/lib/storage/cloudinary';
import { carriesUserId, resourceTypeOfUrl, roleWorkFolder } from '@/lib/roles/work-path';

const PROD_REF = 'zbdsqvpxpsygbuqnuekm';
const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');

function loadEnv(): void {
  let text = '';
  try {
    text = readFileSync('.env.local', 'utf8');
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
}

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (environment or .env.local)`);
  return v;
}

/** The asset's id inside the profile folder, fixed per row so reruns land on the same id. */
export function migratedPublicId(personRoleId: string, evidenceId: string, oldPublicId: string): string {
  const h = crypto.createHash('sha256').update(`${evidenceId}:${oldPublicId}`).digest('hex').slice(0, 24);
  return `${roleWorkFolder(personRoleId)}/m${h}`;
}

/** Public id from a Cloudinary delivery URL (no version, no extension). */
function publicIdFromUrl(url: string): string | null {
  const m = /\/(?:image|video|raw)\/upload\/(?:v\d+\/)?(.+?)(?:\.[A-Za-z0-9]{1,8})?$/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}

async function assetUrl(publicId: string, type: 'image' | 'video' | 'raw'): Promise<string | null> {
  const cloud = need('CLOUDINARY_CLOUD_NAME');
  const auth = Buffer.from(`${need('CLOUDINARY_API_KEY')}:${need('CLOUDINARY_API_SECRET')}`).toString('base64');
  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${cloud}/resources/${type}/upload/${publicId.split('/').map(encodeURIComponent).join('/')}`,
    { headers: { Authorization: `Basic ${auth}` } },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { secure_url?: string };
  return data.secure_url ?? null;
}

const mask = (s: string) => s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>');

async function main(): Promise<void> {
  loadEnv();
  const url = need('NEXT_PUBLIC_SUPABASE_URL');
  const ref = new URL(url).hostname.split('.')[0];
  if (ref === PROD_REF && !args.has('--allow-prod')) {
    throw new Error('This is the production database. Pass --allow-prod once the release that moves new uploads is live.');
  }
  const db = createClient(url, need('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
  console.log(`[migrate-work-paths] database ${ref.slice(0, 4)}…, ${APPLY ? 'APPLY' : 'dry run'}`);

  const { data, error } = await db
    .from('role_evidence')
    .select('id, person_role_id, url, storage_ref, storage_provider')
    .or('url.ilike.%/users/%,storage_ref.ilike.%users/%');
  if (error) throw new Error(error.message);
  const rows = (data ?? []).filter((r) => carriesUserId(r.url) || carriesUserId(r.storage_ref));
  console.log(`[migrate-work-paths] ${rows.length} row(s) carry a user id`);

  let moved = 0;
  let failed = 0;
  for (const r of rows) {
    const oldUrl = r.url as string | null;
    const type = resourceTypeOfUrl(oldUrl);
    const oldId = (r.storage_provider === 'cloudinary' && r.storage_ref) || (oldUrl ? publicIdFromUrl(oldUrl) : null);
    if (!oldId || !oldUrl) {
      console.warn(`  skip ${r.id}: no Cloudinary id`);
      failed++;
      continue;
    }
    const target = migratedPublicId(r.person_role_id as string, r.id as string, oldId);
    console.log(`  ${r.id}: ${mask(oldId)} -> ${target}`);
    if (!APPLY) continue;
    let newUrl: string | null = null;
    try {
      newUrl = (await cloudinary.renameAsset!(oldId, target, type)).url;
    } catch (err) {
      // Already renamed by an earlier run that stopped before the row update?
      newUrl = await assetUrl(target, type);
      if (!newUrl) {
        console.error(`    rename failed: ${err instanceof Error ? mask(err.message) : err}`);
        failed++;
        continue;
      }
    }
    const { data: upd, error: updErr } = await db
      .from('role_evidence')
      .update({ url: newUrl, storage_ref: target, storage_provider: 'cloudinary' })
      .eq('id', r.id)
      .eq('url', oldUrl)
      .select('id');
    if (updErr || !upd?.length) {
      console.error(`    row not updated: ${updErr?.message ?? 'row changed meanwhile'}`);
      failed++;
      continue;
    }
    moved++;
  }
  console.log(`[migrate-work-paths] done: ${APPLY ? moved : 0} moved, ${failed} failed, ${rows.length} matched`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[migrate-work-paths]', err instanceof Error ? mask(err.message) : err);
  process.exit(1);
});
