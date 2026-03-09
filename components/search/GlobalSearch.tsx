'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, Film, Camera, Newspaper, Briefcase, User, Store, ArrowRight } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Skeleton } from '@/components/ui/Skeleton';
import type { SearchResult, SearchResponse } from '@/app/api/search/route';

const CATEGORY_META: Record<string, { label: string; icon: typeof Film; color: string }> = {
  productions:     { label: 'Productions',    icon: Film,      color: 'text-blue-400' },
  equipment:       { label: 'Equipment',      icon: Camera,    color: 'text-emerald-400' },
  press:           { label: 'Press',           icon: Newspaper, color: 'text-violet-400' },
  careers:         { label: 'Careers',         icon: Briefcase, color: 'text-amber-400' },
  creators:        { label: 'Creators',        icon: User,      color: 'text-pink-400' },
  'community-gear': { label: 'Community Gear', icon: Store,     color: 'text-teal-400' },
};

const CATEGORY_ORDER = ['productions', 'equipment', 'press', 'careers', 'creators', 'community-gear'];

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function GlobalSearch({ isOpen, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const listRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults([]);
      setCounts({});
      setActiveIndex(-1);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  // Close on Escape (global)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKey);
      return () => window.removeEventListener('keydown', handleKey);
    }
  }, [isOpen, onClose]);

  // Open search with Cmd+K / Ctrl+K
  useEffect(() => {
    const handleGlobal = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (!isOpen) {
          // Parent needs to handle this — we dispatch a custom event
          window.dispatchEvent(new CustomEvent('toggle-search'));
        }
      }
    };
    window.addEventListener('keydown', handleGlobal);
    return () => window.removeEventListener('keydown', handleGlobal);
  }, [isOpen]);

  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([]);
      setCounts({});
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data: SearchResponse = await res.json();
      setResults(data.results);
      setCounts(data.counts);
      setActiveIndex(-1);
    } catch {
      setResults([]);
      setCounts({});
    } finally {
      setLoading(false);
    }
  }, []);

  const handleInputChange = (value: string) => {
    setQuery(value);
    clearTimeout(debounceRef.current);
    if (value.trim().length < 2) {
      setResults([]);
      setCounts({});
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => doSearch(value), 300);
  };

  const navigate = (href: string) => {
    onClose();
    router.push(href);
  };

  // Build flat list for keyboard nav
  const flatResults = CATEGORY_ORDER
    .filter(cat => counts[cat])
    .flatMap(cat => results.filter(r => r.category === cat));

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(prev => Math.min(prev + 1, flatResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(prev => Math.max(prev - 1, -1));
    } else if (e.key === 'Enter' && activeIndex >= 0 && flatResults[activeIndex]) {
      e.preventDefault();
      navigate(flatResults[activeIndex].href);
    }
  };

  // Scroll active item into view
  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const el = listRef.current.querySelector(`[data-index="${activeIndex}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  const hasQuery = query.trim().length >= 2;
  const hasResults = flatResults.length > 0;
  const showEmpty = hasQuery && !loading && !hasResults;

  // Track flatIndex across grouped rendering
  let flatIndex = -1;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[200] flex items-start justify-center"
          onClick={onClose}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            onClick={e => e.stopPropagation()}
            className="relative w-full max-w-2xl mx-4 mt-[10vh] md:mt-[15vh] bg-neutral-950 border border-white/10 rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[70vh]"
          >
            {/* Search Input */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
              <Search className="w-5 h-5 text-neutral-500 shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => handleInputChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search productions, equipment, press, creators..."
                className="flex-1 bg-transparent text-white text-sm font-mono placeholder:text-neutral-600 outline-none"
              />
              {query && (
                <button onClick={() => handleInputChange('')} className="text-neutral-500 hover:text-white transition-colors">
                  <X className="w-4 h-4" />
                </button>
              )}
              <kbd className="hidden md:block text-[10px] font-mono text-neutral-600 border border-neutral-800 px-1.5 py-0.5 rounded">
                ESC
              </kbd>
            </div>

            {/* Results */}
            <div ref={listRef} className="overflow-y-auto flex-1 overscroll-contain">
              {/* Loading Skeletons */}
              {loading && (
                <div className="p-5 space-y-4">
                  {[1, 2, 3, 4, 5].map(i => (
                    <div key={i} className="flex items-center gap-3">
                      <Skeleton className="w-10 h-10 rounded shrink-0" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-3 w-2/3 rounded" />
                        <Skeleton className="h-2.5 w-1/2 rounded" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Grouped Results */}
              {!loading && hasResults && (
                <div className="py-2">
                  {CATEGORY_ORDER.filter(cat => counts[cat]).map(cat => {
                    const meta = CATEGORY_META[cat];
                    const catResults = results.filter(r => r.category === cat);
                    const Icon = meta.icon;

                    return (
                      <div key={cat}>
                        {/* Section Header */}
                        <div className="flex items-center justify-between px-5 pt-4 pb-2">
                          <div className="flex items-center gap-2">
                            <Icon className={`w-3.5 h-3.5 ${meta.color}`} />
                            <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">
                              {meta.label}
                            </span>
                          </div>
                          <span className="text-[10px] font-mono text-neutral-600">
                            {counts[cat]}
                          </span>
                        </div>

                        {/* Items */}
                        {catResults.map(result => {
                          flatIndex++;
                          const idx = flatIndex;
                          const isActive = idx === activeIndex;

                          return (
                            <button
                              key={result.id}
                              data-index={idx}
                              onClick={() => navigate(result.href)}
                              onMouseEnter={() => setActiveIndex(idx)}
                              className={`w-full flex items-center gap-3 px-5 py-3 text-left transition-colors duration-150 group ${
                                isActive
                                  ? 'bg-[#D4A843]/10 border-l-2 border-[#D4A843]'
                                  : 'border-l-2 border-transparent hover:bg-white/5'
                              }`}
                            >
                              {/* Thumbnail */}
                              {result.thumbnail ? (
                                <div className="w-10 h-10 rounded bg-neutral-900 overflow-hidden shrink-0 relative">
                                  <Image
                                    src={result.thumbnail}
                                    alt=""
                                    fill
                                    sizes="40px"
                                    className="object-cover"
                                    unoptimized
                                  />
                                </div>
                              ) : (
                                <div className="w-10 h-10 rounded bg-neutral-900 flex items-center justify-center shrink-0">
                                  <Icon className={`w-4 h-4 ${meta.color} opacity-50`} />
                                </div>
                              )}

                              {/* Text */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className={`text-sm font-medium truncate ${isActive ? 'text-[#D4A843]' : 'text-white'}`}>
                                    {result.title}
                                  </span>
                                </div>
                                {result.excerpt && (
                                  <p className="text-xs text-neutral-500 truncate mt-0.5">
                                    {result.excerpt}
                                  </p>
                                )}
                              </div>

                              {/* Arrow on active */}
                              <ArrowRight className={`w-4 h-4 shrink-0 transition-opacity ${isActive ? 'text-[#D4A843] opacity-100' : 'opacity-0'}`} />
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Empty State */}
              {showEmpty && (
                <div className="px-5 py-16 text-center">
                  <Search className="w-10 h-10 text-neutral-700 mx-auto mb-4" />
                  <p className="text-neutral-400 text-sm font-mono mb-2">No results found</p>
                  <p className="text-neutral-600 text-xs font-mono">
                    Try searching for a production name, equipment brand, creator, or article title
                  </p>
                </div>
              )}

              {/* Initial State */}
              {!hasQuery && !loading && (
                <div className="px-5 py-12 text-center">
                  <p className="text-neutral-600 text-xs font-mono">
                    Type at least 2 characters to search across productions, equipment, press, careers, creators, and community gear
                  </p>
                  <div className="flex items-center justify-center gap-4 mt-6">
                    {CATEGORY_ORDER.map(cat => {
                      const meta = CATEGORY_META[cat];
                      const Icon = meta.icon;
                      return (
                        <div key={cat} className="flex flex-col items-center gap-1">
                          <Icon className={`w-4 h-4 ${meta.color} opacity-40`} />
                          <span className="text-[9px] font-mono text-neutral-700 hidden md:block">{meta.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-white/10 px-5 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-mono text-neutral-600 flex items-center gap-1">
                  <kbd className="border border-neutral-800 px-1 rounded text-[9px]">↑↓</kbd> navigate
                </span>
                <span className="text-[10px] font-mono text-neutral-600 flex items-center gap-1">
                  <kbd className="border border-neutral-800 px-1 rounded text-[9px]">↵</kbd> open
                </span>
              </div>
              <span className="text-[10px] font-mono text-neutral-700 hidden md:flex items-center gap-1">
                <kbd className="border border-neutral-800 px-1 rounded text-[9px]">⌘</kbd>
                <kbd className="border border-neutral-800 px-1 rounded text-[9px]">K</kbd>
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
