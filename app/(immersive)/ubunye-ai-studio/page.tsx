'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useSearchParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUp, LogIn, UserPlus, ArrowUpRight } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { createClient } from '@/lib/supabase/client';
import { STUDIO } from '@/lib/constants';
import { GoldenSphere } from '@/components/ubunye/GoldenSphere';
import Link from 'next/link';

// ─── Constants ──────────────────────────────────────────────────────────────────

const GUEST_LIMIT = 2;
const SESSION_STORAGE_KEY = 'ubunye_msg_count';
const CHAT_HISTORY_KEY = 'ubunye_chat_history';
const HEADER_HEIGHT = '5rem';

const QUICK_ACTIONS = [
  { label: 'Plan a shoot', prompt: `Help me plan a professional shoot in ${STUDIO.location.city}. I need a shot list, crew recommendations, and equipment.` },
  { label: 'Find gear', prompt: `What camera and lens packages do you recommend for a cinematic corporate video in ${STUDIO.location.country}?` },
  { label: 'Hire crew', prompt: `I need to hire a film crew for a 2-day shoot in ${STUDIO.location.city}. What roles do I need and what are typical rates in ${STUDIO.currency.code}?` },
  { label: 'Get pricing', prompt: `Give me a breakdown of typical production costs in ${STUDIO.currency.code} for a 1-minute commercial in ${STUDIO.location.country}.` },
];

// ─── Helpers ────────────────────────────────────────────────────────────────────

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// ─── Stagger animation variants ─────────────────────────────────────────────────

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.15 + i * 0.15, duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] as const },
  }),
};

// ─── Component ──────────────────────────────────────────────────────────────────

