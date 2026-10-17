'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useSearchParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import type { Components } from 'react-markdown';
import { chatMarkdownComponents } from '@/components/ubunye/chatMarkdown';
import { createClient } from '@/lib/supabase/client';
import { Clapperboard, Heart, Music, Store, type LucideIcon } from 'lucide-react';
import { PLAN, STUDIO, UBUNYE_OCCASIONS, type UbunyeOccasion } from '@/lib/constants';
import { ChatMessageList } from '@/components/ubunye/ChatMessageList';
import { ChatInputBar } from '@/components/ubunye/ChatInputBar';
import Image from 'next/image';
import { cardsFromUiParts, cardsToUiParts, readCards } from '@/lib/ubunye/chat-cards';
import { composePhotoMessage } from '@/lib/ubunye/chat-photos';
import { useChatPhotos } from '@/components/ubunye/useChatPhotos';

// ─── Constants ──────────────────────────────────────────────────────────────────

const GUEST_LIMIT = 5;
const SESSION_STORAGE_KEY = 'ubunye_msg_count';
const CHAT_HISTORY_KEY = 'ubunye_chat_history';
// The conversation this tab is in, so a reload keeps logging to it and still
// finds a proposal waiting for approval (the server checks it is theirs).
const CONVERSATION_KEY = 'ubunye_conversation_id';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEADER_HEIGHT = '5rem';

// ─── Helpers ────────────────────────────────────────────────────────────────────

/** "Ubunye eval (dev only)" becomes "Ubunye": the greeting uses the first name only. */
function firstName(name: string | null): string | null {
  const first = name?.trim().split(/\s+/)[0] ?? '';
  return first || null;
}

const OCCASION_ICONS: Record<UbunyeOccasion['id'], LucideIcon> = {
  wedding: Heart,
  'music-video': Music,
  business: Store,
  film: Clapperboard,
};

const newMessageId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `u-${Date.now()}-${Math.random().toString(36).slice(2)}`;

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
  /** People (roles_v1) is on: the error fallback points to /people, not /book. */
  people?: boolean;
  /**
   * Ubunye plans (ubunye_projects) is on: cards and the conversation survive
   * a reload, and a plan can open its chat (?c=). Off: today's behaviour.
   */
  plans?: boolean;
  /**
   * Photos are on (read on the server, ubunye_projects for now): the photo
   * button shows. Off: no button, and the page never mentions photos.
   */
  photos?: boolean;
}

