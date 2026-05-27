'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, MessageCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';

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
  body = 'Have questions? Our AI assistant can help you find exactly what you need — pricing, availability, or a custom quote.',
  ctaLabel = 'Chat with Ubunye AI',
  ctaHref = '/ubunye-ai-studio',
}: ExitIntentModalProps) {
  const [show, setShow] = useState(false);
  const firedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleMouseLeave = useCallback((e: MouseEvent) => {
    if (e.clientY > 10 || firedRef.current) return;
    firedRef.current = true;
    timerRef.current = setTimeout(() => setShow(true), 200);
  }, []);

  useEffect(() => {
    const dismissed = sessionStorage.getItem('exit-intent-dismissed');
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

  const dismiss = () => {
    setShow(false);
    sessionStorage.setItem('exit-intent-dismissed', '1');
  };

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
            className="bg-[#0A0A0B] border border-white/10 max-w-md w-full p-8 relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={dismiss}
              className="absolute top-4 right-4 text-neutral-500 hover:text-white transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="mb-6">
              <div className="w-10 h-10 rounded-full bg-[#D4A843]/10 flex items-center justify-center mb-4">
                <MessageCircle className="w-5 h-5 text-[#D4A843]" />
              </div>
              <h2 className="text-xl font-display font-medium uppercase text-white mb-2">
                {heading}
              </h2>
              <p className="text-sm text-neutral-400 font-light leading-relaxed">
                {body}
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <Link
                href={prompt ? `${ctaHref}?prompt=${encodeURIComponent(prompt)}` : ctaHref}
                onClick={dismiss}
                className="w-full bg-[#D4A843] text-neutral-950 py-3 px-6 text-xs font-mono font-bold uppercase tracking-widest text-center hover:bg-[#E8C96A] transition-colors"
              >
                {ctaLabel}
              </Link>
              <button
                onClick={dismiss}
                className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 hover:text-white transition-colors py-2"
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
