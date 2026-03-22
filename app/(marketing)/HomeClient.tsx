'use client';

import { motion, useScroll, useTransform } from 'framer-motion';
import Link from 'next/link';
import { ServiceGrid } from '@/components/cinematic/ServiceGrid';
import { LatestWorkCarousel, type CarouselItem } from '@/components/cinematic/LatestWorkCarousel';
import { ChevronRight, ArrowRight, Camera, Calendar, Users, Search, CreditCard, Sparkles, MessageCircle } from 'lucide-react';
import { SITE_NAME, STUDIO, PLACEHOLDER_IMAGES } from '@/lib/constants';

// ─── Hero ────────────────────────────────────────────────────────────────────

const Hero = () => {
  const { scrollY } = useScroll();
  const y1 = useTransform(scrollY, [0, 500], [0, 200]);
  const opacity = useTransform(scrollY, [0, 300], [1, 0]);
  const { hero } = STUDIO;
  const useVideo = hero.type === 'video' && !!hero.videoSrc;

  return (
    <div className="relative h-screen w-full overflow-hidden bg-[#050505] flex items-center justify-center transition-colors duration-500">
      <motion.div style={{ y: y1 }} className="absolute inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-transparent to-[#050505]/50 z-10" />

        {useVideo ? (
          <video
            autoPlay
            loop
            muted
            playsInline
            poster={hero.poster || undefined}
            className="w-full h-full object-cover opacity-40 grayscale contrast-125 motion-reduce:hidden"
          >
            {hero.mobileVideoSrc && (
              <source src={hero.mobileVideoSrc} type="video/mp4" media="(max-width: 767px)" />
            )}
            <source src={hero.videoSrc} type="video/mp4" />
          </video>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={hero.imageSrc}
            alt="Studio Abstract"
            className="w-full h-full object-cover opacity-40 grayscale contrast-125"
          />
        )}

        {useVideo && hero.poster && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={hero.poster}
            alt=""
            className="w-full h-full object-cover opacity-40 grayscale contrast-125 hidden motion-reduce:block absolute inset-0"
          />
        )}
      </motion.div>

      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:100px_100px] pointer-events-none z-10" />

      <motion.div style={{ opacity }} className="relative z-20 px-6 max-w-7xl w-full overflow-hidden">
        <div className="border-l border-white/20 pl-8 md:pl-16 py-4 overflow-hidden">
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.8 }}>
            <h2 className="text-xs md:text-sm font-mono tracking-[0.3em] text-neutral-400 mb-6 uppercase">
              ThabangVision
            </h2>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="text-4xl sm:text-5xl md:text-8xl font-display font-medium text-white tracking-tighter leading-[0.9] mb-8 uppercase max-w-full break-words"
          >
            Book South Africa&apos;s <br />
            <span className="text-neutral-500">Best Creators And Gear.</span>
          </motion.h1>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.4 }} className="max-w-xl">
            <p className="text-lg text-neutral-300 font-light leading-relaxed mb-10">
              Photography. Film. Production. Verified creators. Professional equipment. All in one platform.
            </p>
            <div className="flex flex-wrap gap-4">
              <Link href="/smart-creators" className="group inline-flex items-center gap-2 min-h-[44px] bg-white text-black px-8 py-4 text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity">
                Book a Creator <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Link>
              <Link href="/smart-rentals" className="group inline-flex items-center gap-2 min-h-[44px] border border-white/20 text-white px-8 py-4 text-[10px] font-mono font-bold uppercase tracking-widest hover:bg-white/5 transition-colors">
                Rent Gear <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Link>
            </div>
          </motion.div>
        </div>
      </motion.div>

      <motion.div style={{ opacity }} className="absolute bottom-10 right-10 text-right z-20 hidden md:block">
        <div className="text-[10px] font-mono text-[#D4A843] mb-1">{STUDIO.location.city}, {STUDIO.location.country}</div>
        <a
          href={`https://www.google.com/maps/@${STUDIO.location.lat},${STUDIO.location.lng},15z`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] font-mono text-[#D4A843]/60 hover:text-[#D4A843] transition-colors"
        >
          {STUDIO.location.coordsDisplay}
        </a>
      </motion.div>
    </div>
  );
};

