'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Camera, Check, FileText, Loader2, Mic, Plus, Upload, X } from 'lucide-react';
import { EARN, ROLES_POLICY } from '@/lib/constants';
import { LIST_GEAR_HREF } from '@/lib/welcome';
import { uploadFile } from '@/lib/cloudinary/upload';
import { createClient } from '@/lib/supabase/client';
import { photoForMatch, readyForUpload } from '@/lib/roles/client';
import {
  classifyIntakeFile,
  EMPTY_FACTS,
  FACT_LIST_KEYS,
  formatRolePrice,
  inlineLegalAsks,
  photoLooksLikeCv,
  randsToCents,
  unitLabel,
  type ProfileFacts,
  type Role,
} from '@/lib/roles';
import { RoleIcon } from './RoleIcon';

/**
 * Earn with ThabangVision: three screens, one idea each.
 *   1. Your photo     (required, camera; clients see it only after booking)
 *   2. Show us your work (one box takes anything; we sort it and suggest the role)
 *   3. Price and area (prefilled), then Done.
 * Everything else (facts extraction, proof kinds, embeddings, review) is
 * hidden machinery.
 */

type Step = 'face' | 'work' | 'price' | 'done';

interface WorkItem {
  id: string;
  kind: 'photo' | 'video';
  url: string;
  public_id: string;
  from_camera: boolean;
  exif: unknown;
  last_modified: number;
}
interface PrivateItem {
  id: string;
  kind: 'cv' | 'audio' | 'legal';
  path: string;
  mime: string;
  name: string;
  legal_code?: string;
}
interface Suggestion {
  slug: string;
  name: string;
  status: 'live' | 'coming_soon';
  kind: 'role' | 'gear';
}

const DAYS: [string, string][] = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
const FACT_LABELS: Record<(typeof FACT_LIST_KEYS)[number], string> = {
  roles: 'Work you do',
  skills: 'Skills',
  job_kinds: 'Kinds of jobs',
  areas: 'Areas',
  languages: 'Languages',
  equipment: 'Equipment',
  vehicles: 'Vehicles',
  certifications: 'Certificates',
};

const big = 'w-full min-h-[56px] px-6 bg-accent-gold text-black text-sm font-mono font-bold uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-40';
const ghost = 'w-full min-h-[52px] px-4 border border-white/20 text-neutral-200 text-sm flex items-center justify-center gap-2 hover:border-accent-gold';
const field = 'w-full min-h-[48px] px-3 bg-black/40 border border-white/15 text-white placeholder:text-neutral-500 focus:border-accent-gold outline-none';

