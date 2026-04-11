'use client';

import { Check } from 'lucide-react';

interface OnboardingProgressProps {
  currentStep: number;
  totalSteps: number;
  stepLabels: string[];
}

export default function OnboardingProgress({
  currentStep,
  totalSteps,
  stepLabels,
}: OnboardingProgressProps) {
  return (
    <div className="w-full">
      {/* Step indicators */}
      <div className="flex items-center justify-between gap-2">
        {Array.from({ length: totalSteps }, (_, i) => {
          const stepNum = i + 1;
          const isComplete = stepNum < currentStep;
          const isCurrent = stepNum === currentStep;

          return (
            <div key={i} className="flex flex-col items-center flex-1 min-w-0">
              {/* Circle */}
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-mono font-bold transition-all duration-300 ${
                  isComplete
                    ? 'bg-[#D4A843] text-black'
                    : isCurrent
                    ? 'border-2 border-[#D4A843] text-[#D4A843]'
                    : 'border border-white/10 text-neutral-600'
                }`}
              >
                {isComplete ? (
                  <Check className="w-4 h-4" />
                ) : (
                  stepNum
                )}
              </div>

              {/* Label */}
              <p
                className={`text-[8px] font-mono uppercase tracking-widest mt-2 text-center truncate w-full transition-colors duration-300 ${
                  isCurrent
                    ? 'text-[#D4A843]'
                    : isComplete
                    ? 'text-neutral-400'
                    : 'text-neutral-600'
                }`}
              >
                {stepLabels[i]}
              </p>
            </div>
          );
        })}
      </div>

      {/* Progress bar */}
      <div className="flex gap-1 mt-4">
        {Array.from({ length: totalSteps }, (_, i) => (
          <div
            key={i}
            className={`h-0.5 flex-1 transition-colors duration-300 ${
              i < currentStep ? 'bg-[#D4A843]' : 'bg-white/10'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
