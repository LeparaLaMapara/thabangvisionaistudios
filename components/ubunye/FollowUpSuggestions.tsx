'use client';

import { motion } from 'framer-motion';

const FOLLOW_UPS: Record<string, string[]> = {
  search_creators: ['Compare their rates', 'Book the top match', 'See their portfolio'],
  get_creator_detail: ['Book this creator', 'Find similar creators'],
  calculate_booking_quote: ['Confirm this booking', 'Adjust the duration', 'Try a different package'],
  improve_brief: ['Submit the improved brief', 'Add more details'],
};

/**
 * The follow-up buttons for a finished tool. A creator search that found
 * nobody offers nothing, and one that found a single person never offers to
 * compare rates or pick a "top match".
 */
export function followUpsFor(toolName: string, output?: unknown): string[] {
  const suggestions = FOLLOW_UPS[toolName] ?? [];
  if (toolName !== 'search_creators') return suggestions;
  const results = (output as { results?: unknown } | null | undefined)?.results;
  const count = Array.isArray(results) ? results.length : 0;
  if (count === 0) return [];
  if (count === 1) return ['See their portfolio'];
  return suggestions;
}

interface FollowUpSuggestionsProps {
  toolName: string;
  /** What the tool returned, so the buttons match what it found. */
  output?: unknown;
  onSelect: (prompt: string) => void;
}

export function FollowUpSuggestions({ toolName, output, onSelect }: FollowUpSuggestionsProps) {
  const suggestions = followUpsFor(toolName, output);
  if (suggestions.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3, duration: 0.3 }}
      className="flex flex-wrap gap-1.5 pt-2"
    >
      {suggestions.map(text => (
        <button
          key={text}
          onClick={() => onSelect(text)}
          className="px-2.5 py-1 text-xs text-neutral-400 border border-neutral-800/50 hover:text-[#D4A843]/80 hover:border-[#D4A843]/20 transition-all duration-200"
        >
          {text}
        </button>
      ))}
    </motion.div>
  );
}
