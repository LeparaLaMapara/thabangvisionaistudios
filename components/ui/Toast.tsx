'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, XCircle, Info, X } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type ToastVariant = 'success' | 'error' | 'info';

interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue | null>(null);

// ─── Config ───────────────────────────────────────────────────────────────────

const VARIANT_CONFIG: Record<
  ToastVariant,
  { border: string; icon: React.ReactNode; textColor: string }
> = {
  success: {
    border: 'border-l-4 border-emerald-500',
    icon: <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />,
    textColor: 'text-emerald-700 dark:text-emerald-400',
  },
  error: {
    border: 'border-l-4 border-red-500',
    icon: <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />,
    textColor: 'text-red-700 dark:text-red-400',
  },
  info: {
    border: 'border-l-4 border-blue-500',
    icon: <Info className="w-4 h-4 text-blue-500 flex-shrink-0" />,
    textColor: 'text-blue-700 dark:text-blue-400',
  },
};

// ─── Provider ─────────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const add = useCallback(
    (message: string, variant: ToastVariant) => {
      const id = String(++idRef.current);
      setToasts((prev) => [...prev, { id, message, variant }]);
      setTimeout(() => dismiss(id), 4000);
    },
    [dismiss],
  );

  const value: ToastContextValue = {
    success: (msg) => add(msg, 'success'),
    error: (msg) => add(msg, 'error'),
    info: (msg) => add(msg, 'info'),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}

      {/* Toast stack — fixed bottom-right */}
      <div
        className="fixed bottom-6 right-6 z-[200] flex flex-col gap-3 pointer-events-none"
        aria-live="polite"
        aria-atomic="false"
      >
        <AnimatePresence>
          {toasts.map((toast) => {
            const cfg = VARIANT_CONFIG[toast.variant];
            return (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, y: 16, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.97 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className={[
                  'pointer-events-auto',
                  'flex items-start gap-3',
                  'bg-white dark:bg-neutral-900',
                  cfg.border,
                  'border border-black/10 dark:border-white/10',
                  'px-4 py-3',
                  'shadow-lg',
                  'min-w-[260px] max-w-sm',
                ].join(' ')}
              >
                {cfg.icon}
                <p className={['text-xs font-mono leading-relaxed flex-1', cfg.textColor].join(' ')}>
                  {toast.message}
                </p>
                <button
                  onClick={() => dismiss(toast.id)}
                  className="text-neutral-400 hover:text-black dark:hover:text-white transition-colors flex-shrink-0"
                  aria-label="Dismiss"
                >
                  <X className="w-3 h-3" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}
