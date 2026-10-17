'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { UBUNYE_PHOTO_POLICY } from '@/lib/constants';
import { photoFileProblem, photosLeft } from '@/lib/ubunye/chat-photos';
import { resizePhoto } from '@/components/ubunye/photoResize';

/**
 * The photos waiting to go with the next message. Each one is resized in the
 * browser, then read by the photo route (POST /api/ubunye-chat/photo), which
 * answers with one line of text. Only that line is sent to Ubunye; the photo
 * itself stays in this tab for the thumbnail.
 */

export const PHOTO_ROUTE = '/api/ubunye-chat/photo';

export interface ChatPhoto {
  id: string;
  dataUrl: string | null;
  status: 'resizing' | 'reading' | 'ready' | 'error';
  /** The route's description line, once read. */
  text: string | null;
  /** A plain reason this photo will not go with the message. */
  error: string | null;
}

export interface ChatPhotos {
  photos: ChatPhoto[];
  /** A refusal that has no thumbnail (too big, too many). */
  notice: string | null;
  /** A photo is still being resized or read: sending waits. */
  busy: boolean;
  add: (files: FileList | File[]) => void;
  remove: (id: string) => void;
  /** Takes the photos out of the box (after a send) and returns them. */
  take: () => ChatPhoto[];
  /** Puts photos back (a send that was held back). */
  restore: (photos: ChatPhoto[]) => void;
}

const newId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `p-${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function readPhoto(dataUrl: string, signal: AbortSignal): Promise<{ text: string } | { error: string }> {
  try {
    const res = await fetch(PHOTO_ROUTE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ image: dataUrl }),
      signal,
    });
    const body = (await res.json().catch(() => ({}))) as { text?: unknown; error?: unknown };
    if (res.ok && typeof body.text === 'string' && body.text.trim()) {
      const line = body.text.trim().replace(/\s*\n+\s*/g, ' ');
      const prefix = UBUNYE_PHOTO_POLICY.descriptionPrefix;
      return { text: line.startsWith(prefix) ? line : `${prefix} ${line}` };
    }
    return { error: typeof body.error === 'string' && body.error.trim() ? body.error.trim().slice(0, 200) : 'Could not read this photo. You can still send your words.' };
  } catch {
    if (signal.aborted) return { error: '' };
    return { error: 'Could not read this photo. You can still send your words.' };
  }
}

export function useChatPhotos(): ChatPhotos {
  const [photos, setPhotos] = useState<ChatPhoto[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const photosRef = useRef<ChatPhoto[]>([]);
  const controllers = useRef(new Map<string, AbortController>());

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  useEffect(() => {
    const live = controllers.current;
    return () => {
      for (const c of live.values()) c.abort();
      live.clear();
    };
  }, []);

  const patch = useCallback((id: string, change: Partial<ChatPhoto>) => {
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, ...change } : p)));
  }, []);

  const process = useCallback(async (id: string, file: File) => {
    const controller = new AbortController();
    controllers.current.set(id, controller);
    try {
      let dataUrl: string;
      try {
        dataUrl = await resizePhoto(file);
      } catch {
        if (!controller.signal.aborted) patch(id, { status: 'error', error: 'Could not open this photo. Try another one.' });
        return;
      }
      if (controller.signal.aborted) return;
      patch(id, { dataUrl, status: 'reading' });
      const read = await readPhoto(dataUrl, controller.signal);
      if (controller.signal.aborted) return;
      if ('text' in read) patch(id, { status: 'ready', text: read.text });
      else patch(id, { status: 'error', error: read.error });
    } finally {
      controllers.current.delete(id);
    }
  }, [patch]);

  const add = useCallback((files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    const room = photosLeft(photosRef.current.length);
    const problems: string[] = [];
    if (list.length > room) {
      problems.push(`You can send up to ${UBUNYE_PHOTO_POLICY.perMessage} photos at a time.`);
    }
    const accepted: { photo: ChatPhoto; file: File }[] = [];
    for (const file of list.slice(0, room)) {
      const problem = photoFileProblem(file);
      if (problem) {
        if (!problems.includes(problem)) problems.push(problem);
        continue;
      }
      accepted.push({ photo: { id: newId(), dataUrl: null, status: 'resizing', text: null, error: null }, file });
    }
    setNotice(problems.length ? problems.join(' ') : null);
    if (accepted.length === 0) return;
    const next = [...photosRef.current, ...accepted.map((a) => a.photo)];
    photosRef.current = next;
    setPhotos(next);
    for (const a of accepted) void process(a.photo.id, a.file);
  }, [process]);

  const remove = useCallback((id: string) => {
    controllers.current.get(id)?.abort();
    controllers.current.delete(id);
    setNotice(null);
    setPhotos((prev) => {
      const next = prev.filter((p) => p.id !== id);
      photosRef.current = next;
      return next;
    });
  }, []);

  const take = useCallback((): ChatPhoto[] => {
    const taken = photosRef.current;
    photosRef.current = [];
    setPhotos([]);
    setNotice(null);
    return taken;
  }, []);

  const restore = useCallback((back: ChatPhoto[]) => {
    const next = [...back, ...photosRef.current].slice(0, UBUNYE_PHOTO_POLICY.perMessage);
    photosRef.current = next;
    setPhotos(next);
  }, []);

  const busy = photos.some((p) => p.status === 'resizing' || p.status === 'reading');

  return { photos, notice, busy, add, remove, take, restore };
}
