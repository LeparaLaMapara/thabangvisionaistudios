'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUp, LogIn, UserPlus, ArrowUpRight } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { createClient } from '@/lib/supabase/client';
import { STUDIO } from '@/lib/constants';
import { EnergySphere } from '@/components/ubunye/EnergySphere';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

// ─── Types ──────────────────────────────────────────────────────────────────────

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isLimitMessage?: boolean;
};

type EnergyLevel = 'idle' | 'pulse' | 'calm';

// ─── Constants ──────────────────────────────────────────────────────────────────

const GUEST_LIMIT = 5;
const SESSION_STORAGE_KEY = 'ubunye_msg_count';
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

function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

// ─── Component ──────────────────────────────────────────────────────────────────

export default function UbunyeAIStudioPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [userName, setUserName] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [, setUserPlan] = useState<string>('free');
  const [dailyLimit, setDailyLimit] = useState<number>(20);
  const [dailyUsed, setDailyUsed] = useState<number>(0);
  const [guestMessageCount, setGuestMessageCount] = useState(0);
  const [limitReached, setLimitReached] = useState(false);
  const [energyLevel, setEnergyLevel] = useState<EnergyLevel>('idle');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // ─── Markdown components (stable ref) ──
  const mdComponents: Components = useMemo(() => ({
    a: ({ href, children }) => {
      if (href?.startsWith('/')) {
        return (
          <Link href={href} className="text-[#D4A843] hover:underline transition-colors">
            {children}
          </Link>
        );
      }
      return (
        <a href={href} className="text-[#D4A843] hover:underline transition-colors" target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    },
    strong: ({ children }) => <strong className="text-white font-semibold">{children}</strong>,
    em: ({ children }) => <em className="text-neutral-200">{children}</em>,
    p: ({ children }) => <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>,
    ul: ({ children }) => <ul className="ml-4 mb-3 space-y-1 list-disc">{children}</ul>,
    ol: ({ children }) => <ol className="ml-4 mb-3 space-y-1 list-decimal">{children}</ol>,
    li: ({ children }) => <li className="text-neutral-300 leading-relaxed">{children}</li>,
    h1: ({ children }) => <h1 className="text-white font-semibold text-lg mt-5 mb-2">{children}</h1>,
    h2: ({ children }) => <h2 className="text-white font-semibold text-base mt-5 mb-2">{children}</h2>,
    h3: ({ children }) => <h3 className="text-white font-semibold mt-4 mb-2">{children}</h3>,
    h4: ({ children }) => <h4 className="text-neutral-200 font-semibold mt-3 mb-1">{children}</h4>,
    code: ({ children, className }) => {
      if (className?.includes('language-')) {
        return (
          <code className="block bg-neutral-900 rounded-lg px-4 py-3 my-3 text-[13px] font-mono text-neutral-300 overflow-x-auto">
            {children}
          </code>
        );
      }
      return (
        <code className="bg-neutral-800 px-1.5 py-0.5 rounded text-[13px] font-mono text-[#D4A843]">
          {children}
        </code>
      );
    },
    pre: ({ children }) => <pre className="my-3">{children}</pre>,
    blockquote: ({ children }) => (
      <blockquote className="border-l-2 border-[#D4A843]/30 pl-4 my-3 text-neutral-400">
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
  }, [messages, isTyping]);

  // ─── Message handling ──
  const addLimitMessage = useCallback((content: string) => {
    setMessages(prev => [...prev, {
      id: generateId(),
      role: 'assistant',
      content,
      timestamp: new Date(),
      isLimitMessage: true,
    }]);
    setLimitReached(true);
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || limitReached) return;

    if (!isAuthenticated && guestMessageCount >= GUEST_LIMIT) {
      addLimitMessage("You've used your 5 free messages. Sign in to continue chatting with Ubunye.");
      return;
    }

    const userMsg: Message = { id: generateId(), role: 'user', content: text.trim(), timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);
    setEnergyLevel('pulse');

    let newGuestCount = guestMessageCount;
    if (!isAuthenticated) {
      newGuestCount = guestMessageCount + 1;
      setGuestMessageCount(newGuestCount);
      try { sessionStorage.setItem(SESSION_STORAGE_KEY, String(newGuestCount)); } catch { /* SSR */ }
    }

    const isFirstGuestMessage = !isAuthenticated && newGuestCount === 1;

    try {
      const chatMessages = [...messages, userMsg]
        .filter(m => !m.isLimitMessage)
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      const res = await fetch('/api/ubunye-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: text.trim(),
          messages: chatMessages,
          ...(!isAuthenticated && { sessionMessageCount: newGuestCount - 1 }),
          ...(isFirstGuestMessage && { isFirstGuestMessage: true }),
        }),
      });

      if (res.status === 429) {
        const data = await res.json();
        if (data.error === 'limit_reached') {
          addLimitMessage(
            data.plan === 'guest'
              ? "You've used your 5 free messages. Sign in to continue chatting with Ubunye."
              : `You've reached your daily limit of ${data.limit} messages on the ${data.plan} plan. Upgrade for more messages.`
          );
          setIsTyping(false);
          setEnergyLevel('idle');
          return;
        }
        throw new Error('Rate limited');
      }

      if (!res.ok) throw new Error('Failed to get response');

      // Create assistant message placeholder for streaming
      const assistantId = generateId();
      setMessages(prev => [...prev, {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
      }]);

      // Read SSE stream
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) throw new Error('No response body');

      let accumulated = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') break;
            try {
              const parsed = JSON.parse(data);
              if (typeof parsed === 'string') {
                accumulated += parsed;
                setMessages(prev => prev.map(m =>
                  m.id === assistantId ? { ...m, content: accumulated } : m
                ));
              } else if (parsed?.error) {
                // Server-side stream error
                throw new Error(parsed.error);
              }
            } catch (e) {
              // Ignore JSON parse errors for partial chunks, but rethrow actual errors
              if (e instanceof Error && e.message === 'Stream error') throw e;
            }
          }
        }
      }

      if (isAuthenticated) setDailyUsed(prev => prev + 1);

      // If no content was accumulated (empty stream), show fallback
      if (!accumulated) {
        setMessages(prev => prev.map(m =>
          m.id === assistantId ? { ...m, content: "I couldn't process that request. Please try again." } : m
        ));
      }
    } catch {
      setMessages(prev => [...prev, {
        id: generateId(),
        role: 'assistant',
        content: "I'm experiencing connectivity issues. Please check that the AI service is configured and try again.",
        timestamp: new Date(),
      }]);
    } finally {
      setIsTyping(false);
      setEnergyLevel('calm');
      setTimeout(() => setEnergyLevel('idle'), 2000);
    }
  }, [messages, isAuthenticated, guestMessageCount, limitReached, addLimitMessage]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const greeting = getGreeting();
  const displayName = userName || 'Creator';
  const userInitial = (userName?.[0] || 'Y').toUpperCase();
  const hasMessages = messages.length > 0;

  return (
    <div className="bg-[#050505] text-white" style={{ paddingTop: HEADER_HEIGHT, height: '100vh' }}>
      <div className="flex flex-col h-full max-w-3xl mx-auto px-4 md:px-6">

        {/* ── Empty state: sphere + greeting + chips ── */}
        <AnimatePresence mode="wait">
          {!hasMessages && (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.2 } }}
              className="flex-1 flex flex-col items-center justify-center"
            >
              {/* Sphere — hidden on mobile */}
              <div className="hidden md:block w-[160px] h-[160px] mb-8 opacity-60">
                <EnergySphere energyLevel={energyLevel} className="w-full h-full" />
              </div>

              {/* Greeting */}
              <p className="text-xs text-neutral-500 tracking-wide mb-3">
                {greeting}, {displayName}
              </p>
              <h1 className="text-xl md:text-2xl font-medium text-neutral-200 mb-8">
                What can I do <span className="text-[#D4A843]">for you?</span>
              </h1>

              {/* Quick actions */}
              <div className="flex flex-wrap justify-center gap-2 max-w-lg">
                {QUICK_ACTIONS.map((action) => (
                  <button
                    key={action.label}
                    onClick={() => sendMessage(action.prompt)}
                    className="px-4 py-2 text-sm text-neutral-400 rounded-full border border-neutral-800 hover:border-[#D4A843]/50 hover:text-[#D4A843] transition-colors"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Messages ── */}
        {hasMessages && (
          <div className="flex-1 overflow-y-auto py-6 space-y-6 scrollbar-thin">
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="flex gap-3"
              >
                {/* Avatar */}
                <div className="flex-shrink-0 mt-1">
                  {msg.role === 'assistant' ? (
                    <div className="w-7 h-7 rounded-full bg-[#D4A843]/15 flex items-center justify-center">
                      <span className="text-[11px] font-bold text-[#D4A843]">U</span>
                    </div>
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-neutral-800 flex items-center justify-center">
                      <span className="text-[11px] font-medium text-neutral-400">{userInitial}</span>
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  {/* Name */}
                  <div className="text-[11px] font-medium mb-1.5">
                    {msg.role === 'assistant' ? (
                      <span className="text-[#D4A843]">Ubunye</span>
                    ) : (
                      <span className="text-neutral-500">{displayName}</span>
                    )}
                  </div>

                  {/* Message body */}
                  {msg.role === 'user' ? (
                    <div className="text-[15px] text-white leading-relaxed whitespace-pre-wrap">
                      {msg.content}
                    </div>
                  ) : msg.isLimitMessage ? (
                    <div>
                      <div className="text-[15px] text-[#D4A843] leading-relaxed border-l-2 border-[#D4A843]/30 pl-4">
                        {msg.content}
                      </div>
                      {/* Limit CTAs */}
                      {!isAuthenticated ? (
                        <div className="flex gap-2 mt-4">
                          <Link
                            href="/login"
                            className="flex items-center gap-1.5 px-4 py-2 bg-[#D4A843] text-black text-xs font-semibold rounded-full hover:bg-[#E8C96A] transition-colors"
                          >
                            <LogIn className="w-3.5 h-3.5" />
                            Sign In
                          </Link>
                          <Link
                            href="/register"
                            className="flex items-center gap-1.5 px-4 py-2 border border-neutral-700 text-neutral-300 text-xs font-semibold rounded-full hover:border-[#D4A843]/50 hover:text-[#D4A843] transition-colors"
                          >
                            <UserPlus className="w-3.5 h-3.5" />
                            Create Account
                          </Link>
                        </div>
                      ) : (
                        <div className="flex gap-2 mt-4">
                          <Link
                            href="/pricing"
                            className="flex items-center gap-1.5 px-4 py-2 bg-[#D4A843] text-black text-xs font-semibold rounded-full hover:bg-[#E8C96A] transition-colors"
                          >
                            <ArrowUpRight className="w-3.5 h-3.5" />
                            Upgrade Plan
                          </Link>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-[15px] text-neutral-300 leading-relaxed">
                      <ReactMarkdown components={mdComponents}>
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}

            {/* Typing indicator */}
            {isTyping && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex gap-3"
              >
                <div className="flex-shrink-0 mt-1">
                  <div className="w-7 h-7 rounded-full bg-[#D4A843]/15 flex items-center justify-center">
                    <span className="text-[11px] font-bold text-[#D4A843]">U</span>
                  </div>
                </div>
                <div className="pt-2">
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-neutral-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-1.5 h-1.5 rounded-full bg-neutral-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-1.5 h-1.5 rounded-full bg-neutral-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </motion.div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}

        {/* ── Input bar ── */}
        <div className="pb-4 pt-2 flex-shrink-0">
          <form onSubmit={handleSubmit}>
            <div className={`flex items-center rounded-2xl bg-neutral-900 transition-all ${
              limitReached ? 'opacity-40' : 'focus-within:ring-1 focus-within:ring-neutral-700'
            }`}>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={limitReached ? 'Message limit reached' : 'Message Ubunye...'}
                disabled={isTyping || limitReached}
                className="flex-1 bg-transparent px-5 py-3.5 text-[15px] text-white placeholder-neutral-600 outline-none disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!input.trim() || isTyping || limitReached}
                className="mr-2 w-9 h-9 rounded-full flex items-center justify-center transition-colors disabled:opacity-20 bg-neutral-800 hover:bg-[#D4A843] hover:text-black text-neutral-400"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
            </div>
          </form>

          {/* Remaining messages */}
          {!limitReached && (
            <div className="text-center mt-2">
              {!isAuthenticated ? (
                <span className="text-[11px] text-neutral-600">
                  {GUEST_LIMIT - guestMessageCount} free message{GUEST_LIMIT - guestMessageCount !== 1 ? 's' : ''} remaining
                </span>
              ) : dailyLimit !== -1 ? (
                <span className="text-[11px] text-neutral-600">
                  {Math.max(0, dailyLimit - dailyUsed)} message{Math.max(0, dailyLimit - dailyUsed) !== 1 ? 's' : ''} remaining today
                </span>
              ) : null}
            </div>
          )}

          {/* Footer */}
          <p className="text-center text-[10px] text-neutral-700 mt-3">
            Powered by Ubunye AI
          </p>
        </div>
      </div>
    </div>
  );
}
