'use client';

import { motion, useScroll, useTransform } from 'framer-motion';
import Link from 'next/link';
import { ServiceGrid } from '@/components/cinematic/ServiceGrid';
import { LatestWorkCarousel, type CarouselItem } from '@/components/cinematic/LatestWorkCarousel';
import { ChevronRight, ArrowRight, Camera, Calendar, Users } from 'lucide-react';
import { SITE_NAME, STUDIO } from '@/lib/constants';

// ─── Hero ────────────────────────────────────────────────────────────────────

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
        <div className="text-[10px] font-mono text-neutral-400 dark:text-neutral-600 mt-1">{STUDIO.location.coordsDisplay}</div>
      </motion.div>
    </div>
  );
};

// ─── Community Section ───────────────────────────────────────────────────────

const CommunitySection = () => (
  <section className="py-32 bg-neutral-50 dark:bg-[#050505] border-t border-black/5 dark:border-white/5 transition-colors duration-500">
    <div className="container mx-auto px-6">
      <div className="flex flex-col md:flex-row justify-between items-end mb-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <span className="text-[10px] font-mono text-neutral-500 dark:text-accent uppercase tracking-widest mb-4 block">03 // Community</span>
          <h2 className="text-4xl md:text-5xl font-display font-medium text-black dark:text-white uppercase">
            Creator <span className="text-neutral-400 dark:text-neutral-500">Network</span>
          </h2>
        </motion.div>
        <Link href="/smart-rentals" className="hidden md:flex items-center gap-2 text-xs font-mono text-neutral-500 hover:text-black dark:text-neutral-400 dark:hover:text-white transition-colors uppercase tracking-widest mt-6 md:mt-0">
          Browse All Gear <ChevronRight className="w-4 h-4" />
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {[
          {
            icon: Camera,
            title: 'List Your Gear',
            description: 'Verified creators can list their equipment for rent. Earn from your camera, lenses, lighting, and audio gear.',
            cta: 'Get Verified',
            href: '/dashboard/verification',
          },
          {
            icon: Calendar,
            title: 'Book Equipment',
            description: 'Reserve professional gear from our catalog or community listings. Real-time availability, instant confirmation.',
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

// ─── Booking CTA ─────────────────────────────────────────────────────────────

const BookingCTA = () => (
  <section className="py-24 bg-white dark:bg-[#080808] border-t border-black/5 dark:border-white/5 transition-colors duration-500">
    <div className="container mx-auto px-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
        >
          <span className="text-[10px] font-mono text-neutral-500 dark:text-accent uppercase tracking-widest mb-4 block">04 // Smart Rentals</span>
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

// ─── Main Export ──────────────────────────────────────────────────────────────

export default function HomeClient({ carouselItems }: { carouselItems: CarouselItem[] }) {
  return (
    <div className="min-h-screen bg-white dark:bg-[#050505] transition-colors duration-500">
      <Hero />
      <LatestWorkCarousel items={carouselItems} />
      <ServiceGrid />
      <CommunitySection />
      <BookingCTA />
      <section className="py-40 relative bg-gradient-to-b from-neutral-950 via-neutral-900 to-neutral-950 overflow-hidden border-t border-white/5 transition-colors duration-500">
        <div className="container mx-auto px-6 relative z-10 text-center">
          <span className="text-[10px] font-mono text-neutral-400 uppercase tracking-widest mb-6 block">06 // Contact</span>
          <h2 className="text-5xl md:text-8xl font-display font-medium text-white tracking-tighter mb-12 uppercase">
            Let&apos;s Build <br /> The Impossible
          </h2>
          <Link href="/contact" className="inline-block border border-white/20 hover:bg-white hover:text-black text-white px-12 py-5 text-xs font-mono font-bold tracking-[0.2em] transition-all uppercase">
            Initiate Project
          </Link>
        </div>
      </section>
    </div>
  );
}
