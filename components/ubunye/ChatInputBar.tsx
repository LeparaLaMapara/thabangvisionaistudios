'use client';

import { useRef, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { ArrowUp, ImagePlus, X } from 'lucide-react';
import { UBUNYE_PHOTO_POLICY } from '@/lib/constants';
import type { ChatPhoto } from '@/components/ubunye/useChatPhotos';

interface ChatInputBarProps {
  input: string;
  setInput: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
  limitReached: boolean;
  remaining: number;
  isAuthenticated: boolean;
  /** The page holds the box, so a tapped occasion can fill it and focus it. */
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  /** Photos are on (flag ubunye_projects for now): shows the photo button. */
  photosEnabled?: boolean;
  photos?: ChatPhoto[];
  photoNotice?: string | null;
  /** A photo is still being resized or read: sending waits for it. */
  photosBusy?: boolean;
  /** Send was pressed while a photo was being read: it goes by itself when reading ends. */
  sendQueued?: boolean;
  onAddPhotos?: (files: FileList) => void;
  onRemovePhoto?: (id: string) => void;
}

export function ChatInputBar({
  input,
  setInput,
  onSubmit,
  isLoading,
  limitReached,
  remaining,
  isAuthenticated,
  inputRef,
  photosEnabled = false,
  photos = [],
  photoNotice = null,
  photosBusy = false,
  sendQueued = false,
  onAddPhotos,
  onRemovePhoto,
}: ChatInputBarProps) {
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = inputRef ?? ownRef;
  const fileRef = useRef<HTMLInputElement>(null);

  // The box grows with its text, also when the page fills it (an occasion).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, [input, textareaRef]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
  }, [setInput]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit(e);
    }
    if (e.key === 'Escape') {
      e.currentTarget.blur();
    }
  }

  const handleFiles = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) onAddPhotos?.(files);
    // Cleared so choosing the same photo again still counts as a change.
    e.target.value = '';
  }, [onAddPhotos]);

  const showPhotos = photosEnabled && !!onAddPhotos;
  const readyPhotos = photos.filter((p) => p.status === 'ready').length;
  const hasSomething = input.trim().length > 0 || readyPhotos > 0;
  // Send may be pressed while a photo is still being read: it waits and goes by itself.
  const canSend = (hasSomething || photosBusy) && !sendQueued && !isLoading && !limitReached;
  const photoRoom = photos.length < UBUNYE_PHOTO_POLICY.perMessage;
  const photoErrors = photos.filter((p) => p.status === 'error' && p.error);

  return (
    <div className="pb-4 pt-3 flex-shrink-0">
      <form onSubmit={onSubmit}>
        <div className={`bg-[#0A0A0B] border rounded-2xl transition-all duration-200 ${
          limitReached
            ? 'border-white/5 opacity-40'
            : 'border-white/8 focus-within:border-[#D4A843]/60 focus-within:shadow-[0_0_20px_rgba(212,168,67,0.05)]'
        }`}>
          {/* Photos waiting to go with this message */}
          {showPhotos && photos.length > 0 && (
            <ul className="flex gap-3 px-3 pt-3" aria-label="Photos to send">
              {photos.map((p, i) => (
                <li key={p.id} className="relative">
                  <div className={`w-14 h-14 rounded-lg overflow-hidden bg-neutral-900 flex items-center justify-center ${p.status === 'error' ? 'ring-1 ring-amber-300/50' : ''}`}>
                    {p.dataUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.dataUrl} alt={`Photo ${i + 1}`} className={`w-full h-full object-cover ${p.status === 'ready' ? '' : 'opacity-60'}`} />
                    )}
                    {(p.status === 'resizing' || p.status === 'reading') && (
                      <span className="absolute inset-0 flex items-center justify-center" role="status">
                        <span aria-hidden="true" className="w-4 h-4 border-2 border-[#D4A843]/30 border-t-[#D4A843] rounded-full animate-spin" />
                        <span className="sr-only">Reading photo {i + 1}</span>
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemovePhoto?.(p.id)}
                    aria-label={`Remove photo ${i + 1}`}
                    className="absolute -top-4 -right-4 w-11 h-11 flex items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D4A843] rounded-full"
                  >
                    <span className="w-5 h-5 rounded-full bg-neutral-800 border border-white/15 flex items-center justify-center">
                      <X className="w-3 h-3 text-neutral-200" aria-hidden="true" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {showPhotos && (photoErrors.length > 0 || photoNotice) && (
            <div className="px-4 pt-2 space-y-0.5" aria-live="polite">
              {photoNotice && <p className="text-xs text-amber-200/80">{photoNotice}</p>}
              {photoErrors.map((p) => (
                <p key={p.id} className="text-xs text-amber-200/80">
                  {photos.length > 1 ? `Photo ${photos.indexOf(p) + 1}: ` : ''}{p.error}
                </p>
              ))}
            </div>
          )}

          <div className="flex items-end">
            {showPhotos && (
              <div className="pl-1 pb-1">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleFiles}
                  className="hidden"
                  tabIndex={-1}
                  aria-hidden="true"
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={!photoRoom || isLoading || limitReached}
                  aria-label="Add a photo"
                  className="w-11 h-11 flex items-center justify-center rounded-lg text-neutral-400 hover:text-[#D4A843] transition-colors disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D4A843]"
                >
                  <ImagePlus className="w-5 h-5" aria-hidden="true" />
                </button>
              </div>
            )}

            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              aria-label="Message Ubunye"
              placeholder={limitReached ? 'Message limit reached' : 'Ask Ubunye…'}
              disabled={isLoading || limitReached}
              rows={1}
              // 16px on phones: iOS Safari zooms the page into any smaller input.
              // The gold box border shows focus, so the global ring is not drawn
              // a second time inside it.
              className={`flex-1 min-w-0 bg-transparent focus-visible:outline-none! ${showPhotos ? 'pl-1' : 'pl-4'} pr-4 py-3 text-base md:text-[15px] text-white placeholder-neutral-400 outline-none resize-none disabled:opacity-50 leading-relaxed`}
              style={{ maxHeight: 120 }}
            />

            {/* Send button */}
            <div className="pr-1 pb-1">
              <button
                type="submit"
                aria-label={sendQueued ? 'Sending when your photo is read' : 'Send message'}
                disabled={!canSend}
                className={`w-11 h-11 flex items-center justify-center rounded-lg transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D4A843] ${
                  canSend ? 'bg-[#D4A843] text-black hover:bg-[#E8C96A]' : 'text-neutral-500'
                }`}
              >
                {sendQueued
                  ? <span className="w-4 h-4 rounded-full border-2 border-neutral-500 border-t-[#D4A843] animate-spin" aria-hidden="true" />
                  : <ArrowUp className="w-4 h-4" aria-hidden="true" />}
              </button>
            </div>
          </div>
        </div>
      </form>

      {/* Footer */}
      <div className="flex items-start justify-between gap-3 mt-2 px-1">
        <p className="text-xs text-neutral-400">
          Ubunye can make mistakes. Prices are confirmed at checkout.
        </p>
        {!limitReached && remaining !== -1 && (
          <p className="text-xs text-neutral-400 shrink-0" aria-live="polite">
            {isAuthenticated ? (
              <>{remaining} question{remaining === 1 ? '' : 's'} left today</>
            ) : (
              <>
                {remaining} free question{remaining === 1 ? '' : 's'}.{' '}
                <Link href="/login?next=/ubunye-ai-studio" className="text-[#D4A843] underline underline-offset-2">
                  Sign in for more
                </Link>
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
