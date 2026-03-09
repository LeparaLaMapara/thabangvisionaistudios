'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';
import { Project } from '@/types/equipment';
import { ChevronRight, X, ChevronLeft } from 'lucide-react';

// --- FILTER BAR COMPONENT ---
interface FilterBarProps {
  activeType: 'ALL' | 'FILM' | 'PHOTOGRAPHY';
  onTypeChange: (type: 'ALL' | 'FILM' | 'PHOTOGRAPHY') => void;
  activeSubFilter: string | null;
  onSubFilterChange: (sub: string | null) => void;
  availableSubFilters: string[];
}

export const FilterBar = ({
  activeType,
  onTypeChange,
  activeSubFilter,
  onSubFilterChange,
  availableSubFilters
}: FilterBarProps) => {
  return (
    <div className="sticky top-20 z-40 bg-neutral-50/95 dark:bg-[#050505]/95 backdrop-blur-md border-b border-black/5 dark:border-white/5 py-6 mb-12 transition-colors duration-500">
      <div className="container mx-auto px-6 flex flex-col gap-6">

        {/* Main Type Toggles */}
        <div className="flex items-center gap-8">
          {['ALL', 'FILM', 'PHOTOGRAPHY'].map((type) => (
            <button
              key={type}
              onClick={() => {
                onTypeChange(type as 'ALL' | 'FILM' | 'PHOTOGRAPHY');
                onSubFilterChange(null);
              }}
              className={`text-xs font-mono tracking-widest uppercase transition-colors relative py-2 ${
                activeType === type
                  ? 'text-black dark:text-white font-bold'
                  : 'text-neutral-400 hover:text-black dark:hover:text-white'
              }`}
            >
              {type === 'FILM' ? 'FILM & VIDEO' : type}
              {activeType === type && (
                <motion.div
                  layoutId="activeTab"
                  className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent-gold"
                />
              )}
            </button>
          ))}
        </div>

        {/* Dynamic Chips */}
        <AnimatePresence>
          {availableSubFilters.length > 0 && activeType !== 'ALL' && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="flex flex-wrap gap-3 overflow-hidden"
            >
              <button
                onClick={() => onSubFilterChange(null)}
                className={`px-4 py-1.5 text-[10px] uppercase tracking-widest rounded-full border transition-all ${
                  activeSubFilter === null
                    ? 'bg-black text-white dark:bg-white dark:text-black border-transparent'
                    : 'bg-transparent border-black/10 dark:border-white/10 text-neutral-500 hover:border-black dark:hover:border-white'
                }`}
              >
                All {activeType === 'FILM' ? 'Film' : 'Photos'}
              </button>
              {availableSubFilters.map(sub => (
                <button
                  key={sub}
                  onClick={() => onSubFilterChange(sub)}
                  className={`px-4 py-1.5 text-[10px] uppercase tracking-widest rounded-full border transition-all ${
                    activeSubFilter === sub
                      ? 'bg-black text-white dark:bg-white dark:text-black border-transparent'
                      : 'bg-transparent border-black/10 dark:border-white/10 text-neutral-500 hover:border-black dark:hover:border-white'
                  }`}
                >
                  {sub}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

// --- PROJECT CARD COMPONENT ---
export const ProjectCard = ({ project, index }: { project: Project; index: number; key?: any }) => {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.4, delay: index * 0.05 }}
      className="group relative cursor-pointer"
    >
      <Link href={`/smart-production/${project.slug}`} className="block h-full">
        <div className="relative aspect-[3/2] overflow-hidden bg-neutral-100 dark:bg-neutral-900 mb-4">
          <div className="absolute inset-0 bg-black/20 group-hover:bg-black/40 transition-colors z-10" />

          {/* Hover Overlay */}
          <div className="absolute inset-0 z-20 flex flex-col justify-center items-center opacity-0 group-hover:opacity-100 transition-all duration-500 transform translate-y-4 group-hover:translate-y-0">
            <span className="text-white text-xs font-mono tracking-widest border border-white/30 px-4 py-2 uppercase bg-black/20 backdrop-blur-sm">
              View Project
            </span>
          </div>

          {project.thumbnail ? (
            <Image
              src={project.thumbnail}
              alt={project.title}
              fill
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
              className="object-cover transition-transform duration-700 ease-out group-hover:scale-105 filter grayscale-[0.2] group-hover:grayscale-0"
            />
          ) : (
            <div className="w-full h-full bg-neutral-200 dark:bg-neutral-800 flex items-center justify-center">
              <span className="text-neutral-400 dark:text-neutral-600 text-xs font-mono uppercase">No image</span>
            </div>
          )}
        </div>

        <div className="flex justify-between items-start">
          <div>
            <h3 className="text-lg font-display text-black dark:text-white uppercase mb-1 group-hover:underline decoration-1 underline-offset-4">
              {project.title}
            </h3>
            <span className="text-[10px] font-mono text-neutral-500 dark:text-neutral-400 uppercase tracking-widest">
              {project.subCategory}
            </span>
          </div>
          {project.type === 'film' && (
             <span className="text-[10px] font-mono text-neutral-400 border border-neutral-200 dark:border-white/10 px-1.5 py-0.5">FILM</span>
          )}
        </div>
      </Link>
    </motion.div>
  );
};

// --- PHOTOGRAPHY GALLERY & LIGHTBOX ---
export const PhotographyGallery = ({ images }: { images: string[] }) => {
  const [selectedImage, setSelectedImage] = useState<number | null>(null);

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (selectedImage !== null) {
      setSelectedImage((selectedImage + 1) % images.length);
    }
  };

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (selectedImage !== null) {
      setSelectedImage((selectedImage - 1 + images.length) % images.length);
    }
  };

  return (
    <>
      <div className="columns-1 md:columns-2 lg:columns-3 gap-4 space-y-4 pb-20">
        {images.map((src, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            className="break-inside-avoid relative group cursor-zoom-in"
            onClick={() => setSelectedImage(idx)}
          >
            <Image
              src={src}
              alt={`Gallery ${idx}`}
              width={800}
              height={600}
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
              className="w-full h-auto object-cover bg-neutral-100 dark:bg-neutral-900 hover:opacity-90 transition-opacity"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
          </motion.div>
        ))}
      </div>

      {/* Lightbox */}
      <AnimatePresence>
        {selectedImage !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black/95 flex items-center justify-center p-4 md:p-10"
            onClick={() => setSelectedImage(null)}
          >
            <button
              className="absolute top-8 right-8 text-white/50 hover:text-white transition-colors z-[210]"
              onClick={() => setSelectedImage(null)}
            >
              <X className="w-8 h-8" />
            </button>

            <button
              className="absolute left-4 md:left-8 top-1/2 -translate-y-1/2 text-white/50 hover:text-white transition-colors p-4 z-[210] hidden md:block"
              onClick={handlePrev}
            >
              <ChevronLeft className="w-10 h-10" />
            </button>

            <button
              className="absolute right-4 md:right-8 top-1/2 -translate-y-1/2 text-white/50 hover:text-white transition-colors p-4 z-[210] hidden md:block"
              onClick={handleNext}
            >
              <ChevronRight className="w-10 h-10" />
            </button>

            {/* Lightbox uses unoptimized for full-res viewing */}
            <motion.div
              key={selectedImage}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2 }}
              className="relative max-h-[90vh] max-w-[90vw]"
            >
              <Image
                src={images[selectedImage]}
                alt="Full screen"
                width={1920}
                height={1080}
                unoptimized
                className="max-h-[90vh] max-w-[90vw] object-contain shadow-2xl pointer-events-none select-none"
              />
            </motion.div>

            <div className="absolute bottom-8 left-0 w-full text-center text-white/40 text-xs font-mono tracking-widest">
               {selectedImage + 1} / {images.length}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
