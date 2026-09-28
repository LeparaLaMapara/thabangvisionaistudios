'use client';

import { Share2, Twitter, Facebook, Linkedin, Link2, Check } from 'lucide-react';
import { useState } from 'react';
import { STUDIO } from '@/lib/constants';

interface ShareButtonsProps {
  title: string;
  path: string;
  className?: string;
}

export function ShareButtons({ title, path, className = '' }: ShareButtonsProps) {
  const [copied, setCopied] = useState(false);
  const url = `${STUDIO.meta.url}${path}`;
  const text = encodeURIComponent(title);
  const encodedUrl = encodeURIComponent(url);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback — silently fail
    }
  };

  const links = [
    {
      label: 'X',
      icon: Twitter,
      href: `https://x.com/intent/tweet?text=${text}&url=${encodedUrl}`,
    },
    {
      label: 'Facebook',
      icon: Facebook,
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
    },
    {
      label: 'LinkedIn',
      icon: Linkedin,
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
    },
  ];

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <span className="text-[9px] font-mono uppercase tracking-widest text-neutral-400 mr-2">
        <Share2 className="w-3 h-3 inline mr-1" />
        Share
      </span>
      {links.map(({ label, icon: Icon, href }) => (
        <a
          key={label}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Share on ${label}`}
          className="p-2 text-neutral-400 hover:text-white transition-colors"
        >
          <Icon className="w-3.5 h-3.5" />
        </a>
      ))}
      <button
        onClick={handleCopy}
        aria-label="Copy link"
        className="p-2 text-neutral-400 hover:text-white transition-colors"
      >
        {copied ? (
          <Check className="w-3.5 h-3.5 text-emerald-500" />
        ) : (
          <Link2 className="w-3.5 h-3.5" />
        )}
      </button>
    </div>
  );
}
