'use client';

import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Keyboard-reachable elements inside `container`, in DOM order, skipping hidden ones. */
export function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.closest('[inert]') && el.getClientRects().length > 0,
  );
}

interface FocusTrapOptions {
  /** Trap only while true -- typically the dialog's `open` state. */
  active: boolean;
  /** Called on Escape. Leave out to ignore Escape. */
  onEscape?: () => void;
  /** Element to focus on open. Defaults to the first focusable element. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Lock page scroll while open (default true). */
  lockScroll?: boolean;
}

/**
 * Modal focus handling for a dialog: moves focus in on open, keeps Tab and
 * Shift+Tab inside, closes on Escape, locks page scroll, and returns focus to
 * whatever had it before (normally the button that opened the dialog).
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  { active, onEscape, initialFocus, lockScroll = true }: FocusTrapOptions,
): void {
  // Read the latest callback without re-running the effect (which would
  // steal focus back to the first element on every parent render).
  const escapeRef = useRef(onEscape);
  useEffect(() => {
    escapeRef.current = onEscape;
  });

  useEffect(() => {
    if (!active) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const frame = requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;
      const target = initialFocus?.current ?? getFocusable(container)[0] ?? container;
      target.focus({ preventScroll: true });
    });

    const previousOverflow = document.body.style.overflow;
    if (lockScroll) document.body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && escapeRef.current) {
        e.stopPropagation();
        escapeRef.current();
        return;
      }
      const container = containerRef.current;
      if (e.key !== 'Tab' || !container) return;

      const items = getFocusable(container);
      if (items.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      const outside = !container.contains(current);

      if (e.shiftKey && (current === first || outside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (current === last || outside)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      if (lockScroll) document.body.style.overflow = previousOverflow;
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [active, containerRef, initialFocus, lockScroll]);
}
