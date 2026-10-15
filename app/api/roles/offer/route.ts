export const dynamic = 'force-dynamic';

import { NextResponse, type NextRequest } from 'next/server';
import { rolesOffResponse } from '@/lib/roles/flag';
import { checkRateLimit } from '@/lib/auth';
import { ROLES_POLICY, STUDIO } from '@/lib/constants';
import { sanitizeClientMetadata } from '@/lib/metadata/verification';
import { storage } from '@/lib/storage';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { getMyPersonRole, getRole, ROLE_DOCUMENT_BUCKET } from '@/lib/supabase/queries/roles';
import { audioBecomes, classifySource, inlineLegalAsks, profilePrefill, sanitizeFacts } from '@/lib/roles';
import { reembedQuietly } from '@/lib/roles/embed-server';
import { ownUploadPublicId } from '@/lib/roles/own-upload';

/**
 * Screen 2 confirmed: "Yes, that's me". Creates (or updates) the draft for the
 * chosen role and files everything the person put in the box as the right
 * kind of proof, decided by the role:
 *   - photos and clips (already in their own Cloudinary folder) are work
 *     (Look; Thing for gear and vehicles; supporting photos for trust roles);
 *   - audio is a public Listen clip for listen roles, else a private voice note;
 *   - a CV and the legal photo stay private;
 *   - the reviewed facts are saved (PII stripped again here).
 *
 * POST { role_slug, facts, facts_source, work: [...], private: [{ path, kind, legal_code? }] }
 */

