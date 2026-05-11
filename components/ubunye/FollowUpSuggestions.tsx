'use client';

import { motion } from 'framer-motion';

const FOLLOW_UPS: Record<string, string[]> = {
  search_creators: ['Compare their rates', 'Book the top match', 'See their portfolio'],
  get_creator_detail: ['Book this creator', 'Find similar creators'],
  calculate_booking_quote: ['Confirm this booking', 'Adjust the duration', 'Try a different package'],
  improve_brief: ['Submit the improved brief', 'Add more details'],
};

interface FollowUpSuggestionsProps {
  toolName: string;
  onSelect: (prompt: string) => void;
}

export function FollowUpSuggestions({ toolName, onSelect }: FollowUpSuggestionsProps) {
  const suggestions = FOLLOW_UPS[toolName];
  if (!suggestions) return null;

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
          className="px-2.5 py-1 text-[11px] text-neutral-500 border border-neutral-800/50 hover:text-[#D4A843]/80 hover:border-[#D4A843]/20 transition-all duration-200"
        >
          {text}
        </button>
      ))}
    </motion.div>
  );
}