export default function UbunyeStudioClient({ people = false, plans = false, photos = false }: UbunyeStudioClientProps) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatPhotos = useChatPhotos();
  // The photos the client sent, by message id, for their own bubble. Kept in
  // this tab only: the chat itself carries just the photo's description.
  const [userPhotos, setUserPhotos] = useState<Record<string, string[]>>({});
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
  const plansRef = useRef(plans);

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
        if (plansRef.current && conversationIdRef.current) {
          try { sessionStorage.setItem(CONVERSATION_KEY, conversationIdRef.current); } catch { /* SSR */ }
        }
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

  // ─── Persist chat to sessionStorage ──
  useEffect(() => {
    if (messages.length > 0) {
      try {
        // Text, plus a blind copy of each card (People results, proposals),
        // so a reload draws the same cards (lib/ubunye/chat-cards.ts).
        const toSave = messages.map(m => ({
          id: m.id,
          role: m.role,
          parts: [...m.parts.filter(p => p.type === 'text'), ...(plans ? cardsToUiParts(cardsFromUiParts(m.parts), m.id) : [])],
        }));
        sessionStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(toSave));
      } catch { /* quota exceeded or SSR */ }
    }
  }, [messages, plans]);

  // Restore messages from sessionStorage on mount
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    let restored = false;
    try {
      const savedId = plans ? sessionStorage.getItem(CONVERSATION_KEY) : null;
      if (savedId && UUID.test(savedId)) conversationIdRef.current = savedId;
      const saved = sessionStorage.getItem(CHAT_HISTORY_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Cards are checked again on the way back in: only blind fields survive.
          setMessages(parsed.map((m: { id: string; role: 'user' | 'assistant'; parts?: unknown[] }) => ({
            id: m.id,
            role: m.role,
            parts: [
              ...(Array.isArray(m.parts) ? m.parts.filter((p) => (p as { type?: unknown }).type === 'text') : []),
              ...(plans ? cardsToUiParts(cardsFromUiParts(m.parts), m.id) : []),
            ],
          })) as typeof messages);
          restored = true;
        }
      }
    } catch { /* SSR or invalid JSON */ }

    // Opened from a plan (?c=<conversation>): load that chat from the server,
    // the person's own only (the route checks), with its cards.
    const c = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('c') : null;
    if (plans && !restored && c && UUID.test(c)) {
      void (async () => {
        try {
          const res = await fetch(`/api/chat-session/${encodeURIComponent(c)}`, { cache: 'no-store' });
          if (!res.ok) return;
          const body = await res.json() as { messages?: { id: string; role: 'user' | 'assistant'; text: string; cards: unknown }[] };
          const loaded = (body.messages ?? []).map((m) => ({
            id: m.id,
            role: m.role,
            parts: [...(m.text ? [{ type: 'text' as const, text: m.text }] : []), ...cardsToUiParts(readCards(m.cards), m.id)],
          }));
          if (loaded.length) {
            conversationIdRef.current = c;
            try { sessionStorage.setItem(CONVERSATION_KEY, c); } catch { /* SSR */ }
            setMessages(loaded as typeof messages);
          }
        } catch { /* the chat simply starts fresh */ }
      })();
    }
  }, [setMessages, plans]);


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
  /**
   * Resolves true when the message was handed to the model, false when it was
   * held back. With photos, `words` is what the client typed (it goes back in
   * the box if the request fails) and `thumbs` are drawn in their bubble.
   */
  const doSend = useCallback(async (text: string, withPhotos?: { words: string; thumbs: string[] }): Promise<boolean> => {
    if (!text.trim() || limitReached || isLoading) return false;
    if (!isAuthenticated && guestMessageCount >= GUEST_LIMIT) {
      setLimitMessage(`You've used your ${GUEST_LIMIT} free messages. Sign in to continue chatting with Ubunye.`);
      setLimitReached(true);
      return false;
    }
    lastSentRef.current = withPhotos ? withPhotos.words : text;

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

    if (withPhotos && withPhotos.thumbs.length > 0) {
      // Our own id, so the bubble can find its thumbnails. Still one text part.
      const id = newMessageId();
      const thumbs = withPhotos.thumbs;
      setUserPhotos(prev => ({ ...prev, [id]: thumbs }));
      void sendMessage({ id, role: 'user', parts: [{ type: 'text', text }] });
    } else {
      void sendMessage({ text });
    }
    return true;
  }, [limitReached, isLoading, isAuthenticated, guestMessageCount, sendMessage]);

  // ─── Form submit ──
  // Clear the box straight away so it feels instant, but put the text back if
  // the message was held back (limit, still loading) -- a failed request is
  // handled the same way in onError above.
  // Photos: a send pressed while a photo is still being read waits and goes by
  // itself the moment reading ends (it used to be dropped silently); a photo
  // that could not be read stays behind with its reason and the words still go.
  const { busy: photosBusy, photos: pendingPhotos, take: takePhotos, restore: restorePhotos } = chatPhotos;
  const [sendQueued, setSendQueued] = useState(false);
  const sendNow = useCallback(() => {
    const text = input;
    const ready = pendingPhotos.filter(p => p.status === 'ready' && p.text && p.dataUrl);
    if (!text.trim() && ready.length === 0) return;
    setInput('');
    if (ready.length === 0) {
      void doSend(text).then(sent => {
        if (!sent) setInput(prev => prev || text);
      });
      return;
    }
    const taken = takePhotos();
    const message = composePhotoMessage(text, ready.map(p => p.text as string));
    void doSend(message, { words: text, thumbs: ready.map(p => p.dataUrl as string) }).then(sent => {
      if (sent) return;
      setInput(prev => prev || text);
      restorePhotos(taken);
    });
  }, [input, doSend, pendingPhotos, takePhotos, restorePhotos]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (photosBusy) {
      setSendQueued(true);
      return;
    }
    sendNow();
  }, [photosBusy, sendNow]);

  useEffect(() => {
    if (!sendQueued || photosBusy) return;
    setSendQueued(false);
    sendNow();
  }, [sendQueued, photosBusy, sendNow]);

  // ─── Put words in the box without sending (an occasion, an answer start) ──
  const prefill = useCallback((text: string) => {
    setInput(text);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(text.length, text.length);
    });
  }, []);

  // ─── Retry after a failed request ──
  // regenerate() re-sends the conversation up to the last user message, so
  // the customer does not have to retype it.
  const handleRetry = useCallback(() => {
    if (isLoading || limitReached) return;
    if (input === lastSentRef.current) setInput('');
    clearError();
    void regenerate();
  }, [isLoading, limitReached, input, clearError, regenerate]);

  // ─── Quick action (follow-up buttons send straight away) ──
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
      router.replace(PLAN.href, { scroll: false });
    }
  }, [searchParams, doSend, isLoading, messages.length, router]);

  const greeting = getGreeting();
  const displayName = firstName(userName);
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
              className="flex-1 flex flex-col justify-center py-6 overflow-y-auto scrollbar-thin scrollbar-thumb-neutral-800 scrollbar-track-transparent"
            >
              {/* One question. Painted at once (no fade): the heading is the
                  page's largest paint on most phones. */}
              <div className="flex flex-col items-center mb-8">
                {/* Just the B (owner, 2026-10-17): no floating sphere. */}
                <Image
                  src="/logo-header-90.webp"
                  alt=""
                  width={80}
                  height={90}
                  priority
                  className="h-12 md:h-14 w-auto mb-5 select-none"
                />
                {displayName && (
                  <p className="text-sm text-neutral-400 mb-2">
                    {greeting}, {displayName}.
                  </p>
                )}
                <h1 className="text-2xl md:text-3xl font-medium text-neutral-100 text-center">
                  What are you <span className="text-[#D4A843]">planning?</span>
                </h1>
                <p className="mt-3 max-w-[30ch] md:max-w-none text-[15px] text-neutral-400 text-center leading-relaxed">
                  {photos
                    ? 'Tell me about your shoot, or send a photo of the look you want.'
                    : 'Tell me about your shoot.'}
                </p>
                {/* The one quiet line about the brain behind Plan (owner, 2026-10-17). */}
                <p className="mt-2 text-xs text-neutral-400 text-center">{PLAN.brainLine}</p>
              </div>

              {/* Four occasions. A tap starts the sentence in the box (not sent). */}
              <motion.div
                custom={1}
                initial="hidden"
                animate="visible"
                variants={fadeUp}
                className="grid grid-cols-2 gap-2 w-full max-w-[520px] mx-auto"
              >
                {UBUNYE_OCCASIONS.map(occasion => {
                  const Icon = OCCASION_ICONS[occasion.id];
                  return (
                    <button
                      key={occasion.id}
                      type="button"
                      onClick={() => prefill(occasion.starter)}
                      className="flex items-center gap-3 min-h-[52px] px-4 py-3 rounded-2xl border border-white/10 bg-white/[0.02] text-left text-sm text-neutral-200 hover:border-[#D4A843]/40 hover:text-[#D4A843] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D4A843]"
                    >
                      <Icon className="w-4 h-4 shrink-0 text-[#D4A843]" strokeWidth={1.5} aria-hidden="true" />
                      <span>{occasion.label}</span>
                    </button>
                  );
                })}
              </motion.div>

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
            people={people}
            userPhotos={userPhotos}
            onPrefill={prefill}
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
          inputRef={inputRef}
          photosEnabled={photos}
          photos={chatPhotos.photos}
          photoNotice={chatPhotos.notice}
          photosBusy={chatPhotos.busy}
          sendQueued={sendQueued}
          onAddPhotos={chatPhotos.add}
          onRemovePhoto={chatPhotos.remove}
          voiceEnabled={photos}
          onVoiceText={(text) => { void doSend(text); }}
        />
      </div>
    </div>
  );
}
