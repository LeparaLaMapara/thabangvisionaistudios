'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { Search, Menu, X, ChevronDown, Sun, Moon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { MAIN_NAVIGATION } from '@/lib/constants';

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

const NavItem = ({ label, to, items }: { label: string; to?: string; items?: any[]; key?: any }) => {
  const [isOpen, setIsOpen] = useState(false);

  const baseClasses = "px-4 py-2 text-[10px] font-mono font-medium tracking-widest text-neutral-600 dark:text-neutral-400 hover:text-black dark:hover:text-white transition-colors duration-300 uppercase flex items-center gap-1 group-hover:bg-black/5 dark:group-hover:bg-white/5 cursor-pointer";

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
                  className="text-xs font-mono text-neutral-600 dark:text-neutral-400 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 hover:pl-3 transition-all duration-200 block py-3 px-2 border-b border-neutral-100 dark:border-white/5 last:border-0"
                >
                  <span className="mr-2 text-neutral-400 dark:text-neutral-600">0{idx + 1}</span> {child.label}
                </Link>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
};

export const Header = () => {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const isDark = resolvedTheme === 'dark';

  const toggleTheme = () => {
    setTheme(isDark ? 'light' : 'dark');
  };

  return (
    <header
      className={`fixed top-0 w-full z-[100] transition-all duration-500 border-b ${
        scrolled ? 'bg-white/90 dark:bg-[#050505]/90 backdrop-blur-md border-neutral-200 dark:border-white/10' : 'bg-transparent border-transparent'
      }`}
    >
      <div className="container mx-auto px-6 flex justify-between items-center h-20">
        {/* Logo */}
        <Link href="/" className="z-50 group flex items-center gap-4">
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
          {mounted && (
            <button
              onClick={toggleTheme}
              className="text-neutral-500 hover:text-black dark:hover:text-white transition-colors"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          )}
          <button className="text-neutral-500 hover:text-black dark:hover:text-white transition-colors">
            <Search className="w-4 h-4" />
          </button>
          <Link href="/contact" className="text-[10px] font-mono font-bold tracking-widest text-white bg-black dark:text-black dark:bg-white px-5 py-2 hover:opacity-80 transition-all duration-300 uppercase">
            Start Project
          </Link>
        </div>

        {/* Mobile Toggle */}
        <button
          className="lg:hidden text-black dark:text-white z-50"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? <X /> : <Menu />}
        </button>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-white dark:bg-[#050505] z-40 flex flex-col justify-center items-center gap-8 lg:hidden"
          >
            {mounted && (
              <button onClick={toggleTheme} className="text-black dark:text-white mb-4">
                {isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
              </button>
            )}
            <Link href="/smart-production" onClick={() => setMobileMenuOpen(false)} className="text-3xl font-display font-medium text-black dark:text-white">PROJECTS</Link>
            <Link href="/lab" onClick={() => setMobileMenuOpen(false)} className="text-3xl font-display font-medium text-black dark:text-white">THE LAB</Link>
            <Link href="/smart-rentals" onClick={() => setMobileMenuOpen(false)} className="text-3xl font-display font-medium text-black dark:text-white">SMART RENTALS</Link>
            <Link href="/resources/tools" onClick={() => setMobileMenuOpen(false)} className="text-3xl font-display font-medium text-black dark:text-white">TOOLS</Link>
            <Link href="/contact" onClick={() => setMobileMenuOpen(false)} className="text-3xl font-display font-medium text-black dark:text-white">CONTACT</Link>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
};
