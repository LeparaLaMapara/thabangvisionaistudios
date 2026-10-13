'use client';

import { useRef, useCallback, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUp, Sparkles } from 'lucide-react';
import { UBUNYE_EXAMPLE_PROMPTS } from '@/lib/constants';

interface ChatInputBarProps {
  input: string;
  setInput: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
  limitReached: boolean;
  remaining: number;
  isAuthenticated: boolean;
  showSuggestions?: boolean;
}

export function ChatInputBar({
  input,
  setInput,
  onSubmit,
  isLoading,
  limitReached,
  remaining,
  isAuthenticated,
  showSuggestions = false,
}: ChatInputBarProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [suggestionIndex, setSuggestionIndex] = useState(0);

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    resizeTextarea();
  }, [setInput, resizeTextarea]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit(e);
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
    if (e.key === 'Escape') {
      textareaRef.current?.blur();
    }
  }, [onSubmit]);

  // Cycle suggestions
  useEffect(() => {
    if (!showSuggestions) return;
    const timer = setInterval(() => {
      setSuggestionIndex(i => (i + 1) % UBUNYE_EXAMPLE_PROMPTS.length);
    }, 4000);
    return () => clearInterval(timer);
  }, [showSuggestions]);

  return (
    <div className="pb-4 pt-3 flex-shrink-0">
      {/* Rotating suggestion */}
      {showSuggestions && !input && (
        <div className="h-5 mb-2 overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.p
              key={suggestionIndex}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3 }}
              className="text-xs text-neutral-400 text-center"
            >
              Try: &ldquo;{UBUNYE_EXAMPLE_PROMPTS[suggestionIndex]}&rdquo;
            </motion.p>
          </AnimatePresence>
        </div>
      )}

      <form onSubmit={onSubmit}>
        <div className={`flex items-end bg-[#0A0A0B] border rounded-xl transition-all duration-200 ${
          limitReached
            ? 'border-white/5 opacity-40'
            : 'border-white/8 focus-within:border-[#D4A843]/30 focus-within:shadow-[0_0_20px_rgba(212,168,67,0.05)]'
        }`}>
          {/* Textarea. Attachments and voice input used to sit here as two
              buttons that only said "coming soon" -- removed until they work. */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            aria-label="Message Ubunye"
            placeholder={limitReached ? 'Message limit reached' : 'Ask Ubunye…'}
            disabled={isLoading || limitReached}
            rows={1}
            // 16px on phones: iOS Safari zooms the page into any smaller input.
            className="flex-1 min-w-0 bg-transparent px-4 py-3 text-base md:text-[15px] text-white placeholder-neutral-400 outline-none resize-none disabled:opacity-50 leading-relaxed"
            style={{ maxHeight: 120 }}
          />

          {/* Send button */}
          <div className="pr-1 pb-1">
            <button
              type="submit"
              aria-label="Send message"
              disabled={!input.trim() || isLoading || limitReached}
              className={`w-11 h-11 flex items-center justify-center rounded-lg transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D4A843] ${
                input.trim() && !isLoading && !limitReached
                  ? 'bg-[#D4A843] text-black hover:bg-[#E8C96A]'
                  : 'text-neutral-400'
              }`}
            >
              {input.trim() ? (
                <ArrowUp className="w-4 h-4" aria-hidden="true" />
              ) : (
                <Sparkles className="w-4 h-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </form>

      {/* Footer */}
      <div className="flex items-start justify-between gap-3 mt-2 px-1">
        <p className="text-xs text-neutral-400">
          Ubunye is an AI assistant and can make mistakes. Prices are confirmed at checkout.
        </p>
        {!limitReached && remaining !== -1 && (
          <p className="text-xs text-neutral-400 shrink-0" aria-live="polite">
            {remaining} free message{remaining === 1 ? '' : 's'} left{isAuthenticated ? ' today' : ''}
          </p>
        )}
      </div>
    </div>
  );
}
