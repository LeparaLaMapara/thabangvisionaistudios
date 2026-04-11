'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { STUDIO } from '@/lib/constants';
import OnboardingProgress from './OnboardingProgress';
import StepIdCapture from './StepIdCapture';
import StepPortfolioUpload from './StepPortfolioUpload';
import StepSkillsDetection from './StepSkillsDetection';
import StepGearRentals from './StepGearRentals';
import type { SceneAnalysisResult, SkillDetectionResult } from '@/lib/agents/types';

const TOTAL_STEPS = 5;
const STEP_LABELS = ['Identity', 'Portfolio', 'Skills', 'Review', 'Gear'];

interface OnboardingData {
  idData: { firstName: string; lastName: string; idNumber: string; dateOfBirth: string } | null;
  analyses: SceneAnalysisResult[];
  skills: SkillDetectionResult | null;
  gear: unknown[];
}

export default function OnboardingFlow() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<OnboardingData>({
    idData: null,
    analyses: [],
    skills: null,
    gear: [],
  });

  // Check auth and load existing progress
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) {
        window.location.href = '/login';
        return;
      }

      // Load existing progress
      try {
        const { data: progress } = await supabase
          .from('onboarding_progress')
          .select('*')
          .eq('creator_id', user.id)
          .single();

        if (progress) {
          setStep(progress.current_step || 1);
          if (progress.detected_skills) {
            setData(prev => ({ ...prev, skills: progress.detected_skills as SkillDetectionResult }));
          }
        }
      } catch {
        // No existing progress, start from step 1
      }

      setLoading(false);
    });
  }, []);

  // Save progress to Supabase
  const saveProgress = useCallback(async (currentStep: number, extraData?: Record<string, unknown>) => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const progressData = {
      creator_id: user.id,
      current_step: currentStep,
      [`step_${currentStep}_complete`]: true,
      updated_at: new Date().toISOString(),
      ...extraData,
    };

    await supabase
      .from('onboarding_progress')
      .upsert(progressData, { onConflict: 'creator_id' });
  }, []);

  // Step 1: ID capture complete
  const handleIdComplete = useCallback(async (idData: OnboardingData['idData']) => {
    setData(prev => ({ ...prev, idData }));
    await saveProgress(1);
    setStep(2);
  }, [saveProgress]);

  // Step 2: Portfolio upload complete
  const handlePortfolioComplete = useCallback(async (analyses: SceneAnalysisResult[]) => {
    setData(prev => ({ ...prev, analyses }));
    await saveProgress(2);
    setStep(3);
  }, [saveProgress]);

  // Step 3: Skills detection complete
  const handleSkillsComplete = useCallback(async (skills: SkillDetectionResult) => {
    setData(prev => ({ ...prev, skills }));
    await saveProgress(3, { detected_skills: skills });
    setStep(4);
  }, [saveProgress]);

  // Step 4: Review — just advance
  const handleReviewComplete = useCallback(async () => {
    await saveProgress(4);
    setStep(5);
  }, [saveProgress]);

  // Step 5: Gear listing complete
  const handleGearComplete = useCallback(async (gear: unknown[]) => {
    setSaving(true);
    setError(null);

    try {
      setData(prev => ({ ...prev, gear }));
      await saveProgress(5, { detected_gear: gear, completed_at: new Date().toISOString() });
      window.location.href = '/dashboard';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save.');
      setSaving(false);
    }
  }, [saveProgress]);

  const handleGearSkip = useCallback(async () => {
    setSaving(true);
    try {
      await saveProgress(5, { completed_at: new Date().toISOString() });
      window.location.href = '/dashboard';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save.');
      setSaving(false);
    }
  }, [saveProgress]);

  const goBack = () => {
    if (step > 1) {
      setError(null);
      setStep(step - 1);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-40">
        <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center px-6 py-16 min-h-screen">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="w-full max-w-2xl"
      >
        {/* Header */}
        <div className="mb-6">
          <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-neutral-600 mb-3">
            {STUDIO.shortName.toUpperCase()} / CREATOR ONBOARDING
          </p>
          <h1 className="text-3xl font-display font-medium uppercase tracking-tight text-white">
            Join the Network
          </h1>
          <p className="text-xs font-mono text-neutral-500 mt-3 leading-relaxed">
            Complete these steps to set up your creator profile and start earning.
          </p>
          <div className="w-8 h-px bg-[#D4A843] mt-5" />
        </div>

        {/* Progress */}
        <div className="mb-8">
          <OnboardingProgress
            currentStep={step}
            totalSteps={TOTAL_STEPS}
            stepLabels={STEP_LABELS}
          />
        </div>

        {/* Card */}
        <div className="bg-[#0A0A0B] border border-white/10 p-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              {step === 1 && (
                <StepIdCapture onComplete={handleIdComplete} />
              )}

              {step === 2 && (
                <StepPortfolioUpload onComplete={handlePortfolioComplete} />
              )}

              {step === 3 && (
                <StepSkillsDetection
                  analyses={data.analyses}
                  onComplete={handleSkillsComplete}
                />
              )}

              {step === 4 && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-sm font-mono font-bold uppercase tracking-widest text-white mb-1">
                      Profile Review
                    </h2>
                    <p className="text-[10px] font-mono text-neutral-500 leading-relaxed">
                      Here&apos;s a summary of your onboarding so far.
                    </p>
                  </div>

                  {/* ID summary */}
                  {data.idData && (
                    <div className="bg-neutral-900 border border-white/5 p-4">
                      <p className="text-[9px] font-mono uppercase tracking-widest text-neutral-500 mb-2">Identity</p>
                      <p className="text-sm font-mono text-white">
                        {data.idData.firstName} {data.idData.lastName}
                      </p>
                      <p className="text-[10px] font-mono text-neutral-400 mt-1">
                        DOB: {data.idData.dateOfBirth}
                      </p>
                    </div>
                  )}

                  {/* Portfolio summary */}
                  <div className="bg-neutral-900 border border-white/5 p-4">
                    <p className="text-[9px] font-mono uppercase tracking-widest text-neutral-500 mb-2">Portfolio</p>
                    <p className="text-sm font-mono text-white">
                      {data.analyses.length} photos analyzed
                    </p>
                  </div>

                  {/* Skills summary */}
                  {data.skills && (
                    <div className="bg-neutral-900 border border-white/5 p-4">
                      <p className="text-[9px] font-mono uppercase tracking-widest text-neutral-500 mb-2">Skills</p>
                      <div className="flex flex-wrap gap-2">
                        {data.skills.skills.map(s => (
                          <span
                            key={s.name}
                            className="text-[10px] font-mono text-[#D4A843] border border-[#D4A843]/20 px-2 py-1"
                          >
                            {s.name} ({s.percentage}%)
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleReviewComplete}
                    className="w-full bg-[#D4A843] text-black py-3 px-6 text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity min-h-[44px]"
                  >
                    Continue to Gear Listing
                  </button>
                </div>
              )}

              {step === 5 && (
                <StepGearRentals
                  onComplete={handleGearComplete}
                  onSkip={handleGearSkip}
                />
              )}
            </motion.div>
          </AnimatePresence>

          {/* Error */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 px-4 py-3 mt-4">
              <p className="text-xs text-red-400 font-mono">{error}</p>
            </div>
          )}

          {saving && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <div className="w-4 h-4 border-2 border-white/20 border-t-[#D4A843] rounded-full animate-spin" />
              <p className="text-xs font-mono text-neutral-400">Saving...</p>
            </div>
          )}

          {/* Back button */}
          {step > 1 && step < 5 && (
            <div className="mt-6 pt-4 border-t border-white/5">
              <button
                type="button"
                onClick={goBack}
                className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-neutral-500 hover:text-white transition-colors min-h-[44px] px-2"
              >
                <ChevronLeft className="w-3 h-3" />
                Back
              </button>
            </div>
          )}
        </div>

        {/* Step indicator */}
        <p className="text-center text-[9px] font-mono text-neutral-600 mt-4">
          Step {step} of {TOTAL_STEPS}
        </p>
      </motion.div>
    </div>
  );
}
