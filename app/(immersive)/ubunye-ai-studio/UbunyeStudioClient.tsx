'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useSearchParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import type { Components } from 'react-markdown';
import { chatMarkdownComponents } from '@/components/ubunye/chatMarkdown';
import { createClient } from '@/lib/supabase/client';
import { STUDIO, UBUNYE_QUICK_ACTIONS } from '@/lib/constants';
import { GoldenSphere } from '@/components/ubunye/GoldenSphere';
import { ChatMessageList } from '@/components/ubunye/ChatMessageList';
import { ChatInputBar } from '@/components/ubunye/ChatInputBar';
import type { StudioContext, OrbState } from '@/types/ubunye';
import { formatRate } from '@/lib/format/money';

// ─── Constants ──────────────────────────────────────────────────────────────────

const GUEST_LIMIT = 5;
const SESSION_STORAGE_KEY = 'ubunye_msg_count';
const CHAT_HISTORY_KEY = 'ubunye_chat_history';
const HEADER_HEIGHT = '5rem';

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
    transition: { delay: 0.1 + i * 0.12, duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] as const },
  }),
};

// ─── Component ──────────────────────────────────────────────────────────────────

interface UbunyeStudioClientProps {
  context: StudioContext;
}

export default function UbunyeStudioClient({ context }: UbunyeStudioClientProps) {
  const [input, setInput] = useState('');
  const [userName, setUserName] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [, setUserPlan] = useState<string>('free');
  const [dailyLimit, setDailyLimit] = useState<number>(20);
  const [dailyUsed, setDailyUsed] = useState<number>(0);
  const [guestMessageCount, setGuestMessageCount] = useState(0);
  const [limitReached, setLimitReached] = useState(false);
  const [limitMessage, setLimitMessage] = useState<string | null>(null);
  const guestCountRef = useRef(0);
  const isAuthenticatedRef = useRef(false);
  // The last text handed to the model. If the request fails it goes back into
  // the input box, so a dropped connection never eats what the customer typed.
  const lastSentRef = useRef('');

  // Keep refs in sync
  useEffect(() => { guestCountRef.current = guestMessageCount; }, [guestMessageCount]);
  useEffect(() => { isAuthenticatedRef.current = isAuthenticated; }, [isAuthenticated]);

  // ─── Pre-selected creator from URL ──
  const creatorIdRef = useRef<string | null>(null);

  // ─── Conversation ID (persists across messages in one session) ──
  const conversationIdRef = useRef<string | null>(null);

  // ─── Transport with dynamic body ──
  const transportRef = useRef(
    new DefaultChatTransport({
      api: '/api/ubunye-chat',
      body: () => ({
        ...(!isAuthenticatedRef.current && { sessionMessageCount: guestCountRef.current }),
        ...(!isAuthenticatedRef.current && guestCountRef.current === 0 && { isFirstGuestMessage: true }),
        ...(creatorIdRef.current && { creator_id: creatorIdRef.current }),
        ...(conversationIdRef.current && { conversation_id: conversationIdRef.current }),
      }),
      // The server names the conversation it logged this turn under. Keeping
      // it means the next turn (e.g. "yes, approve that") finds the pending
      // proposal even when creating the session up front failed.
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const res = await fetch(input, init);
        const id = res.headers.get('x-conversation-id');
        if (id && !conversationIdRef.current) conversationIdRef.current = id;
        return res;
      },
    })
  );

  // Count a guest's message once it has been answered (see onFinish below).
  // Reads the ref, not state, because useChat keeps the first onFinish.
  function countAnsweredGuestMessage(): void {
    const newCount = guestCountRef.current + 1;
    guestCountRef.current = newCount;
    setGuestMessageCount(newCount);
    try { sessionStorage.setItem(SESSION_STORAGE_KEY, String(newCount)); } catch { /* SSR */ }
    if (newCount >= GUEST_LIMIT) {
      setLimitMessage(`You've used your ${GUEST_LIMIT} free messages. Sign in to continue chatting with Ubunye.`);
      setLimitReached(true);
    }
  }

  // ─── Vercel AI SDK useChat (v4 API) ──
  const {
    messages,
    setMessages,
    sendMessage,
    regenerate,
    clearError,
    status,
    error,
  } = useChat({
    transport: transportRef.current,
    // A message counts against the allowance only once Ubunye has answered
    // it. A failed or stopped reply costs nothing: the customer retries free.
    onFinish: ({ isError, isAbort }) => {
      if (isError || isAbort) return;
      if (isAuthenticatedRef.current) setDailyUsed(prev => prev + 1);
      else countAnsweredGuestMessage();
    },
    onError: (err) => {
      const failedText = lastSentRef.current;
      if (failedText) setInput(prev => prev || failedText);
      const msg = err?.message;
      if (msg?.includes('limit_reached')) {
        try {
          const data = JSON.parse(msg);
          const limitMsg = data.plan === 'guest'
            ? `You've used your ${GUEST_LIMIT} free messages. Sign in to continue chatting with Ubunye.`
            : STUDIO.subscriptions.enabled
              ? `You've reached your daily limit of ${data.limit} messages on the ${data.plan} plan. Upgrade for more messages.`
              : 'Daily limit reached. It resets tomorrow.';
          setLimitMessage(limitMsg);
          setLimitReached(true);
        } catch {
          // Non-parseable error, ignore
        }
      }
    },
  });

  const isLoading = status === 'submitted' || status === 'streaming';

  // ─── Orb state ──
  const orbState: OrbState = status === 'submitted' ? 'processing' : status === 'streaming' ? 'streaming' : 'idle';

  // ─── Persist chat to sessionStorage ──
  useEffect(() => {
    if (messages.length > 0) {
      try {
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


  // ─── Markdown components (stable ref; links/images are policed, see chatMarkdown.tsx) ──
  const mdComponents: Components = useMemo(() => chatMarkdownComponents,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  []);

  // ─── Auth & session ──
  const handleAuthUser = useCallback(async (user: { id: string; user_metadata: Record<string, string> } | null) => {
    if (user) {
      const wasGuest = !isAuthenticatedRef.current;
      setIsAuthenticated(true);
      const meta = user.user_metadata;
      const name = meta?.display_name || meta?.full_name || meta?.name || null;
      setUserName(name);

      if (wasGuest) {
        setLimitReached(false);
        setLimitMessage(null);
        setGuestMessageCount(0);
        try { sessionStorage.removeItem(SESSION_STORAGE_KEY); } catch { /* SSR */ }

        setMessages(prev => {
          if (prev.length === 0) return prev;
          return [...prev, {
            id: `auth-${Date.now()}`,
            role: 'assistant' as const,
            parts: [{ type: 'text' as const, text: `Welcome back${name ? `, ${name}` : ''}! You're now signed in. I can see your account and help you with bookings, quotes, and payments. Where were we?` }],
          }];
        });
      }

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
    } else {
      setIsAuthenticated(false);
      setUserName(null);
    }
  }, [setMessages]);

  useEffect(() => {
    const supabase = createClient();

    try {
      const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (stored) setGuestMessageCount(parseInt(stored, 10) || 0);
    } catch { /* SSR safety */ }

    supabase.auth.getUser().then(({ data }) => handleAuthUser(data.user));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      handleAuthUser(session?.user ?? null);
    });

    return () => { subscription.unsubscribe(); };
  }, [handleAuthUser]);

  // ─── Send message helper ──
  /** Resolves true when the message was handed to the model, false when it was held back. */
  const doSend = useCallback(async (text: string): Promise<boolean> => {
    if (!text.trim() || limitReached || isLoading) return false;
    if (!isAuthenticated && guestMessageCount >= GUEST_LIMIT) {
      setLimitMessage(`You've used your ${GUEST_LIMIT} free messages. Sign in to continue chatting with Ubunye.`);
      setLimitReached(true);
      return false;
    }
    lastSentRef.current = text;

    // Create chat session on first message
    if (!conversationIdRef.current) {
      try {
        const res = await fetch('/api/chat-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(creatorIdRef.current && { creator_id: creatorIdRef.current }),
          }),
        });
        const data = await res.json();
        if (data.conversation_id) {
          conversationIdRef.current = data.conversation_id;
        }
      } catch {
        // Non-blocking — chat still works without persistence
      }
    }

    void sendMessage({ text });
    return true;
  }, [limitReached, isLoading, isAuthenticated, guestMessageCount, sendMessage]);

  // ─── Form submit ──
  // Clear the box straight away so it feels instant, but put the text back if
  // the message was held back (limit, still loading) -- a failed request is
  // handled the same way in onError above.
  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const text = input;
    if (!text.trim()) return;
    setInput('');
    void doSend(text).then(sent => {
      if (!sent) setInput(prev => prev || text);
    });
  }, [input, doSend]);

  // ─── Retry after a failed request ──
  // regenerate() re-sends the conversation up to the last user message, so
  // the customer does not have to retype it.
  const handleRetry = useCallback(() => {
    if (isLoading || limitReached) return;
    if (input === lastSentRef.current) setInput('');
    clearError();
    void regenerate();
  }, [isLoading, limitReached, input, clearError, regenerate]);

  // ─── Quick action ──
  const sendQuickAction = useCallback((text: string) => {
    void doSend(text);
  }, [doSend]);

  // ─── Auto-send from ?prompt query param ──
  const searchParams = useSearchParams();
  const router = useRouter();
  const promptSentRef = useRef(false);

  if (!creatorIdRef.current) {
    const cid = searchParams.get('creator_id');
    if (cid) creatorIdRef.current = cid;
  }

  useEffect(() => {
    const promptParam = searchParams.get('prompt');
    if (promptParam && !promptSentRef.current && !isLoading && messages.length === 0) {
      promptSentRef.current = true;
      void doSend(promptParam);
      router.replace('/ubunye-ai-studio', { scroll: false });
    }
  }, [searchParams, doSend, isLoading, messages.length, router]);

  const greeting = getGreeting();
  const displayName = userName || null;
  const hasMessages = messages.length > 0;

  const remaining = !isAuthenticated
    ? GUEST_LIMIT - guestMessageCount
    : dailyLimit === -1 ? -1 : Math.max(0, dailyLimit - dailyUsed);

  return (
    // h-dvh, not 100vh: on iOS Safari 100vh includes the area under the
    // browser toolbar, which pushed the input bar off the bottom of the screen.
    <div className="bg-[#050505] text-white h-dvh" style={{ paddingTop: HEADER_HEIGHT }}>
      <div className={`flex flex-col h-full w-full mx-auto px-4 md:px-6 ${hasMessages ? 'max-w-[680px]' : 'max-w-[780px]'}`}>

        {/* ── Landing state ── */}
        <AnimatePresence mode="wait">
          {!hasMessages && (
            <motion.div
              key="landing"
              initial={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.25 } }}
              className="flex-1 flex flex-col pt-6 md:pt-10 overflow-y-auto scrollbar-thin scrollbar-thumb-neutral-800 scrollbar-track-transparent"
            >
              {/* Compact hero: sphere + greeting. Painted at once (no fade):
                  the heading is the page's largest paint on most phones. */}
              <div className="flex flex-col items-center mb-6 md:mb-8">
                <div className="w-[80px] h-[80px] md:w-[120px] md:h-[120px] mb-4 md:mb-5">
                  <GoldenSphere className="w-full h-full" state={orbState} />
                </div>
                <p className="text-xs text-neutral-400 tracking-wide mb-1.5">
                  {greeting}{displayName ? `, ${displayName}` : ''}. Ask about gear, dates or prices.
                </p>
                <h1 className="text-lg md:text-2xl font-medium text-neutral-200 text-center">
                  What can I help you <span className="text-[#D4A843]">create?</span>
                </h1>
              </div>

              {/* Quick action cards */}
              <motion.div
                custom={1}
                initial="hidden"
                animate="visible"
                variants={fadeUp}
                className="grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-3 mb-6 md:mb-8"
              >
                {UBUNYE_QUICK_ACTIONS.map((action, idx) => (
                  <button
                    key={action.id}
                    onClick={() => sendQuickAction(action.prompt)}
                    className={`group bg-[#0A0A0B] border border-white/5 p-3 md:p-4 text-left transition-all duration-200 hover:border-[#D4A843]/30 hover:-translate-y-0.5 active:scale-[0.98] ${
                      idx === UBUNYE_QUICK_ACTIONS.length - 1 && UBUNYE_QUICK_ACTIONS.length % 2 !== 0
                        ? 'col-span-2 md:col-span-1'
                        : ''
                    }`}
                  >
                    <span className="text-sm font-medium text-neutral-200 group-hover:text-[#D4A843] transition-colors block mb-0.5">
                      {action.label}
                    </span>
                    <span className="text-xs text-neutral-400 leading-snug line-clamp-2">
                      {action.description}
                    </span>
                  </button>
                ))}
              </motion.div>

              {/* Studio insights — featured gear, creators, productions */}
              {(context.featuredGear.length > 0 || context.featuredCreators.length > 0 || context.featuredProductions.length > 0) && (
                <motion.div
                  custom={2}
                  initial="hidden"
                  animate="visible"
                  variants={fadeUp}
                  className="mb-6"
                >
                  {/* Featured gear */}
                  {context.featuredGear.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs font-mono text-neutral-400 uppercase tracking-widest mb-2">Active Gear</p>
                      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none snap-x snap-mandatory -mx-4 px-4 md:mx-0 md:px-0">
                        {context.featuredGear.map(gear => (
                          <button
                            key={gear.id}
                            onClick={() => sendQuickAction(`Tell me about the ${gear.title}: pricing, availability, and what it's best for.`)}
                            className="flex-shrink-0 snap-start bg-[#0A0A0B] border border-white/5 p-3 w-[200px] text-left hover:border-[#D4A843]/20 transition-colors group"
                          >
                            {gear.thumbnail_url && (
                              <div className="w-full h-20 mb-2 overflow-hidden bg-neutral-900">
                                <img src={gear.thumbnail_url} alt="" className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                              </div>
                            )}
                            <span className="text-xs text-neutral-300 block truncate">{gear.title}</span>
                            {gear.price_per_day && (
                              <span className="text-xs text-neutral-400 font-mono">From {formatRate(Number(gear.price_per_day), 'day')}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Recommended creators */}
                  {context.featuredCreators.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs font-mono text-neutral-400 uppercase tracking-widest mb-2">People you can book</p>
                      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none snap-x snap-mandatory -mx-4 px-4 md:mx-0 md:px-0">
                        {context.featuredCreators.map(creator => (
                          <button
                            key={creator.id}
                            onClick={() => sendQuickAction(`Tell me about ${creator.display_name ?? 'this person'}: their work, rates, and availability.`)}
                            className="flex-shrink-0 snap-start bg-[#0A0A0B] border border-white/5 p-3 w-[180px] text-left hover:border-[#D4A843]/20 transition-colors"
                          >
                            <div className="flex items-center gap-2 mb-1.5">
                              {creator.avatar_url ? (
                                <img src={creator.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover" />
                              ) : (
                                <div className="w-7 h-7 rounded-full bg-neutral-800 flex items-center justify-center text-xs text-neutral-400 font-mono">
                                  {(creator.display_name ?? '?')[0]}
                                </div>
                              )}
                              <span className="text-xs text-neutral-300 truncate">{creator.display_name}</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-xs text-neutral-400 font-mono">
                              {creator.hourly_rate && <span>{formatRate(Number(creator.hourly_rate), 'hour')}</span>}
                              {creator.hourly_rate && creator.specializations?.[0] && <span>·</span>}
                              {creator.specializations?.[0] && <span className="truncate">{creator.specializations[0]}</span>}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}

              {/* Example prompts */}
              <motion.div
                custom={3}
                initial="hidden"
                animate="visible"
                variants={fadeUp}
                className="flex flex-wrap gap-1.5 md:gap-2 justify-center mb-4"
              >
                {UBUNYE_QUICK_ACTIONS.length > 0 && (
                  <>
                    {[
                      'Build a podcast setup for 3 people.',
                      `Find a photographer in ${STUDIO.location.city}.`,
                      'Compare Sony cameras for documentary filmmaking.',
                      'Create a wedding production package.',
                    ].map(prompt => (
                      <button
                        key={prompt}
                        onClick={() => sendQuickAction(prompt)}
                        className="min-h-[44px] px-3 py-2 text-xs text-neutral-400 border border-neutral-800/50 hover:text-[#D4A843]/80 hover:border-[#D4A843]/20 transition-all duration-200 truncate max-w-[220px]"
                      >
                        &ldquo;{prompt}&rdquo;
                      </button>
                    ))}
                  </>
                )}
              </motion.div>

              {/* Pulse of life */}
              <motion.p
                custom={4}
                initial="hidden"
                animate="visible"
                variants={fadeUp}
                className="text-xs text-neutral-400 text-center mb-4"
              >
                {context.featuredCreators.length > 0 && (
                  <>{context.featuredCreators.length} creators available</>
                )}
                {context.featuredCreators.length > 0 && context.featuredGear.length > 0 && ' · '}
                {context.featuredGear.length > 0 && (
                  <>{context.featuredGear.length} gear items ready</>
                )}
              </motion.p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Messages area ── */}
        {hasMessages && (
          <ChatMessageList
            messages={messages}
            isLoading={isLoading}
            error={error}
            limitReached={limitReached}
            limitMessage={limitMessage}
            isAuthenticated={isAuthenticated}
            mdComponents={mdComponents}
            onSend={sendQuickAction}
            onRetry={handleRetry}
          />
        )}

        {/* ── Input bar ── */}
        <ChatInputBar
          input={input}
          setInput={setInput}
          onSubmit={handleSubmit}
          isLoading={isLoading}
          limitReached={limitReached}
          remaining={remaining}
          isAuthenticated={isAuthenticated}
          showSuggestions={!hasMessages}
        />
      </div>
    </div>
  );
}
