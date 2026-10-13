'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { SceneAnalysisResult, SkillDetectionResult } from '@/lib/agents/types';
import { MAX_BIO_CHARS } from '@/lib/agents/agents/bio-writer';

/** Shown when no draft could be made at all: what to write, so the box is never a dead end. */
const WRITE_YOUR_OWN =
  'We could not draft a bio just now. Write a line or two yourself: what you shoot, where you work and what clients can expect.';

interface StepBioReviewProps {
  analyses: SceneAnalysisResult[];
  skills: SkillDetectionResult | null;
  onComplete: (bio: string) => void;
}

export default function StepBioReview({ analyses, skills, onComplete }: StepBioReviewProps) {
  const [bio, setBio] = useState('');
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [samples, setSamples] = useState<number>(0);
  const [notice, setNotice] = useState<string | null>(null);

  const generate = useCallback(async () => {
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/agents/bio-writer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        // Keep whatever they already typed; tell them what to write.
        setNotice(typeof data.error === 'string' && res.status === 429 ? data.error : WRITE_YOUR_OWN);
        return;
      }
      const drafted = typeof data.bio === 'string' ? data.bio : '';
      if (drafted) setBio(drafted);
      setSamples((data.samples as number) ?? 0);
      if (typeof data.notice === 'string') setNotice(data.notice);
      else if (!drafted) setNotice(WRITE_YOUR_OWN);
    } catch {
      setNotice(WRITE_YOUR_OWN);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await generate();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [generate]);

  const handleRegenerate = async () => {
    setRegenerating(true);
    await generate();
    setRegenerating(false);
  };

  const handleSave = async () => {
    const trimmed = bio.trim();
    if (!trimmed) {
      setError('Bio cannot be empty.');
      return;
    }
    if (trimmed.length > MAX_BIO_CHARS) {
      setError(`Bio must be ${MAX_BIO_CHARS} characters or fewer.`);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error('Not signed in.');

      const { error: updateError } = await supabase
        .from('profiles')
        // crew_bio is what the public creator profile shows; bio is kept too.
        .update({ bio: trimmed, crew_bio: trimmed })
        .eq('id', userData.user.id);

      if (updateError) throw updateError;
      onComplete(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save bio.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-sm font-mono font-bold uppercase tracking-widest text-white mb-1">
            Writing Your Bio
          </h2>
          <p className="text-xs font-mono text-neutral-400 leading-relaxed">
            Drafting a short intro from your portfolio and profile...
          </p>
        </div>
        <div className="flex items-center justify-center gap-3 py-12">
          <Loader2 className="w-6 h-6 text-[#D4A843] animate-spin" />
          <p className="text-xs font-mono text-neutral-400">Generating bio...</p>
        </div>
      </div>
    );
  }

  const charsLeft = MAX_BIO_CHARS - bio.length;
  const overLimit = charsLeft < 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-mono font-bold uppercase tracking-widest text-white mb-1">
          Bio & Review
        </h2>
        <p className="text-xs font-mono text-neutral-400 leading-relaxed">
          Review your profile summary and edit your bio before continuing.
          {samples > 0 && ` Drafted from ${samples} portfolio scene${samples === 1 ? '' : 's'}.`}
        </p>
      </div>

      {/* Profile summary */}
      <div className="space-y-3">
        <div className="bg-neutral-900 border border-white/5 p-4">
          <p className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-2">Portfolio</p>
          <p className="text-sm font-mono text-white">
            {analyses.length} photo{analyses.length !== 1 ? 's' : ''} analyzed
          </p>
        </div>

        {skills && (
          <div className="bg-neutral-900 border border-white/5 p-4">
            <p className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-2">Skills</p>
            <div className="flex flex-wrap gap-2">
              {skills.skills.map(s => (
                <span
                  key={s.name}
                  className="text-xs font-mono text-[#D4A843] border border-[#D4A843]/20 px-2 py-1"
                >
                  {s.name} ({s.percentage}%)
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bio editor */}
      <div>
        {notice && (
          <div className="bg-[#D4A843]/10 border border-[#D4A843]/30 px-4 py-3 mb-3" role="status">
            <p className="text-xs text-[#D4A843] font-mono leading-relaxed">{notice}</p>
          </div>
        )}
        <p className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-2">Bio</p>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={5}
          className="w-full bg-neutral-900 border border-white/10 focus:border-[#D4A843]/50 outline-none p-4 text-sm font-mono text-white leading-relaxed resize-none"
          placeholder="For example: I am a wedding and portrait photographer in Soweto. I work with natural light and deliver edited photos within a week."
          disabled={regenerating || saving}
        />
        <div className="flex justify-between items-center mt-2">
          <p className={`text-xs font-mono ${overLimit ? 'text-red-400' : 'text-neutral-400'}`}>
            {charsLeft} character{charsLeft === 1 ? '' : 's'} {overLimit ? 'over' : 'left'}
          </p>
          <button
            type="button"
            onClick={handleRegenerate}
            disabled={regenerating || saving}
            className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-widest text-neutral-400 hover:text-[#D4A843] transition-colors disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px] px-2"
          >
            <RefreshCw className={`w-3 h-3 ${regenerating ? 'animate-spin' : ''}`} />
            {regenerating ? 'Regenerating' : 'Regenerate'}
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={handleSave}
        disabled={saving || regenerating || overLimit || !bio.trim()}
        className="w-full bg-[#D4A843] text-black py-3 px-6 text-xs font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity disabled:opacity-20 disabled:cursor-not-allowed min-h-[44px]"
      >
        {saving ? 'Saving...' : 'Looks good, continue'}
      </button>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 px-4 py-3">
          <p className="text-xs text-red-400 font-mono">{error}</p>
        </div>
      )}
    </div>
  );
}
