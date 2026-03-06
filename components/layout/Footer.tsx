'use client';

import React from 'react';
import Link from 'next/link';
import { Youtube, Instagram, Facebook, Twitter, Linkedin, Mail } from 'lucide-react';
import { FOOTER_SECTIONS, SOCIAL_LINKS, SITE_COPYRIGHT, SITE_NAME } from '@/lib/constants';

const IconMap: Record<string, React.ElementType> = {
  Youtube,
  Instagram,
  Facebook,
  Twitter,
  Linkedin,
  Mail
};

export const Footer = () => {
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
            <div className="flex gap-4 border-b border-black/20 dark:border-white/20 pb-2 max-w-md mb-10">
              <input
                type="email"
                placeholder="EMAIL ADDRESS"
                className="bg-transparent border-none outline-none text-black dark:text-white w-full placeholder-neutral-500 dark:placeholder-neutral-600 text-sm tracking-widest"
              />
              <button className="text-black dark:text-white text-xs font-bold tracking-widest hover:text-neutral-600 dark:hover:text-neutral-400">SUBSCRIBE</button>
            </div>

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
