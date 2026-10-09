import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, forwardRef, type ReactNode } from 'react';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

// Render the calendar without animation so it appears and leaves at once.
vi.mock('framer-motion', () => {
  const MOTION_PROPS = ['initial', 'animate', 'exit', 'transition'];
  const strip = (props: Record<string, unknown>) => Object.fromEntries(Object.entries(props).filter(([k]) => !MOTION_PROPS.includes(k)));
  return {
    motion: {
      div: forwardRef<HTMLDivElement, Record<string, unknown>>(function MotionDiv(props, ref) {
        return createElement('div', { ...strip(props), ref });
      }),
    },
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
  };
});

import { DateRangePicker, type DateRange } from '@/components/ui/DateRangePicker';

/**
 * The date picker is operable by keyboard and screen reader, has 44px day
 * targets, and (with minNights) never produces a same-day range the
 * checkout refuses. Props stay backward compatible.
 */

const MIN = new Date(2030, 0, 10);

function setup(props: Partial<Parameters<typeof DateRangePicker>[0]> = {}, value: DateRange = { start: null, end: null }) {
  const onChange = vi.fn();
  const utils = render(createElement(DateRangePicker, { value, onChange, minDate: MIN, label: 'Rental dates', ...props }));
  const trigger = screen.getByRole('button', { name: /rental dates/i });
  return { onChange, trigger, ...utils };
}

// Matches the day's full name, e.g. "Thursday, 10 January 2030" (not "19 January").
const dayButton = (day: string) => screen.getByRole('button', { name: new RegExp(`(^|\\D)${day}( |,|$)`) });

afterEach(() => cleanup());

describe('DateRangePicker', () => {
  it('labels the trigger and says whether the calendar is open', () => {
    const { trigger } = setup({ hint: 'Pick up on the first day.' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAccessibleDescription('Pick up on the first day.');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const dialog = screen.getByRole('dialog');
    expect(trigger.getAttribute('aria-controls')).toBe(dialog.id);
  });

  it('names each day with its full date, 44px targets, and disables days before the minimum', () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    const tenth = dayButton('10 January 2030');
    expect(tenth.className).toMatch(/h-11/);
    expect(tenth).toHaveAttribute('tabindex', '0');
    const ninth = dayButton('9 January 2030');
    expect(ninth).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(ninth);
    expect(screen.getByRole('button', { name: 'Previous month' }).className).toMatch(/w-11 h-11/);
  });

  it('links an error to the trigger', () => {
    const { trigger } = setup({ error: 'Choose dates' });
    expect(trigger).toHaveAccessibleDescription('Choose dates');
  });

  it('picks a range with two clicks and closes, returning focus to the trigger', () => {
    const { trigger, onChange, rerender } = setup();
    fireEvent.click(trigger);
    fireEvent.click(dayButton('12 January 2030'));
    expect(onChange).toHaveBeenLastCalledWith({ start: new Date(2030, 0, 12), end: null });
    rerender(createElement(DateRangePicker, { value: { start: new Date(2030, 0, 12), end: null }, onChange, minDate: MIN, label: 'Rental dates' }));
    fireEvent.click(dayButton('15 January 2030'));
    expect(onChange).toHaveBeenLastCalledWith({ start: new Date(2030, 0, 12), end: new Date(2030, 0, 15) });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('with minNights=1 the same day twice asks for a later day instead of a same-day range', () => {
    const start = new Date(2030, 0, 12);
    const { trigger, onChange } = setup({ minNights: 1 }, { start, end: null });
    fireEvent.click(trigger);
    fireEvent.click(dayButton('12 January 2030'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/last day after/i);
  });

  it('without minNights a same-day range is still allowed (backward compatible)', () => {
    const start = new Date(2030, 0, 12);
    const { trigger, onChange } = setup({}, { start, end: null });
    fireEvent.click(trigger);
    fireEvent.click(dayButton('12 January 2030'));
    expect(onChange).toHaveBeenCalledWith({ start, end: start });
  });

  it('maxNights disables days too far after the start', () => {
    const { trigger } = setup({ maxNights: 3 }, { start: new Date(2030, 0, 12), end: null });
    fireEvent.click(trigger);
    expect(dayButton('15 January 2030')).not.toHaveAttribute('aria-disabled');
    expect(dayButton('16 January 2030')).toHaveAttribute('aria-disabled', 'true');
  });

  it('moves focus with the arrow keys, across months with Page Down', async () => {
    const { trigger } = setup();
    await act(async () => {
      fireEvent.click(trigger);
    });
    const grid = screen.getByRole('grid');
    expect(document.activeElement).toBe(dayButton('10 January 2030'));
    await act(async () => {
      fireEvent.keyDown(grid, { key: 'ArrowRight' });
    });
    expect(document.activeElement).toBe(dayButton('11 January 2030'));
    await act(async () => {
      fireEvent.keyDown(grid, { key: 'ArrowDown' });
    });
    expect(document.activeElement).toBe(dayButton('18 January 2030'));
    await act(async () => {
      fireEvent.keyDown(grid, { key: 'PageDown' });
    });
    expect(document.activeElement).toBe(dayButton('18 February 2030'));
  });

  it('Escape and a click outside close the calendar', () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
