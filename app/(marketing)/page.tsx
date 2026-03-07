'use client';

import { motion, useScroll, useTransform } from 'framer-motion';
import Link from 'next/link';
import { ServiceGrid } from '@/components/cinematic/ServiceGrid';
import { proprietaryTech, projects } from '@/lib/data';
import { ChevronRight, ArrowRight, ArrowUpRight, Cpu, ShoppingBag, Calendar, Users } from 'lucide-react';
import { SITE_NAME } from '@/lib/constants';

const Hero = () => {
  const { scrollY } = useScroll();
  const y1 = useTransform(scrollY, [0, 500], [0, 200]);
  const opacity = useTransform(scrollY, [0, 300], [1, 0]);

  return (
    <div className="relative h-screen w-full overflow-hidden bg-white dark:bg-[#050505] flex items-center justify-center transition-colors duration-500">
      <motion.div style={{ y: y1 }} className="absolute inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-t from-white via-transparent to-white/50 dark:from-[#050505] dark:via-transparent dark:to-[#050505]/50 z-10" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=80&w=2940&auto=format&fit=crop"
          alt="Studio Abstract"
          className="w-full h-full object-cover opacity-10 dark:opacity-40 grayscale contrast-125"
        />
      </motion.div>

      <div className="absolute inset-0 bg-[linear-gradient(rgba(0,0,0,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.03)_1px,transparent_1px)] dark:bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:100px_100px] pointer-events-none z-10" />

      <motion.div style={{ opacity }} className="relative z-20 px-6 max-w-7xl w-full">
        <div className="border-l border-black/20 dark:border-white/20 pl-8 md:pl-16 py-4">
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.8 }}>
            <h2 className="text-xs md:text-sm font-mono tracking-[0.3em] text-neutral-500 dark:text-neutral-400 mb-6 uppercase">
              Technology Creative Studio
            </h2>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="text-5xl md:text-8xl font-display font-medium text-black dark:text-white tracking-tighter leading-[0.9] mb-8 uppercase"
          >
            We Engineer <br />
            <span className="text-neutral-400 dark:text-neutral-500">The Invisible.</span>
          </motion.h1>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.4 }} className="max-w-xl">
            <p className="text-lg text-neutral-600 dark:text-neutral-300 font-light leading-relaxed mb-10">
              {SITE_NAME} is a multidisciplinary laboratory fusing optical physics, mechanical engineering, and virtual production to define the next generation of image-making.
            </p>
            <div className="flex gap-6">
              <Link href="/lab" className="group flex items-center gap-2 text-xs font-mono font-bold tracking-widest text-black dark:text-white border-b border-black dark:border-white pb-1 hover:text-neutral-600 dark:hover:text-neutral-400 hover:border-neutral-600 dark:hover:border-neutral-400 transition-all uppercase">
                Explore The Lab <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Link>
            </div>
          </motion.div>
        </div>
      </motion.div>

      <motion.div style={{ opacity }} className="absolute bottom-10 right-10 text-right z-20 hidden md:block">
        <div className="text-[10px] font-mono text-neutral-500 mb-2">SYSTEM STATUS</div>
        <div className="text-xs font-mono text-green-600 dark:text-green-500">ALL SYSTEMS NOMINAL</div>
        <div className="text-[10px] font-mono text-neutral-400 dark:text-neutral-600 mt-1">LAT: 34.0522 N / LONG: 118.2437 W</div>
      </motion.div>
    </div>
  );
};

const ProjectGallery = () => (
  <section className="py-32 bg-neutral-50 dark:bg-[#050505] transition-colors duration-500">
    <div className="container mx-auto px-6 mb-16 flex justify-between items-end">
      <div>
        <span className="text-[10px] font-mono text-neutral-500 dark:text-accent uppercase tracking-widest mb-4 block">01 // Selected Works</span>
        <h2 className="text-4xl md:text-5xl font-display font-medium text-black dark:text-white">CASE STUDIES</h2>
      </div>
      <Link href="/smart-production" className="hidden md:flex items-center gap-2 text-xs font-mono text-neutral-500 hover:text-black dark:text-neutral-400 dark:hover:text-white transition-colors uppercase tracking-widest">
        View Archive <ChevronRight className="w-4 h-4" />
      </Link>
    </div>
    <div className="flex overflow-x-auto pb-10 gap-8 px-6 no-scrollbar snap-x snap-mandatory">
      {projects.map((project, index) => (
        <motion.div
          key={project.id}
          initial={{ opacity: 0, x: 50 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ delay: index * 0.1 }}
          className="min-w-[85vw] md:min-w-[600px] snap-center group cursor-pointer"
        >
          <div className="relative aspect-video overflow-hidden mb-6 bg-neutral-200 dark:bg-neutral-900 border border-black/5 dark:border-white/10">
            <div className="absolute top-4 left-4 z-20 flex gap-2">
              {project.tags.map(tag => (
                <span key={tag} className="text-[9px] font-mono bg-white/90 dark:bg-black/80 text-black dark:text-white border border-black/10 dark:border-white/20 px-2 py-1 uppercase tracking-wider backdrop-blur-md">
                  {tag}
                </span>
              ))}
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={project.thumbnail} alt={project.title} className="w-full h-full object-cover opacity-90 dark:opacity-80 group-hover:opacity-100 group-hover:scale-105 transition-all duration-700" />
          </div>
          <div className="flex justify-between items-start border-b border-black/10 dark:border-white/10 pb-4">
            <div>
              <h3 className="text-2xl font-display text-black dark:text-white uppercase mb-1">{project.title}</h3>
              <p className="text-sm font-mono text-neutral-500">{project.client} / {project.year}</p>
            </div>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 max-w-xs text-right hidden md:block">{project.description}</p>
          </div>
        </motion.div>
      ))}
    </div>
  </section>
);