// ─── How It Works ────────────────────────────────────────────────────────────

const HowItWorks = () => {
  const steps = [
    { icon: Search, title: 'Browse', description: 'Find verified creators and professional gear for your project.' },
    { icon: Calendar, title: 'Book', description: 'Pick your dates, describe your shoot, and lock it in.' },
    { icon: CreditCard, title: 'Pay', description: 'Secure online payment. No hidden fees, transparent pricing.' },
    { icon: Sparkles, title: 'Create', description: 'Your creator arrives, the gear is ready. Make something amazing.' },
  ];

  return (
    <section className="py-24 bg-[#050505] border-t border-white/5">
      <div className="container mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <span className="text-[10px] font-mono text-accent uppercase tracking-widest mb-4 block">01 // Process</span>
          <h2 className="text-4xl md:text-5xl font-display font-medium text-white uppercase">
            How It <span className="text-neutral-500">Works</span>
          </h2>
        </motion.div>

        <div className="grid grid-cols-1 min-[380px]:grid-cols-2 md:grid-cols-4 gap-6">
          {steps.map((step, index) => (
            <motion.div
              key={step.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className="relative bg-[#0A0A0B] border border-white/5 p-8 text-center hover:border-white/20 transition-colors"
            >
              <div className="text-[10px] font-mono text-neutral-600 mb-4">0{index + 1}</div>
              <step.icon className="w-8 h-8 text-accent mx-auto mb-4" />
              <h3 className="text-lg font-display font-medium text-white uppercase mb-2">{step.title}</h3>
              <p className="text-sm font-mono text-neutral-500 leading-relaxed">{step.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

// ─── Community Section ───────────────────────────────────────────────────────

const CommunitySection = () => (
  <section className="py-32 bg-[#050505] border-t border-white/5 transition-colors duration-500">
    <div className="container mx-auto px-6">
      <div className="flex flex-col md:flex-row justify-between items-end mb-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <span className="text-[10px] font-mono text-accent uppercase tracking-widest mb-4 block">03 // Community</span>
          <h2 className="text-4xl md:text-5xl font-display font-medium text-white uppercase">
            Creator <span className="text-neutral-500">Network</span>
          </h2>
        </motion.div>
        <Link href="/smart-rentals" className="hidden md:flex items-center gap-2 text-xs font-mono text-neutral-400 hover:text-white transition-colors uppercase tracking-widest mt-6 md:mt-0">
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
              <div className="h-full bg-[#0A0A0B] border border-white/5 p-8 hover:border-white/20 transition-all">
                <item.icon className="w-6 h-6 text-neutral-600 mb-6 group-hover:text-white transition-colors" />
                <h3 className="text-lg font-display font-medium uppercase text-white mb-3">
                  {item.title}
                </h3>
                <p className="text-sm font-mono text-neutral-500 leading-relaxed mb-6">
                  {item.description}
                </p>
                <span className="flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-widest text-white group-hover:translate-x-1 transition-transform">
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
  <section className="py-24 bg-[#080808] border-t border-white/5 transition-colors duration-500">
    <div className="container mx-auto px-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
        >
          <span className="text-[10px] font-mono text-accent uppercase tracking-widest mb-4 block">04 // Smart Rentals</span>
          <h2 className="text-4xl md:text-5xl font-display font-medium text-white tracking-tighter uppercase mb-6 leading-[0.95]">
            Book <br />
            <span className="text-neutral-500">Professional Gear</span>
          </h2>
          <p className="text-neutral-400 font-light leading-relaxed mb-8 max-w-md">
            From cinema cameras to lighting kits. Check real-time availability, get instant pricing, and secure your gear with our streamlined booking system.
          </p>
          <div className="flex flex-wrap gap-4">
            <Link href="/smart-rentals" className="inline-flex items-center gap-2 min-h-[44px] bg-white text-black px-8 py-4 text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity">
              Browse Equipment <ArrowRight className="w-3 h-3" />
            </Link>
            <Link href="/register" className="inline-flex items-center gap-2 min-h-[44px] border border-white/20 text-white px-8 py-4 text-[10px] font-mono font-bold uppercase tracking-widest hover:bg-white/5 transition-colors">
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
            <div key={stat.label} className="bg-[#0A0A0B] border border-white/5 p-6">
              <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
                {stat.label}
              </p>
              <p className="text-2xl font-display font-medium text-white">
                {stat.value}
              </p>
            </div>
          ))}
        </motion.div>
      </div>
    </div>
  </section>
);

// ─── Ubunye AI Section ───────────────────────────────────────────────────────

const UbunyeSection = () => (
  <section className="py-24 bg-[#050505] border-t border-white/5">
    <div className="container mx-auto px-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="max-w-2xl mx-auto text-center"
      >
        <span className="text-[10px] font-mono text-accent uppercase tracking-widest mb-4 block">06 // AI Assistant</span>
        <MessageCircle className="w-10 h-10 text-accent mx-auto mb-6" />
        <h2 className="text-3xl md:text-4xl font-display font-medium text-white uppercase mb-4">
          Need Help <span className="text-neutral-500">Deciding?</span>
        </h2>
        <p className="text-neutral-400 font-light leading-relaxed mb-8">
          Ask Ubunye — our AI assistant finds the right creator and gear for your project.
        </p>
        <Link
          href="/ubunye-ai-studio"
          className="group inline-flex items-center gap-2 min-h-[44px] border border-accent/30 text-accent px-8 py-4 text-[10px] font-mono font-bold uppercase tracking-widest hover:bg-accent/10 transition-colors"
        >
          Ask Ubunye <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </Link>
      </motion.div>
    </div>
  </section>
);

// ─── Main Export ──────────────────────────────────────────────────────────────

export default function HomeClient({ carouselItems }: { carouselItems: CarouselItem[] }) {
  return (
    <div className="min-h-screen bg-[#050505] transition-colors duration-500">
      {/* 1. Hero */}
      <Hero />
      {/* 2. How It Works */}
      <HowItWorks />
      {/* 3. Studio Capabilities (3 cards) */}
      <ServiceGrid />
      {/* 4. Creator Network */}
      <CommunitySection />
      {/* 5. Smart Rentals */}
      <BookingCTA />
      {/* 6. Recent Work (productions only) */}
      <LatestWorkCarousel items={carouselItems} />
      {/* 7. Ubunye AI */}
      <UbunyeSection />
      {/* 8. CTA */}
      <section className="py-40 relative bg-gradient-to-b from-neutral-950 via-neutral-900 to-neutral-950 overflow-hidden border-t border-white/5 transition-colors duration-500">
        <div className="container mx-auto px-6 relative z-10 text-center">
          <span className="text-[10px] font-mono text-neutral-400 uppercase tracking-widest mb-6 block">08 // Get Started</span>
          <h2 className="text-5xl md:text-8xl font-display font-medium text-white tracking-tighter mb-12 uppercase">
            Ready To <br /> Create?
          </h2>
          <div className="flex flex-wrap justify-center gap-4">
            <Link href="/contact" className="inline-flex items-center justify-center min-h-[44px] bg-white text-black px-12 py-5 text-xs font-mono font-bold tracking-[0.2em] transition-all uppercase hover:opacity-80">
              Start a Project
            </Link>
            <Link href="/smart-rentals" className="inline-flex items-center justify-center min-h-[44px] border border-white/20 hover:bg-white/5 text-white px-12 py-5 text-xs font-mono font-bold tracking-[0.2em] transition-all uppercase">
              Browse Gear
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
