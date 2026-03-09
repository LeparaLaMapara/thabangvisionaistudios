'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { STUDIO } from '@/lib/constants';
import { EnergySphere } from '@/components/ubunye/EnergySphere';

// ─── Types ──────────────────────────────────────────────────────────────────────

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
};

type EnergyLevel = 'idle' | 'pulse' | 'calm';

// ─── System Prompt ──────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Ubunye, the AI assistant for ${STUDIO.name}. You help ${STUDIO.location.country} filmmakers and photographers plan productions, find equipment, discover crew, generate creative assets, and get pricing estimates. Be helpful, knowledgeable about the ${STUDIO.location.country} creative industry, and conversational. Use ${STUDIO.currency.code} for all pricing. Keep responses concise and actionable. You can help with:
- Production planning (schedules, shot lists, budgets)
- Equipment recommendations and rental pricing
- Crew hiring and role suggestions
- Creative asset ideas and briefs
- ${STUDIO.location.country} filming locations and permits
- Industry rates and market pricing in ${STUDIO.currency.code}`;

// ─── Quick Actions ──────────────────────────────────────────────────────────────

const QUICK_ACTIONS = [
  { label: 'Plan a shoot', prompt: `Help me plan a professional shoot in ${STUDIO.location.city}. I need a shot list, crew recommendations, and equipment.` },
  { label: 'Find gear', prompt: `What camera and lens packages do you recommend for a cinematic corporate video in ${STUDIO.location.country}?` },
  { label: 'Hire crew', prompt: `I need to hire a film crew for a 2-day shoot in ${STUDIO.location.city}. What roles do I need and what are typical rates in ${STUDIO.currency.code}?` },
  { label: 'Create assets', prompt: `Help me create a creative brief for a brand video for a ${STUDIO.location.country} tech startup.` },
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

// Header is fixed top-0 h-20 = 80px
const HEADER_HEIGHT = '5rem'; // 80px

// ─── Component ──────────────────────────────────────────────────────────────────

export default function UbunyeAIStudioPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [userName, setUserName] = useState<string | null>(null);
  const [energyLevel, setEnergyLevel] = useState<EnergyLevel>('idle');
  const [latency, setLatency] = useState(12);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch user name from Supabase session
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        const meta = data.user.user_metadata;
        const name = meta?.display_name || meta?.full_name || meta?.name || null;
        setUserName(name);
      }
    });
  }, []);

  // Simulate latency fluctuation
  useEffect(() => {
    const interval = setInterval(() => {
      setLatency(Math.floor(8 + Math.random() * 18));
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim()) return;

    const userMsg: Message = {
      id: generateId(),
      role: 'user',
      content: text.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);
    setEnergyLevel('pulse');

    const startTime = Date.now();

    try {
      // Build conversation context
      const conversationHistory = [...messages, userMsg]
        .map(m => `${m.role === 'user' ? 'User' : 'Ubunye'}: ${m.content}`)
        .join('\n');

      const fullPrompt = `${SYSTEM_PROMPT}\n\nConversation:\n${conversationHistory}\n\nUbunye:`;

      const res = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: fullPrompt }),
      });

      if (!res.ok) {
        throw new Error('Failed to get response');
      }

      const data = await res.json();
      const responseText = data?.candidates?.[0]?.content?.parts?.[0]?.text
        || 'I apologize, I couldn\'t process that request. Please try again.';

      const elapsed = Date.now() - startTime;
      setLatency(Math.max(8, Math.min(99, Math.floor(elapsed / 100))));

      const assistantMsg: Message = {
        id: generateId(),
        role: 'assistant',
        content: responseText,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, assistantMsg]);
    } catch {
      const assistantMsg: Message = {
        id: generateId(),
        role: 'assistant',
        content: 'I\'m experiencing connectivity issues. Please check that the AI service is configured and try again.',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMsg]);
    } finally {
      setIsTyping(false);
      setEnergyLevel('calm');
      // Return to idle after calm period
      setTimeout(() => setEnergyLevel('idle'), 2000);
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleQuickAction = (prompt: string) => {
    sendMessage(prompt);
  };

  const greeting = getGreeting();
  const displayName = userName || 'Creator';

  return (
    <div
      className="relative bg-[#030305] text-white overflow-hidden"
      style={{ paddingTop: HEADER_HEIGHT, height: '100vh' }}
    >

      {/* ── Background layers (offset below header) ── */}

      {/* Grid overlay */}
      <div
        className="absolute inset-0 pointer-events-none z-0"
        style={{
          top: HEADER_HEIGHT,
          backgroundImage:
            'linear-gradient(rgba(212,168,67,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(212,168,67,0.03) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }}
      />

      {/* Scanlines */}
      <div
        className="absolute inset-0 pointer-events-none z-[1]"
        style={{
          top: HEADER_HEIGHT,
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px)',
        }}
      />

      {/* Vignette */}
      <div
        className="absolute inset-0 pointer-events-none z-[2]"
        style={{
          top: HEADER_HEIGHT,
          background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.7) 100%)',
        }}
      />

      {/* ── HUD Corners (hidden on mobile, offset below header) ── */}
      <div className="hidden md:block">
        {/* Top-left */}
        <div className="absolute left-4 z-10 w-12 h-12 border-l border-t border-[#D4A843]/30" style={{ top: `calc(${HEADER_HEIGHT} + 1rem)` }} />
        {/* Top-right */}
        <div className="absolute right-4 z-10 w-12 h-12 border-r border-t border-[#D4A843]/30" style={{ top: `calc(${HEADER_HEIGHT} + 1rem)` }} />
        {/* Bottom-left */}
        <div className="absolute bottom-4 left-4 z-10 w-12 h-12 border-l border-b border-[#D4A843]/30" />
        {/* Bottom-right */}
        <div className="absolute bottom-4 right-4 z-10 w-12 h-12 border-r border-b border-[#D4A843]/30" />
      </div>

      {/* ── Top status bar (below header) ── */}
      <div className="relative z-10 flex items-center justify-between px-4 md:px-8 py-4 border-b border-[#D4A843]/10">
        <div className="flex items-center gap-3">
          {/* AI avatar dot */}
          <div className="relative w-3 h-3">
            <div className="absolute inset-0 rounded-full bg-[#D4A843] animate-ping opacity-30" />
            <div className="relative w-3 h-3 rounded-full bg-[#D4A843]" />
          </div>
          <span
            className="text-[11px] font-bold tracking-[0.3em] text-[#D4A843] uppercase"
            style={{ fontFamily: 'var(--font-orbitron), sans-serif' }}
          >
            UBUNYE AI
          </span>
        </div>

        {/* Status indicators (hidden on mobile) */}
        <div className="hidden md:flex items-center gap-6">
          <StatusIndicator label="Neural Core" status="active" />
          <StatusIndicator label="Latency" value={`${latency}ms`} />
          <StatusIndicator label="Status" status="ready" />
        </div>
      </div>

      {/* ── Main content — fills remaining space below header + status bar ── */}
      <div className="relative z-10 flex flex-col items-center px-4 md:px-8 pt-6 md:pt-8 pb-4 overflow-hidden" style={{ height: `calc(100vh - ${HEADER_HEIGHT} - 57px)` }}>

        {/* Energy Sphere */}
        <div className="relative w-[200px] h-[200px] md:w-[320px] md:h-[320px] mb-6 md:mb-8 flex-shrink-0">
          <EnergySphere
            energyLevel={energyLevel}
            className="w-full h-full"
          />
        </div>

        {/* Greeting & Prompt (shown when no messages) */}
        <AnimatePresence mode="wait">
          {messages.length === 0 && (
            <motion.div
              key="greeting"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.5 }}
              className="text-center mb-6 md:mb-8 flex-shrink-0"
            >
              <p className="text-xs font-mono text-[#D4A843]/60 tracking-[0.2em] uppercase mb-3">
                {greeting}, {displayName}
              </p>
              <h1
                className="text-2xl md:text-4xl font-bold tracking-wide text-white uppercase mb-2"
                style={{ fontFamily: 'var(--font-orbitron), sans-serif' }}
              >
                WHAT CAN I DO{' '}
                <span className="text-[#D4A843]">FOR YOU?</span>
              </h1>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Quick Actions (shown when no messages) */}
        <AnimatePresence>
          {messages.length === 0 && (
            <motion.div
              key="actions"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, delay: 0.2 }}
              className="flex flex-wrap justify-center gap-2 md:gap-3 mb-6 md:mb-8 max-w-2xl flex-shrink-0"
            >
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action.label}
                  onClick={() => handleQuickAction(action.prompt)}
                  className="px-4 py-2 text-[10px] md:text-[11px] font-mono font-bold uppercase tracking-[0.15em] border border-[#D4A843]/20 text-[#D4A843]/70 hover:text-[#D4A843] hover:border-[#D4A843]/50 hover:bg-[#D4A843]/5 transition-all duration-300"
                >
                  {action.label}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Messages area */}
        {messages.length > 0 && (
          <div className="w-full max-w-2xl flex-1 overflow-y-auto mb-4 space-y-4 scrollbar-thin px-2">
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' && (
                  <div className="flex-shrink-0 mt-1">
                    {/* AI avatar ring + core dot */}
                    <div className="relative w-7 h-7 flex items-center justify-center">
                      <div className="absolute inset-0 rounded-full border border-[#D4A843]/40" />
                      <div className="w-2 h-2 rounded-full bg-[#D4A843]" />
                    </div>
                  </div>
                )}
                <div
                  className={`max-w-[80%] px-4 py-3 text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-[#D4A843]/10 border border-[#D4A843]/20 text-white'
                      : 'bg-white/5 border border-white/10 text-neutral-300'
                  }`}
                >
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                  <div className={`text-[9px] font-mono mt-2 ${
                    msg.role === 'user' ? 'text-[#D4A843]/40' : 'text-white/20'
                  }`}>
                    {msg.timestamp.toLocaleTimeString(STUDIO.currency.locale, { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </motion.div>
            ))}

            {/* Typing indicator */}
            {isTyping && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center gap-3"
              >
                <div className="relative w-7 h-7 flex items-center justify-center flex-shrink-0">
                  <div className="absolute inset-0 rounded-full border border-[#D4A843]/40 animate-spin" style={{ animationDuration: '3s' }} />
                  <div className="w-2 h-2 rounded-full bg-[#D4A843] animate-pulse" />
                </div>
                <span
                  className="text-[10px] font-bold tracking-[0.25em] text-[#D4A843]/60 uppercase animate-pulse"
                  style={{ fontFamily: 'var(--font-orbitron), sans-serif' }}
                >
                  UBUNYE IS THINKING
                </span>
              </motion.div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}

        {/* Chat input */}
        <form onSubmit={handleSubmit} className="w-full max-w-2xl mt-auto flex-shrink-0">
          <div className="relative flex items-center border border-[#D4A843]/20 bg-[#0A0A0F] hover:border-[#D4A843]/40 focus-within:border-[#D4A843]/50 transition-colors">
            {/* Prefix */}
            <span className="pl-4 text-[#D4A843]/50 font-mono text-sm select-none">&#9654;</span>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask Ubunye anything..."
              disabled={isTyping}
              className="flex-1 bg-transparent px-3 py-4 text-sm text-white placeholder-white/20 outline-none font-mono disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!input.trim() || isTyping}
              className="h-full px-5 py-4 bg-[#D4A843] text-black font-bold text-xs tracking-widest uppercase hover:bg-[#E8C96A] disabled:opacity-30 disabled:hover:bg-[#D4A843] transition-colors flex items-center gap-2"
              style={{
                clipPath: 'polygon(12px 0, 100% 0, 100% 100%, 0 100%)',
              }}
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </form>

        {/* Footer */}
        <div className="w-full text-center mt-4 mb-2 flex-shrink-0">
          <p
            className="text-[8px] md:text-[9px] tracking-[0.25em] text-white/15 uppercase"
            style={{ fontFamily: 'var(--font-orbitron), sans-serif' }}
          >
            POWERED BY UBUNYE AI &middot; {STUDIO.name.toUpperCase()} &middot; {STUDIO.location.city.toUpperCase()}, {STUDIO.location.country.toUpperCase()}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Status Indicator ──────────────────────────────────────────────────────────

function StatusIndicator({
  label,
  status,
  value,
}: {
  label: string;
  status?: 'active' | 'ready';
  value?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {status === 'active' && (
        <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
      )}
      {status === 'ready' && (
        <div className="w-1.5 h-1.5 rounded-full bg-[#D4A843]" />
      )}
      <span className="text-[9px] font-mono tracking-[0.15em] text-white/30 uppercase">
        {label}
      </span>
      {value && (
        <span className="text-[9px] font-mono tracking-wider text-[#D4A843]/60">
          {value}
        </span>
      )}
    </div>
  );
}