const TechArsenal = () => (
  <section className="py-32 bg-white dark:bg-[#080808] border-t border-black/5 dark:border-white/5 transition-colors duration-500">
    <div className="container mx-auto px-6">
      <div className="flex justify-between items-end mb-16">
        <div>
          <span className="text-[10px] font-mono text-neutral-500 dark:text-accent uppercase tracking-widest mb-4 block">03 // The Arsenal</span>
          <h2 className="text-4xl text-black dark:text-white font-display font-medium uppercase">Proprietary Technology</h2>
          <p className="text-neutral-500 dark:text-neutral-400 mt-4 max-w-2xl font-light">
            Our in-house IP engineered specifically for Johannesburg creatives. Experience the tools that power our productions.
          </p>
        </div>
        <Link href="/resources/tools" className="text-xs font-mono font-bold text-black dark:text-white tracking-widest flex items-center gap-2 hover:text-neutral-600 dark:hover:text-neutral-400 transition-colors uppercase">
          View All Tools <ChevronRight className="w-4 h-4" />
        </Link>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {proprietaryTech.map((item, index) => (
          <Link href={`/resources/tools?tool=${item.toolId}`} key={item.id} className="group block h-full">
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.1 }} viewport={{ once: true }} className="relative h-full flex flex-col">
              <div className="relative aspect-square bg-neutral-100 dark:bg-neutral-900 mb-6 overflow-hidden border border-black/5 dark:border-white/5 group-hover:border-black/20 dark:group-hover:border-white/30 transition-colors">
                <div className="absolute top-0 right-0 p-4 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                  <ArrowUpRight className="text-black dark:text-white w-6 h-6" />
                </div>
                <div className="absolute bottom-4 left-4 z-10 flex flex-col gap-1">
                  <span className="text-[9px] font-mono text-white bg-black/50 px-2 py-1 uppercase tracking-widest backdrop-blur-sm border border-white/10">{item.toolLabel}</span>
                  <span className="text-[9px] font-mono text-white/70 uppercase tracking-widest px-1">ID: {item.id}</span>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.image} alt={item.title} className="w-full h-full object-cover opacity-90 dark:opacity-80 grayscale group-hover:grayscale-0 group-hover:opacity-100 group-hover:scale-105 transition-all duration-700" />
              </div>
              <div className="flex-grow flex flex-col justify-between">
                <div>
                  <h3 className="text-xl font-bold font-display text-black dark:text-white mb-2 group-hover:text-neutral-600 dark:group-hover:text-accent transition-colors uppercase">{item.title}</h3>
                  <p className="text-sm font-mono text-neutral-500 mb-6 leading-relaxed">{item.description}</p>
                </div>
                <div className="flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-widest text-black dark:text-white group-hover:translate-x-1 transition-transform">
                  <Cpu className="w-3 h-3" /> Explore Tool
                </div>
              </div>
            </motion.div>
          </Link>
        ))}
      </div>
    </div>
  </section>
);

