'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Equipment } from '@/types/equipment';

export const TechnicalHUD = ({ equipment }: { equipment: Equipment }) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      // Show after hero
      setIsVisible(window.scrollY > 400);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

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
                 <span className="text-[9px] font-mono text-green-500">LIVE</span>
                 <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-center group">
                <span className="text-[9px] font-mono text-neutral-500 uppercase tracking-widest group-hover:text-white transition-colors">Unit ID</span>
                <span className="text-xs font-mono font-bold text-white uppercase">{equipment.name}</span>
              </div>

              <div className="flex justify-between items-center group">
                <span className="text-[9px] font-mono text-neutral-500 uppercase tracking-widest group-hover:text-white transition-colors">Aperture</span>
                <span className="text-xs font-mono text-white border border-white/10 px-2 py-0.5 bg-white/5">
                  {equipment.specs.tStop}
                </span>
              </div>

              <div className="flex justify-between items-center group">
                <span className="text-[9px] font-mono text-neutral-500 uppercase tracking-widest group-hover:text-white transition-colors">CF</span>
                <span className="text-xs font-mono text-white">
                  {equipment.specs.closeFocus}
                </span>
              </div>

              {equipment.specs.squeezeRatio && (
                <div className="flex justify-between items-center group">
                  <span className="text-[9px] font-mono text-neutral-500 uppercase tracking-widest group-hover:text-white transition-colors">Anamorphic</span>
                  <span className="text-xs font-mono text-white">
                    {equipment.specs.squeezeRatio}
                  </span>
                </div>
              )}

              <div className="pt-4 border-t border-white/10 mt-2">
                <span className="text-[9px] font-mono text-neutral-600 uppercase tracking-widest block mb-2">Sensor Coverage</span>
                <div className="flex gap-2 flex-wrap">
                  {equipment.specs.mount.map(m => (
                    <span key={m} className="text-[9px] font-mono border border-neutral-700 px-2 py-0.5 text-neutral-300 bg-neutral-900">{m}</span>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-8">
               <button className="w-full text-center text-[10px] font-mono font-bold tracking-widest border border-white text-white py-3 hover:bg-white hover:text-black transition-all uppercase relative group overflow-hidden">
                 <span className="relative z-10">Download Spec Sheet</span>
                 <div className="absolute inset-0 bg-white transform -translate-x-full group-hover:translate-x-0 transition-transform duration-300 z-0" />
               </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
