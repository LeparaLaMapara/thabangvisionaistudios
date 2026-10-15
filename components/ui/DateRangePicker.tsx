'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';

export interface DateRange {
  start: Date | null;
  end: Date | null;
}

interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  minDate?: Date;
  maxDate?: Date;
  label?: string;
  error?: string;
  className?: string;
  /** Helper text under the field, read out with it. */
  hint?: string;
  /**
   * Fewest days between the first and last day picked. With 1, picking the
   * same day twice keeps the calendar open and asks for a later day instead
   * of making a range the server refuses. Default 0 (same day allowed).
   */
  minNights?: number;
  /** Most days between the first and last day picked; later days are disabled once a start is chosen. */
  maxNights?: number;
}

const DAYS: { short: string; long: string }[] = [
  { short: 'Mo', long: 'Monday' },
  { short: 'Tu', long: 'Tuesday' },
  { short: 'We', long: 'Wednesday' },
  { short: 'Th', long: 'Thursday' },
  { short: 'Fr', long: 'Friday' },
  { short: 'Sa', long: 'Saturday' },
  { short: 'Su', long: 'Sunday' },
];

/**
 * A two-click date range picker (first day, then last day).
 *
 * Accessible: the trigger names its label and value and says whether the
 * calendar is open; every day is a 44px button named with its full date;
 * the calendar is operable by keyboard (arrows, Home/End, Page Up/Down,
 * Enter or Space to pick, Escape to close) and closes on a click outside.
 */