const MarketplaceSection = () => (
  <section className="py-32 bg-neutral-50 dark:bg-[#050505] border-t border-black/5 dark:border-white/5 transition-colors duration-500">
    <div className="container mx-auto px-6">
      <div className="flex flex-col md:flex-row justify-between items-end mb-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <span className="text-[10px] font-mono text-neutral-500 dark:text-accent uppercase tracking-widest mb-4 block">04 // Marketplace</span>
          <h2 className="text-4xl md:text-5xl font-display font-medium text-black dark:text-white uppercase">
            Creator <span className="text-neutral-400 dark:text-neutral-500">Economy</span>
          </h2>
        </motion.div>
        <Link href="/marketplace" className="hidden md:flex items-center gap-2 text-xs font-mono text-neutral-500 hover:text-black dark:text-neutral-400 dark:hover:text-white transition-colors uppercase tracking-widest mt-6 md:mt-0">
          Browse Marketplace <ChevronRight className="w-4 h-4" />
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {[
          {
            icon: ShoppingBag,
            title: 'Buy & Sell Gear',
            description: 'List your equipment or find deals from fellow creators. Cameras, lenses, lighting, audio and more.',
            cta: 'Browse Listings',
            href: '/marketplace',
          },
          {
            icon: Calendar,
            title: 'Book Equipment',
            description: 'Reserve professional gear from our Smart Rentals catalog. Real-time availability, instant confirmation.',
            cta: 'View Rentals',
            href: '/smart-rentals',
          },
          {
            icon: Users,
            title: 'Join the Community',
            description: 'Create your profile, showcase your portfolio, and connect with South African creatives.',
            cta: 'Create Account',
            href: '/register',
          },
        ].map((item, index) => (
          <motion.div
            key={item.title}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: index * 0.1 }}
          >
            <Link href={item.href} className="group block h-full">
              <div className="h-full bg-white dark:bg-[#0A0A0B] border border-black/5 dark:border-white/5 p-8 hover:border-black/20 dark:hover:border-white/20 transition-all">
                <item.icon className="w-6 h-6 text-neutral-400 dark:text-neutral-600 mb-6 group-hover:text-black dark:group-hover:text-white transition-colors" />
                <h3 className="text-lg font-display font-medium uppercase text-black dark:text-white mb-3">
                  {item.title}
                </h3>
                <p className="text-sm font-mono text-neutral-500 leading-relaxed mb-6">
                  {item.description}
                </p>
                <span className="flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-widest text-black dark:text-white group-hover:translate-x-1 transition-transform">
                  {item.cta} <ArrowRight className="w-3 h-3" />
                </span>
              </div>
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  </section>
);

const BookingCTA = () => (
  <section className="py-24 bg-white dark:bg-[#080808] border-t border-black/5 dark:border-white/5 transition-colors duration-500">
    <div className="container mx-auto px-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
        >
          <span className="text-[10px] font-mono text-neutral-500 dark:text-accent uppercase tracking-widest mb-4 block">05 // Smart Rentals</span>
          <h2 className="text-4xl md:text-5xl font-display font-medium text-black dark:text-white tracking-tighter uppercase mb-6 leading-[0.95]">
            Book <br />
            <span className="text-neutral-400 dark:text-neutral-500">Professional Gear</span>
          </h2>
          <p className="text-neutral-500 dark:text-neutral-400 font-light leading-relaxed mb-8 max-w-md">
            From cinema cameras to lighting kits. Check real-time availability, get instant pricing, and secure your gear with our streamlined booking system.
          </p>
          <div className="flex flex-wrap gap-4">
            <Link href="/smart-rentals" className="inline-flex items-center gap-2 bg-black dark:bg-white text-white dark:text-black px-8 py-4 text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity">
              Browse Equipment <ArrowRight className="w-3 h-3" />
            </Link>
            <Link href="/register" className="inline-flex items-center gap-2 border border-black/20 dark:border-white/20 text-black dark:text-white px-8 py-4 text-[10px] font-mono font-bold uppercase tracking-widest hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
              Create Account
            </Link>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          className="grid grid-cols-2 gap-4"
        >
          {[
            { label: 'Categories', value: '6+' },
            { label: 'Day Rates From', value: 'R500' },
            { label: 'Instant Booking', value: 'Yes' },
            { label: 'Deposit Protection', value: 'Secured' },
          ].map(stat => (
            <div key={stat.label} className="bg-neutral-50 dark:bg-[#0A0A0B] border border-black/5 dark:border-white/5 p-6">
              <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
                {stat.label}
              </p>
              <p className="text-2xl font-display font-medium text-black dark:text-white">
                {stat.value}
              </p>
            </div>
          ))}
        </motion.div>
      </div>
    </div>
  </section>
);

export default function Home() {
  return (
    <div className="min-h-screen bg-white dark:bg-[#050505] transition-colors duration-500">
      <Hero />
      <ProjectGallery />
      <ServiceGrid />
      <TechArsenal />
      <MarketplaceSection />
      <BookingCTA />
      <section className="py-40 relative bg-white dark:bg-[#050505] overflow-hidden border-t border-black/5 dark:border-white/5 transition-colors duration-500">
        <div className="container mx-auto px-6 relative z-10 text-center">
          <span className="text-[10px] font-mono text-neutral-500 dark:text-accent uppercase tracking-widest mb-6 block">06 // Contact</span>
          <h2 className="text-5xl md:text-8xl font-display font-medium text-black dark:text-white tracking-tighter mb-12 uppercase">
            Let&apos;s Build <br /> The Impossible
          </h2>
          <Link href="/contact" className="inline-block border border-black/20 dark:border-white/20 hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black text-black dark:text-white px-12 py-5 text-xs font-mono font-bold tracking-[0.2em] transition-all uppercase">
            Initiate Project
          </Link>
        </div>
      </section>
    </div>
  );
}