async function privateUpload(kind: 'cv' | 'audio' | 'legal', file: File): Promise<string> {
  const ext = (file.name.split('.').pop() || (kind === 'audio' ? 'm4a' : 'jpg')).toLowerCase();
  const res = await fetch('/api/roles/intake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'upload', kind, ext }) });
  const link = (await res.json().catch(() => ({}))) as { bucket?: string; path?: string; token?: string; error?: string };
  if (!res.ok || !link.bucket || !link.path || !link.token) throw new Error(link.error ?? 'Could not upload that.');
  const { error } = await createClient().storage.from(link.bucket).uploadToSignedUrl(link.path, link.token, file, { contentType: file.type || undefined });
  if (error) throw new Error('Upload failed. Please try again.');
  return link.path;
}

export function OfferFlow({
  roles,
  hasFace,
  faceUrl,
  preselect,
  prefillArea,
  userId,
}: {
  roles: Role[];
  hasFace: boolean;
  faceUrl: string | null;
  preselect: string | null;
  prefillArea: string;
  /** Puts uploads in a folder that carries the person's id (members and admins alike). */
  userId: string;
}) {
  const [step, setStep] = useState<Step>(hasFace ? 'work' : 'face');
  const [face, setFace] = useState<string | null>(faceUrl);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Screen 2
  const [text, setText] = useState('');
  const [work, setWork] = useState<WorkItem[]>([]);
  const [priv, setPriv] = useState<PrivateItem[]>([]);
  const [matchPhoto, setMatchPhoto] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [roleSlug, setRoleSlug] = useState<string | null>(preselect);
  const [facts, setFacts] = useState<ProfileFacts>({ ...EMPTY_FACTS });
  const [factsSource, setFactsSource] = useState<'cv' | 'voice' | 'text' | null>(null);
  const [picking, setPicking] = useState(false);

  // Screen 3
  const role = roles.find((r) => r.slug === roleSlug) ?? null;
  const [price, setPrice] = useState('');
  const [area, setArea] = useState(prefillArea);
  const [days, setDays] = useState<string[]>(['mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
  const [comesWith, setComesWith] = useState('');
  const [todo, setTodo] = useState<string[]>([]);

  const live = roles.filter((r) => r.status === 'live');
  const asks = useMemo(() => (role ? inlineLegalAsks(role.legal_requirements, role.slug) : []), [role]);

  async function takeFace(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setError(null);
    setBusy('face');
    try {
      const ready = await readyForUpload(file);
      const res = await fetch('/api/roles/face', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'upload' }) });
      const link = (await res.json().catch(() => ({}))) as { bucket?: string; path?: string; token?: string; error?: string };
      if (!res.ok || !link.bucket || !link.path || !link.token) throw new Error(link.error ?? 'Could not upload your photo.');
      const { error: upErr } = await createClient().storage.from(link.bucket).uploadToSignedUrl(link.path, link.token, ready.file, { contentType: 'image/jpeg' });
      if (upErr) throw new Error('Upload failed. Please try again.');
      const save = await fetch('/api/roles/face', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', path: link.path, captured_at: ready.meta?.dateTaken ?? new Date(ready.lastModified).toISOString() }) });
      if (!save.ok) throw new Error('Could not save your photo.');
      setFace(URL.createObjectURL(ready.file));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your photo.');
    } finally {
      setBusy(null);
    }
  }

  async function addFiles(files: FileList | null, fromCamera: boolean) {
    if (!files?.length) return;
    setError(null);
    setBusy('add');
    try {
      for (const file of Array.from(files).slice(0, ROLES_POLICY.maxFilesPerStep)) {
        let kind = classifyIntakeFile(file.type, file.name);
        if (kind === 'photo' && photoLooksLikeCv(file.name)) kind = 'cv';
        if (kind === 'photo' || kind === 'video') {
          const ready = await readyForUpload(file);
          if (kind === 'photo' && !matchPhoto) setMatchPhoto(await photoForMatch(file).catch(() => null));
          const asset = await uploadFile(ready.file, `roles/${userId}/work`);
          setWork((w) => [...w, { id: asset.public_id, kind, url: asset.url, public_id: asset.public_id, from_camera: fromCamera, exif: ready.meta, last_modified: ready.lastModified }]);
        } else if (kind === 'cv' || kind === 'audio') {
          const path = await privateUpload(kind, file);
          setPriv((p) => [...p, { id: path, kind, path, mime: file.type, name: file.name }]);
        } else {
          throw new Error(`We cannot read "${file.name}". Try a photo, a short clip, a PDF or a voice note.`);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that.');
    } finally {
      setBusy(null);
    }
  }

  async function addLegal(code: string, files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy(`legal-${code}`);
    setError(null);
    try {
      const ready = await readyForUpload(file);
      const path = await privateUpload('legal', ready.file);
      setPriv((p) => [...p.filter((x) => x.legal_code !== code), { id: path, kind: 'legal', path, mime: 'image/jpeg', name: code, legal_code: code }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that photo.');
    } finally {
      setBusy(null);
    }
  }

  async function analyze() {
    setError(null);
    setBusy('analyze');
    try {
      const res = await fetch('/api/roles/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'analyze', text, photo: matchPhoto, files: priv.filter((p) => p.kind !== 'legal').map((p) => ({ path: p.path, kind: p.kind, mime: p.mime })) }),
      });
      const body = (await res.json().catch(() => ({}))) as { suggestions?: Suggestion[]; facts?: ProfileFacts; factsSource?: 'cv' | 'voice' | 'text' | null; error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not read that. Pick your work below.');
      setSuggestions(body.suggestions ?? []);
      setFacts(body.facts ?? { ...EMPTY_FACTS });
      setFactsSource(body.factsSource ?? null);
      const first = (body.suggestions ?? []).find((s) => s.kind === 'role' && s.status === 'live');
      if (!roleSlug && first) setRoleSlug(first.slug);
      if (!(body.suggestions ?? []).length) setPicking(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that.');
      setSuggestions([]);
      setPicking(true);
    } finally {
      setBusy(null);
    }
  }

  async function confirmRole() {
    if (!role) return;
    setError(null);
    setBusy('confirm');
    try {
      const res = await fetch('/api/roles/offer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role_slug: role.slug,
          facts,
          facts_source: factsSource ?? 'manual',
          work: work.map(({ id: _id, ...w }) => { void _id; return w; }),
          private: priv.map((p) => ({ path: p.path, kind: p.kind, legal_code: p.legal_code })),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { personRole?: { price_cents: number | null; area: string | null; comes_with?: { label?: string } }; error?: string };
      if (!res.ok || !body.personRole) throw new Error(body.error ?? 'Could not save that.');
      setPrice(String(Math.round((body.personRole.price_cents ?? role.suggested_price_cents.typical) / 100)));
      if (body.personRole.area) setArea(body.personRole.area);
      setComesWith(body.personRole.comes_with?.label ?? (role.proof_format === 'trust' ? facts.vehicles[0] ?? '' : role.role_group === 'camera' ? facts.equipment.slice(0, 3).join(', ') : ''));
      setStep('price');
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
    } finally {
      setBusy(null);
    }
  }

  async function finish() {
    if (!role) return;
    setError(null);
    setTodo([]);
    setBusy('finish');
    try {
      const cents = randsToCents(price);
      if (cents === null) throw new Error('Type your price in rands, for example 650.');
      const put = await fetch(`/api/roles/${role.slug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ price_cents: cents, area, available_days: days, ...(comesWith.trim() ? { comes_with: { label: comesWith.trim(), evidence_ids: [] } } : {}) }),
      });
      if (!put.ok) throw new Error(((await put.json().catch(() => ({}))) as { error?: string }).error ?? 'Could not save.');
      const sub = await fetch(`/api/roles/${role.slug}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'submit' }) });
      const body = (await sub.json().catch(() => ({}))) as { error?: string; todo?: string[] };
      if (!sub.ok) {
        setTodo(body.todo ?? []);
        throw new Error(body.error ?? 'Could not send it.');
      }
      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send it.');
    } finally {
      setBusy(null);
    }
  }

  const progress = { face: 1, work: 2, price: 3, done: 3 }[step];

  return (
    <div className="max-w-lg mx-auto px-4 pt-24 pb-16">
      <div className="flex items-center justify-between mb-6">
        <p className="text-xs font-mono uppercase tracking-widest text-accent-gold">{EARN.label}</p>
        <p className="text-xs font-mono text-neutral-500">{progress} of 3</p>
      </div>

      {step === 'face' && (
        <section>
          <h1 className="text-4xl font-display font-medium text-white mb-3">Your photo</h1>
          <p className="text-neutral-400 mb-8">{ROLES_POLICY.copy.facePrompt}</p>
          <div className="mx-auto w-56 h-56 rounded-full overflow-hidden bg-neutral-900 border border-white/15 flex items-center justify-center mb-8">
            {face ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={face} alt="Your photo" className="w-full h-full object-cover" />
            ) : (
              <Camera className="w-12 h-12 text-neutral-600" aria-hidden="true" />
            )}
          </div>
          <label className={`${big} cursor-pointer ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
            {busy === 'face' ? <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> : <Camera className="w-5 h-5" aria-hidden="true" />}
            {face ? 'Take it again' : 'Take your photo'}
            <input type="file" accept="image/*" capture="user" className="sr-only" onChange={(e) => { void takeFace(e.target.files); e.target.value = ''; }} />
          </label>
          {face && (
            <button type="button" className={`${ghost} mt-3`} onClick={() => setStep('work')}>
              Next
            </button>
          )}
        </section>
      )}

      {step === 'work' && (
        <section>
          <button type="button" onClick={() => setStep('face')} className="mb-2 min-h-[44px] flex items-center gap-2 text-sm text-neutral-400"><ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back</button>
          <h1 className="text-4xl font-display font-medium text-white mb-3">Show us your work</h1>
          <p className="text-neutral-400 mb-6">Photos, a short clip, your CV, a voice note, or a few words. Anything.</p>

          <div className="border border-dashed border-white/25 p-4 space-y-3">
            <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder="I do make-up for weddings. Or: I have a Quantum and drive crews." className={`${field} min-h-[88px] py-2`} />
            <div className="grid grid-cols-2 gap-2">
              <label className={`${ghost} cursor-pointer ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
                <Camera className="w-4 h-4" aria-hidden="true" /> Take a photo
                <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { void addFiles(e.target.files, true); e.target.value = ''; }} />
              </label>
              <label className={`${ghost} cursor-pointer ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
                <Upload className="w-4 h-4" aria-hidden="true" /> Add files
                <input type="file" multiple accept="image/*,video/mp4,audio/*,.pdf,.doc,.docx" className="sr-only" onChange={(e) => { void addFiles(e.target.files, false); e.target.value = ''; }} />
              </label>
            </div>
            <label className={`${ghost} cursor-pointer ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
              <Mic className="w-4 h-4" aria-hidden="true" /> Record a voice note or a sound clip
              <input type="file" accept="audio/*" capture className="sr-only" onChange={(e) => { void addFiles(e.target.files, true); e.target.value = ''; }} />
            </label>
            {busy === 'add' && <p className="flex items-center gap-2 text-sm text-neutral-400"><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Adding...</p>}
            {(work.length > 0 || priv.some((p) => p.kind !== 'legal')) && (
              <ul className="flex flex-wrap gap-2">
                {work.map((w) => (
                  <li key={w.id} className="relative w-20 h-20 bg-neutral-900 overflow-hidden">
                    {w.kind === 'photo' ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={w.url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="w-full h-full flex items-center justify-center text-xs text-neutral-400">Clip</span>
                    )}
                    <button type="button" aria-label="Remove" onClick={() => setWork((x) => x.filter((y) => y.id !== w.id))} className="absolute right-0 top-0 w-11 h-11 flex items-start justify-end p-1"><X className="w-4 h-4 bg-black/70 text-white" aria-hidden="true" /></button>
                  </li>
                ))}
                {priv.filter((p) => p.kind !== 'legal').map((p) => (
                  <li key={p.id} className="flex items-center gap-2 px-3 min-h-[44px] border border-white/15 text-xs text-neutral-200">
                    {p.kind === 'cv' ? <FileText className="w-4 h-4 text-accent-gold" aria-hidden="true" /> : <Mic className="w-4 h-4 text-accent-gold" aria-hidden="true" />}
                    {p.kind === 'cv' ? 'CV (private)' : 'Audio'}
                    <button type="button" aria-label="Remove" onClick={() => setPriv((x) => x.filter((y) => y.id !== p.id))} className="min-w-[44px] min-h-[44px] flex items-center justify-center"><X className="w-4 h-4" aria-hidden="true" /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="text-xs text-neutral-500 mt-2">Your CV stays private. Nobody sees it; we only read the work facts from it.</p>

          {suggestions === null ? (
            <button type="button" className={`${big} mt-6`} disabled={!!busy || (!text.trim() && !work.length && !priv.length)} onClick={analyze}>
              {busy === 'analyze' && <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />} Continue
            </button>
          ) : (
            <div className="mt-8 space-y-6">
              {role && !picking ? (
                <div className="border border-accent-gold/50 bg-accent-gold/5 p-4">
                  <p className="text-sm text-neutral-300 mb-2">You are a:</p>
                  <p className="flex items-center gap-3 text-xl text-white"><span className="text-accent-gold"><RoleIcon group={role.role_group} /></span>{role.name}</p>
                  <button type="button" onClick={() => setPicking(true)} className="mt-2 min-h-[44px] text-sm text-neutral-400 underline underline-offset-4">Not right? Pick another</button>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-neutral-300 mb-2">What do you offer?</p>
                  <ul className="grid gap-2">
                    {live.map((r) => (
                      <li key={r.slug}>
                        <button type="button" onClick={() => { setRoleSlug(r.slug); setPicking(false); }} className={`w-full flex items-center gap-3 min-h-[56px] px-4 border text-left ${roleSlug === r.slug ? 'border-accent-gold text-accent-gold' : 'border-white/10 text-white'}`}>
                          <RoleIcon group={r.role_group} className="w-5 h-5" /> {r.name}
                        </button>
                      </li>
                    ))}
                    <li><Link href={LIST_GEAR_HREF} className="w-full flex items-center gap-3 min-h-[56px] px-4 border border-white/10 text-white"><Plus className="w-5 h-5" aria-hidden="true" /> Gear to rent out</Link></li>
                  </ul>
                </div>
              )}
              {suggestions.some((s) => s.kind === 'gear') && !role && (
                <Link href={LIST_GEAR_HREF} className={big}>Sounds like gear. List it</Link>
              )}

              {role && (
                <>
                  <details open className="border border-white/10 p-4">
                    <summary className="min-h-[44px] flex items-center cursor-pointer text-white">What we found (change anything)</summary>
                    <div className="space-y-3 mt-3">
                      {FACT_LIST_KEYS.map((k) => (
                        <label key={k} className="block">
                          <span className="block text-xs text-neutral-400 mb-1">{FACT_LABELS[k]}</span>
                          <input className={field} value={facts[k].join(', ')} onChange={(e) => setFacts((f) => ({ ...f, [k]: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) }))} />
                        </label>
                      ))}
                      <label className="block">
                        <span className="block text-xs text-neutral-400 mb-1">Years of experience</span>
                        <input inputMode="numeric" className={field} value={facts.years_experience ?? ''} onChange={(e) => setFacts((f) => ({ ...f, years_experience: e.target.value === '' ? null : Number(e.target.value) || 0 }))} />
                      </label>
                    </div>
                  </details>

                  {asks.map((a) => {
                    const have = priv.some((p) => p.legal_code === a.code);
                    return (
                      <label key={a.code} className={`${ghost} cursor-pointer ${have ? 'border-emerald-500/50 text-emerald-300' : ''}`}>
                        {have ? <Check className="w-4 h-4" aria-hidden="true" /> : busy === `legal-${a.code}` ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Camera className="w-4 h-4" aria-hidden="true" />}
                        {have ? `${a.label}: added` : `One more photo: ${a.label}`}
                        <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { void addLegal(a.code, e.target.files); e.target.value = ''; }} />
                      </label>
                    );
                  })}

                  <button type="button" className={big} disabled={!!busy} onClick={confirmRole}>
                    {busy === 'confirm' ? <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> : <Check className="w-5 h-5" aria-hidden="true" />} Yes, that&apos;s me
                  </button>
                </>
              )}
            </div>
          )}
        </section>
      )}

      {step === 'price' && role && (
        <section>
          <h1 className="text-4xl font-display font-medium text-white mb-3">Your price and area</h1>
          <p className="text-neutral-400 mb-6">We filled in what most people charge.</p>
          <div className="space-y-5">
            <label className="block">
              <span className="block text-sm text-neutral-300 mb-1">Price, {unitLabel(role.pricing_unit)}</span>
              <div className="flex items-center gap-2"><span className="text-neutral-400 text-xl">R</span><input inputMode="numeric" className={`${field} text-2xl`} value={price} onChange={(e) => setPrice(e.target.value)} /></div>
              <span className="block text-xs text-neutral-500 mt-1">Between {formatRolePrice(role.pricing_unit, role.suggested_price_cents.low)} and {formatRolePrice(role.pricing_unit, role.suggested_price_cents.high)}</span>
            </label>
            <label className="block">
              <span className="block text-sm text-neutral-300 mb-1">Area</span>
              <input className={field} value={area} maxLength={80} onChange={(e) => setArea(e.target.value)} placeholder="Soweto" />
            </label>
            <fieldset>
              <legend className="text-sm text-neutral-300 mb-2">Days you can work</legend>
              <div className="grid grid-cols-7 gap-1">
                {DAYS.map(([k, l]) => (
                  <button key={k} type="button" aria-pressed={days.includes(k)} onClick={() => setDays((d) => (d.includes(k) ? d.filter((x) => x !== k) : [...d, k]))} className={`min-h-[48px] text-xs border ${days.includes(k) ? 'border-accent-gold text-accent-gold bg-accent-gold/10' : 'border-white/15 text-neutral-400'}`}>{l}</button>
                ))}
              </div>
            </fieldset>
            {(role.proof_format === 'trust' || role.role_group === 'camera') && (
              <label className="block">
                <span className="block text-sm text-neutral-300 mb-1">{role.proof_format === 'trust' ? 'Comes with (your vehicle)' : 'Comes with (your kit, optional)'}</span>
                <input className={field} value={comesWith} maxLength={120} onChange={(e) => setComesWith(e.target.value)} placeholder={role.proof_format === 'trust' ? 'Toyota Quantum, 14 seats' : 'Own camera kit and lights'} />
              </label>
            )}
            {todo.length > 0 && <ul className="text-sm text-amber-200 list-disc pl-5">{todo.map((t) => <li key={t}>{t}</li>)}</ul>}
            <button type="button" className={big} disabled={!!busy} onClick={finish}>
              {busy === 'finish' && <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />} Done
            </button>
          </div>
        </section>
      )}

      {step === 'done' && role && (
        <section className="text-center pt-8">
          <Check className="w-14 h-14 text-accent-gold mx-auto mb-4" aria-hidden="true" />
          <h1 className="text-3xl font-display font-medium text-white mb-3">{ROLES_POLICY.copy.done}</h1>
          <Link href={`/offer/preview?role=${role.slug}`} className={`${big} mt-8`}>Here&apos;s how clients will see you</Link>
        </section>
      )}

      {error && <p className="mt-5 text-sm text-red-300" role="alert">{error}</p>}
      <p className="mt-10 text-center"><Link href="/offer/guidelines" className="text-xs text-neutral-500 underline underline-offset-4">What we look for</Link></p>
    </div>
  );
}
