'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, BadgeCheck, CheckCircle, FileText, Loader2, MessageSquare, Phone, Video } from 'lucide-react';
import { useAdminUI } from '@/components/admin/shell/AdminUI';
import { factsSummary, formatRolePrice, sanitizeFacts, type EvidenceLevel, type PersonRole, type Role, type RoleEvidence } from '@/lib/roles';

/**
 * Role review queue (TASK-085). The submitted proof sits next to the role's
 * published guidelines; approve, or ask for changes with a required "how to
 * get there" note. Access: the admin layout plus requireAdmin() in the API.
 */

type Item = {
  personRole: PersonRole;
  role: Role;
  person: { label: string; displayName: string | null; identityVerified: boolean; email: string | null };
  face: { url: string | null; idSelfieUrl: string | null; check: string | null } | null;
  evidence: (RoleEvidence & { viewUrl: string | null })[];
  dateOfBirth: string | null;
  suggestedLevel: EvidenceLevel;
};

type Status = PersonRole['status'];

const TABS: { status: Status; label: string }[] = [
  { status: 'submitted', label: 'Waiting for review' },
  { status: 'changes_requested', label: 'Sent back' },
  { status: 'approved', label: 'Live' },
  { status: 'draft', label: 'Still making' },
];

const LEVEL_WORDS: Record<EvidenceLevel, string> = {
  new: 'New',
  shown: 'Shown (proof done in the app)',
  vouched: 'Vouched',
  proven: 'Proven (3+ jobs)',
  trusted: 'Trusted',
};

