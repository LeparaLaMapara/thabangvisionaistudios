'use client';

import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Cpu, Wifi, Zap, Database, FlaskConical, ArrowRight, Layers, Box, ArrowUpRight } from 'lucide-react';
import Link from 'next/link';

const SUB_CAPABILITIES = [
  {
    id: 'vp',
    number: '01',
    title: 'Virtual Production',
    subtitle: 'REAL-TIME RENDERING & COMPOSITING',
    image: 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?q=80&w=2000&auto=format&fit=crop',
    icon: Layers,
    description: 'We integrate LED volumes with real-time rendering engines, utilizing AI to optimize asset placement and lighting matching instantly.',
    features: ['Real-time Unreal Engine 5 Integration', 'AI-Assisted Frustum Tracking', 'Dynamic Set Extension']
  },
  {
    id: 'remote',
    number: '02',
    title: 'Remote Systems',
    subtitle: 'AI PREDICTIVE CONTROL & DIAGNOSTICS',
    image: 'https://images.unsplash.com/photo-1563806954203-d6c2c786c52a?q=80&w=2000&auto=format&fit=crop',
    icon: Wifi,
    description: 'Wireless control protocols enhanced by predictive AI algorithms that stabilize signal latency and automate complex camera movements.',
    features: ['Long-range Low-latency Control', 'AI Motion Prediction', 'Autonomous Drone swarms']
  },
  {
    id: 'lighting',
    number: '03',
    title: 'Lighting Science',
    subtitle: 'AI-TUNED SPECTRAL ANALYSIS',
    image: 'https://images.unsplash.com/photo-1563319768-e3660d84c0c1?q=80&w=2000&auto=format&fit=crop',
    icon: Zap,
    description: 'Spectral tuning and automated DMX workflows. Our AI analyzes scene composition to suggest and apply optimal colorimetry.',
    features: ['Spectral Analysis & Matching', 'AI Scene Presets', 'Automated DMX Mapping']
  },
  {
    id: 'data',
    number: '04',
    title: 'Data & Workflow',
    subtitle: 'AI-DRIVEN OPTIMIZATION & MANAGEMENT',
    image: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?q=80&w=2000&auto=format&fit=crop',
    icon: Database,
    description: 'Automated metadata tagging and on-set color pipelines. AI manages the flow of data from sensor to post-production server.',
    features: ['Automated Metadata Injection', 'Cloud Proxy Generation', 'Semantic Video Search']
  },
  {
    id: 'labs',
    number: '05',
    title: 'Creative AI Labs',
    subtitle: 'CUSTOM AI PROTOTYPES & R&D',
    image: 'https://images.unsplash.com/photo-1518770660439-4636190af475?q=80&w=2000&auto=format&fit=crop',
    icon: FlaskConical,
    description: 'Custom prototypes and experimental technology. We build the tools that don\'t exist yet.',
    features: ['Generative Asset Creation', 'Custom LoRAs for Productions', 'Experimental Hardware']
  }
];

