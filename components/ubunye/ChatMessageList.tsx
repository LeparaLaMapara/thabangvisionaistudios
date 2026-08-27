'use client';

import { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LogIn, UserPlus, ArrowUpRight } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import Link from 'next/link';
import type { UIMessage } from 'ai';
import { FollowUpSuggestions } from '@/components/ubunye/FollowUpSuggestions';

const TOOL_LABELS: Record<string, string> = {
  search_creators: 'Searching creators',
  get_creator_detail: 'Getting creator details',
  submit_creator_request: 'Submitting booking request',
  calculate_booking_quote: 'Calculating quote',
  improve_brief: 'Analyzing your brief',
};

function getMessageText(msg: UIMessage): string {
  return msg.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map(p => p.text)
    .join('');
}

function getToolStates(msg: UIMessage) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts = msg.parts as any[];
  const toolCalls = parts.filter(p => p.type === 'tool-call');
  const toolResults = parts.filter(p => p.type === 'tool-result');
  const completedIds = new Set(toolResults.map(p => p.toolCallId));

  return toolCalls
    .filter(p => !completedIds.has(p.toolCallId))
    .map(p => ({
      name: p.toolName as string,
      label: TOOL_LABELS[p.toolName as string] || 'Processing',
    }));
}

function getLastCompletedTool(msg: UIMessage): string | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts = msg.parts as any[];
  const toolResults = parts.filter(p => p.type === 'tool-result');
  if (toolResults.length === 0) return null;
  const lastResult = toolResults[toolResults.length - 1];
  const toolCalls = parts.filter(p => p.type === 'tool-call');
  const matching = toolCalls.find(p => p.toolCallId === lastResult.toolCallId);
  return matching?.toolName ?? null;
}

interface ChatMessageListProps {
  messages: UIMessage[];
  isLoading: boolean;
  error: Error | undefined;
  limitReached: boolean;
  limitMessage: string | null;
  isAuthenticated: boolean;
  mdComponents: Components;
  onSend: (text: string) => void;
}

export function ChatMessageList({
  messages,
  isLoading,
  error,
  limitReached,
  limitMessage,
  isAuthenticated,
  mdComponents,
  onSend,
}: ChatMessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="flex-1 overflow-y-auto py-6 space-y-4 md:space-y-6 scrollbar-thin scrollbar-thumb-neutral-800 scrollbar-track-transparent"
    >
      {messages.map((msg, msgIndex) => {
        const text = getMessageText(msg);
        const isAssistant = msg.role === 'assistant';
        const pendingTools = isAssistant ? getToolStates(msg) : [];
        const isLastAssistant = isAssistant && msgIndex === messages.length - 1;
        const completedTool = isLastAssistant && pendingTools.length === 0 ? getLastCompletedTool(msg) : null;

        return (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="space-y-1"
          >
            <span className={`text-[11px] font-medium tracking-wide ${
              isAssistant ? 'text-[#D4A843]' : 'text-neutral-600'
            }`}>
              {isAssistant ? 'Ubunye' : 'You'}
            </span>

            {msg.role === 'user' ? (
              <div className="text-[15px] text-neutral-200 leading-relaxed whitespace-pre-wrap">
                {text}
              </div>
            ) : (
              <div className="text-[15px] text-neutral-400 leading-relaxed border-l-2 border-[#D4A843]/10 pl-3 md:border-l-0 md:pl-0">
                <ReactMarkdown components={mdComponents}>
                  {text}
                </ReactMarkdown>
              </div>
            )}

            {pendingTools.length > 0 && (
              <div className="flex items-center gap-2 pt-1">
                <div className="w-3 h-3 border-2 border-[#D4A843]/30 border-t-[#D4A843] rounded-full animate-spin" />
                <span className="text-[12px] text-[#D4A843]/70 font-mono">
                  {pendingTools[0].label}...
                </span>
              </div>
            )}

            {completedTool && (
              <FollowUpSuggestions toolName={completedTool} onSelect={onSend} />
            )}
          </motion.div>
        );
      })}

      {limitMessage && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-1"
        >
          <span className="text-[11px] font-medium tracking-wide text-[#D4A843]">
            Ubunye
          </span>
          <div className="text-[15px] text-[#D4A843]/80 leading-relaxed border-l-2 border-[#D4A843]/20 pl-4">
            {limitMessage}
          </div>
          {!isAuthenticated ? (
            <div className="flex gap-2 mt-3 pl-4">
              <Link
                href="/login"
                className="flex items-center gap-1.5 px-4 py-2 bg-[#D4A843] text-black text-xs font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity"
              >
                <LogIn className="w-3.5 h-3.5" />
                Sign In
              </Link>
              <Link
                href="/register"
                className="flex items-center gap-1.5 px-4 py-2 border border-neutral-700 text-neutral-400 text-xs font-mono font-bold uppercase tracking-widest hover:border-[#D4A843]/50 hover:text-[#D4A843] transition-colors"
              >
                <UserPlus className="w-3.5 h-3.5" />
                Create Account
              </Link>
            </div>
          ) : (
            <div className="flex gap-2 mt-3 pl-4">
              <Link
                href="/pricing"
                className="flex items-center gap-1.5 px-4 py-2 bg-[#D4A843] text-black text-xs font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity"
              >
                <ArrowUpRight className="w-3.5 h-3.5" />
                Upgrade Plan
              </Link>
            </div>
          )}
        </motion.div>
      )}

      <AnimatePresence>
        {isLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-1"
          >
            <span className="text-[11px] font-medium tracking-wide text-[#D4A843]">
              Ubunye
            </span>
            <div className="flex items-center gap-1 pt-1">
              <span className="typing-dot" style={{ animationDelay: '0ms' }} />
              <span className="typing-dot" style={{ animationDelay: '160ms' }} />
              <span className="typing-dot" style={{ animationDelay: '320ms' }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {error && !limitReached && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-1"
        >
          <span className="text-[11px] font-medium tracking-wide text-[#D4A843]">
            Ubunye
          </span>
          <div className="text-[15px] text-neutral-500 leading-relaxed">
            I&apos;m experiencing connectivity issues. Please try again.
          </div>
          {/* A dead end here used to be a dead end for the booking too: the
              only link to the booking form lived in this assistant's system
              prompt, so a customer who got this message had nowhere to go. */}
          <div className="text-[14px] text-neutral-400 leading-relaxed pt-1">
            You can also{' '}
            <Link
              href="/book"
              className="text-[#D4A843] underline underline-offset-2 hover:opacity-80 transition-opacity"
            >
              book a shoot directly
            </Link>{' '}
            without me — pick your date, hours and type of shoot.
          </div>
        </motion.div>
      )}

      <div ref={messagesEndRef} />

      <style jsx>{`
        .typing-dot {
          display: inline-block;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background-color: #D4A843;
          animation: typing-bounce 1.2s ease-in-out infinite;
        }

        @keyframes typing-bounce {
          0%, 60%, 100% {
            transform: translateY(0);
            opacity: 0.4;
          }
          30% {
            transform: translateY(-6px);
            opacity: 1;
          }
        }
      `}</style>
    </motion.div>
  );
}