export default function UbunyeAIStudioPage() {
  const [input, setInput] = useState('');
  const [userName, setUserName] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [, setUserPlan] = useState<string>('free');
  const [dailyLimit, setDailyLimit] = useState<number>(20);
  const [dailyUsed, setDailyUsed] = useState<number>(0);
  const [guestMessageCount, setGuestMessageCount] = useState(0);
  const [limitReached, setLimitReached] = useState(false);
  const [limitMessage, setLimitMessage] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const guestCountRef = useRef(0);
  const isAuthenticatedRef = useRef(false);

  // Keep refs in sync
  useEffect(() => { guestCountRef.current = guestMessageCount; }, [guestMessageCount]);
  useEffect(() => { isAuthenticatedRef.current = isAuthenticated; }, [isAuthenticated]);

  // ─── Transport with dynamic body ──
  const transportRef = useRef(
    new DefaultChatTransport({
      api: '/api/ubunye-chat',
      body: () => ({
        ...(!isAuthenticatedRef.current && { sessionMessageCount: guestCountRef.current }),
        ...(!isAuthenticatedRef.current && guestCountRef.current === 0 && { isFirstGuestMessage: true }),
      }),
    })
  );

  // ─── Vercel AI SDK useChat (v4 API) ──
  const {
    messages,
    setMessages,
    sendMessage,
    status,
    error,
  } = useChat({
    transport: transportRef.current,
    onFinish: () => {
      if (isAuthenticatedRef.current) setDailyUsed(prev => prev + 1);
    },
    onError: (err) => {
      const msg = err?.message;
      if (msg?.includes('limit_reached')) {
        try {
          const data = JSON.parse(msg);
          const limitMsg = data.plan === 'guest'
            ? "You've used your 2 free messages. Sign in to continue chatting with Ubunye."
            : `You've reached your daily limit of ${data.limit} messages on the ${data.plan} plan. Upgrade for more messages.`;
          setLimitMessage(limitMsg);
          setLimitReached(true);
        } catch {
          // Non-parseable error, ignore
        }
      }
    },
  });

  const isLoading = status === 'submitted' || status === 'streaming';

  // ─── Persist chat to sessionStorage ──
  // Save messages whenever they change (so session survives login redirect)
  useEffect(() => {
    if (messages.length > 0) {
      try {
        // Only save text parts (tool parts don't serialize well)
        const toSave = messages.map(m => ({
          id: m.id,
          role: m.role,
          parts: m.parts.filter(p => p.type === 'text'),
        }));
        sessionStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(toSave));
      } catch { /* quota exceeded or SSR */ }
    }
  }, [messages]);

  // Restore messages from sessionStorage on mount
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    try {
      const saved = sessionStorage.getItem(CHAT_HISTORY_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
        }
      }
    } catch { /* SSR or invalid JSON */ }
  }, [setMessages]);

  // Track guest message sends
  const trackGuestMessage = useCallback(() => {
    if (!isAuthenticated) {
      const newCount = guestMessageCount + 1;
      setGuestMessageCount(newCount);
      try { sessionStorage.setItem(SESSION_STORAGE_KEY, String(newCount)); } catch { /* SSR */ }

      if (newCount >= GUEST_LIMIT) {
        setLimitMessage("You've used your 2 free messages. Sign in to continue chatting with Ubunye.");
        setLimitReached(true);
      }
    }
  }, [isAuthenticated, guestMessageCount]);

  // ─── Markdown components (stable ref) ──
  const mdComponents: Components = useMemo(() => ({
    a: ({ href, children }) => {
      if (href?.startsWith('/')) {
        return (
          <Link href={href} className="text-[#D4A843] underline decoration-[#D4A843]/30 underline-offset-2 hover:decoration-[#D4A843] transition-colors">
            {children}
          </Link>
        );
      }
      const safe = (() => { try { return ['http:', 'https:'].includes(new URL(href ?? '').protocol); } catch { return false; } })();
      if (!href || !safe) {
        return <span className="text-[#D4A843]">{children}</span>;
      }
      return (
        <a href={href} className="text-[#D4A843] underline decoration-[#D4A843]/30 underline-offset-2 hover:decoration-[#D4A843] transition-colors" target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    },
    strong: ({ children }) => <strong className="text-white font-semibold">{children}</strong>,
    em: ({ children }) => <em className="text-neutral-200">{children}</em>,
    p: ({ children }) => <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>,
    ul: ({ children }) => <ul className="ml-4 mb-3 space-y-1 list-disc">{children}</ul>,
    ol: ({ children }) => <ol className="ml-4 mb-3 space-y-1 list-decimal">{children}</ol>,
    li: ({ children }) => <li className="text-neutral-400 leading-relaxed">{children}</li>,
    h1: ({ children }) => <h1 className="text-white font-semibold text-lg mt-5 mb-2">{children}</h1>,
    h2: ({ children }) => <h2 className="text-white font-semibold text-base mt-5 mb-2">{children}</h2>,
    h3: ({ children }) => <h3 className="text-white font-semibold mt-4 mb-2">{children}</h3>,
    h4: ({ children }) => <h4 className="text-neutral-200 font-semibold mt-3 mb-1">{children}</h4>,
    code: ({ children, className }) => {
      if (className?.includes('language-')) {
        return (
          <code className="block bg-neutral-900/80 rounded-lg px-4 py-3 my-3 text-[13px] font-mono text-neutral-300 overflow-x-auto border border-white/5">
            {children}
          </code>
        );
      }
      return (
        <code className="bg-neutral-800/80 px-1.5 py-0.5 rounded text-[13px] font-mono text-[#D4A843]">
          {children}
        </code>
      );
    },
    pre: ({ children }) => <pre className="my-3">{children}</pre>,
    blockquote: ({ children }) => (
      <blockquote className="border-l-2 border-[#D4A843]/30 pl-4 my-3 text-neutral-500">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="border-neutral-800 my-4" />,
    table: ({ children }) => (
      <div className="overflow-x-auto my-3">
        <table className="w-full text-sm border-collapse">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="border-b border-neutral-700">{children}</thead>,
    th: ({ children }) => <th className="text-left text-neutral-300 font-semibold px-3 py-2 text-sm">{children}</th>,
    td: ({ children }) => <td className="px-3 py-2 border-b border-neutral-800/50 text-sm">{children}</td>,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  // ─── Auth & session ──
  useEffect(() => {
    const supabase = createClient();

    try {
      const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (stored) setGuestMessageCount(parseInt(stored, 10) || 0);
    } catch { /* SSR safety */ }

    supabase.auth.getUser().then(async ({ data }) => {
      if (data.user) {
        setIsAuthenticated(true);
        const meta = data.user.user_metadata;
        setUserName(meta?.display_name || meta?.full_name || meta?.name || null);

        try {
          const res = await fetch('/api/subscriptions/me');
          const sub = await res.json();
          if (sub?.subscription_plans?.slug) {
            const slug = sub.subscription_plans.slug;
            setUserPlan(slug);
            const limits: Record<string, number> = { free: 20, starter: 20, pro: 100, 'pro-creator': 100, studio: -1 };
            setDailyLimit(limits[slug] ?? 20);
          }
        } catch { /* fallback to free */ }
      }
    });
  }, []);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // ─── Send message helper ──
  const doSend = useCallback((text: string) => {
    if (!text.trim() || limitReached || isLoading) return;
    if (!isAuthenticated && guestMessageCount >= GUEST_LIMIT) {
      setLimitMessage("You've used your 2 free messages. Sign in to continue chatting with Ubunye.");
      setLimitReached(true);
      return;
    }
    trackGuestMessage();
    sendMessage({ text });
  }, [limitReached, isLoading, isAuthenticated, guestMessageCount, trackGuestMessage, sendMessage]);

  // ─── Form submit ──
  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    doSend(input);
    setInput('');
  }, [input, doSend]);

  // ─── Quick action ──
  const sendQuickAction = useCallback((text: string) => {
    doSend(text);
  }, [doSend]);

  // ─── Auto-send from ?prompt query param ──
  const searchParams = useSearchParams();
  const router = useRouter();
  const promptSentRef = useRef(false);

  useEffect(() => {
    const promptParam = searchParams.get('prompt');
    if (promptParam && !promptSentRef.current && !isLoading && messages.length === 0) {
      promptSentRef.current = true;
      doSend(promptParam);
      router.replace('/ubunye-ai-studio', { scroll: false });
    }
  }, [searchParams, doSend, isLoading, messages.length, router]);

  const greeting = getGreeting();
  const displayName = userName || 'Creator';
  const hasMessages = messages.length > 0;

  // Remaining messages count
  const remaining = !isAuthenticated
    ? GUEST_LIMIT - guestMessageCount
    : dailyLimit === -1 ? -1 : Math.max(0, dailyLimit - dailyUsed);

  // Extract text content from UIMessage parts
  const getMessageText = (msg: typeof messages[0]): string => {
    return msg.parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map(p => p.text)
      .join('');
  };

  // Tool invocation labels
  const toolLabels: Record<string, string> = {
    search_creators: 'Searching creators',
    get_creator_detail: 'Getting creator details',
    submit_creator_request: 'Submitting booking request',
  };

  // Check if message has active (pending) tool calls
  const getToolStates = (msg: typeof messages[0]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parts = msg.parts as any[];
    const toolCalls = parts.filter(p => p.type === 'tool-call');
    const toolResults = parts.filter(p => p.type === 'tool-result');
    const completedIds = new Set(toolResults.map(p => p.toolCallId));

    return toolCalls
      .filter(p => !completedIds.has(p.toolCallId))
      .map(p => ({
        name: p.toolName as string,
        label: toolLabels[p.toolName as string] || 'Processing',
      }));
  };

  return (
    <div className="bg-[#050505] text-white" style={{ paddingTop: HEADER_HEIGHT, height: '100vh' }}>
      <div className="flex flex-col h-full w-full max-w-[680px] mx-auto px-4 md:px-6">

        {/* ── Landing state: sphere + greeting + headline + chips ── */}
        <AnimatePresence mode="wait">
          {!hasMessages && (
            <motion.div
              key="landing"
              initial={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.25 } }}
              className="flex-1 flex flex-col items-center justify-center gap-0"
            >
              {/* Golden sphere — smaller on mobile */}
              <motion.div
                custom={0}
                initial="hidden"
                animate="visible"
                variants={fadeUp}
                className="w-[100px] h-[100px] md:w-[160px] md:h-[160px] mb-6 md:mb-8"
              >
                <GoldenSphere className="w-full h-full" />
              </motion.div>

              {/* Greeting line */}
              <motion.p
                custom={1}
                initial="hidden"
                animate="visible"
                variants={fadeUp}
                className="text-xs md:text-sm text-neutral-500 tracking-wide mb-2"
              >
                {greeting}, {displayName}
              </motion.p>

              {/* Headline */}
              <motion.h1
                custom={2}
                initial="hidden"
                animate="visible"
                variants={fadeUp}
                className="text-xl md:text-3xl font-medium text-neutral-200 mb-8 md:mb-10 text-center"
              >
                What can I help you <span className="text-[#D4A843]">create?</span>
              </motion.h1>

              {/* Quick-action chips */}
              <motion.div
                custom={3}
                initial="hidden"
                animate="visible"
                variants={fadeUp}
                className="flex flex-wrap justify-center gap-2 md:gap-3 max-w-md md:max-w-lg"
              >
                {QUICK_ACTIONS.map((action) => (
                  <button
                    key={action.label}
                    onClick={() => sendQuickAction(action.prompt)}
                    className="px-3 py-1.5 md:px-4 md:py-2 text-xs md:text-sm text-neutral-500 rounded-full border border-neutral-800 hover:border-[#D4A843]/50 hover:text-[#D4A843] transition-all duration-200 hover:bg-[#D4A843]/5"
                  >
                    {action.label}
                  </button>
                ))}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Messages area ── */}
        {hasMessages && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="flex-1 overflow-y-auto py-6 space-y-6 scrollbar-thin scrollbar-thumb-neutral-800 scrollbar-track-transparent"
          >
            {messages.map((msg) => {
              const text = getMessageText(msg);
              const isAssistant = msg.role === 'assistant';
              const pendingTools = isAssistant ? getToolStates(msg) : [];

              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: 'easeOut' }}
                  className="space-y-1"
                >
                  {/* Label */}
                  <span className={`text-[11px] font-medium tracking-wide ${
                    isAssistant ? 'text-[#D4A843]' : 'text-neutral-600'
                  }`}>
                    {isAssistant ? 'Ubunye' : 'You'}
                  </span>

                  {/* Body */}
                  {msg.role === 'user' ? (
                    <div className="text-[15px] text-neutral-200 leading-relaxed whitespace-pre-wrap">
                      {text}
                    </div>
                  ) : (
                    <div className="text-[15px] text-neutral-400 leading-relaxed">
                      <ReactMarkdown components={mdComponents}>
                        {text}
                      </ReactMarkdown>
                    </div>
                  )}

                  {/* Tool invocation indicator */}
                  {pendingTools.length > 0 && (
                    <div className="flex items-center gap-2 pt-1">
                      <div className="w-3 h-3 border-2 border-[#D4A843]/30 border-t-[#D4A843] rounded-full animate-spin" />
                      <span className="text-[12px] text-[#D4A843]/70 font-mono">
                        {pendingTools[0].label}...
                      </span>
                    </div>
                  )}
                </motion.div>
              );
            })}

            {/* Limit message */}
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
                      className="flex items-center gap-1.5 px-4 py-2 bg-[#D4A843] text-black text-xs font-semibold rounded-full hover:bg-[#E8C96A] transition-colors"
                    >
                      <LogIn className="w-3.5 h-3.5" />
                      Sign In
                    </Link>
                    <Link
                      href="/register"
                      className="flex items-center gap-1.5 px-4 py-2 border border-neutral-700 text-neutral-400 text-xs font-semibold rounded-full hover:border-[#D4A843]/50 hover:text-[#D4A843] transition-colors"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      Create Account
                    </Link>
                  </div>
                ) : (
                  <div className="flex gap-2 mt-3 pl-4">
                    <Link
                      href="/pricing"
                      className="flex items-center gap-1.5 px-4 py-2 bg-[#D4A843] text-black text-xs font-semibold rounded-full hover:bg-[#E8C96A] transition-colors"
                    >
                      <ArrowUpRight className="w-3.5 h-3.5" />
                      Upgrade Plan
                    </Link>
                  </div>
                )}
              </motion.div>
            )}

            {/* Three-dot typing indicator in gold */}
            {isLoading && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
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

            {/* Error display */}
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
              </motion.div>
            )}

            <div ref={messagesEndRef} />
          </motion.div>
        )}

        {/* ── Input bar + footer ── */}
        <div className="pb-4 pt-3 flex-shrink-0">
          <form onSubmit={handleSubmit}>
            <div className={`flex items-center rounded-2xl bg-neutral-900/80 border border-transparent transition-all duration-200 ${
              limitReached
                ? 'opacity-40'
                : 'focus-within:border-[#D4A843]/40 focus-within:ring-1 focus-within:ring-[#D4A843]/20'
            }`}>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={limitReached ? 'Message limit reached' : 'Message Ubunye...'}
                disabled={isLoading || limitReached}
                className="flex-1 bg-transparent px-5 py-3.5 text-[15px] text-white placeholder-neutral-600 outline-none disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!input.trim() || isLoading || limitReached}
                className={`mr-2 w-9 h-9 rounded-full flex items-center justify-center transition-all duration-200 ${
                  input.trim() && !isLoading && !limitReached
                    ? 'bg-[#D4A843] text-black hover:bg-[#E8C96A] scale-100'
                    : 'bg-neutral-800 text-neutral-600 opacity-50'
                }`}
              >
                <ArrowUp className="w-4 h-4" />
              </button>
            </div>
          </form>

          {/* X free messages remaining */}
          {!limitReached && remaining !== -1 && (
            <p className="text-center mt-2.5 text-[11px] text-neutral-600">
              {remaining} free message{remaining !== 1 ? 's' : ''} remaining
              {isAuthenticated && ' today'}
            </p>
          )}

          {/* Powered by */}
          <p className="text-center text-[10px] text-neutral-700 mt-2.5">
            Powered by Ubunye AI
          </p>
        </div>
      </div>

      {/* ── Typing dot animation ── */}
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
    </div>
  );
}
