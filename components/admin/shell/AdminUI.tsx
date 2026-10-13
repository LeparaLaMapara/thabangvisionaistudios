'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

/**
 * In-page replacements for window.confirm, window.prompt and window.alert.
 *
 * The browser's own boxes cannot show names or amounts clearly, look like an
 * error, and on a phone can be blocked. These say what will happen in plain
 * words, with the button naming the action ("Refund R1 200", not "OK").
 *
 *   const ui = useAdminUI();
 *   if (!(await ui.confirm({ title: 'Refund Lerato R1 200?', action: 'Refund R1 200', danger: true }))) return;
 *   const reason = await ui.ask({ title: 'Why is it cancelled?', label: 'Reason', action: 'Cancel booking' });
 *   ui.notify('Payout sent to Naledi.', 'good');
 */

export type Tone = 'good' | 'bad' | 'info';

export interface ConfirmOptions {
  title: string;
  /** What happens, in one or two plain sentences. */
  body?: string;
  /** The button's words. Say the action, not "OK". */
  action?: string;
  cancel?: string;
  /** Red button: money moves, something is removed or someone is blocked. */
  danger?: boolean;
}

export interface AskOptions extends ConfirmOptions {
  label: string;
  placeholder?: string;
  initial?: string;
  /** A longer answer gets a text area. */
  multiline?: boolean;
  /** An empty answer is refused unless this is false. */
  required?: boolean;
}

interface AdminUI {
  confirm: (o: ConfirmOptions) => Promise<boolean>;
  ask: (o: AskOptions) => Promise<string | null>;
  notify: (message: string, tone?: Tone) => void;
}

const Ctx = createContext<AdminUI | null>(null);

/** The admin's dialog and notice helpers. Outside the admin frame it falls back to the browser's boxes. */
export function useAdminUI(): AdminUI {
  const ui = useContext(Ctx);
  if (ui) return ui;
  return {
    confirm: async (o) => window.confirm([o.title, o.body].filter(Boolean).join('\n\n')),
    ask: async (o) => window.prompt([o.title, o.body].filter(Boolean).join('\n\n'), o.initial ?? ''),
    notify: (m) => window.alert(m),
  };
}

type Pending =
  | { kind: 'confirm'; o: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'ask'; o: AskOptions; resolve: (v: string | null) => void };

interface Notice {
  id: number;
  message: string;
  tone: Tone;
}

const TONE = {
  good: { Icon: CheckCircle2, cls: 'border-emerald-500/30 text-emerald-200' },
  bad: { Icon: AlertTriangle, cls: 'border-red-500/40 text-red-200' },
  info: { Icon: Info, cls: 'border-white/15 text-neutral-200' },
} as const;

export function AdminUIProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [value, setValue] = useState('');
  const [notices, setNotices] = useState<Notice[]>([]);
  const nextId = useRef(1);
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const actionBtn = useRef<HTMLButtonElement>(null);

  const confirm = useCallback(
    (o: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ kind: 'confirm', o, resolve })),
    [],
  );
  const ask = useCallback(
    (o: AskOptions) =>
      new Promise<string | null>((resolve) => {
        setValue(o.initial ?? '');
        setPending({ kind: 'ask', o, resolve });
      }),
    [],
  );
  const notify = useCallback((message: string, tone: Tone = 'info') => {
    const id = nextId.current++;
    setNotices((n) => [...n.slice(-2), { id, message, tone }]);
    // Problems stay until closed; good news and info go by themselves.
    if (tone !== 'bad') setTimeout(() => setNotices((n) => n.filter((x) => x.id !== id)), 6000);
  }, []);

  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => (pending.kind === 'ask' ? field.current?.focus() : actionBtn.current?.focus()), 10);
    return () => clearTimeout(t);
  }, [pending]);

  function close(answer: boolean) {
    if (!pending) return;
    if (pending.kind === 'confirm') pending.resolve(answer);
    else pending.resolve(answer ? value.trim() : null);
    setPending(null);
  }

  const askRequired = pending?.kind === 'ask' && pending.o.required !== false;
  const canSubmit = !(askRequired && !value.trim());

  return (
    <Ctx.Provider value={{ confirm, ask, notify }}>
      {children}

      {pending && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center p-4 sm:items-center"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="admin-dialog-title"
          onKeyDown={(e) => {
            if (e.key === 'Escape') close(false);
          }}
        >
          <button type="button" aria-label="Close" className="absolute inset-0 bg-black/75" onClick={() => close(false)} />
          <form
            className="relative w-full max-w-md rounded-2xl border border-white/15 bg-[#111] p-5 shadow-2xl"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit) close(true);
            }}
          >
            <h2 id="admin-dialog-title" className="pr-8 font-display text-lg text-white">
              {pending.o.title}
            </h2>
            {pending.o.body && <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-neutral-300">{pending.o.body}</p>}
            {pending.kind === 'ask' && (
              <label className="mt-4 block">
                <span className="text-sm text-neutral-300">{pending.o.label}</span>
                {pending.o.multiline ? (
                  <textarea
                    ref={field}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={pending.o.placeholder}
                    rows={4}
                    className="mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-base text-white placeholder:text-neutral-500 focus:border-accent-gold focus:outline-none"
                  />
                ) : (
                  <input
                    ref={field}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={pending.o.placeholder}
                    className="mt-1 h-11 w-full rounded-lg border border-white/15 bg-black/40 px-3 text-base text-white placeholder:text-neutral-500 focus:border-accent-gold focus:outline-none"
                  />
                )}
              </label>
            )}
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => close(false)}
                className="min-h-[44px] rounded-full border border-white/15 px-5 text-sm text-neutral-200 hover:bg-white/5"
              >
                {pending.o.cancel ?? 'Go back'}
              </button>
              <button
                ref={actionBtn}
                type="submit"
                disabled={!canSubmit}
                className={`min-h-[44px] rounded-full px-5 text-sm font-semibold disabled:opacity-40 ${
                  pending.o.danger ? 'bg-red-600 text-white hover:bg-red-500' : 'bg-foreground text-background hover:opacity-90'
                }`}
              >
                {pending.o.action ?? 'Continue'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[80] flex flex-col items-center gap-2 px-4 lg:bottom-6" aria-live="polite">
        {notices.map((n) => {
          const t = TONE[n.tone];
          return (
            <div
              key={n.id}
              role={n.tone === 'bad' ? 'alert' : 'status'}
              className={`pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border bg-[#111] px-4 py-3 text-sm shadow-xl ${t.cls}`}
            >
              <t.Icon className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
              <span className="flex-1 leading-snug">{n.message}</span>
              <button
                type="button"
                aria-label="Close notice"
                onClick={() => setNotices((x) => x.filter((y) => y.id !== n.id))}
                className="-m-1 p-1 text-neutral-400 hover:text-white"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}