interface WorkItem {
  url?: unknown;
  public_id?: unknown;
  kind?: unknown;
  from_camera?: unknown;
  exif?: unknown;
  last_modified?: unknown;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const off = await rolesOffResponse();
  if (off) return off;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  if (!(await checkRateLimit(`roles-offer:${user.id}`, 20, 60_000))) {
    return NextResponse.json({ error: 'Too many tries. Wait a moment.' }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  }

  const role = await getRole(typeof body.role_slug === 'string' ? body.role_slug : '');
  if (!role) return NextResponse.json({ error: 'Unknown kind of work.' }, { status: 404 });
  if (role.status !== 'live') return NextResponse.json({ error: 'This kind of work opens soon.' }, { status: 409 });

  const admin = createAdminClient();
  try {
    let mine = await getMyPersonRole(user.id, role.slug);
    if (mine?.personRole.status === 'approved') return NextResponse.json({ error: 'Your profile is live already.' }, { status: 409 });

    if (!mine) {
      const { data: prof } = await admin.from('profiles').select('bio, crew_bio, location, city, specializations').eq('id', user.id).maybeSingle();
      const pre = profilePrefill(prof);
      const { error } = await supabase.from('person_roles').insert({
        user_id: user.id,
        role_slug: role.slug,
        headline: pre.headline || null,
        about: pre.about || null,
        area: pre.area || null,
        price_cents: role.suggested_price_cents.typical,
        per_km_cents: role.suggested_price_cents.per_km ?? null,
      });
      if (error) throw new Error(error.message);
      mine = await getMyPersonRole(user.id, role.slug);
      if (!mine) throw new Error('draft not found');
    } else if (mine.personRole.status !== 'draft') {
      await supabase.from('person_roles').update({ status: 'draft' }).eq('id', mine.personRole.id);
    }
    const prId = mine.personRole.id;
    const rows: Record<string, unknown>[] = [];

    // Work: photos and clips the browser put in the person's own folder.
    const ownFolder = `${STUDIO.security.uploads.userRoot}/${user.id}/`;
    const work = Array.isArray(body.work) ? (body.work as WorkItem[]).slice(0, ROLES_POLICY.maxFilesPerStep * 2) : [];
    for (const w of work) {
      const url = typeof w.url === 'string' ? w.url : '';
      // Their own upload: this account's storage, and the path carries their id
      // (a member's folder is <root>/<id>/...). The public id comes from the
      // URL's path, never from the client (M3).
      const publicId = storage.ownsUrl?.(url) ? ownUploadPublicId(url, user.id, process.env.CLOUDINARY_CLOUD_NAME) : null;
      if (!publicId) continue;
      const meta = sanitizeClientMetadata(w.exif);
      const lastModified = typeof w.last_modified === 'number' ? w.last_modified : null;
      const isVideo = w.kind === 'video';
      rows.push({
        person_role_id: prId,
        step_key: role.proof_format === 'thing' || role.proof_format === 'trust' ? 'things' : 'work',
        kind: isVideo ? 'video' : 'photo',
        media_kind: isVideo ? 'video' : 'image',
        source: classifySource({ fromCameraButton: w.from_camera === true, exifDate: meta?.dateTaken ?? null, fileLastModified: lastModified, now: Date.now() }),
        storage_provider: 'cloudinary',
        storage_ref: publicId,
        url,
        captured_at: meta?.dateTaken ?? (lastModified ? new Date(lastModified).toISOString() : null),
        device_summary: meta ? { device: meta.device, software: meta.software, dateTaken: meta.dateTaken } : null,
      });
    }

    // Private things: CV, voice note or Listen clip, the legal photo.
    const asks = inlineLegalAsks(role.legal_requirements, role.slug).map((a) => a.code);
    const priv = Array.isArray(body.private) ? (body.private as { path?: unknown; kind?: unknown; legal_code?: unknown }[]).slice(0, 8) : [];
    for (const p of priv) {
      const path = typeof p.path === 'string' ? p.path : '';
      if (!path.startsWith(`${user.id}/intake/`) || path.includes('..')) continue;
      if (p.kind === 'legal') {
        const code = typeof p.legal_code === 'string' && asks.includes(p.legal_code) ? p.legal_code : null;
        if (!code) continue;
        rows.push({ person_role_id: prId, step_key: code, kind: 'document', source: 'uploaded', legal_code: code, storage_provider: 'supabase', storage_ref: path, is_public: false });
      } else if (p.kind === 'cv') {
        rows.push({ person_role_id: prId, step_key: 'cv', kind: 'document', source: 'uploaded', storage_provider: 'supabase', storage_ref: path, is_public: false, note: `private CV, delete after ${ROLES_POLICY.cvRetentionDays} days` });
      } else if (p.kind === 'audio') {
        if (audioBecomes(role.proof_format) === 'listen') {
          // A Listen clip is public work: publish a copy to the person's own folder.
          const { data: blob } = await admin.storage.from(ROLE_DOCUMENT_BUCKET).download(path);
          if (!blob || blob.size > 15 * 1024 * 1024) continue;
          const asset = await storage.uploadImage(Buffer.from(await blob.arrayBuffer()), `${ownFolder}roles/listen`, 'video');
          rows.push({ person_role_id: prId, step_key: 'listen', kind: 'video', media_kind: 'audio', source: 'uploaded', storage_provider: 'cloudinary', storage_ref: asset.public_id, url: asset.url });
        } else {
          rows.push({ person_role_id: prId, step_key: 'voice', kind: 'document', source: 'uploaded', storage_provider: 'supabase', storage_ref: path, is_public: false, media_kind: 'audio', note: `private voice note, delete after ${ROLES_POLICY.cvRetentionDays} days` });
        }
      }
    }
    if (rows.length) {
      // Service role after the checks above (094: no browser insert, M2).
      const { error } = await admin.from('role_evidence').insert(rows);
      if (error) throw new Error(error.message);
    }

    // The facts the person reviewed.
    if (body.facts !== undefined) {
      const source = body.facts_source === 'cv' || body.facts_source === 'voice' || body.facts_source === 'text' ? body.facts_source : 'manual';
      const { error } = await supabase.from('person_roles').update({ facts: sanitizeFacts(body.facts), facts_source: source }).eq('id', prId);
      if (error) throw new Error(error.message);
      await reembedQuietly(prId);
    }

    const fresh = await getMyPersonRole(user.id, role.slug);
    return NextResponse.json({ personRole: fresh?.personRole ?? null, evidence: fresh?.evidence ?? [] });
  } catch {
    console.error('[roles/offer] failed');
    return NextResponse.json({ error: 'Could not save that. Please try again.' }, { status: 500 });
  }
}
