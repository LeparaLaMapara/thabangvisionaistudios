'use client';

import { motion } from 'framer-motion';
import { MapPin, Clock, Phone } from 'lucide-react';

const LocationCard = ({ city, type, address, contact, image, delay }: {
  city: string;
  type: string;
  address: string;
  contact: string;
  image: string;
  delay: number;
}) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    whileInView={{ opacity: 1, y: 0 }}
    transition={{ delay }}
    className="group bg-white dark:bg-[#0A0A0B] border border-black/5 dark:border-white/5 overflow-hidden"
  >
    <div className="relative h-64 overflow-hidden">
       <div className="absolute inset-0 bg-black/20 group-hover:bg-black/0 transition-colors z-10" />
       {/* eslint-disable-next-line @next/next/no-img-element */}
       <img src={image} alt={city} className="w-full h-full object-cover grayscale group-hover:grayscale-0 scale-100 group-hover:scale-105 transition-all duration-700" />
       <div className="absolute bottom-0 left-0 p-6 z-20">
          <span className="bg-black text-white dark:bg-white dark:text-black text-[9px] font-mono font-bold px-2 py-1 uppercase tracking-widest">
            {type}
          </span>
       </div>
    </div>
    <div className="p-8">
       <h3 className="text-3xl font-display font-medium uppercase mb-6 text-black dark:text-white">{city}</h3>
       <div className="space-y-4 text-sm font-mono text-neutral-600 dark:text-neutral-400">
          <div className="flex gap-4">
             <MapPin className="w-4 h-4 flex-shrink-0 mt-1" />
             <p>{address}</p>
          </div>
          <div className="flex gap-4">
             <Phone className="w-4 h-4 flex-shrink-0" />
             <p>{contact}</p>
          </div>
          <div className="flex gap-4">
             <Clock className="w-4 h-4 flex-shrink-0" />
             <p>Mon-Fri: 08:00 - 18:00</p>
          </div>
       </div>
    </div>
  </motion.div>
);

export default function LocationsPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-[#050505] pt-32 pb-20 transition-colors duration-500">
       <div className="container mx-auto px-6">
          <div className="max-w-4xl mb-20">
            <span className="text-[10px] font-mono text-neutral-500 dark:text-accent uppercase tracking-widest mb-4 block">Global Operations</span>
            <h1 className="text-5xl md:text-7xl font-display font-medium text-black dark:text-white tracking-tighter uppercase mb-8">
              Where to Find Us
            </h1>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
             <LocationCard
               city="Johannesburg"
               type="Headquarters & Lab"
               address="1 Fox Precinct, Maboneng, Johannesburg, 2094, South Africa"
               contact="+27 (10) 555 0123"
               image="https://images.unsplash.com/photo-1576487248805-cf45f6bcc67f?q=80&w=2000&auto=format&fit=crop"
               delay={0}
             />
             <LocationCard
               city="Cape Town"
               type="Rental Depot"
               address="Unit 4, Film Studios, Paarden Eiland, Cape Town, 7405"
               contact="+27 (21) 555 0987"
               image="https://images.unsplash.com/photo-1580060839134-75a5edca2e27?q=80&w=2000&auto=format&fit=crop"
               delay={0.1}
             />
          </div>

          {/* Map Graphic Placeholder */}
          <div className="mt-20 p-12 bg-neutral-100 dark:bg-[#0A0A0B] border border-black/5 dark:border-white/5 text-center">
             <h2 className="text-2xl font-display uppercase mb-4 text-black dark:text-white">International Support</h2>
             <p className="text-neutral-500 max-w-2xl mx-auto font-mono text-sm mb-8">
                We maintain active partnerships with rental houses in Los Angeles, London, and Dubai to support travelling productions using Thabangvision proprietary optics.
             </p>
             <div className="flex flex-wrap justify-center gap-4">
                {['Los Angeles', 'New York', 'London', 'Berlin', 'Dubai', 'Tokyo'].map(city => (
                   <span key={city} className="px-4 py-2 border border-black/10 dark:border-white/10 text-[10px] uppercase tracking-widest font-bold text-neutral-400">
                      {city}
                   </span>
                ))}
             </div>
          </div>
       </div>
    </div>
  );
}
