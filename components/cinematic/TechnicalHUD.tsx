'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { SmartRental } from '@/lib/supabase/queries/smartRentals';

function humanizeKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export const TechnicalHUD = ({ rental }: { rental: SmartRental }) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsVisible(window.scrollY > 400);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const metadata = rental.metadata ?? {};
  const metaEntries = Object.entries(metadata);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 20 }}
          className="fixed bottom-8 right-8 z-40 hidden lg:block"
        >
          <div className="bg-[#050505]/95 backdrop-blur-md border border-white/20 p-6 w-80 shadow-2xl relative overflow-hidden">
            {/* Corner Markers */}
            <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-white/50" />
            <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-white/50" />
            <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-white/50" />
            <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-white/50" />

            <div className="flex justify-between items-center mb-6 border-b border-white/20 pb-2">
              <h3 className="text-[10px] font-mono font-bold tracking-widest text-neutral-400 uppercase">System Status</h3>
              <div className="flex items-center gap-2">
                <span className={`text-[9px] font-mono ${rental.is_available ? 'text-green-500' : 'text-red-500'}`}>
                  {rental.is_available ? 'AVAILABLE' : 'UNAVAILABLE'}
                </span>
                <div className={`w-1.5 h-1.5 rounded-full ${rental.is_available ? 'bg-green-500' : 'bg-red-500'} animate-pulse`} />
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-center group">
                <span className="text-[9px] font-mono text-neutral-500 uppercase tracking-widest group-hover:text-white transition-colors">Unit</span>
                <span className="text-xs font-mono font-bold text-white uppercase truncate max-w-[180px]">{rental.title}</span>
              </div>

              {rental.brand && (
                <div className="flex justify-between items-center group">
                  <span className="text-[9px] font-mono text-neutral-500 uppercase tracking-widest group-hover:text-white transition-colors">Brand</span>
                  <span className="text-xs font-mono text-white">{rental.brand}</span>
                </div>
              )}

              {rental.price_per_day != null && (
                <div className="flex justify-between items-center group">
                  <span className="text-[9px] font-mono text-neutral-500 uppercase tracking-widest group-hover:text-white transition-colors">Daily Rate</span>
                  <span className="text-xs font-mono text-white border border-white/10 px-2 py-0.5 bg-white/5">
                    {rental.currency} {rental.price_per_day.toLocaleString()}
                  </span>
                </div>
              )}

              {/* Metadata specs */}
              {metaEntries.length > 0 && (
                <div className="pt-4 border-t border-white/10 mt-2 space-y-3">
                  <span className="text-[9px] font-mono text-neutral-600 uppercase tracking-widest block">Specifications</span>
                  {metaEntries.slice(0, 5).map(([key, val]) => (
                    <div key={key} className="flex justify-between items-center group">
                      <span className="text-[9px] font-mono text-neutral-500 uppercase tracking-widest group-hover:text-white transition-colors">
                        {humanizeKey(key)}
                      </span>
                      <span className="text-[9px] font-mono border border-neutral-700 px-2 py-0.5 text-neutral-300 bg-neutral-900">
                        {val}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Tags */}
              {rental.tags && rental.tags.length > 0 && (
                <div className="pt-4 border-t border-white/10 mt-2">
                  <span className="text-[9px] font-mono text-neutral-600 uppercase tracking-widest block mb-2">Tags</span>
                  <div className="flex gap-2 flex-wrap">
                    {rental.tags.slice(0, 4).map(tag => (
                      <span key={tag} className="text-[9px] font-mono border border-neutral-700 px-2 py-0.5 text-neutral-300 bg-neutral-900">{tag}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-8">
              <button className="w-full text-center text-[10px] font-mono font-bold tracking-widest border border-white text-white py-3 hover:bg-white hover:text-black transition-all uppercase relative group overflow-hidden">
                <span className="relative z-10">Request Rental</span>
                <div className="absolute inset-0 bg-white transform -translate-x-full group-hover:translate-x-0 transition-transform duration-300 z-0" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
