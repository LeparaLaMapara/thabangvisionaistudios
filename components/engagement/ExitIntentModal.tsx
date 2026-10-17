'use client';

import { useState, useEffect, useCallback, useId, useRef } from 'react';
import { X, MessageCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { useFocusTrap } from '@/components/ui/useFocusTrap';
import { PLAN } from '@/lib/constants';

interface ExitIntentModalProps {
  prompt?: string;
  heading?: string;
  body?: string;
  ctaLabel?: string;
  ctaHref?: string;
}

export function ExitIntentModal({
  prompt,
  heading = 'Before you go...',
  body = 'Have questions? Our AI assistant can help you find exactly what you need: prices, dates, or a quote.',
  ctaLabel = PLAN.cta,
  ctaHref = PLAN.href,
}: ExitIntentModalProps) {
  const [show, setShow] = useState(false);
  const firedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const panelRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const bodyId = useId();

  const handleMouseLeave = useCallback((e: MouseEvent) => {
    if (e.clientY > 10 || firedRef.current) return;
    firedRef.current = true;
    timerRef.current = setTimeout(() => setShow(true), 200);
  }, []);

  useEffect(() => {
    let dismissed: string | null = null;
    try { dismissed = sessionStorage.getItem('exit-intent-dismissed'); } catch { /* storage blocked */ }
    if (dismissed) return;

    const delay = setTimeout(() => {
      document.addEventListener('mouseleave', handleMouseLeave);
    }, 5000);

    return () => {
      clearTimeout(delay);
      clearTimeout(timerRef.current);
      document.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [handleMouseLeave]);

  const dismiss = useCallback(() => {
    setShow(false);
    try { sessionStorage.setItem('exit-intent-dismissed', '1'); } catch { /* storage blocked */ }
  }, []);

  useFocusTrap(panelRef, { active: show, onEscape: dismiss });

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
          onClick={dismiss}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={headingId}
            aria-describedby={bodyId}
            tabIndex={-1}
            className="bg-[#0A0A0B] border border-white/10 max-w-md w-full p-8 relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={dismiss}
              className="absolute top-2 right-2 w-11 h-11 flex items-center justify-center text-neutral-400 hover:text-white transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>

            <div className="mb-6">
              <div className="w-10 h-10 rounded-full bg-[#D4A843]/10 flex items-center justify-center mb-4">
                <MessageCircle className="w-5 h-5 text-[#D4A843]" aria-hidden="true" />
              </div>
              <h2 id={headingId} className="text-xl font-display font-medium uppercase text-white mb-2">
                {heading}
              </h2>
              <p id={bodyId} className="text-sm text-neutral-400 font-light leading-relaxed">
                {body}
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <Link
                href={prompt ? `${ctaHref}?prompt=${encodeURIComponent(prompt)}` : ctaHref}
                onClick={dismiss}
                className="w-full min-h-[44px] flex items-center justify-center bg-[#D4A843] text-neutral-950 py-3 px-6 text-xs font-mono font-bold uppercase tracking-widest text-center hover:bg-[#E8C96A] transition-colors"
              >
                {ctaLabel}
              </Link>
              <button
                onClick={dismiss}
                className="min-h-[44px] text-xs font-mono uppercase tracking-widest text-neutral-400 hover:text-white transition-colors py-2"
              >
                No thanks, I&apos;m just browsing
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
