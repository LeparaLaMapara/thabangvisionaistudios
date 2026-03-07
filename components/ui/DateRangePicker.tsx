'use client';

import { useCallback, useMemo, useState } from 'react';
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
}

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

export function DateRangePicker({
  value,
  onChange,
  minDate,
  maxDate,
  label,
  error,
  className = '',
}: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [viewDate, setViewDate] = useState(
    () => value.start ?? new Date(),
  );

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const days = useMemo(() => buildCalendarDays(year, month), [year, month]);

  const prevMonth = useCallback(() => {
    setViewDate(new Date(year, month - 1, 1));
  }, [year, month]);

  const nextMonth = useCallback(() => {
    setViewDate(new Date(year, month + 1, 1));
  }, [year, month]);

  const handleDayClick = useCallback(
    (day: Date) => {
      if (!value.start || (value.start && value.end)) {
        onChange({ start: day, end: null });
      } else {
        if (day < value.start) {
          onChange({ start: day, end: value.start });
        } else {
          onChange({ start: value.start, end: day });
        }
        setIsOpen(false);
      }
    },
    [value, onChange],
  );

  const isDisabled = (day: Date) => {
    if (minDate && day < stripTime(minDate)) return true;
    if (maxDate && day > stripTime(maxDate)) return true;
    return false;
  };

  const isInRange = (day: Date) => {
    if (!value.start || !value.end) return false;
    return day >= value.start && day <= value.end;
  };

  const isSelected = (day: Date) => {
    return (
      (value.start && sameDay(day, value.start)) ||
      (value.end && sameDay(day, value.end))
    );
  };

  const formatDisplay = () => {
    if (!value.start) return '';
    const fmt = (d: Date) =>
      d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
    if (!value.end) return fmt(value.start);
    return `${fmt(value.start)} — ${fmt(value.end)}`;
  };

  const monthLabel = viewDate.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className={['relative w-full', className].filter(Boolean).join(' ')}>
      {label && (
        <span className="block text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
          {label}
        </span>
      )}

      {/* Trigger */}
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className={[
          'w-full flex items-center gap-3',
          'bg-transparent',
          'border',
          error
            ? 'border-red-500'
            : 'border-black/20 dark:border-white/10',
          'px-4 py-3 font-mono text-sm text-left',
          'text-black dark:text-white',
          'transition-colors duration-200',
          'focus:outline-none',
          error
            ? 'focus:border-red-500'
            : 'focus:border-black dark:focus:border-white',
        ].join(' ')}
      >
        <Calendar className="w-4 h-4 text-neutral-400 flex-shrink-0" />
        <span className={!value.start ? 'text-neutral-300 dark:text-neutral-700' : ''}>
          {value.start ? formatDisplay() : 'Select dates'}
        </span>
      </button>

      {error && (
        <p className="mt-1.5 text-[10px] font-mono text-red-500">{error}</p>
      )}

      {/* Dropdown calendar */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className={[
              'absolute z-50 mt-1 left-0',
              'w-full min-w-[280px]',
              'bg-white dark:bg-neutral-900',
              'border border-black/10 dark:border-white/10',
              'shadow-xl',
              'p-4',
            ].join(' ')}
          >
            {/* Month navigation */}
            <div className="flex items-center justify-between mb-3">
              <button
                type="button"
                onClick={prevMonth}
                className="text-neutral-400 hover:text-black dark:hover:text-white transition-colors"
                aria-label="Previous month"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-[10px] font-mono uppercase tracking-widest text-black dark:text-white">
                {monthLabel}
              </span>
              <button
                type="button"
                onClick={nextMonth}
                className="text-neutral-400 hover:text-black dark:hover:text-white transition-colors"
                aria-label="Next month"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Day headers */}
            <div className="grid grid-cols-7 mb-1">
              {DAYS.map((d) => (
                <div
                  key={d}
                  className="text-center text-[9px] font-mono uppercase tracking-widest text-neutral-400 py-1"
                >
                  {d}
                </div>
              ))}
            </div>

            {/* Days grid */}
            <div className="grid grid-cols-7">
              {days.map((day, i) => {
                if (!day) {
                  return <div key={`empty-${i}`} />;
                }

                const disabled = isDisabled(day);
                const selected = isSelected(day);
                const inRange = isInRange(day);
                const isCurrentMonth = day.getMonth() === month;

                return (
                  <button
                    key={day.toISOString()}
                    type="button"
                    disabled={disabled}
                    onClick={() => handleDayClick(day)}
                    className={[
                      'h-8 text-[11px] font-mono transition-colors duration-100',
                      'disabled:opacity-30 disabled:cursor-not-allowed',
                      !isCurrentMonth && 'opacity-30',
                      selected
                        ? 'bg-black dark:bg-white text-white dark:text-black font-medium'
                        : inRange
                          ? 'bg-black/10 dark:bg-white/10 text-black dark:text-white'
                          : 'text-neutral-600 dark:text-neutral-400 hover:bg-black/5 dark:hover:bg-white/5',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {day.getDate()}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function stripTime(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function buildCalendarDays(year: number, month: number): (Date | null)[] {
  const firstDay = new Date(year, month, 1);
  // Monday-based: 0=Mon, 6=Sun
  const startOffset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (Date | null)[] = [];

  for (let i = 0; i < startOffset; i++) {
    cells.push(null);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(new Date(year, month, d));
  }

  return cells;
}
