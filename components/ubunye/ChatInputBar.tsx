'use client';

import { useRef, useCallback, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUp, Paperclip, Mic, Sparkles } from 'lucide-react';
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
  const [comingSoon, setComingSoon] = useState<string | null>(null);

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

  const showComingSoon = useCallback((feature: string) => {
    setComingSoon(feature);
    setTimeout(() => setComingSoon(null), 2000);
  }, []);

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

      {/* Coming soon toast */}
      <AnimatePresence>
        {comingSoon && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="text-xs text-neutral-400 text-center mb-2 font-mono"
          >
            {comingSoon} coming soon
          </motion.div>
        )}
      </AnimatePresence>

      <form onSubmit={onSubmit}>
        <div className={`flex items-end bg-[#0A0A0B] border rounded-xl transition-all duration-200 ${
          limitReached
            ? 'border-white/5 opacity-40'
            : 'border-white/8 focus-within:border-[#D4A843]/30 focus-within:shadow-[0_0_20px_rgba(212,168,67,0.05)]'
        }`}>
          {/* Left actions */}
          <div className="flex items-center gap-0.5 pl-2 pb-2.5">
            <button
              type="button"
              onClick={() => showComingSoon('Attachments')}
              disabled={limitReached}
              className="p-1.5 text-neutral-400 hover:text-neutral-400 transition-colors disabled:opacity-50"
            >
              <Paperclip className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => showComingSoon('Voice input')}
              disabled={limitReached}
              className="p-1.5 text-neutral-400 hover:text-neutral-400 transition-colors disabled:opacity-50"
            >
              <Mic className="w-4 h-4" />
            </button>
          </div>

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={limitReached ? 'Message limit reached' : 'Ask Ubunye…'}
            disabled={isLoading || limitReached}
            rows={1}
            className="flex-1 bg-transparent px-3 py-3 text-[15px] text-white placeholder-neutral-600 outline-none resize-none disabled:opacity-50 leading-relaxed"
            style={{ maxHeight: 120 }}
          />

          {/* Send button */}
          <div className="pr-2 pb-2.5">
            <button
              type="submit"
              disabled={!input.trim() || isLoading || limitReached}
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all duration-200 ${
                input.trim() && !isLoading && !limitReached
                  ? 'bg-[#D4A843] text-black hover:bg-[#E8C96A]'
                  : 'text-neutral-400'
              }`}
            >
              {input.trim() ? (
                <ArrowUp className="w-4 h-4" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </form>

      {/* Footer */}
      <div className="flex items-center justify-between mt-2 px-1">
        <p className="text-xs text-neutral-400">
          Powered by Ubunye AI
        </p>
        {!limitReached && remaining !== -1 && (
          <p className="text-xs text-neutral-400">
            {remaining} free message{remaining === 1 ? '' : 's'} left{isAuthenticated ? ' today' : ''}
          </p>
        )}
      </div>
    </div>
  );
}
