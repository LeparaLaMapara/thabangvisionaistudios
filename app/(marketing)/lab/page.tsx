'use client';

import { motion } from 'framer-motion';
import { Cpu, Eye, Bot, Layers, ArrowRight, Network, Code2 } from 'lucide-react';
import Link from 'next/link';

export default function LabPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-[#050505] pt-32 pb-20 transition-colors duration-500">
      <div className="container mx-auto px-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-5xl mb-24">
          <span className="text-[10px] font-mono text-neutral-500 dark:text-accent uppercase tracking-widest mb-4 block">01 // R&amp;D Division</span>
          <h1 className="text-5xl md:text-8xl font-display font-medium text-black dark:text-white tracking-tighter uppercase mb-8 leading-[0.9]">
            The <span className="text-neutral-400 dark:text-neutral-600">Lab</span>
          </h1>
          <p className="text-xl md:text-3xl text-neutral-600 dark:text-neutral-300 font-light leading-relaxed max-w-4xl">
            Thabangvision Lab uses engineering, AI, and technology to build custom AI-driven solutions for creatives and operates as a research lab in computer vision and autonomous systems.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-neutral-200 dark:bg-white/10 border border-neutral-200 dark:border-white/10 mb-32">
          {[
            { title: "Computer Vision", icon: Eye, desc: "Developing proprietary object tracking and segmentation models for real-time virtual production environments. Our systems perceive depth and motion with sub-millimeter precision." },
            { title: "Autonomous Systems", icon: Bot, desc: "Engineering robotic motion control systems that interface directly with Unreal Engine. We build custom rovers and arms for impossible camera angles." },
            { title: "Generative Workflows", icon: Cpu, desc: "Building custom Stable Diffusion and LLM pipelines that augment human creativity, automating asset generation and storyboarding." },
            { title: "Optical Engineering", icon: Layers, desc: "Designing bespoke lens elements and coatings. We bridge the gap between digital sensors and analog character through physical modification." },
            { title: "Neural Rendering", icon: Network, desc: "Researching NeRFs and Gaussian Splatting for photorealistic environment capture and relighting in post-production." },
            { title: "Custom Software", icon: Code2, desc: "Developing proprietary plugins for Nuke, Unreal, and DaVinci Resolve to solve niche production challenges found on our sets." },
          ].map((item, i) => (
            <motion.div key={i} initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} transition={{ delay: i * 0.1 }} className="bg-white dark:bg-[#0A0A0B] p-12 group hover:bg-neutral-50 dark:hover:bg-white/5 transition-colors flex flex-col justify-between h-80">
              <div>
                <item.icon className="w-8 h-8 text-black dark:text-white mb-6 opacity-80" />
                <h3 className="text-2xl font-display uppercase mb-4 text-black dark:text-white tracking-tight">{item.title}</h3>
                <p className="text-neutral-500 font-mono text-xs leading-relaxed">{item.desc}</p>
              </div>
              <div className="w-8 h-px bg-black/20 dark:bg-white/20 mt-8 group-hover:w-full transition-all duration-500" />
            </motion.div>
          ))}
        </div>

        <div className="bg-neutral-100 dark:bg-[#080808] border border-black/5 dark:border-white/5 p-12 md:p-24 text-center">
          <h2 className="text-3xl md:text-5xl font-display font-bold uppercase mb-8 text-black dark:text-white">Have a technical challenge?</h2>
          <p className="text-neutral-500 mb-12 max-w-xl mx-auto font-mono text-sm">
            We partner with production houses and agencies to solve complex imaging problems using our R&amp;D stack.
          </p>
          <Link href="/contact" className="inline-flex items-center gap-3 bg-black text-white dark:bg-white dark:text-black px-8 py-4 text-xs font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity">
            Contact The Lab <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
