'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Menu, X, ChevronDown, ShoppingCart } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { MAIN_NAVIGATION } from '@/lib/constants';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/providers/AuthProvider';
import { useCart } from '@/providers/CartProvider';
import { HeaderUbunyeBubble } from '@/components/ubunye/HeaderUbunyeBubble';
import { useFocusTrap } from '@/components/ui/useFocusTrap';

const ThabangLogo = () => (
  <Image
    // A 90px-tall copy: the original is 400x448 and 70 KB, shown at 32 to 40px.
    src="/logo-header-90.webp"
    alt="ThabangVision"
    width={80}
    height={90}
    priority
    className="h-8 md:h-10 w-auto select-none"
  />
);

// Shared style constants
const NAV_TEXT = "font-mono font-medium tracking-widest uppercase text-neutral-400 hover:text-white transition-colors duration-300";
const SUB_ITEM_TEXT = "text-xs font-mono tracking-widest uppercase text-neutral-400 hover:text-white transition-all duration-200";
const NUMBER_PREFIX = "text-neutral-400 mr-2";
const ACTION_BTN = "w-full px-6 py-3 font-mono font-medium tracking-widest uppercase text-sm hover:opacity-80 transition-all duration-300";

const formatIndex = (idx: number) => String(idx + 1).padStart(2, '0');

