'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { featuredEquipment } from '@/lib/data';
import { TechnicalHUD } from '@/components/cinematic/TechnicalHUD';
import { motion } from 'framer-motion';
import { ArrowLeft, Check, Ruler, Camera } from 'lucide-react';

export default function ProductDetailPage() {
  const { slug } = useParams<{ slug: string }>();

  // Mock finding product (in real app, fetch from API)
  const product = featuredEquipment.find(p => p.slug === slug) || featuredEquipment[0];

  if (!product) return <div>Product not found</div>;

  return (
    <div className="min-h-screen bg-white dark:bg-[#0A0A0B] text-black dark:text-white pt-20 transition-colors duration-500">
      <TechnicalHUD equipment={product} />

      {/* Breadcrumb & Back */}
      <div className="container mx-auto px-6 py-6 flex items-center gap-4 text-xs tracking-widest text-neutral-500">
        <Link href="/" className="hover:text-black dark:hover:text-white transition-colors flex items-center gap-2">
          <ArrowLeft className="w-3 h-3" /> BACK
        </Link>
        <span>/</span>
        <span className="uppercase">{product.category}</span>
        <span>/</span>
        <span className="text-black dark:text-white font-bold uppercase">{product.name}</span>
      </div>

      {/* Cinematic Hero */}
      <section className="relative h-[80vh] w-full overflow-hidden mb-20">
        <motion.div
          initial={{ scale: 1.1, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 1.5, ease: "easeOut" }}
          className="absolute inset-0"
        >
          <div className="absolute inset-0 bg-gradient-to-t from-white via-transparent to-transparent dark:from-[#0A0A0B] dark:via-transparent dark:to-transparent z-10" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={product.media.heroImage}
            alt={product.name}
            className="w-full h-full object-cover"
          />
        </motion.div>

        <div className="absolute bottom-0 left-0 w-full z-20 pb-20 pt-32 bg-gradient-to-t from-white to-transparent dark:from-[#0A0A0B] dark:to-transparent">
          <div className="container mx-auto px-6">
            <motion.span
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="inline-block border border-black/10 dark:border-white/20 bg-white/50 dark:bg-black/50 backdrop-blur-sm px-3 py-1 text-[10px] font-bold tracking-widest uppercase mb-4 text-neutral-600 dark:text-neutral-300"
            >
              {product.category} Series
            </motion.span>
            <motion.h1
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.7 }}
              className="text-5xl md:text-8xl font-black tracking-tighter uppercase mb-6 text-black dark:text-white"
            >
              {product.name}
            </motion.h1>
            <motion.p
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.9 }}
              className="text-lg md:text-xl text-neutral-600 dark:text-neutral-400 max-w-2xl font-light leading-relaxed"
            >
              {product.description}
            </motion.p>
          </div>
        </div>
      </section>

      {/* Main Content Layout */}
      <div className="container mx-auto px-6 pb-32">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">

          {/* Left Column (Details) */}
          <div className="lg:col-span-8 space-y-20">

            {/* Overview */}
            <section>
              <h2 className="text-2xl font-bold tracking-tight mb-8 border-l-2 border-black dark:border-white pl-4">OVERVIEW</h2>
              <div className="prose prose-invert prose-lg text-neutral-600 dark:text-neutral-400">
                <p>{product.tagline} Engineered for the modern cinematographer, the {product.name} brings distinct character and technical perfection together.</p>
                <p className="mt-4">Whether shooting on digital or film, this system provides organic falloff, pleasing skin tones, and the robust build quality professionals demand in the field.</p>
              </div>
            </section>

            {/* Features Grid */}
            <section>
               <h2 className="text-2xl font-bold tracking-tight mb-8 border-l-2 border-black dark:border-white pl-4">KEY FEATURES</h2>
               <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 <div className="bg-neutral-100 dark:bg-neutral-900/50 p-6 border border-black/5 dark:border-white/5">
                    <Ruler className="w-6 h-6 text-black dark:text-white mb-4" />
                    <h3 className="text-sm font-bold tracking-widest text-black dark:text-white mb-2 uppercase">Optical Precision</h3>
                    <p className="text-sm text-neutral-500">Hand-assembled optics ensuring consistent T-stops and color matching across the entire set.</p>
                 </div>
                 <div className="bg-neutral-100 dark:bg-neutral-900/50 p-6 border border-black/5 dark:border-white/5">
                    <Camera className="w-6 h-6 text-black dark:text-white mb-4" />
                    <h3 className="text-sm font-bold tracking-widest text-black dark:text-white mb-2 uppercase">Wide Format</h3>
                    <p className="text-sm text-neutral-500">Designed to cover modern sensor sizes including {product.specs.coverage.join(' & ')}.</p>
                 </div>
               </div>
            </section>

            {/* Gallery */}
            <section>
              <h2 className="text-2xl font-bold tracking-tight mb-8 border-l-2 border-black dark:border-white pl-4">VISUAL GALLERY</h2>
              <div className="grid grid-cols-2 gap-4">
                 {product.media.gallery.map((img, i) => (
                   // eslint-disable-next-line @next/next/no-img-element
                   <img key={i} src={img} alt="Gallery" className="w-full h-64 object-cover border border-black/5 dark:border-white/10 hover:border-black/20 dark:hover:border-white/30 transition-colors" />
                 ))}
                 <div className="w-full h-64 bg-neutral-100 dark:bg-neutral-900 flex items-center justify-center border border-black/5 dark:border-white/10">
                    <span className="text-xs tracking-widest text-neutral-500 dark:text-neutral-600 uppercase">+ View More</span>
                 </div>
              </div>
            </section>
          </div>

          {/* Right Column (Mobile Specs - Desktop uses HUD) */}
          <div className="lg:col-span-4 lg:hidden">
             <div className="bg-neutral-100 dark:bg-neutral-900 p-8 border border-black/10 dark:border-white/10">
               <h3 className="text-lg font-bold text-black dark:text-white mb-6 uppercase tracking-widest">Specifications</h3>
               <dl className="space-y-4">
                 <div className="flex justify-between border-b border-black/10 dark:border-white/10 pb-2">
                   <dt className="text-neutral-500 text-sm">T-Stop</dt>
                   <dd className="text-black dark:text-white text-sm font-mono">{product.specs.tStop}</dd>
                 </div>
                 <div className="flex justify-between border-b border-black/10 dark:border-white/10 pb-2">
                   <dt className="text-neutral-500 text-sm">Close Focus</dt>
                   <dd className="text-black dark:text-white text-sm font-mono">{product.specs.closeFocus}</dd>
                 </div>
                 <div className="flex justify-between border-b border-black/10 dark:border-white/10 pb-2">
                   <dt className="text-neutral-500 text-sm">Weight</dt>
                   <dd className="text-black dark:text-white text-sm font-mono">{product.specs.weight}</dd>
                 </div>
               </dl>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}