export function DateRangePicker({
  value,
  onChange,
  minDate,
  maxDate,
  label,
  error,
  className = '',
  hint,
  minNights = 0,
  maxNights,
}: DateRangePickerProps) {
  const uid = useId();
  const labelId = `${uid}-label`;
  const valueId = `${uid}-value`;
  const popupId = `${uid}-calendar`;
  const errorId = `${uid}-error`;
  const hintId = `${uid}-hint`;

  const [isOpen, setIsOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => firstOfMonth(value.start ?? minDate ?? new Date()));
  const [focusDate, setFocusDate] = useState<Date>(() => stripTime(value.start ?? minDate ?? new Date()));
  const [status, setStatus] = useState('');

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const moveFocusRef = useRef(false);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const weeks = useMemo(() => buildCalendarWeeks(year, month), [year, month]);

  // Days after start + maxNights cannot be the end of this range.
  const lastAllowed = useMemo(() => {
    const limits: Date[] = [];
    if (maxDate) limits.push(stripTime(maxDate));
    if (maxNights !== undefined && value.start && !value.end) limits.push(addDays(stripTime(value.start), maxNights));
    return limits.length ? new Date(Math.min(...limits.map((d) => d.getTime()))) : null;
  }, [maxDate, maxNights, value.start, value.end]);

  const isDisabled = useCallback(
    (day: Date): boolean => {
      if (minDate && day < stripTime(minDate)) return true;
      if (lastAllowed && day > lastAllowed) return true;
      return false;
    },
    [minDate, lastAllowed],
  );

  const close = useCallback((returnFocus: boolean) => {
    setIsOpen(false);
    setStatus('');
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  const open = () => {
    const start = stripTime(value.start ?? minDate ?? new Date());
    setFocusDate(start);
    setViewDate(firstOfMonth(start));
    moveFocusRef.current = true;
    setIsOpen(true);
  };

  // While the calendar is open, floating buttons (Ask Ubunye) step aside so
  // they never cover a date: app/globals.css hides [data-floating] under it.
  useEffect(() => {
    if (!isOpen) return;
    document.body.dataset.calendarOpen = 'true';
    return () => {
      delete document.body.dataset.calendarOpen;
    };
  }, [isOpen]);

  // Close on a click or tap outside.
  useEffect(() => {
    if (!isOpen) return;
    const onPointer = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
    };
  }, [isOpen, close]);

  // Keyboard focus follows the focused day once the calendar has rendered it.
  useEffect(() => {
    if (!isOpen || !moveFocusRef.current) return;
    moveFocusRef.current = false;
    const el = gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${ymd(focusDate)}"]`);
    el?.focus();
  }, [isOpen, focusDate, viewDate]);

  const handleDayClick = useCallback(
    (day: Date) => {
      if (isDisabled(day)) return;
      setFocusDate(day);
      if (!value.start || (value.start && value.end)) {
        onChange({ start: day, end: null });
        setStatus(`Pick-up ${fullDate(day)}. Now choose the last day.`);
        return;
      }
      const [start, end] = day < value.start ? [day, value.start] : [value.start, day];
      if (nightsBetween(start, end) < minNights) {
        setStatus(`Choose a last day after ${fullDate(value.start)}.`);
        return;
      }
      onChange({ start, end });
      close(true);
    },
    [value, onChange, isDisabled, minNights, close],
  );

  const moveFocus = (next: Date) => {
    setFocusDate(next);
    if (next.getMonth() !== month || next.getFullYear() !== year) setViewDate(firstOfMonth(next));
    moveFocusRef.current = true;
  };

  const onGridKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = focusDate;
    let next: Date | null = null;
    switch (e.key) {
      case 'ArrowLeft': next = addDays(d, -1); break;
      case 'ArrowRight': next = addDays(d, 1); break;
      case 'ArrowUp': next = addDays(d, -7); break;
      case 'ArrowDown': next = addDays(d, 7); break;
      case 'Home': next = addDays(d, -((d.getDay() + 6) % 7)); break;
      case 'End': next = addDays(d, 6 - ((d.getDay() + 6) % 7)); break;
      case 'PageUp': next = addMonths(d, -1); break;
      case 'PageDown': next = addMonths(d, 1); break;
      default: return;
    }
    e.preventDefault();
    moveFocus(next);
  };

  // Escape closes the calendar from anywhere in the field and returns focus to the trigger.
  const onRootKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && isOpen) {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    }
  };

  // The one day reachable with Tab: the focused day if it is in view, else the 1st.
  const tabDate = focusDate.getMonth() === month && focusDate.getFullYear() === year ? focusDate : viewDate;

  const isInRange = (day: Date): boolean => !!value.start && !!value.end && day >= stripTime(value.start) && day <= stripTime(value.end);
  const isSelected = (day: Date): boolean => (!!value.start && sameDay(day, value.start)) || (!!value.end && sameDay(day, value.end));

  const fmt = (d: Date) => d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
  const display = !value.start ? 'Select dates' : !value.end ? `${fmt(value.start)}: choose the last day` : `${fmt(value.start)} to ${fmt(value.end)}`;
  const monthLabel = viewDate.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  const prevDisabled = !!minDate && lastDayOf(addMonths(viewDate, -1)) < stripTime(minDate);
  const nextDisabled = !!maxDate && firstOfMonth(addMonths(viewDate, 1)) > stripTime(maxDate);

  return (
    <div ref={rootRef} onKeyDown={onRootKeyDown} className={['relative w-full', className].filter(Boolean).join(' ')}>
      {label && (
        <span id={labelId} className="block text-xs font-mono uppercase tracking-widest text-neutral-400 mb-2">
          {label}
        </span>
      )}

      {/* Trigger */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (isOpen ? close(false) : open())}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={popupId}
        aria-labelledby={label ? `${labelId} ${valueId}` : valueId}
        aria-describedby={describedBy}
        className={[
          'w-full min-h-[44px] flex items-center gap-3 bg-transparent border px-4 py-3 font-mono text-sm text-left text-white',
          'transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A843]/60',
          error ? 'border-red-500 focus:border-red-500' : 'border-white/10 focus:border-white',
        ].join(' ')}
      >
        <Calendar className="w-4 h-4 text-neutral-400 flex-shrink-0" aria-hidden="true" />
        <span id={valueId} className={!value.start ? 'text-neutral-400' : ''}>
          {display}
        </span>
      </button>

      {hint && (
        <p id={hintId} className="mt-1.5 text-xs font-mono text-neutral-400">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1.5 text-xs font-mono text-red-400">
          {error}
        </p>
      )}

      {/* Dropdown calendar */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            id={popupId}
            role="dialog"
            aria-modal="false"
            aria-label={label ? `${label}: choose the first and last day` : 'Choose the first and last day'}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="absolute z-50 mt-1 left-0 w-full min-w-[300px] bg-[#0A0A0B] border border-white/10 shadow-xl p-3"
          >
            {/* Month navigation */}
            <div className="flex items-center justify-between mb-2">
              <button
                type="button"
                onClick={() => setViewDate(addMonths(viewDate, -1))}
                disabled={prevDisabled}
                className="w-11 h-11 flex items-center justify-center text-neutral-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                aria-label="Previous month"
              >
                <ChevronLeft className="w-4 h-4" aria-hidden="true" />
              </button>
              <span aria-live="polite" className="text-xs font-mono uppercase tracking-widest text-white">
                {monthLabel}
              </span>
              <button
                type="button"
                onClick={() => setViewDate(addMonths(viewDate, 1))}
                disabled={nextDisabled}
                className="w-11 h-11 flex items-center justify-center text-neutral-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                aria-label="Next month"
              >
                <ChevronRight className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <div ref={gridRef} role="grid" aria-label={monthLabel} onKeyDown={onGridKeyDown}>
              <div role="row" className="grid grid-cols-7 mb-1">
                {DAYS.map((d) => (
                  <div
                    key={d.short}
                    role="columnheader"
                    aria-label={d.long}
                    className="text-center text-xs font-mono uppercase tracking-widest text-neutral-400 py-1"
                  >
                    {d.short}
                  </div>
                ))}
              </div>

              {weeks.map((week, wi) => (
                <div role="row" key={`w-${wi}`} className="grid grid-cols-7">
                  {week.map((day, di) => {
                    if (!day) return <div role="gridcell" key={`e-${wi}-${di}`} />;
                    const disabled = isDisabled(day);
                    const selected = isSelected(day);
                    const inRange = isInRange(day);
                    const focused = sameDay(day, tabDate);
                    return (
                      <div role="gridcell" key={ymd(day)} aria-selected={selected || inRange}>
                        <button
                          type="button"
                          data-date={ymd(day)}
                          tabIndex={focused ? 0 : -1}
                          aria-disabled={disabled || undefined}
                          aria-pressed={selected}
                          aria-label={`${fullDate(day)}${disabled ? ', not available' : ''}`}
                          onClick={() => handleDayClick(day)}
                          onFocus={() => setFocusDate(day)}
                          className={[
                            'w-full h-11 min-w-[44px] text-xs font-mono transition-colors duration-100',
                            'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A843] focus-visible:ring-inset',
                            disabled
                              ? 'opacity-30 cursor-not-allowed text-neutral-400'
                              : selected
                                ? 'bg-[#D4A843] text-[#050505] font-bold'
                                : inRange
                                  ? 'bg-[#D4A843]/15 text-white'
                                  : 'text-neutral-300 hover:bg-white/5',
                          ].join(' ')}
                        >
                          {day.getDate()}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            <p role="status" aria-live="polite" className="min-h-[1rem] mt-2 text-xs font-mono text-neutral-400">
              {status}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function stripTime(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function firstOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function lastDayOf(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function addMonths(d: Date, n: number): Date {
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const day = Math.min(d.getDate(), lastDayOf(target).getDate());
  return new Date(target.getFullYear(), target.getMonth(), day);
}

function nightsBetween(a: Date, b: Date): number {
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86_400_000);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fullDate(d: Date): string {
  return d.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/** Weeks of the month, Monday first, with null padding before the 1st and after the last day. */
function buildCalendarWeeks(year: number, month: number): (Date | null)[][] {
  const startOffset = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
