'use client';

import { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LogIn, UserPlus, ArrowUpRight, RotateCcw } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import Link from 'next/link';
import type { UIMessage } from 'ai';
import { FollowUpSuggestions } from '@/components/ubunye/FollowUpSuggestions';
import { ApprovalCard } from '@/components/ubunye/ApprovalCard';
import { STUDIO } from '@/lib/constants';

const TOOL_LABELS: Record<string, string> = {
  search_creators: 'Searching creators',
  get_creator_detail: 'Getting creator details',
  calculate_booking_quote: 'Calculating quote',
  check_availability: 'Checking availability',
  prepare_gear_booking: 'Preparing your hire for approval',
  prepare_service_booking: 'Preparing your booking for approval',
  get_pending_proposal: 'Loading your proposal',
  my_bookings: 'Checking your bookings',
  improve_brief: 'Analyzing your brief',
};

function getMessageText(msg: UIMessage): string {
  return msg.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map(p => p.text)
    .join('');
}

/** A tool part as the AI SDK (v6) streams it: type `tool-<name>`, with a state. */
interface ToolPart {
  type: string;
  state?: string;
  output?: unknown;
}

const toolParts = (msg: UIMessage): ToolPart[] =>
  (msg.parts as unknown as ToolPart[]).filter((p) => typeof p.type === 'string' && p.type.startsWith('tool-'));

const toolName = (p: ToolPart): string => p.type.slice('tool-'.length);

function getToolStates(msg: UIMessage) {
  return toolParts(msg)
    .filter((p) => p.state !== 'output-available' && p.state !== 'output-error')
    .map((p) => ({ name: toolName(p), label: TOOL_LABELS[toolName(p)] || 'Processing' }));
}

function getLastCompletedTool(msg: UIMessage): { name: string; output: unknown } | null {
  const done = toolParts(msg).filter((p) => p.state === 'output-available');
  if (done.length === 0) return null;
  const last = done[done.length - 1];
  return { name: toolName(last), output: last.output };
}

/** The latest proposal in this message that is waiting for approval, if any. */
function getProposalId(msg: UIMessage): string | null {
  const ids = toolParts(msg)
    .filter((p) => p.state === 'output-available')
    .map((p) => p.output as { approval_required?: boolean; proposal_id?: unknown } | undefined)
    .filter((o): o is { approval_required: boolean; proposal_id: string } => Boolean(o?.approval_required) && typeof o?.proposal_id === 'string');
  return ids.length > 0 ? ids[ids.length - 1].proposal_id : null;
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
  /** Re-sends the last message after a failed request. Omit to hide the button. */
  onRetry?: () => void;
  /** People (roles_v1) is on: the fallback link goes to /people, never the old /book. */
  people?: boolean;
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
  onRetry,
  people = false,
}: ChatMessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // One card per proposal: when a later message mentions the same proposal
  // (get_pending_proposal), only the latest mention shows the card.
  const cardAt = new Map<string, number>();
  if (isAuthenticated) {
    messages.forEach((m, i) => {
      const id = m.role === 'assistant' ? getProposalId(m) : null;
      if (id) cardAt.set(id, i);
    });
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      // A chat transcript: screen readers announce new messages as they land.
      // aria-busy holds the announcement until a streamed reply is complete,
      // instead of reading it out token by token.
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-label="Conversation with Ubunye"
      aria-busy={isLoading}
      tabIndex={0}
      className="flex-1 overflow-y-auto focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#D4A843]/40 py-6 space-y-4 md:space-y-6 scrollbar-thin scrollbar-thumb-neutral-800 scrollbar-track-transparent"
    >
      {messages.map((msg, msgIndex) => {
        const text = getMessageText(msg);
        const isAssistant = msg.role === 'assistant';
        const pendingTools = isAssistant ? getToolStates(msg) : [];
        const isLastAssistant = isAssistant && msgIndex === messages.length - 1;
        const completedTool = isLastAssistant && pendingTools.length === 0 ? getLastCompletedTool(msg) : null;
        const mentioned = isAssistant && isAuthenticated ? getProposalId(msg) : null;
        const proposalId = mentioned && cardAt.get(mentioned) === msgIndex ? mentioned : null;

        return (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="space-y-1"
          >
            <span className={`text-xs font-medium tracking-wide ${
              isAssistant ? 'text-[#D4A843]' : 'text-neutral-400'
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
                <div aria-hidden="true" className="w-3 h-3 border-2 border-[#D4A843]/30 border-t-[#D4A843] rounded-full animate-spin" />
                <span className="text-[12px] text-[#D4A843] font-mono">
                  {pendingTools[0].label}...
                </span>
              </div>
            )}

            {proposalId && <ApprovalCard key={proposalId} proposalId={proposalId} />}

            {completedTool && (
              <FollowUpSuggestions toolName={completedTool.name} output={completedTool.output} onSelect={onSend} />
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
          <span className="text-xs font-medium tracking-wide text-[#D4A843]">
            Ubunye
          </span>
          <div className="text-[15px] text-[#D4A843]/80 leading-relaxed border-l-2 border-[#D4A843]/20 pl-4">
            {limitMessage}
          </div>
          {!isAuthenticated ? (
            <div className="flex gap-2 mt-3 pl-4">
              <Link
                href="/login"
                className="flex items-center gap-1.5 min-h-[44px] px-4 py-2 bg-[#D4A843] text-black text-xs font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity"
              >
                <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
                Sign In
              </Link>
              <Link
                href="/register"
                className="flex items-center gap-1.5 min-h-[44px] px-4 py-2 border border-neutral-700 text-neutral-400 text-xs font-mono font-bold uppercase tracking-widest hover:border-[#D4A843]/50 hover:text-[#D4A843] transition-colors"
              >
                <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
                Create Account
              </Link>
            </div>
          ) : STUDIO.subscriptions.enabled ? (
            <div className="flex gap-2 mt-3 pl-4">
              <Link
                href="/pricing"
                className="flex items-center gap-1.5 min-h-[44px] px-4 py-2 bg-[#D4A843] text-black text-xs font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity"
              >
                <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
                Upgrade Plan
              </Link>
            </div>
          ) : null}
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
            <span className="text-xs font-medium tracking-wide text-[#D4A843]">
              Ubunye
            </span>
            <div className="flex items-center gap-1 pt-1" role="status">
              <span className="sr-only">Ubunye is replying…</span>
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
          role="alert"
        >
          <span className="text-xs font-medium tracking-wide text-[#D4A843]">
            Ubunye
          </span>
          <div className="text-[15px] text-neutral-400 leading-relaxed">
            I couldn&apos;t get a reply through. Your message is safe — try sending it again.
          </div>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              disabled={isLoading}
              className="mt-2 inline-flex items-center gap-2 min-h-[44px] px-4 border border-[#D4A843]/40 text-[#D4A843] text-xs font-mono font-bold uppercase tracking-widest hover:bg-[#D4A843]/10 transition-colors disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D4A843]"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              Retry
            </button>
          )}
          {/* A dead end here used to be a dead end for the booking too: the
              only link to the booking form lived in this assistant's system
              prompt, so a customer who got this message had nowhere to go. */}
          {people ? (
            <div className="text-[14px] text-neutral-400 leading-relaxed pt-1">
              You can also{' '}
              <Link
                href="/people"
                className="text-[#D4A843] underline underline-offset-2 hover:opacity-80 transition-opacity"
              >
                choose a person yourself
              </Link>{' '}
              on People. You see the price before you send a request.
            </div>
          ) : (
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
          )}
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
