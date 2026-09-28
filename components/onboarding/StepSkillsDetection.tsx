'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import type { SceneAnalysisResult, SkillDetectionResult } from '@/lib/agents/types';

interface StepSkillsDetectionProps {
  analyses: SceneAnalysisResult[];
  onComplete: (skills: SkillDetectionResult) => void;
}

interface SelectableSkill {
  id: string;
  name: string;
  percentage: number;
  selected: boolean;
}

export default function StepSkillsDetection({ analyses, onComplete }: StepSkillsDetectionProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [skills, setSkills] = useState<SelectableSkill[]>([]);

  const detectSkills = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/agents/portfolios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'detect-skills', analyses }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Skills detection failed.');

      const result = data.data as SkillDetectionResult;
      // Prefer mapped platform skills (e.g. wedding_photography) over raw scene types.
      const mapped: SelectableSkill[] =
        result.platformSkills && result.platformSkills.length > 0
          ? result.platformSkills.map((s) => ({
              id: s.id,
              name: s.label,
              percentage: s.percentage,
              selected: true,
            }))
          : result.skills.map((s) => ({ id: s.name, ...s, selected: true }));
      setSkills(mapped);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to detect skills.');
    } finally {
      setLoading(false);
    }
  }, [analyses]);

  useEffect(() => {
    detectSkills();
  }, [detectSkills]);

  const toggleSkill = (index: number) => {
    setSkills(prev =>
      prev.map((s, i) => (i === index ? { ...s, selected: !s.selected } : s)),
    );
  };

  const handleConfirm = () => {
    const selectedSkills = skills
      .filter(s => s.selected)
      .map(s => ({ name: s.name, percentage: s.percentage }));

    if (selectedSkills.length === 0) {
      setError('Select at least one skill.');
      return;
    }

    onComplete({ skills: selectedSkills });
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-sm font-mono font-bold uppercase tracking-widest text-white mb-1">
            Detecting Your Skills
          </h2>
          <p className="text-[10px] font-mono text-neutral-400 leading-relaxed">
            Analyzing your portfolio to identify your specialties...
          </p>
        </div>
        <div className="flex items-center justify-center gap-3 py-12">
          <Loader2 className="w-6 h-6 text-[#D4A843] animate-spin" />
          <p className="text-xs font-mono text-neutral-400">Processing {analyses.length} photos...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-mono font-bold uppercase tracking-widest text-white mb-1">
          Your Skills
        </h2>
        <p className="text-[10px] font-mono text-neutral-400 leading-relaxed">
          Based on your portfolio, here are your detected specialties. Uncheck any that don&apos;t apply.
        </p>
      </div>

      {/* Skills list */}
      <div className="space-y-3">
        {skills.map((skill, index) => (
          <button
            key={skill.id}
            type="button"
            onClick={() => toggleSkill(index)}
            className={`w-full flex items-center gap-4 p-4 border transition-colors ${
              skill.selected
                ? 'border-[#D4A843]/30 bg-[#D4A843]/5'
                : 'border-white/5 bg-neutral-900/50 opacity-50'
            }`}
          >
            {/* Checkbox */}
            <div
              className={`w-5 h-5 border flex-shrink-0 flex items-center justify-center transition-colors ${
                skill.selected ? 'border-[#D4A843] bg-[#D4A843]' : 'border-white/20'
              }`}
            >
              {skill.selected && (
                <svg className="w-3 h-3 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>

            {/* Skill name */}
            <span className="text-sm font-mono text-white flex-1 text-left">{skill.name}</span>

            {/* Percentage bar */}
            <div className="w-24 flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-white/5 overflow-hidden">
                <div
                  className="h-full bg-[#D4A843] transition-all duration-500"
                  style={{ width: `${skill.percentage}%` }}
                />
              </div>
              <span className="text-[10px] font-mono text-neutral-400 w-8 text-right">
                {skill.percentage}%
              </span>
            </div>
          </button>
        ))}
      </div>

      {skills.length === 0 && !error && (
        <p className="text-xs font-mono text-neutral-400 text-center py-8">
          No skills detected. Please go back and upload more portfolio photos.
        </p>
      )}

      <button
        type="button"
        onClick={handleConfirm}
        disabled={skills.filter(s => s.selected).length === 0}
        className="w-full bg-[#D4A843] text-black py-3 px-6 text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity disabled:opacity-20 disabled:cursor-not-allowed min-h-[44px]"
      >
        Confirm Skills
      </button>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 px-4 py-3">
          <p className="text-xs text-red-400 font-mono">{error}</p>
        </div>
      )}
    </div>
  );
}
