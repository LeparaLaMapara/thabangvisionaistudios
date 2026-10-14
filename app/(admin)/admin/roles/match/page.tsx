'use client';

import { useState } from 'react';
import { Loader2, RefreshCw, Search } from 'lucide-react';

/**
 * Admin/dev only: try the matcher. Competence-only profile embeddings,
 * ranked with the record and the fair "new" slots. Blind labels only.
 */

interface Match {
  id: string;
  label: string;
  role: string;
  similarity: number;
  reliability: number;
  score: number;
  isNew: boolean;
  jobs: number;
}

export default function AdminRoleMatchPage() {
  const [q, setQ] = useState('make-up artist for a wedding in Soweto');
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function run(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy('search');
    setNote(null);
    try {
      const res = await fetch(`/api/admin/roles/match?q=${encodeURIComponent(q)}`);
      const body = (await res.json()) as { matches?: Match[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Matching failed.');
      setMatches(body.matches ?? []);
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Matching failed.');
    } finally {
      setBusy(null);
    }
  }

  async function reembed() {
    setBusy('reembed');
    setNote(null);
    try {
      const res = await fetch('/api/admin/roles/reembed', { method: 'POST' });
      const body = (await res.json()) as { counts?: Record<string, number>; error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Failed.');
      setNote(`Embeddings: ${Object.entries(body.counts ?? {}).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="p-4 sm:p-8 max-w-3xl">
      <h1 className="text-2xl font-display text-white mb-1">Try the matcher</h1>
      <p className="text-sm text-neutral-400 mb-6">Uses only the work: facts, proof, record and area. Never names, faces or demographics.</p>
      <form onSubmit={run} className="flex gap-2 mb-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} className="flex-1 min-h-[48px] px-3 bg-black/40 border border-white/15 text-white" aria-label="Request" />
        <button type="submit" className="min-h-[48px] min-w-[48px] px-4 bg-accent-gold text-black flex items-center justify-center" aria-label="Search">
          {busy === 'search' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
        </button>
      </form>
      <button type="button" onClick={reembed} className="min-h-[44px] px-3 text-xs border border-white/15 text-neutral-300 flex items-center gap-2 mb-6">
        {busy === 'reembed' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Rebuild embeddings
      </button>
      {note && <p className="text-sm text-neutral-300 mb-4">{note}</p>}
      {matches && (
        <ol className="space-y-2">
          {matches.length === 0 && <li className="text-neutral-400 text-sm">No matches (no embeddings yet? Rebuild them).</li>}
          {matches.map((m, i) => (
            <li key={m.id} className="border border-white/10 p-3 text-sm">
              <p className="text-white">{i + 1}. {m.label} {m.isNew && <span className="text-xs text-accent-gold">new</span>}</p>
              <p className="text-xs text-neutral-400 font-mono">score {m.score} · fit {m.similarity} · record {m.reliability} · {m.jobs} jobs</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