export default function UbunyeAIPage() {
  useEffect(() => {
    const hash = window.location.hash;
    if (hash) {
      const element = document.getElementById(hash.substring(1));
      if (element) {
        setTimeout(() => {
          element.scrollIntoView({ behavior: 'smooth' });
        }, 100);
      }
    }
  }, []);

  return (
    <div className="min-h-screen bg-white dark:bg-[#050505] pt-28 pb-20 transition-colors duration-500">

      {/* Hero */}
      <div className="container mx-auto px-6 mb-20">
         <div className="border-l border-black/20 dark:border-white/20 pl-8 md:pl-16 py-4">
            <span className="text-[10px] font-mono text-neutral-500 dark:text-accent uppercase tracking-widest mb-4 block">03 // Ubunye AI Studio</span>
            <h1 className="text-4xl md:text-7xl font-display font-medium text-black dark:text-white tracking-tight leading-[0.9] mb-8 uppercase">
              Ubunye AI Studio <br />
              <span className="text-neutral-400 dark:text-neutral-600">Creative Intelligence & Automation</span>
            </h1>
         </div>
      </div>

      {/* Sub-Capabilities Grid */}
      <div className="container mx-auto px-6 mb-32">
         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-neutral-200 dark:bg-white/10 border border-neutral-200 dark:border-white/10">
            {SUB_CAPABILITIES.map((item, index) => (
              <motion.a
                 href={`#${item.id}`}
                 key={item.id}
                 initial={{ opacity: 0 }}
                 whileInView={{ opacity: 1 }}
                 transition={{ delay: index * 0.1 }}
                 className="relative group h-80 overflow-hidden bg-black cursor-pointer"
              >
                 {/* Background Image */}
                 <div className="absolute inset-0 opacity-60 group-hover:opacity-80 transition-opacity duration-500">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.image} alt={item.title} className="w-full h-full object-cover grayscale group-hover:grayscale-0 scale-100 group-hover:scale-110 transition-all duration-700" />
                 </div>
                 <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />

                 {/* Content */}
                 <div className="absolute inset-0 p-8 flex flex-col justify-between z-10">
                    <div className="flex justify-between items-start">
                       <span className="text-4xl font-display font-bold text-white/20 group-hover:text-white transition-colors duration-500">{item.number}</span>
                       <ArrowUpRight className="text-white opacity-0 -translate-x-2 translate-y-2 group-hover:translate-x-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300" />
                    </div>

                    <div>
                       <h3 className="text-2xl font-display font-medium uppercase text-white mb-2 tracking-wide group-hover:text-white transition-colors">{item.title}</h3>
                       <p className="text-[10px] font-mono font-bold text-neutral-400 uppercase tracking-widest group-hover:text-white transition-colors border-t border-white/20 pt-4 inline-block">
                          {item.subtitle}
                       </p>
                    </div>
                 </div>

                 {/* Hover Border Glow */}
                 <div className="absolute inset-0 border border-white/0 group-hover:border-white/20 transition-colors duration-300 pointer-events-none" />
              </motion.a>
            ))}

            {/* Empty Tile for Grid Balance */}
            <div className="bg-[#080808] h-80 relative overflow-hidden hidden lg:block">
               <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent" />
               <div className="absolute bottom-8 right-8">
                  <Cpu className="w-12 h-12 text-white/5" />
               </div>
            </div>
         </div>
      </div>

      {/* Detailed Sections (Anchored) */}
      <div className="container mx-auto px-6">
        <div className="flex flex-col gap-24">
           {SUB_CAPABILITIES.map((section) => (
              <div id={section.id} key={section.id} className="scroll-mt-32 border-t border-black/10 dark:border-white/10 pt-12">
                 <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
                    <div className="lg:col-span-4">
                       <div className="flex items-center gap-4 mb-6">
                          <span className="text-4xl font-display font-bold text-black/10 dark:text-white/10">{section.number}</span>
                          <h2 className="text-3xl font-display font-medium uppercase text-black dark:text-white">{section.title}</h2>
                       </div>
                       <div className="w-12 h-1 bg-black dark:bg-white mb-8" />
                       <Link href="/contact" className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest hover:text-neutral-500 transition-colors">
                          Consult Engineer <ArrowRight className="w-3 h-3" />
                       </Link>
                    </div>

                    <div className="lg:col-span-8">
                       <p className="text-xl text-neutral-600 dark:text-neutral-300 font-light leading-relaxed mb-10 max-w-2xl">
                          {section.description}
                       </p>
                       <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {section.features.map(feature => (
                             <div key={feature} className="flex items-center gap-3 p-4 bg-neutral-50 dark:bg-white/5 border border-black/5 dark:border-white/5">
                                <Box className="w-4 h-4 text-neutral-400" />
                                <span className="text-xs font-mono uppercase tracking-widest text-black dark:text-white">{feature}</span>
                             </div>
                          ))}
                       </div>
                    </div>
                 </div>
              </div>
           ))}
        </div>
      </div>

      {/* Lab CTA */}
      <div className="mt-32 border-t border-black/5 dark:border-white/5 bg-neutral-50 dark:bg-[#080808] py-24">
         <div className="container mx-auto px-6 text-center">
            <Cpu className="w-16 h-16 mx-auto mb-8 animate-pulse-slow text-black dark:text-white" />
            <h2 className="text-4xl md:text-6xl font-display font-medium uppercase mb-8 text-black dark:text-white">Build The Impossible</h2>
            <p className="max-w-xl mx-auto font-mono text-sm opacity-70 mb-12 text-neutral-600 dark:text-neutral-400">
               Our R&D team works with production houses to develop custom hardware and software solutions for specific shot requirements.
            </p>
            <Link href="/contact" className="inline-block border border-black/30 dark:border-white/30 px-10 py-4 text-xs font-mono font-bold uppercase tracking-widest hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black transition-colors text-black dark:text-white">
               Start R&D Project
            </Link>
         </div>
      </div>
    </div>
  );
}
