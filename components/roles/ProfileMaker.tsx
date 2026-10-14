'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, Camera, Check, CheckCircle2, FileText, ImagePlus, Loader2, Trash2, Video } from 'lucide-react';
import { ROLES_POLICY } from '@/lib/constants';
import { uploadFile } from '@/lib/cloudinary/upload';
import { createClient } from '@/lib/supabase/client';
import { readyForUpload } from '@/lib/roles/client';
import {
  applicableRequirements,
  bestDateOfBirth,
  canSubmit,
  formatRolePrice,
  isAgeRequirement,
  legalQuestions,
  proofProgress,
  randsToCents,
  unitLabel,
  type PersonRole,
  type ProofStep,
  type Role,
  type RoleEvidence,
} from '@/lib/roles';

/**
 * The guided profile maker. A gift, not a test: tiny phone-first steps that
 * walk a person through capturing their work in the app (light, angles,
 * before and after). The output is a profile; the in-app capture is the proof.
 *
 * Order: about you -> what the law needs (only where it applies) -> one
 * screen per proof step -> price (pre-filled) -> send for review.
 */

interface Props {
  role: Role;
  initialPersonRole: PersonRole | null;
  initialEvidence: RoleEvidence[];
  identity: { verified: boolean; status: string | null; dateOfBirthFromId: string | null };
}

type Screen = { id: string; title: string; step?: ProofStep };

const btnPrimary =
  'w-full min-h-[52px] px-6 bg-accent-gold text-black text-sm font-mono font-bold uppercase tracking-widest disabled:opacity-40 flex items-center justify-center gap-2';
const btnGhost =
  'min-h-[48px] px-4 border border-white/15 text-neutral-200 text-xs font-mono uppercase tracking-widest flex items-center justify-center gap-2 hover:border-accent-gold hover:text-accent-gold transition-colors';
const field =
  'w-full min-h-[48px] px-3 bg-black/40 border border-white/15 text-white placeholder:text-neutral-500 focus:border-accent-gold outline-none';

