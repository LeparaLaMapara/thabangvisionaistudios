'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Recording a voice note in Plan: tap the microphone, speak, tap send. The
 * audio goes once to /api/ubunye-chat/voice and comes back as words, which
 * the page sends as the client's message. Nothing is kept in the browser
 * after that, and the microphone is released as soon as recording stops.
 */

export const VOICE_ROUTE = '/api/ubunye-chat/voice';

/** Recorder formats in order of preference (Chrome and Android: webm; Safari: mp4). */
const PREFERRED = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

export function pickVoiceMime(isSupported: (mime: string) => boolean): string | null {
  return PREFERRED.find((m) => isSupported(m)) ?? null;
}

/** "0:07", "1:00". */
export function voiceClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export type VoiceState = 'idle' | 'recording' | 'reading';

export interface VoiceNote {
  state: VoiceState;
  seconds: number;
  error: string | null;
  start: () => void;
  /** Stop and send. */
  stop: () => void;
  /** Stop and throw the recording away. */
  cancel: () => void;
  clearError: () => void;
}

export function useVoiceNote({ maxSeconds, onText }: { maxSeconds: number; onText: (text: string) => void }): VoiceNote {
  const [state, setState] = useState<VoiceState>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number | null>(null);
  const cancelled = useRef(false);
  const onTextRef = useRef(onText);
  useEffect(() => { onTextRef.current = onText; }, [onText]);

  const release = useCallback(() => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    recorder.current = null;
  }, []);

  const stop = useCallback(() => {
    const r = recorder.current;
    if (r && r.state === 'recording') r.stop();
  }, []);

  const send = useCallback(async (blob: Blob) => {
    setState('reading');
    try {
      const audio = await blobToDataUrl(blob);
      const res = await fetch(VOICE_ROUTE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ audio }),
      });
      const body = (await res.json().catch(() => ({}))) as { text?: unknown; error?: unknown };
      if (res.ok && typeof body.text === 'string' && body.text.trim()) onTextRef.current(body.text);
      else setError(typeof body.error === 'string' ? body.error : 'I could not hear that voice note. Try again, or type it.');
    } catch {
      setError('I could not send that voice note. Check your connection and try again.');
    } finally {
      setState('idle');
    }
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('This browser cannot record a voice note. Type it instead.');
      return;
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = media;
      const mime = pickVoiceMime((m) => MediaRecorder.isTypeSupported(m));
      const r = new MediaRecorder(media, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      cancelled.current = false;
      r.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.current.push(e.data); };
      r.onstop = () => {
        const blob = new Blob(chunks.current, { type: r.mimeType || mime || 'audio/webm' });
        chunks.current = [];
        release();
        if (cancelled.current) { setState('idle'); return; }
        void send(blob);
      };
      recorder.current = r;
      r.start(250);
      setSeconds(0);
      setState('recording');
      const startedAt = Date.now();
      timer.current = window.setInterval(() => {
        const s = Math.floor((Date.now() - startedAt) / 1000);
        setSeconds(s);
        if (s >= maxSeconds) stop();
      }, 250);
    } catch {
      release();
      setState('idle');
      setError('Allow the microphone to send a voice note, or type it.');
    }
  }, [maxSeconds, release, send, stop]);

  const cancel = useCallback(() => {
    cancelled.current = true;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    else { release(); setState('idle'); }
  }, [release]);

  // Leaving the page never leaves the microphone on.
  useEffect(() => () => {
    cancelled.current = true;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    release();
  }, [release]);

  return { state, seconds, error, start: () => void start(), stop, cancel, clearError: () => setError(null) };
}
