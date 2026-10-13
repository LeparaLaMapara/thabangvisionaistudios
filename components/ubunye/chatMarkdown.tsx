'use client';

import Link from 'next/link';
import type { Components } from 'react-markdown';
import { chatImageAlt, chatLinkTarget } from '@/lib/ubunye/chat-links';

/**
 * How Ubunye replies (model-written markdown) are rendered. Raw HTML is not
 * parsed (no rehype-raw).
 */
export const chatMarkdownComponents: Components = {
  // Links and images from the model are untrusted (security LLM-2/LLM-3):
  // only same-site paths and allowlisted https hosts are clickable, and an
  // image is never loaded (a markdown image would fetch an attacker URL
  // with zero clicks). See lib/ubunye/chat-links.ts.
  a: ({ href, children }) => {
    const target = chatLinkTarget(href, typeof window !== 'undefined' ? window.location.hostname : undefined);
    if (target.kind === 'internal') {
      return (
        <Link href={target.href} className="text-[#D4A843] underline decoration-[#D4A843]/30 underline-offset-2 hover:decoration-[#D4A843] transition-colors">
          {children}
        </Link>
      );
    }
    if (target.kind === 'text') {
      return <span className="text-[#D4A843]">{children}</span>;
    }
    return (
      <a href={target.href} className="text-[#D4A843] underline decoration-[#D4A843]/30 underline-offset-2 hover:decoration-[#D4A843] transition-colors" target="_blank" rel="noopener noreferrer nofollow">
        {children}
      </a>
    );
  },
  img: ({ alt }) => {
    const text = chatImageAlt(typeof alt === 'string' ? alt : '');
    return text ? <span className="text-neutral-500">{text}</span> : null;
  },
  strong: ({ children }) => <strong className="text-white font-semibold">{children}</strong>,
  em: ({ children }) => <em className="text-neutral-200">{children}</em>,
  p: ({ children }) => <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="ml-4 mb-3 space-y-1 list-disc">{children}</ul>,
  ol: ({ children }) => <ol className="ml-4 mb-3 space-y-1 list-decimal">{children}</ol>,
  li: ({ children }) => <li className="text-neutral-400 leading-relaxed">{children}</li>,
  h1: ({ children }) => <h1 className="text-white font-semibold text-lg mt-5 mb-2">{children}</h1>,
  h2: ({ children }) => <h2 className="text-white font-semibold text-base mt-5 mb-2">{children}</h2>,
  h3: ({ children }) => <h3 className="text-white font-semibold mt-4 mb-2">{children}</h3>,
  h4: ({ children }) => <h4 className="text-neutral-200 font-semibold mt-3 mb-1">{children}</h4>,
  code: ({ children, className }) => {
    if (className?.includes('language-')) {
      return (
        <code className="block bg-neutral-900/80 px-4 py-3 my-3 text-[13px] font-mono text-neutral-300 overflow-x-auto border border-white/5">
          {children}
        </code>
      );
    }
    return (
      <code className="bg-neutral-800/80 px-1.5 py-0.5 text-[13px] font-mono text-[#D4A843]">
        {children}
      </code>
    );
  },
  pre: ({ children }) => <pre className="my-3">{children}</pre>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-[#D4A843]/30 pl-4 my-3 text-neutral-400">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-neutral-800 my-4" />,
  table: ({ children }) => (
    <div className="overflow-x-auto my-3">
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b border-neutral-700">{children}</thead>,
  th: ({ children }) => <th className="text-left text-neutral-300 font-semibold px-3 py-2 text-sm">{children}</th>,
  td: ({ children }) => <td className="px-3 py-2 border-b border-neutral-800/50 text-sm">{children}</td>,
};