const NavItem = ({ label, to, items }: { label: string; to?: string; items?: readonly { label: string; href: string }[] }) => {
  const [isOpen, setIsOpen] = useState(false);

  const baseClasses = `px-4 py-2 text-xs ${NAV_TEXT} flex items-center gap-1 group-hover:bg-black/5 dark:group-hover:bg-white/5 cursor-pointer`;

  return (
    <div
      className="relative group h-full flex items-center"
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
      // Keyboard users reach the sub-links too: the menu opens while focus is
      // inside it and closes when focus leaves or on Escape.
      onFocus={() => setIsOpen(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setIsOpen(false);
      }}
    >
      {to ? (
        <Link href={to} className={baseClasses} aria-expanded={items ? isOpen : undefined}>
          {label}
          {items && <ChevronDown className="w-3 h-3 opacity-50" aria-hidden="true" />}
        </Link>
      ) : (
        <div className={baseClasses}>
          {label}
          {items && <ChevronDown className="w-3 h-3 opacity-50" aria-hidden="true" />}
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
              className="absolute top-full left-0 min-w-[240px] bg-[#050505] border border-white/20 p-2 shadow-2xl z-50 flex flex-col"
            >
              {items.map((child, idx) => (
                <Link
                  key={idx}
                  href={child.href}
                  className={`${SUB_ITEM_TEXT} hover:bg-white/10 hover:pl-3 block py-3 px-2 border-b border-white/5 last:border-0`}
                >
                  <span className={NUMBER_PREFIX} aria-hidden="true">{formatIndex(idx)}</span> {child.label}
                </Link>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
};

type NavigationItem = (typeof MAIN_NAVIGATION)[number];

const MobileNavSection = ({
  item,
  onNavigate,
}: {
  item: NavigationItem;
  onNavigate: (href: string) => void;
}) => {
  const [open, setOpen] = useState(false);

  if (!item.children) {
    return (
      <button
        onClick={() => onNavigate(item.href)}
        className={`text-sm min-h-[44px] ${NAV_TEXT}`}
      >
        {item.label}
      </button>
    );
  }

  return (
    <div className="w-full flex flex-col items-center">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={`text-sm min-h-[44px] ${NAV_TEXT} flex items-center gap-2`}
      >
        {item.label}
        <ChevronDown
          aria-hidden="true"
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
            <div className="w-fit flex flex-col items-start gap-1">
              {item.children.map((child, idx) => (
                <button
                  key={child.href}
                  onClick={() => onNavigate(child.href)}
                  className={`pl-4 min-h-[44px] flex items-center ${SUB_ITEM_TEXT} text-left`}
                >
                  <span className={NUMBER_PREFIX} aria-hidden="true">
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

export const Header = ({ navigation = MAIN_NAVIGATION }: { navigation?: readonly NavigationItem[] } = {}) => {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { count: cartCount } = useCart();
  const isLoggedIn = !!user;

  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMobileMenuOpen(false), []);

  // The open menu is a modal dialog: focus moves into it, Tab stays inside,
  // Escape closes it, and focus goes back to the menu button afterwards.
  // (Scroll lock stays in the effect below.)
  useFocusTrap(menuPanelRef, { active: mobileMenuOpen, onEscape: closeMenu, lockScroll: false });

  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    setMobileMenuOpen(false);
    window.location.href = '/';
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

  // Close mobile menu on the browser back button (Escape: see useFocusTrap)
  useEffect(() => {
    if (!mobileMenuOpen) return;

    window.history.pushState({ mobileMenu: true }, '');
    const handlePopState = () => setMobileMenuOpen(false);

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 w-full z-[300] transition-all duration-500 border-b ${
        scrolled ? 'bg-[#050505]/90 backdrop-blur-md border-white/10' : 'bg-transparent border-transparent'
      }`}
    >
      <div className="container mx-auto px-6 flex justify-between items-center h-20 relative z-50">
        {/* Logo */}
        <Link href="/" aria-label="ThabangVision home" className="group flex items-center gap-4 min-h-[44px] pointer-events-auto">
          <ThabangLogo />
        </Link>

        {/* Desktop Nav */}
        <nav aria-label="Main" className="hidden lg:flex items-center h-full gap-1">
          {navigation.map((item) => (
            <NavItem
              key={item.label}
              label={item.label}
              to={item.href}
              items={item.children}
            />
          ))}
        </nav>

        {/* Right Actions */}
        <div className="hidden lg:flex items-center gap-5">
          {isLoggedIn && (
            <Link
              href="/dashboard/cart"
              aria-label={cartCount > 0 ? `Cart, ${cartCount} item${cartCount === 1 ? '' : 's'}` : 'Cart'}
              className="relative w-11 h-11 flex items-center justify-center text-neutral-400 hover:text-white transition-colors"
            >
              <ShoppingCart className="w-4 h-4" aria-hidden="true" />
              {cartCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-[#D4A843] text-black text-xs leading-none font-mono font-bold min-w-5 h-5 px-1 rounded-full flex items-center justify-center">
                  {cartCount > 9 ? '9+' : cartCount}
                </span>
              )}
            </Link>
          )}
          <HeaderUbunyeBubble />
          {authLoading ? (
            <div className="w-24 h-11" />
          ) : isLoggedIn ? (
            <>
              <Link
                href="/dashboard"
                className="text-xs font-mono font-medium tracking-widest text-neutral-400 hover:text-white border border-white/30 px-5 min-h-[44px] inline-flex items-center hover:opacity-80 transition-all duration-300 uppercase"
              >
                Dashboard
              </Link>
              <button
                onClick={handleSignOut}
                disabled={signingOut}
                className="text-xs font-mono font-medium tracking-widest text-neutral-400 hover:text-red-400 px-5 min-h-[44px] hover:opacity-80 transition-all duration-300 uppercase disabled:opacity-50"
              >
                {signingOut ? 'Signing Out...' : 'Sign Out'}
              </button>
            </>
          ) : (
            <Link
              href="/login"
              className="text-xs font-mono font-medium tracking-widest text-neutral-400 hover:text-white border border-white/30 px-5 min-h-[44px] inline-flex items-center hover:opacity-80 transition-all duration-300 uppercase"
            >
              Sign In
            </Link>
          )}
        </div>

        {/* Mobile Actions */}
        <div className="lg:hidden flex items-center gap-3 pointer-events-auto">
          <HeaderUbunyeBubble />
          {isLoggedIn && (
            <Link
              href="/dashboard/cart"
              aria-label={cartCount > 0 ? `Cart, ${cartCount} item${cartCount === 1 ? '' : 's'}` : 'Cart'}
              className="relative w-11 h-11 flex items-center justify-center text-neutral-400 hover:text-white transition-colors"
            >
              <ShoppingCart className="w-5 h-5" aria-hidden="true" />
              {cartCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-[#D4A843] text-black text-xs leading-none font-mono font-bold min-w-5 h-5 px-1 rounded-full flex items-center justify-center">
                  {cartCount > 9 ? '9+' : cartCount}
                </span>
              )}
            </Link>
          )}
          <button
            className="text-white w-11 h-11 -mr-2 flex items-center justify-center"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileMenuOpen}
            aria-haspopup="dialog"
          >
            {mobileMenuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
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
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[200] lg:hidden"
            onClick={() => setMobileMenuOpen(false)}
          >
            <motion.div
              ref={menuPanelRef}
              role="dialog"
              aria-modal="true"
              aria-label="Menu"
              tabIndex={-1}
              initial={{ opacity: 0, y: -30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -30 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              // h-dvh + overflow-y-auto + justify-start: in landscape the
              // links are taller than the screen; centring them clipped the
              // top items off-screen where they could not be scrolled to.
              // The inner my-auto still centres them when they do fit.
              className="bg-[#050505] h-dvh overflow-y-auto overscroll-contain flex flex-col justify-start"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close button */}
              <button
                onClick={closeMenu}
                className="absolute top-0 right-0 z-10 p-6 min-h-[44px] min-w-[44px] flex items-center justify-center text-white"
                aria-label="Close menu"
              >
                <X className="w-6 h-6" aria-hidden="true" />
              </button>

              <nav aria-label="Main" className="my-auto w-full flex flex-col items-center gap-6 py-20">
              {navigation.map((item) => (
                <MobileNavSection
                  key={item.label}
                  item={item}
                  onNavigate={mobileNavigate}
                />
              ))}

              <div className="mt-6 px-6 w-full flex flex-col gap-3">
                <button
                  onClick={() => mobileNavigate('/ubunye-ai-studio')}
                  className={`${ACTION_BTN} bg-[#D4A843] text-black border border-[#D4A843] min-h-[44px]`}
                >
                  Ask Ubunye
                </button>
                {authLoading ? (
                  <div className="h-[44px]" />
                ) : isLoggedIn ? (
                  <>
                    <button
                      onClick={() => mobileNavigate('/dashboard')}
                      className={`${ACTION_BTN} bg-transparent text-white border border-white/30 min-h-[44px]`}
                    >
                      Dashboard
                    </button>
                    <button
                      onClick={handleSignOut}
                      disabled={signingOut}
                      className={`${ACTION_BTN} bg-transparent text-red-400 border border-red-400/30 hover:bg-red-400/10 min-h-[44px] disabled:opacity-50`}
                    >
                      {signingOut ? 'Signing Out...' : 'Sign Out'}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => mobileNavigate('/login')}
                    className={`${ACTION_BTN} bg-transparent text-white border border-white/30 min-h-[44px]`}
                  >
                    Sign In
                  </button>
                )}
              </div>
              </nav>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
};