export default function AdminRolesPage() {
  const ui = useAdminUI();
  const [status, setStatus] = useState<Status>('submitted');
  const [items, setItems] = useState<Item[]>([]);
  const [counts, setCounts] = useState<Record<Status, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (s: Status) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/roles?status=${s}`);
      const body = (await res.json()) as { items?: Item[]; counts?: Record<Status, number>; error?: string };
      if (res.status === 404) throw new Error('Role profiles are switched off here (the roles_v1 flag, in Site switches).');
      if (!res.ok) throw new Error(body.error ?? 'Could not load.');
      setItems(body.items ?? []);
      setCounts(body.counts ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(status);
  }, [status, load]);

  async function act(item: Item, action: 'approve' | 'changes' | 'verify_vouch' | 'face_check', extra: Record<string, unknown> = {}) {
    let note: string | null = null;
    if (action === 'changes') {
      note = await ui.ask({
        title: `What should ${item.person.displayName ?? item.person.label} fix?`,
        body: 'Say exactly how to get there: which photo to retake and how. They see these words.',
        label: 'How to get there',
        placeholder: 'Retake the before photo by a window, same angle as the after. Then send again.',
        action: 'Send back with this note',
        multiline: true,
      });
      if (!note) return;
    } else if (action === 'approve') {
      const ok = await ui.confirm({
        title: `Approve ${item.person.displayName ?? item.person.label} as ${item.role.name.toLowerCase()}?`,
        body: 'Their profile becomes visible to clients. Approving also confirms you checked their documents.',
        action: 'Approve',
      });
      if (!ok) return;
    }
    setBusy(item.personRole.id + action);
    try {
      const res = await fetch('/api/admin/roles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.personRole.id, action, note, ...extra }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not save.');
      ui.notify(action === 'approve' ? 'Approved. The profile is live.' : action === 'changes' ? 'Sent back with your note.' : action === 'face_check' ? 'Face check saved.' : 'Vouch confirmed.', 'good');
      await load(status);
    } catch (e) {
      ui.notify(e instanceof Error ? e.message : 'Could not save.', 'bad');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="p-4 sm:p-8 max-w-6xl">
      <h1 className="text-2xl font-display text-white mb-1">Role profiles</h1>
      <p className="text-sm text-neutral-400 mb-6">Check the proof against the role&apos;s published guidelines. A send-back must say how to get there.</p>

      <div className="flex gap-2 overflow-x-auto mb-6" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.status}
            role="tab"
            aria-selected={status === t.status}
            onClick={() => setStatus(t.status)}
            className={`shrink-0 min-h-[44px] px-4 text-sm border ${status === t.status ? 'border-accent-gold text-accent-gold' : 'border-white/15 text-neutral-300'}`}
          >
            {t.label}
            {counts ? ` (${counts[t.status]})` : ''}
          </button>
        ))}
      </div>

      {loading && <Loader2 className="w-5 h-5 animate-spin text-neutral-400" aria-label="Loading" />}
      {error && <p className="text-red-300 text-sm">{error}</p>}
      {!loading && !error && items.length === 0 && <p className="text-neutral-400 text-sm">Nothing here.</p>}

      <ul className="space-y-8">
        {items.map((item) => {
          const work = item.evidence.filter((e) => (e.kind === 'photo' || e.kind === 'video') && e.step_key !== 'face');
          const docs = item.evidence.filter((e) => e.kind === 'document');
          const vouches = item.evidence.filter((e) => e.kind === 'vouch');
          const pr = item.personRole;
          return (
            <li key={pr.id} className="border border-white/10 bg-white/[0.02]">
              <div className="p-4 border-b border-white/10 flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="text-white text-lg">{item.person.displayName ?? '(no name)'}</span>
                <span className="text-xs text-neutral-400">{item.person.label}</span>
                <span className="text-xs font-mono uppercase tracking-widest text-accent-gold">{item.role.name}</span>
                {pr.is_demo && <span className="text-xs px-2 py-0.5 border border-white/20 text-neutral-400">demo</span>}
                <span className={`text-xs flex items-center gap-1 ${item.person.identityVerified ? 'text-emerald-300' : 'text-amber-300'}`}>
                  {item.person.identityVerified ? <BadgeCheck className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                  {item.person.identityVerified ? 'ID checked' : 'ID not checked yet'}
                </span>
                <span className="text-xs text-neutral-500">{item.person.email}</span>
              </div>

              <div className="grid lg:grid-cols-[1fr_320px]">
                {/* The proof */}
                <div className="p-4 space-y-5">
                  {/* Face next to the ID-check selfie: the reviewer compares (no automatic matching). */}
                  <div>
                    <p className="text-sm text-white mb-2">Photo and ID selfie</p>
                    {item.face ? (
                      <>
                        <div className="grid grid-cols-2 gap-2 max-w-sm">
                          {[['In-app photo', item.face.url], ['ID-check selfie', item.face.idSelfieUrl]].map(([label, url]) => (
                            <figure key={label as string} className="aspect-square bg-neutral-900 overflow-hidden relative">
                              {url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={url as string} alt={label as string} className="w-full h-full object-cover" />
                              ) : (
                                <span className="w-full h-full flex items-center justify-center text-xs text-neutral-500 p-2 text-center">{label === 'ID-check selfie' ? 'No ID selfie yet' : 'Missing'}</span>
                              )}
                              <figcaption className="absolute left-1 bottom-1 px-1 text-[10px] font-mono bg-black/70 text-white">{label}</figcaption>
                            </figure>
                          ))}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 mt-2 text-xs">
                          <span className="text-neutral-400">Check: {item.face.check ?? 'not done'}</span>
                          {item.face.idSelfieUrl && (
                            <>
                              <button type="button" onClick={() => act(item, 'face_check', { value: 'same_person' })} className="min-h-[36px] px-2 border border-white/15 hover:border-emerald-400">Same person</button>
                              <button type="button" onClick={() => act(item, 'face_check', { value: 'different_person' })} className="min-h-[36px] px-2 border border-white/15 hover:border-red-400">Different person</button>
                            </>
                          )}
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-amber-300">No photo yet.</p>
                    )}
                  </div>
                  {pr.headline && <p className="text-neutral-200">{pr.headline}</p>}
                  <p className="text-xs text-neutral-400">
                    {pr.area ?? 'No area'} | {pr.price_cents !== null ? formatRolePrice(item.role.pricing_unit, pr.price_cents, pr.per_km_cents) : 'No price'}
                    {item.dateOfBirth ? ` | Born ${item.dateOfBirth}` : item.role.min_age ? ' | No date of birth' : ''}
                  </p>

                  <div>
                    <p className="text-sm text-white mb-2">
                      Work ({item.role.proof_format}) <span className="text-neutral-500">({work.length})</span>
                    </p>
                    {work.length === 0 ? (
                      <p className="text-xs text-neutral-500">Nothing yet.</p>
                    ) : (
                      <ul className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                        {work.map((e) => (
                          <li key={e.id} className={`relative bg-neutral-900 overflow-hidden ${e.media_kind === 'audio' ? 'col-span-3 sm:col-span-4 p-2' : 'aspect-square'}`}>
                            {e.media_kind === 'audio' ? (
                              <audio src={e.viewUrl ?? undefined} controls preload="none" className="w-full" />
                            ) : e.kind === 'video' ? (
                              <a href={e.viewUrl ?? '#'} target="_blank" rel="noreferrer" className="w-full h-full flex items-center justify-center text-neutral-300">
                                <Video className="w-6 h-6" aria-label="Open video" />
                              </a>
                            ) : e.viewUrl ? (
                              <a href={e.viewUrl} target="_blank" rel="noreferrer">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={e.viewUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                              </a>
                            ) : null}
                            {e.media_kind !== 'audio' && (
                              <span className={`absolute left-1 bottom-1 px-1 text-[10px] font-mono ${e.source === 'captured_in_app' ? 'bg-emerald-900/80 text-emerald-200' : 'bg-black/70 text-neutral-300'}`}>
                                {e.source === 'captured_in_app' ? 'in app' : e.source}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {Object.keys(pr.facts ?? {}).length > 0 && (
                      <p className="text-xs text-neutral-400 mt-2">Facts: {factsSummary(sanitizeFacts(pr.facts)).join(' | ') || 'none'}</p>
                    )}
                    {item.evidence.some((e) => e.step_key === 'cv' || e.step_key === 'voice') && (
                      <p className="text-xs text-neutral-500 mt-1">
                        Private: {item.evidence.filter((e) => e.step_key === 'cv' || e.step_key === 'voice').map((e) => (
                          <a key={e.id} href={e.viewUrl ?? '#'} target="_blank" rel="noreferrer" className="text-accent-gold underline mr-2">{e.step_key === 'cv' ? 'CV' : 'voice note'}</a>
                        ))}
                      </p>
                    )}
                  </div>

                  {item.role.legal_requirements.length > 0 && (
                    <div>
                      <p className="text-sm text-white mb-2">Legal documents</p>
                      <ul className="space-y-1">
                        {item.role.legal_requirements.map((r) => {
                          const d = docs.filter((x) => x.legal_code === r.code);
                          const applies = !r.when || pr.answers?.[r.when] === true;
                          return (
                            <li key={r.code} className="text-xs flex items-center gap-2">
                              <FileText className="w-3.5 h-3.5 text-neutral-500" aria-hidden="true" />
                              <span className={applies ? 'text-neutral-200' : 'text-neutral-600 line-through'}>{r.label}</span>
                              {r.basis === 'platform' && <span className="text-neutral-500">(our rule)</span>}
                              {r.code.startsWith('age_') ? null : d.length ? (
                                d.map((x) => (
                                  <a key={x.id} href={x.viewUrl ?? '#'} target="_blank" rel="noreferrer" className="text-accent-gold underline">
                                    open{x.verified_at ? ' (checked)' : ''}
                                  </a>
                                ))
                              ) : applies ? (
                                <span className="text-amber-300">missing</span>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}

                  {vouches.length > 0 && (
                    <div>
                      <p className="text-sm text-white mb-2">Vouches</p>
                      <ul className="space-y-2">
                        {vouches.map((v) => (
                          <li key={v.id} className="text-xs text-neutral-300 flex items-center gap-2">
                            <Phone className="w-3.5 h-3.5" aria-hidden="true" /> {v.note}
                            {v.verified_at ? (
                              <span className="text-emerald-300">confirmed</span>
                            ) : (
                              <button type="button" onClick={() => act(item, 'verify_vouch', { evidence_id: v.id })} className="min-h-[36px] px-2 border border-white/15 hover:border-accent-gold">
                                They confirmed
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {pr.reviewer_note && (
                    <p className="text-xs text-neutral-400 border-l-2 border-accent-gold pl-3 whitespace-pre-line">Last note: {pr.reviewer_note}</p>
                  )}
                  {pr.status === 'approved' && (
                    <p className="text-xs text-neutral-400">
                      Level: {LEVEL_WORDS[pr.evidence_level]}.{' '}
                      <Link href={`/people/${pr.id}`} className="text-accent-gold underline" target="_blank">
                        Public profile
                      </Link>
                    </p>
                  )}
                </div>

                {/* The published standard, side by side */}
                <aside className="p-4 border-t lg:border-t-0 lg:border-l border-white/10 bg-black/20">
                  <p className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-2">Published guidelines</p>
                  <p className="text-sm text-neutral-300 whitespace-pre-line mb-4">{item.role.guidelines}</p>
                  {pr.status === 'submitted' && (
                    <p className="text-xs text-neutral-500 mb-4">If approved now: {LEVEL_WORDS[item.suggestedLevel]}.</p>
                  )}
                  {pr.status === 'submitted' && (
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => act(item, 'approve')}
                        disabled={busy !== null}
                        className="w-full min-h-[48px] bg-accent-gold text-black text-xs font-mono font-bold uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-40"
                      >
                        <CheckCircle className="w-4 h-4" aria-hidden="true" /> Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => act(item, 'changes')}
                        disabled={busy !== null}
                        className="w-full min-h-[48px] border border-white/20 text-neutral-200 text-xs font-mono uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-40"
                      >
                        <MessageSquare className="w-4 h-4" aria-hidden="true" /> Ask for changes
                      </button>
                    </div>
                  )}
                </aside>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
