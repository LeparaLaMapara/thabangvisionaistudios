import { describe, it, expect } from 'vitest';
import { lastUserText } from '@/lib/agents/last-user-text';
import { classifyIntent } from '@/lib/agents/router';

describe('reading what the person typed', () => {
  it('reads the chat window shape (parts)', () => {
    const body = { messages: [
      { role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'hello' }] },
      { role: 'user', parts: [{ type: 'text', text: 'I want to book a photographer for Saturday' }] },
    ] };
    expect(lastUserText(body)).toBe('I want to book a photographer for Saturday');
  });
  it('still reads the older content shape and a plain prompt', () => {
    expect(lastUserText({ messages: [{ role: 'user', content: 'rent a camera' }] })).toBe('rent a camera');
    expect(lastUserText({ prompt: 'quote please' })).toBe('quote please');
    expect(lastUserText(null)).toBe('');
  });
  it('a booking request now reaches the booking agent', () => {
    const text = lastUserText({ messages: [{ role: 'user', parts: [{ type: 'text', text: 'I want to book a photographer for my wedding' }] }] });
    expect(classifyIntent(text)).toBe('booking');
  });
});