export function ProfileMaker({ role, initialPersonRole, initialEvidence, identity }: Props) {
  const [personRole, setPersonRole] = useState<PersonRole | null>(initialPersonRole);
  const [evidence, setEvidence] = useState<RoleEvidence[]>(initialEvidence);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [todo, setTodo] = useState<string[]>([]);

  const [headline, setHeadline] = useState(initialPersonRole?.headline ?? '');
  const [area, setArea] = useState(initialPersonRole?.area ?? '');
  const [about, setAbout] = useState(initialPersonRole?.about ?? '');
  const [dob, setDob] = useState(typeof initialPersonRole?.answers?.date_of_birth === 'string' ? (initialPersonRole.answers.date_of_birth as string) : '');
  const [answers, setAnswers] = useState<Record<string, unknown>>(initialPersonRole?.answers ?? {});
  const band = role.suggested_price_cents;
  const [price, setPrice] = useState(String(Math.round((initialPersonRole?.price_cents ?? band.typical) / 100)));
  const [perKm, setPerKm] = useState(band.per_km !== undefined ? String((initialPersonRole?.per_km_cents ?? band.per_km) / 100) : '');

  const questions = legalQuestions(role.legal_requirements);
  const hasLegal = role.legal_requirements.some((r) => r.required && !isAgeRequirement(r)) || questions.length > 0;
  const needsDob = role.min_age !== null && !identity.dateOfBirthFromId;

  const screens: Screen[] = useMemo(() => {
    const s: Screen[] = [{ id: 'about', title: 'About you' }];
    if (hasLegal) s.push({ id: 'legal', title: 'What the law needs' });
    for (const step of role.proof_task) s.push({ id: `step:${step.key}`, title: step.title, step });
    s.push({ id: 'price', title: 'Your price' }, { id: 'send', title: 'Send for review' });
    return s;
  }, [hasLegal, role.proof_task]);

  const screen = screens[Math.min(index, screens.length - 1)];
  const progress = proofProgress(role.proof_task, evidence);
  const locked = personRole?.status === 'approved';

  // ── server calls ──────────────────────────────────────────────────────────

  async function save(patch: Record<string, unknown>): Promise<PersonRole | null> {
    const res = await fetch(`/api/roles/${role.slug}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const body = (await res.json().catch(() => ({}))) as { personRole?: PersonRole; error?: string };
    if (!res.ok || !body.personRole) throw new Error(body.error ?? 'Could not save. Please try again.');
    setPersonRole(body.personRole);
    return body.personRole;
  }

  async function ensureDraft(): Promise<PersonRole> {
    return personRole ?? ((await save({})) as PersonRole);
  }

  async function addEvidence(payload: Record<string, unknown>): Promise<void> {
    const res = await fetch(`/api/roles/${role.slug}/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => ({}))) as { evidence?: RoleEvidence; error?: string };
    if (!res.ok || !body.evidence) throw new Error(body.error ?? 'Could not save that. Please try again.');
    setEvidence((prev) => [...prev, body.evidence as RoleEvidence]);
    if (personRole && personRole.status !== 'draft') setPersonRole({ ...personRole, status: 'draft' });
  }

  async function removeEvidence(id: string): Promise<void> {
    setError(null);
    setBusy(id);
    try {
      const res = await fetch(`/api/roles/${role.slug}/evidence?id=${id}`, { method: 'DELETE' });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not remove it.');
      setEvidence((prev) => prev.filter((e) => e.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove it.');
    } finally {
      setBusy(null);
    }
  }

  async function onWork(step: ProofStep, files: FileList | null, fromCamera: boolean, side?: 'before' | 'after', group?: string | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setBusy(step.key);
    try {
      await ensureDraft();
      for (const original of Array.from(files).slice(0, ROLES_POLICY.maxFilesPerStep)) {
        const ready = await readyForUpload(original);
        const asset = await uploadFile(ready.file, `roles/${role.slug}`);
        await addEvidence({
          step_key: step.key,
          kind: ready.file.type.startsWith('video/') ? 'video' : 'photo',
          url: asset.url,
          public_id: asset.public_id,
          from_camera: fromCamera,
          exif: ready.meta,
          last_modified: ready.lastModified,
          ...(side ? { pair_group: side === 'after' && group ? group : `p-${Date.now().toString(36)}`, pair_side: side } : {}),
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  async function onDocument(code: string, files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setError(null);
    setBusy(code);
    try {
      await ensureDraft();
      const ready = await readyForUpload(file);
      const res = await fetch(`/api/roles/${role.slug}/document`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ legal_code: code }),
      });
      const link = (await res.json().catch(() => ({}))) as { bucket?: string; path?: string; token?: string; error?: string };
      if (!res.ok || !link.bucket || !link.path || !link.token) throw new Error(link.error ?? 'Could not prepare the upload.');
      const supabase = createClient();
      const { error: upErr } = await supabase.storage.from(link.bucket).uploadToSignedUrl(link.path, link.token, ready.file, { contentType: ready.file.type || 'image/jpeg' });
      if (upErr) throw new Error('Upload failed. Please try again.');
      await addEvidence({ kind: 'document', legal_code: code, path: link.path });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  async function next() {
    setError(null);
    try {
      if (!locked && screen.id === 'about') {
        setBusy('save');
        await save({ headline, area, about, answers: needsDob ? { date_of_birth: dob || null } : {} });
      }
      if (!locked && screen.id === 'legal') {
        setBusy('save');
        await save({ answers });
      }
      if (!locked && screen.id === 'price') {
        const cents = randsToCents(price);
        if (cents === null) throw new Error('Type your price in rands, for example 650.');
        const km = band.per_km !== undefined ? randsToCents(perKm) : null;
        setBusy('save');
        const saved = await save({ price_cents: cents, ...(km !== null ? { per_km_cents: km } : {}) });
        if (saved?.price_cents) setPrice(String(Math.round(saved.price_cents / 100)));
      }
      setIndex((i) => Math.min(i + 1, screens.length - 1));
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    setError(null);
    setTodo([]);
    setBusy('submit');
    try {
      const res = await fetch(`/api/roles/${role.slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'submit' }),
      });
      const body = (await res.json().catch(() => ({}))) as { personRole?: PersonRole; error?: string; todo?: string[] };
      if (!res.ok || !body.personRole) {
        setTodo(body.todo ?? []);
        throw new Error(body.error ?? 'Could not send it.');
      }
      setPersonRole(body.personRole);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send it.');
    } finally {
      setBusy(null);
    }
  }

  const check = canSubmit({
    role,
    answers: { ...answers, ...(needsDob ? { date_of_birth: dob } : {}) },
    evidence,
    priceCents: personRole?.price_cents ?? null,
    dateOfBirth: bestDateOfBirth(identity.dateOfBirthFromId, dob),
    now: new Date(),
  });

  // ── render ───────────────────────────────────────────────────────────────

  return (
    <div className="max-w-lg mx-auto">
      <StatusBanner personRole={personRole} />

      {/* Progress */}
      <div className="mb-6">
        <div className="flex items-center justify-between text-xs font-mono text-neutral-500 mb-2">
          <span>
            Step {index + 1} of {screens.length}
          </span>
          <span>{role.name}</span>
        </div>
        <div className="h-1 bg-white/10" aria-hidden="true">
          <div className="h-1 bg-accent-gold transition-all" style={{ width: `${((index + 1) / screens.length) * 100}%` }} />
        </div>
      </div>

      {index > 0 && (
        <button type="button" onClick={() => setIndex((i) => Math.max(0, i - 1))} className="mb-4 min-h-[44px] flex items-center gap-2 text-sm text-neutral-400 hover:text-white">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back
        </button>
      )}

      <h2 className="text-2xl font-display font-medium text-white mb-2">{screen.title}</h2>

      {screen.id === 'about' && (
        <div className="space-y-5">
          <p className="text-neutral-400">Three short things. You can change them later.</p>
          {!identity.verified && (
            <p className="text-sm text-neutral-300 border border-white/10 p-3">
              Everyone also does a quick ID and selfie check. {identity.status === 'pending' ? 'Yours is being checked.' : (
                <Link href="/dashboard/verification" className="text-accent-gold underline underline-offset-4">Do it now</Link>
              )}
            </p>
          )}
          <label className="block">
            <span className="block text-sm text-neutral-300 mb-1">In one line, what do you do best?</span>
            <input className={field} value={headline} maxLength={80} onChange={(e) => setHeadline(e.target.value)} placeholder="Soft glam for shoots and weddings" disabled={locked} />
          </label>
          <label className="block">
            <span className="block text-sm text-neutral-300 mb-1">Where do you work?</span>
            <input className={field} value={area} maxLength={80} onChange={(e) => setArea(e.target.value)} placeholder="Soweto and Joburg" disabled={locked} />
          </label>
          <label className="block">
            <span className="block text-sm text-neutral-300 mb-1">A few words about you (optional)</span>
            <textarea className={`${field} min-h-[96px] py-2`} value={about} maxLength={600} onChange={(e) => setAbout(e.target.value)} disabled={locked} />
          </label>
          {needsDob && (
            <label className="block">
              <span className="block text-sm text-neutral-300 mb-1">Date of birth (we check it against your ID)</span>
              <input type="date" className={field} value={dob} onChange={(e) => setDob(e.target.value)} disabled={locked} />
            </label>
          )}
        </div>
      )}

      {screen.id === 'legal' && (
        <div className="space-y-5">
          <p className="text-neutral-400">Only what the law asks for this work. A clear phone photo of each is enough. Nobody but our team sees these.</p>
          {questions.map((q) => (
            <fieldset key={q.key} className="border border-white/10 p-3">
              <legend className="text-sm text-neutral-200 px-1">{q.ask}</legend>
              <div className="flex gap-2 mt-2">
                {[true, false].map((v) => (
                  <button
                    key={String(v)}
                    type="button"
                    disabled={locked}
                    onClick={() => setAnswers((a) => ({ ...a, [q.key]: v }))}
                    aria-pressed={answers[q.key] === v}
                    className={`flex-1 min-h-[48px] border text-sm ${answers[q.key] === v ? 'border-accent-gold text-accent-gold bg-accent-gold/10' : 'border-white/15 text-neutral-300'}`}
                  >
                    {v ? 'Yes' : 'No'}
                  </button>
                ))}
              </div>
            </fieldset>
          ))}
          <ul className="space-y-3">
            {applicableRequirements(role.legal_requirements, answers)
              .filter((r) => !isAgeRequirement(r))
              .map((r) => {
                const have = evidence.filter((e) => e.kind === 'document' && e.legal_code === r.code);
                return (
                  <li key={r.code} className="border border-white/10 p-3">
                    <div className="flex items-start gap-3">
                      <FileText className="w-5 h-5 text-accent-gold shrink-0 mt-0.5" aria-hidden="true" />
                      <div className="flex-1">
                        <p className="text-white">{r.label}</p>
                        {r.help && <p className="text-xs text-neutral-400 mt-1">{r.help}</p>}
                        {r.basis === 'platform' && <p className="text-xs text-neutral-500 mt-1">Our rule, not the law.</p>}
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      {have.length > 0 ? (
                        <span className="flex items-center gap-2 text-sm text-emerald-300">
                          <Check className="w-4 h-4" aria-hidden="true" /> Added
                        </span>
                      ) : (
                        <CaptureInput label="Take a photo" capture="environment" accept="image/*" disabled={locked || busy !== null} busy={busy === r.code} onFiles={(f) => onDocument(r.code, f)} icon="camera" variant="ghost" />
                      )}
                    </div>
                  </li>
                );
              })}
          </ul>
        </div>
      )}

      {screen.step && (
        <ProofScreen
          step={screen.step}
          evidence={evidence.filter((e) => e.step_key === screen.step?.key)}
          done={progress.find((p) => p.key === screen.step?.key)?.done ?? 0}
          busy={busy}
          locked={locked}
          onFiles={(files, fromCamera, side, group) => onWork(screen.step as ProofStep, files, fromCamera, side, group)}
          onRemove={removeEvidence}
        />
      )}

      {screen.id === 'price' && (
        <div className="space-y-5">
          <p className="text-neutral-400">
            Clients see one clear price before they pay. We filled in what most people charge. You can move it between {formatRolePrice(role.pricing_unit, band.low)} and {formatRolePrice(role.pricing_unit, band.high)}.
          </p>
          <label className="block">
            <span className="block text-sm text-neutral-300 mb-1">Price in rands, {unitLabel(role.pricing_unit)}</span>
            <div className="flex items-center gap-2">
              <span className="text-neutral-400 text-lg">R</span>
              <input inputMode="numeric" className={`${field} text-2xl`} value={price} onChange={(e) => setPrice(e.target.value)} disabled={locked} />
            </div>
          </label>
          {band.per_km !== undefined && (
            <label className="block">
              <span className="block text-sm text-neutral-300 mb-1">Price per km, in rands</span>
              <div className="flex items-center gap-2">
                <span className="text-neutral-400 text-lg">R</span>
                <input inputMode="decimal" className={field} value={perKm} onChange={(e) => setPerKm(e.target.value)} disabled={locked} />
              </div>
            </label>
          )}
          <p className="text-xs text-neutral-500">{ROLES_POLICY.copy.promise}</p>
        </div>
      )}

      {screen.id === 'send' && (
        <div className="space-y-5">
          {personRole?.status === 'submitted' ? (
            <p className="text-neutral-300">{ROLES_POLICY.copy.reviewPromise}</p>
          ) : locked ? (
            <p className="text-neutral-300">Your profile is live.</p>
          ) : check.ok ? (
            <>
              <p className="text-neutral-300">Everything is in. {ROLES_POLICY.copy.reviewPromise}</p>
              <button type="button" className={btnPrimary} disabled={busy !== null} onClick={submit}>
                {busy === 'submit' ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="w-4 h-4" aria-hidden="true" />}
                Send for review
              </button>
            </>
          ) : (
            <>
              <p className="text-neutral-300">Almost there. Still to do:</p>
              <ul className="space-y-2">
                {(todo.length ? todo : check.todo).map((t) => (
                  <li key={t} className="flex items-start gap-2 text-sm text-neutral-200">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent-gold shrink-0" aria-hidden="true" /> {t}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {error && (
        <p className="mt-5 flex items-start gap-2 text-sm text-red-300" role="alert">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" /> {error}
        </p>
      )}

      {screen.id !== 'send' && (
        <div className="sticky bottom-0 mt-8 -mx-4 px-4 py-4 bg-[#0A0A0B]/95 backdrop-blur border-t border-white/10">
          <button
            type="button"
            className={screen.step && !progress.find((p) => p.key === screen.step?.key)?.complete ? `${btnGhost} w-full` : btnPrimary}
            disabled={busy !== null}
            onClick={next}
          >
            {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
            {screen.step && (progress.find((p) => p.key === screen.step?.key)?.complete ? 'Next' : 'Skip for now')}
            {!screen.step && 'Next'}
          </button>
        </div>
      )}
    </div>
  );
}

function StatusBanner({ personRole }: { personRole: PersonRole | null }) {
  if (!personRole) return null;
  if (personRole.status === 'approved') {
    return (
      <div className="mb-6 p-4 border border-emerald-500/30 bg-emerald-500/5 text-emerald-200 text-sm">
        You are live. <Link href={`/people/${personRole.id}`} className="underline underline-offset-4">See your profile</Link>
      </div>
    );
  }
  if (personRole.status === 'submitted') {
    return <div className="mb-6 p-4 border border-white/15 bg-white/[0.03] text-neutral-200 text-sm">Sent for review. {ROLES_POLICY.copy.reviewPromise}</div>;
  }
  if (personRole.reviewer_note) {
    return (
      <div className="mb-6 p-4 border border-accent-gold/40 bg-accent-gold/5 text-sm">
        <p className="text-accent-gold font-mono text-xs uppercase tracking-widest mb-1">How to get there</p>
        <p className="text-neutral-100 whitespace-pre-line">{personRole.reviewer_note}</p>
      </div>
    );
  }
  return null;
}

function CaptureInput({
  label,
  capture,
  accept,
  disabled,
  busy,
  onFiles,
  icon,
  multiple = false,
  variant,
}: {
  label: string;
  capture?: 'environment' | 'user';
  accept: string;
  disabled: boolean;
  busy: boolean;
  onFiles: (files: FileList | null) => void;
  icon: 'camera' | 'video' | 'gallery';
  multiple?: boolean;
  /** Ghost for secondary actions (gallery, documents) so "Next" stays the one gold button. */
  variant?: 'primary' | 'ghost';
}) {
  const Icon = icon === 'camera' ? Camera : icon === 'video' ? Video : ImagePlus;
  return (
    <label className={`${(variant ?? (icon === 'gallery' ? 'ghost' : 'primary')) === 'ghost' ? `${btnGhost} w-full` : btnPrimary} cursor-pointer ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Icon className="w-4 h-4" aria-hidden="true" />}
      {busy ? 'Uploading...' : label}
      <input
        type="file"
        accept={accept}
        {...(capture ? { capture } : {})}
        multiple={multiple}
        className="sr-only"
        disabled={disabled}
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </label>
  );
}

function ProofScreen({
  step,
  evidence,
  done,
  busy,
  locked,
  onFiles,
  onRemove,
}: {
  step: ProofStep;
  evidence: RoleEvidence[];
  done: number;
  busy: string | null;
  locked: boolean;
  onFiles: (files: FileList | null, fromCamera: boolean, side?: 'before' | 'after', group?: string | null) => void;
  onRemove: (id: string) => void;
}) {
  const accept = step.kind === 'video' ? 'video/*' : 'image/*';
  const disabled = locked || busy !== null;
  const isBusy = busy === step.key;
  const openPair = step.kind === 'pair' ? pendingPair(evidence) : null;

  return (
    <div className="space-y-5">
      <p className="text-neutral-300">{step.help}</p>
      {step.tips && step.tips.length > 0 && (
        <ul className="space-y-1.5">
          {step.tips.map((t) => (
            <li key={t} className="flex items-start gap-2 text-sm text-neutral-400">
              <Check className="w-4 h-4 text-accent-gold shrink-0 mt-0.5" aria-hidden="true" /> {t}
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs font-mono text-neutral-500">
        {step.min === 0 ? 'Optional' : `${Math.min(done, step.min)} of ${step.min} done`}
      </p>

      {evidence.length > 0 && (
        <ul className="grid grid-cols-3 gap-2">
          {evidence.map((e) => (
            <li key={e.id} className="relative aspect-square bg-white/5 overflow-hidden">
              {e.kind === 'video' ? (
                <div className="w-full h-full flex items-center justify-center text-neutral-400">
                  <Video className="w-6 h-6" aria-label="Video" />
                </div>
              ) : e.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={e.url} alt="" className="w-full h-full object-cover" loading="lazy" />
              ) : null}
              {e.pair_side && (
                <span className="absolute left-1 top-1 px-1.5 py-0.5 bg-black/70 text-[10px] font-mono uppercase text-white">{e.pair_side}</span>
              )}
              {e.source === 'captured_in_app' && (
                <span className="absolute left-1 bottom-1 px-1.5 py-0.5 bg-black/70 text-[10px] font-mono text-accent-gold">in app</span>
              )}
              {!locked && (
                <button
                  type="button"
                  onClick={() => onRemove(e.id)}
                  disabled={busy !== null}
                  aria-label="Remove"
                  className="absolute right-0 top-0 w-11 h-11 flex items-center justify-center bg-black/60 text-white"
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!locked && step.kind === 'pair' && (
        <CaptureInput
          label={openPair?.side === 'after' ? 'Take the AFTER photo' : 'Take the BEFORE photo'}
          capture={step.capture ?? 'environment'}
          accept="image/*"
          disabled={disabled}
          busy={isBusy}
          onFiles={(f) => onFiles(f, true, openPair?.side ?? 'before', openPair?.group ?? null)}
          icon="camera"
        />
      )}

      {!locked && step.kind !== 'pair' && step.kind !== 'text' && (
        <div className="space-y-2">
          {step.capture && (
            <CaptureInput
              label={step.kind === 'video' ? 'Record now' : 'Take a photo'}
              capture={step.capture}
              accept={accept}
              disabled={disabled}
              busy={isBusy}
              onFiles={(f) => onFiles(f, true)}
              icon={step.kind === 'video' ? 'video' : 'camera'}
            />
          )}
          <CaptureInput
            label={step.capture ? 'Choose from my phone' : step.kind === 'video' ? 'Choose a video' : 'Choose photos'}
            accept={accept}
            disabled={disabled}
            busy={!step.capture && isBusy}
            onFiles={(f) => onFiles(f, false)}
            icon="gallery"
            multiple={step.kind === 'photo'}
          />
          {step.capture && <p className="text-xs text-neutral-500">Photos taken here now count as proof. Older photos still help your profile.</p>}
        </div>
      )}
    </div>
  );
}

/** For a before/after step: a pair waiting for its after photo, else start a new one. */
function pendingPair(evidence: RoleEvidence[]): { side: 'before' | 'after'; group: string | null } {
  const groups = new Map<string, Set<string>>();
  for (const e of evidence) {
    if (!e.pair_group || !e.pair_side) continue;
    const s = groups.get(e.pair_group) ?? new Set<string>();
    s.add(e.pair_side);
    groups.set(e.pair_group, s);
  }
  for (const [group, s] of groups) if (s.has('before') && !s.has('after')) return { side: 'after', group };
  return { side: 'before', group: null };
}
