'use client';

import { motion } from 'framer-motion';
import { MapPin, Clock, Phone, Mail } from 'lucide-react';
import { STUDIO } from '@/lib/constants';

const LocationCard = ({ name, address, city, province, phone, email, isPrimary, delay }: {
  name: string;
  address: string;
  city: string;
  province: string;
  phone: string;
  email: string;
  isPrimary: boolean;
  delay: number;
}) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    whileInView={{ opacity: 1, y: 0 }}
    transition={{ delay }}
    className="group bg-[#0A0A0B] border border-white/5 overflow-hidden hover:border-white/20 transition-colors"
  >
    <div className="relative h-48 overflow-hidden bg-neutral-900 flex items-center justify-center">
      <MapPin className="w-16 h-16 text-neutral-800" />
      <div className="absolute bottom-0 left-0 p-6 z-20">
        <span className="bg-[#D4A843] text-black text-xs font-mono font-bold px-2 py-1 uppercase tracking-widest">
          {isPrimary ? 'Collection point' : 'Studio'}
        </span>
      </div>
    </div>
    <div className="p-8">
       <h3 className="text-3xl font-display font-medium uppercase mb-2 text-white">{name}</h3>
       <p className="text-sm font-mono text-neutral-400 mb-6">{city}, {province}</p>
       <div className="space-y-4 text-sm font-mono text-neutral-400">
          {address && (
            <div className="flex gap-4">
               <MapPin className="w-4 h-4 flex-shrink-0 mt-1 text-[#D4A843]" />
               <p>{address}</p>
            </div>
          )}
          {phone && (
            <div className="flex gap-4">
               <Phone className="w-4 h-4 flex-shrink-0 text-[#D4A843]" />
               <a href={`tel:${phone}`} className="hover:text-white transition-colors">{phone}</a>
            </div>
          )}
          <div className="flex gap-4">
             <Mail className="w-4 h-4 flex-shrink-0 text-[#D4A843]" />
             <a href={`mailto:${email}`} className="hover:text-white transition-colors">{email}</a>
          </div>
          {/* Hours only where there are set hours: the by-appointment
              location listed Mon to Sat hours under "by appointment". */}
          {isPrimary && (
          <div className="flex gap-4">
             <Clock className="w-4 h-4 flex-shrink-0 mt-1 text-[#D4A843]" />
             <div>
               <p>{STUDIO.hours.weekday}</p>
               <p>{STUDIO.hours.weekend}</p>
               <p>{STUDIO.hours.sunday}</p>
             </div>
          </div>
          )}
       </div>
    </div>
  </motion.div>
);

export default function LocationsPage() {
  return (
    <div className="min-h-screen bg-[#050505] pt-32 pb-20">
       <div className="container mx-auto px-6">
          <div className="max-w-4xl mb-20">
            <h1 className="text-5xl md:text-7xl font-display font-medium text-white tracking-tighter uppercase mb-8">
              Where to <span className="text-neutral-400">Collect</span>
            </h1>
            <div className="w-8 h-px bg-[#D4A843] mt-6" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
             {STUDIO.locations.map((loc, index) => (
               <LocationCard
                 key={loc.name}
                 name={loc.name}
                 address={loc.address || ''}
                 city={loc.city}
                 province={loc.province}
                 phone={loc.phone}
                 email={loc.email}
                 isPrimary={loc.isPrimary}
                 delay={index * 0.1}
               />
             ))}
          </div>
       </div>
    </div>
  );
}
