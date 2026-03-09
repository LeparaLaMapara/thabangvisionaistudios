'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, Menu, X, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { MAIN_NAVIGATION } from '@/lib/constants';
import { GlobalSearch } from '@/components/search/GlobalSearch';
import { createClient } from '@/lib/supabase/client';

// Pre-computed ray params to avoid hydration mismatch (no Math.random() in render)
const RAY_LENGTHS = [38, 47, 43, 35, 44, 41, 39, 48, 42];
const RAY_DURATIONS = [2.4, 3.1, 2.7, 2.2, 3.5, 2.9, 2.6, 3.3, 2.8];

// --- CUSTOM LOGO COMPONENT ---
const ThabangLogo = () => (
  <div className="flex items-center tracking-tighter font-display font-bold text-xl md:text-2xl text-black dark:text-white relative group select-none">
    <span>THA</span>
    <div className="relative mx-1 flex items-center justify-center w-[1.6em] h-[1.6em] -mt-1.5">
       <svg viewBox="0 0 100 110" className="w-[200%] h-[200%] absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 overflow-visible">
            <defs>
              <linearGradient id="bladeGrad" x1="0" y1="0" x2="1" y2="1">
                 <stop offset="0%" stopColor="#444" />
                 <stop offset="50%" stopColor="#222" />
                 <stop offset="100%" stopColor="#111" />
              </linearGradient>
              <radialGradient id="glareGrad" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="white" stopOpacity="0.8" />
                <stop offset="70%" stopColor="white" stopOpacity="0" />
              </radialGradient>
            </defs>

            {/* 1. Rays Behind Lens - Clustered Top-Left */}
            <g transform="translate(52, 34)">
                {RAY_LENGTHS.map((length, i) => {
                     const angleStart = 195;
                     const angleStep = 15;
                     const rotation = angleStart + (i * angleStep);

                     return (
                        <motion.line
                           key={i}
                           x1="26" y1="0"
                           x2={26 + length} y2="0"
                           stroke="currentColor"
                           strokeWidth={i % 2 === 0 ? 2 : 1}
                           transform={`rotate(${rotation})`}
                           className="text-black dark:text-white"
                           initial={{ opacity: 0.5, scaleX: 0.9 }}
                           animate={{ opacity: [0.5, 1, 0.5], scaleX: [0.9, 1.1, 0.9] }}
                           transition={{ duration: RAY_DURATIONS[i], repeat: Infinity }}
                        />
                     )
                })}
            </g>

            {/* 2. Serif B Structure */}
            <g className="text-black dark:text-white fill-current drop-shadow-sm">
                {/* Vertical Stem with Serifs */}
                <path d="M22 10 H42 V20 H36 V90 H48 V100 H18 V90 H28 V20 H22 V10 Z" />

                {/* Bottom Bowl - Classic Serif Curve */}
                <path d="M36 54 H54 C74 54 84 64 84 77 C84 92 72 100 52 100 H36 V54 Z M48 90 C58 90 66 86 66 77 C66 68 58 64 48 64 H36 V90 H48 Z" />
            </g>

            {/* 3. The Lens (Integrated Top Loop) */}
            <g transform="translate(52, 34)">
                 {/* Outer Housing Ring */}
                 <circle cx="0" cy="0" r="23" fill="#0A0A0A" stroke="currentColor" strokeWidth="1.5" />
                 <circle cx="0" cy="0" r="20" fill="none" stroke="#333" strokeWidth="0.5" />

                 {/* Aperture Blades */}
                 <g>
                    {[0, 60, 120, 180, 240, 300].map(deg => (
                        <path
                           key={deg}
                           d="M0 0 C10 5 18 16 20 20 L0 20 Z"
                           fill="url(#bladeGrad)"
                           stroke="#444"
                           strokeWidth="0.5"
                           transform={`rotate(${deg})`}
                        />
                    ))}
                 </g>

                 {/* Center Eye / Glare */}
                 <circle cx="0" cy="0" r="7" fill="#000" stroke="#222" strokeWidth="1" />
                 <circle cx="-2.5" cy="-2.5" r="2.5" fill="white" className="animate-pulse" />
                 <circle cx="0" cy="0" r="20" fill="url(#glareGrad)" opacity="0.25" style={{ mixBlendMode: 'screen' }} />
            </g>
       </svg>
    </div>
    <span>ANGVISION</span>
    <span className="text-neutral-500 font-light text-sm ml-1">.LAB</span>
  </div>
);

