'use client';

import { useId, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { useFocusTrap } from '@/components/ui/useFocusTrap';

type ModalSize = 'sm' | 'md' | 'lg';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: ModalSize;
}

const SIZE_CLASSES: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
};

export function Modal({ isOpen, onClose, title, children, size = 'md' }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Focus moves into the dialog, Tab stays inside it, Escape closes it, page
  // scroll is locked, and focus returns to the opener on close.
  useFocusTrap(panelRef, { active: isOpen, onEscape: onClose });

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Panel */}
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            aria-label={title ? undefined : 'Dialog'}
            className={[
              'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50',
              'w-[calc(100%-2rem)]',
              SIZE_CLASSES[size],
              'bg-neutral-900',
              'border border-white/10',
              'shadow-2xl',
              'max-h-[90vh] overflow-y-auto',
            ].join(' ')}
          >
            {/* Header */}
            <div className="flex items-center justify-between py-3 pl-6 pr-3 border-b border-white/10">
              {title ? (
                <h2
                  id={titleId}
                  className="text-sm font-display font-medium uppercase tracking-tight text-white"
                >
                  {title}
                </h2>
              ) : (
                <div />
              )}
              <button
                onClick={onClose}
                aria-label="Close modal"
                className="w-11 h-11 flex items-center justify-center text-neutral-400 hover:text-white transition-colors ml-4 flex-shrink-0"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
