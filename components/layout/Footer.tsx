'use client';

import React, { useState, useCallback } from 'react';
import Link from 'next/link';
import { Youtube, Instagram, Facebook, Twitter, Linkedin, Mail, Loader2, CheckCircle2 } from 'lucide-react';
import { FOOTER_SECTIONS, SOCIAL_LINKS, SITE_COPYRIGHT, SITE_NAME, STUDIO } from '@/lib/constants';

const IconMap: Record<string, React.ElementType> = {
  Youtube,
  Instagram,
  Facebook,
  Twitter,
  Linkedin,
  Mail
};

export const Footer = () => {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubscribe = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setStatus('error');
      setErrorMsg('Please enter a valid email address.');
      return;
    }
    setStatus('loading');
    try {
      const res = await fetch('/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Something went wrong.');
      }
      setStatus('success');
      setEmail('');
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong.');
    }
  }, [email]);

  return (
    <footer className="bg-neutral-100 dark:bg-black border-t border-black/5 dark:border-white/10 pt-20 pb-10 transition-colors duration-500">
      <div className="container mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-20">

          {FOOTER_SECTIONS.map((section) => (
            <div key={section.title}>
              <h4 className="text-sm font-bold tracking-widest text-black dark:text-white mb-6 uppercase">{section.title}</h4>
              <ul className="space-y-3 text-sm text-neutral-600 dark:text-neutral-500">
                {section.links.map((link) => (
                  <li key={link.label}>
                     {link.href.startsWith('/') ? (
                        <Link href={link.href} className="hover:text-black dark:hover:text-white transition-colors cursor-pointer">
                          {link.label}
                        </Link>
                     ) : (
                        <a href={link.href} className="hover:text-black dark:hover:text-white transition-colors cursor-pointer">
                          {link.label}
                        </a>
                     )}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div className="col-span-1 md:col-span-2">
            <h4 className="text-sm font-bold tracking-widest text-black dark:text-white mb-6 uppercase">Newsletter</h4>
            <p className="text-neutral-600 dark:text-neutral-500 text-sm mb-6 max-w-md">
              Subscribe to receive the latest technical updates, product releases, and cinematic stories from the {SITE_NAME} world.
            </p>
            {status === 'success' ? (
              <div className="flex items-center gap-2 text-green-600 dark:text-green-400 text-sm font-mono mb-10 max-w-md">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                <span>You&apos;re subscribed. Welcome to the {SITE_NAME} world.</span>
              </div>
            ) : (
              <form onSubmit={handleSubscribe} className="max-w-md mb-10">
                <div className="flex gap-4 border-b border-black/20 dark:border-white/20 pb-2">
                  <input
                    type="email"
                    value={email}
                    onChange={e => { setEmail(e.target.value); if (status === 'error') setStatus('idle'); }}
                    placeholder="EMAIL ADDRESS"
                    required
                    className="bg-transparent border-none outline-none text-black dark:text-white w-full placeholder-neutral-500 dark:placeholder-neutral-600 text-sm tracking-widest"
                  />
                  <button
                    type="submit"
                    disabled={status === 'loading'}
                    className="text-black dark:text-white text-xs font-bold tracking-widest hover:text-neutral-600 dark:hover:text-neutral-400 disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {status === 'loading' ? <Loader2 className="w-3 h-3 animate-spin" /> : 'SUBSCRIBE'}
                  </button>
                </div>
                {status === 'error' && (
                  <p className="text-red-500 text-xs font-mono mt-2">{errorMsg}</p>
                )}
                <p className="text-[10px] font-mono text-neutral-500 mt-3 leading-relaxed">
                  By subscribing you agree to receive occasional marketing email from us.
                  You can{' '}
                  <Link href="/unsubscribe" className="underline underline-offset-2 hover:text-black dark:hover:text-white transition-colors">
                    unsubscribe
                  </Link>{' '}
                  at any time. See our{' '}
                  <Link href="/privacy" className="underline underline-offset-2 hover:text-black dark:hover:text-white transition-colors">
                    Privacy Policy
                  </Link>.
                </p>
              </form>
            )}

            <div className="flex gap-6">
              {SOCIAL_LINKS.map((social) => {
                const Icon = IconMap[social.platform];
                return (
                  <a
                    key={social.platform}
                    href={social.href}
                    className="text-neutral-500 hover:text-black dark:hover:text-white transition-colors transform hover:-translate-y-1 duration-300"
                    aria-label={social.platform}
                  >
                    {Icon && <Icon className="w-5 h-5" />}
                  </a>
                );
              })}
            </div>
          </div>
        </div>

        {/* Registered business details.
            Required for payment-provider compliance, but presented as an
            identity block rather than a footnote: a gold rule and the same
            micro-label vocabulary the legal pages use, with each fact given a
            label instead of being run together with pipe separators.
            Semantic dl/dt/dd, so a screen reader reads label-then-value. */}
        <div className="border-t border-black/5 dark:border-white/5 pt-12 pb-10">
          <div className="w-8 h-px bg-[#D4A843] mb-6" />

          <p className="text-xs md:text-sm font-mono uppercase tracking-[0.2em] text-neutral-700 dark:text-neutral-300 mb-8">
            {STUDIO.legal.companyName}
          </p>

          <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-10 gap-y-7">
            <div>
              <dt className="text-[9px] font-mono uppercase tracking-[0.25em] text-neutral-500 dark:text-neutral-500 mb-2">
                Registration
              </dt>
              <dd className="text-[11px] font-mono text-neutral-600 dark:text-neutral-400 leading-relaxed">
                {STUDIO.legal.registrationNumber}
              </dd>
            </div>

            {(STUDIO.legal.vatNumber || STUDIO.legal.vatRegistered) && (
              <div>
                <dt className="text-[9px] font-mono uppercase tracking-[0.25em] text-neutral-500 dark:text-neutral-500 mb-2">
                  VAT
                </dt>
                <dd className="text-[11px] font-mono text-neutral-600 dark:text-neutral-400 leading-relaxed">
                  {STUDIO.legal.vatNumber || 'Registered vendor'}
                </dd>
              </div>
            )}

            {STUDIO.legal.registeredAddress && (
              <div>
                <dt className="text-[9px] font-mono uppercase tracking-[0.25em] text-neutral-500 dark:text-neutral-500 mb-2">
                  Registered address
                </dt>
                <dd className="text-[11px] font-mono text-neutral-600 dark:text-neutral-400 leading-relaxed">
                  {STUDIO.legal.registeredAddress}
                </dd>
              </div>
            )}

            <div>
              <dt className="text-[9px] font-mono uppercase tracking-[0.25em] text-neutral-500 dark:text-neutral-500 mb-2">
                Contact
              </dt>
              <dd className="text-[11px] font-mono text-neutral-600 dark:text-neutral-400 leading-relaxed">
                <a
                  href={`tel:${STUDIO.phone.replace(/\s+/g, '')}`}
                  className="hover:text-black dark:hover:text-white transition-colors"
                >
                  {STUDIO.phone}
                </a>
                <br />
                <a
                  href={`mailto:${STUDIO.email}`}
                  className="hover:text-[#D4A843] transition-colors"
                >
                  {STUDIO.email}
                </a>
              </dd>
            </div>
          </dl>
        </div>

        <div className="flex flex-col md:flex-row justify-between items-center border-t border-black/5 dark:border-white/5 pt-10">
          <div className="text-2xl font-black tracking-[0.2em] text-neutral-200 dark:text-white/20 italic mb-4 md:mb-0">
            {SITE_NAME}
          </div>
          <p className="text-xs text-neutral-500 dark:text-neutral-600 tracking-widest">
            {SITE_COPYRIGHT}
          </p>
        </div>
      </div>
    </footer>
  );
};