// Shared style constants
const NAV_TEXT = "font-mono font-medium tracking-widest uppercase text-neutral-600 dark:text-neutral-400 hover:text-black dark:hover:text-white transition-colors duration-300";
const SUB_ITEM_TEXT = "text-xs font-mono tracking-widest uppercase text-neutral-600 dark:text-neutral-400 hover:text-black dark:hover:text-white transition-all duration-200";
const NUMBER_PREFIX = "text-neutral-400 dark:text-neutral-600 mr-2";
const ACTION_BTN = "w-full px-6 py-3 font-mono font-medium tracking-widest uppercase text-sm hover:opacity-80 transition-all duration-300";

const formatIndex = (idx: number) => String(idx + 1).padStart(2, '0');

const NavItem = ({ label, to, items }: { label: string; to?: string; items?: any[]; key?: any }) => {
  const [isOpen, setIsOpen] = useState(false);

  const baseClasses = `px-4 py-2 text-[10px] ${NAV_TEXT} flex items-center gap-1 group-hover:bg-black/5 dark:group-hover:bg-white/5 cursor-pointer`;

  return (
    <div
      className="relative group h-full flex items-center"
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
    >
      {to ? (
        <Link href={to} className={baseClasses}>
          {label}
          {items && <ChevronDown className="w-3 h-3 opacity-50" />}
        </Link>
      ) : (
        <div className={baseClasses}>
          {label}
          {items && <ChevronDown className="w-3 h-3 opacity-50" />}
        </div>
      )}

      {items && (
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 5 }}
              transition={{ duration: 0.15, ease: 'circOut' }}
              className="absolute top-full left-0 min-w-[240px] bg-white dark:bg-[#050505] border border-neutral-200 dark:border-white/20 p-2 shadow-2xl z-50 flex flex-col"
            >
              {items.map((child, idx) => (
                <Link
                  key={idx}
                  href={child.href}
                  className={`${SUB_ITEM_TEXT} hover:bg-black/5 dark:hover:bg-white/10 hover:pl-3 block py-3 px-2 border-b border-neutral-100 dark:border-white/5 last:border-0`}
                >
                  <span className={NUMBER_PREFIX}>{formatIndex(idx)}</span> {child.label}
                </Link>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
};

const MobileNavSection = ({
  item,
  onNavigate,
}: {
  item: (typeof MAIN_NAVIGATION)[number];
  onNavigate: (href: string) => void;
}) => {
  const [open, setOpen] = useState(false);

  if (!item.children) {
    return (
      <button
        onClick={() => onNavigate(item.href)}
        className={`text-sm ${NAV_TEXT}`}
      >
        {item.label}
      </button>
    );
  }

  return (
    <div className="w-full flex flex-col items-center">
      <button
        onClick={() => setOpen(!open)}
        className={`text-sm ${NAV_TEXT} flex items-center gap-2`}
      >
        {item.label}
        <ChevronDown
          className={`w-4 h-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden w-full flex justify-center mt-3"
          >
            <div className="w-fit flex flex-col items-start gap-3">
              {item.children.map((child, idx) => (
                <button
                  key={child.href}
                  onClick={() => onNavigate(child.href)}
                  className={`pl-4 ${SUB_ITEM_TEXT} text-left`}
                >
                  <span className={NUMBER_PREFIX}>
                    {formatIndex(idx)}
                  </span>
                  {child.label}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export const Header = () => {
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const closeSearch = useCallback(() => setSearchOpen(false), []);

  // Check auth state
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setIsLoggedIn(!!data.user);
    });
  }, []);

  /** Navigate from mobile menu — start navigation first, then close menu */
  const mobileNavigate = useCallback((href: string) => {
    router.push(href);
    setMobileMenuOpen(false);
  }, [router]);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [mobileMenuOpen]);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Cmd+K / Ctrl+K to toggle search
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  return (
    <header
      className={`fixed top-0 w-full z-[100] transition-all duration-500 border-b ${
        scrolled ? 'bg-white/90 dark:bg-[#050505]/90 backdrop-blur-md border-neutral-200 dark:border-white/10' : 'bg-transparent border-transparent'
      }`}
    >
      <div className={`container mx-auto px-6 flex justify-between items-center h-20 relative z-50 ${mobileMenuOpen ? 'pointer-events-none' : ''}`}>
        {/* Logo */}
        <Link href="/" className="group flex items-center gap-4 pointer-events-auto">
          <ThabangLogo />
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden lg:flex items-center h-full gap-1">
          {MAIN_NAVIGATION.map((item) => (
            <NavItem
              key={item.label}
              label={item.label}
              to={item.href}
              items={item.children}
            />
          ))}
        </nav>

        {/* Right Actions */}
        <div className="hidden lg:flex items-center gap-6">
          <button
            onClick={() => setSearchOpen(true)}
            className="text-neutral-500 hover:text-black dark:hover:text-white transition-colors flex items-center gap-1.5"
          >
            <Search className="w-4 h-4" />
            <kbd className="hidden xl:inline text-[9px] font-mono text-neutral-500 border border-neutral-300 dark:border-neutral-700 px-1 py-0.5 rounded">⌘K</kbd>
          </button>
          <Link href="/contact" className="text-[10px] font-mono font-bold tracking-widest text-white bg-black dark:text-black dark:bg-white px-5 py-2 hover:opacity-80 transition-all duration-300 uppercase">
            Start Project
          </Link>
          <Link
            href={isLoggedIn ? '/dashboard' : '/login'}
            className="text-[10px] font-mono font-medium tracking-widest text-neutral-600 dark:text-neutral-400 hover:text-black dark:hover:text-white border border-neutral-300 dark:border-white/30 px-5 py-2 hover:opacity-80 transition-all duration-300 uppercase"
          >
            {isLoggedIn ? 'Dashboard' : 'Login'}
          </Link>
        </div>

        {/* Mobile Actions */}
        <div className="lg:hidden flex items-center gap-3 pointer-events-auto">
          <button
            onClick={() => setSearchOpen(true)}
            className="text-neutral-500 hover:text-black dark:hover:text-white transition-colors"
          >
            <Search className="w-5 h-5" />
          </button>
          <button
            className="text-black dark:text-white"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X /> : <Menu />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-white dark:bg-[#050505] min-h-screen overflow-y-auto flex flex-col justify-center items-center gap-6 lg:hidden"
          >
            {MAIN_NAVIGATION.map((item) => (
              <MobileNavSection
                key={item.label}
                item={item}
                onNavigate={mobileNavigate}
              />
            ))}

            <div className="mt-6 px-6 w-full flex flex-col gap-3">
              <button
                onClick={() => mobileNavigate('/contact')}
                className={`${ACTION_BTN} bg-white text-black border border-white`}
              >
                Start Project
              </button>
              <button
                onClick={() => mobileNavigate(isLoggedIn ? '/dashboard' : '/login')}
                className={`${ACTION_BTN} bg-transparent text-white border border-white/30`}
              >
                {isLoggedIn ? 'Dashboard' : 'Login'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Global Search Modal */}
      <GlobalSearch isOpen={searchOpen} onClose={closeSearch} />
    </header>
  );
};
