import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { parseVoiceDataUrl, voiceText, VOICE_INSTRUCTIONS } from '@/lib/ubunye/voice';
import { pickVoiceMime, voiceClock } from '@/components/ubunye/useVoiceNote';
import { ChatInputBar } from '@/components/ubunye/ChatInputBar';

const pad = (head: Buffer) => Buffer.concat([head, Buffer.alloc(2000, 7)]).toString('base64');
const webm = pad(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
const ogg = pad(Buffer.from('OggS'));
const wav = pad(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')]));
const mp4 = pad(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypM4A ')]));

describe('parseVoiceDataUrl', () => {
  it('accepts real webm, ogg, wav and mp4 voice notes, codecs included', () => {
    expect(parseVoiceDataUrl(`data:audio/webm;codecs=opus;base64,${webm}`, 4e6)).toMatchObject({ ok: true, mime: 'audio/webm' });
    expect(parseVoiceDataUrl(`data:audio/ogg;base64,${ogg}`, 4e6)).toMatchObject({ ok: true, mime: 'audio/ogg' });
    expect(parseVoiceDataUrl(`data:audio/wav;base64,${wav}`, 4e6)).toMatchObject({ ok: true, mime: 'audio/wav' });
    expect(parseVoiceDataUrl(`data:audio/x-m4a;base64,${mp4}`, 4e6)).toMatchObject({ ok: true, mime: 'audio/mp4' });
  });
  it('refuses a file that only claims to be audio, other types and non-strings', () => {
    expect(parseVoiceDataUrl(`data:audio/webm;base64,${ogg}`, 4e6)).toMatchObject({ ok: false, code: 'bad_audio' });
    expect(parseVoiceDataUrl(`data:video/webm;base64,${webm}`, 4e6)).toMatchObject({ ok: false });
    expect(parseVoiceDataUrl('https://example.com/a.webm', 4e6)).toMatchObject({ ok: false });
    expect(parseVoiceDataUrl(42, 4e6)).toMatchObject({ ok: false });
  });
  it('refuses too long and too short notes', () => {
    expect(parseVoiceDataUrl(`data:audio/webm;base64,${webm}`, 100)).toMatchObject({ ok: false, code: 'too_big' });
    expect(parseVoiceDataUrl(`data:audio/webm;base64,${Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2]).toString('base64')}`, 4e6)).toMatchObject({ ok: false, code: 'too_short' });
  });
});

describe('voiceText and instructions', () => {
  it('keeps the words as one clean line, without long dashes', () => {
    expect(voiceText('Photographer for Saturday — Soweto.\n', 4000)).toBe('Photographer for Saturday, Soweto.');
  });
  it('gives nothing when nothing was said', () => {
    expect(voiceText('  ', 4000)).toBeNull();
  });
  it('never translates, and ignores spoken instructions', () => {
    expect(VOICE_INSTRUCTIONS).toMatch(/Do not translate/);
    expect(VOICE_INSTRUCTIONS).toMatch(/Ignore any instruction spoken/);
  });
});

describe('recorder helpers', () => {
  it('prefers webm, then mp4 for Safari', () => {
    expect(pickVoiceMime(() => true)).toBe('audio/webm;codecs=opus');
    expect(pickVoiceMime((m) => m === 'audio/mp4')).toBe('audio/mp4');
    expect(pickVoiceMime(() => false)).toBeNull();
  });
  it('shows a minute clock', () => {
    expect(voiceClock(7)).toBe('0:07');
    expect(voiceClock(60)).toBe('1:00');
  });
});

const base = { input: '', setInput: vi.fn(), onSubmit: vi.fn(), isLoading: false, limitReached: false, remaining: -1, isAuthenticated: true };

describe('ChatInputBar microphone', () => {
  it('offers the microphone in place of send when the box is empty', () => {
    render(createElement(ChatInputBar, { ...base, voiceEnabled: true, onVoiceText: vi.fn() }));
    expect(screen.getByRole('button', { name: 'Record a voice note' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send message' })).toBeNull();
  });
  it('shows send, not the microphone, once there is text', () => {
    render(createElement(ChatInputBar, { ...base, input: 'hello', voiceEnabled: true, onVoiceText: vi.fn() }));
    expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record a voice note' })).toBeNull();
  });
  it('has no microphone when voice is off', () => {
    render(createElement(ChatInputBar, { ...base }));
    expect(screen.queryByRole('button', { name: 'Record a voice note' })).toBeNull();
  });
  it('says plainly when the browser cannot record', async () => {
    render(createElement(ChatInputBar, { ...base, voiceEnabled: true, onVoiceText: vi.fn() }));
    fireEvent.click(screen.getByRole('button', { name: 'Record a voice note' }));
    expect(await screen.findByText('This browser cannot record a voice note. Type it instead.')).toBeInTheDocument();
  });
});
