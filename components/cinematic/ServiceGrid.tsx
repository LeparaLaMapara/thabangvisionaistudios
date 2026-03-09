'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';
import { CAPABILITIES as capabilities } from '@/lib/constants';
import { ArrowUpRight } from 'lucide-react';

export const ServiceGrid = () => {
  return (
    <section className="py-32 bg-neutral-50 dark:bg-[#050505] relative border-t border-black/5 dark:border-white/5 transition-colors duration-500">
       {/* Background Grid */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#00000005_1px,transparent_1px),linear-gradient(to_bottom,#00000005_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:4rem_4rem] pointer-events-none" />

      <div className="container mx-auto px-6 relative z-10">
        <div className="flex flex-col md:flex-row justify-between items-end mb-20">
          <motion.div
             initial={{ opacity: 0, y: 20 }}
             whileInView={{ opacity: 1, y: 0 }}
             viewport={{ once: true }}
          >
            <span className="text-[10px] font-mono text-neutral-500 dark:text-accent uppercase tracking-widest mb-4 block">02 // Core Competencies</span>
            <h2 className="text-4xl md:text-6xl font-display font-medium text-black dark:text-white tracking-tight">
              STUDIO <span className="text-neutral-400 dark:text-neutral-500">CAPABILITIES</span>
            </h2>
          </motion.div>
          <div className="max-w-md mt-8 md:mt-0">
            <p className="text-neutral-500 dark:text-neutral-400 font-light leading-relaxed">
              We operate at the intersection of creative vision and engineering precision. Our specialized divisions support productions from prototype to final pixel.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-neutral-200 dark:bg-white/10 border border-neutral-200 dark:border-white/10">
          {capabilities.map((item, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className="relative group h-96 bg-white dark:bg-[#0A0A0B]"
            >
              <Link href={item.link} className="block w-full h-full relative overflow-hidden">
                  <div className="absolute inset-0 z-10 bg-black/40 dark:bg-black/60 group-hover:bg-black/20 dark:group-hover:bg-black/30 transition-colors duration-500" />
                  <Image
                    src={item.image}
                    alt={item.title}
                    fill
                    className="object-cover grayscale group-hover:grayscale-0 scale-100 group-hover:scale-105 transition-all duration-700 ease-out"
                  />
                  <div className="absolute inset-0 z-20 flex flex-col justify-between p-8">
                    <div className="flex justify-between items-start">
                      <span className="text-[10px] font-mono text-white/70 group-hover:text-white transition-colors">0{index + 1}</span>
                      <ArrowUpRight className="text-white opacity-0 -translate-y-2 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-500 w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-xl font-display font-medium tracking-wide text-white uppercase mb-1">{item.title}</h3>
                      <p className="text-xs font-mono text-white/60 uppercase tracking-widest">{item.subtitle}</p>
                    </div>
                  </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};
