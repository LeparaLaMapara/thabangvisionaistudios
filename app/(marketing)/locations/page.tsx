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
    className="group bg-white dark:bg-[#0A0A0B] border border-black/5 dark:border-white/5 overflow-hidden"
  >
    <div className="relative h-48 overflow-hidden bg-neutral-100 dark:bg-neutral-900 flex items-center justify-center">
      <MapPin className="w-16 h-16 text-neutral-300 dark:text-neutral-700" />
      <div className="absolute bottom-0 left-0 p-6 z-20">
        <span className="bg-black text-white dark:bg-white dark:text-black text-[9px] font-mono font-bold px-2 py-1 uppercase tracking-widest">
          {isPrimary ? 'Headquarters' : 'Studio'}
        </span>
      </div>
    </div>
    <div className="p-8">
       <h3 className="text-3xl font-display font-medium uppercase mb-2 text-black dark:text-white">{name}</h3>
       <p className="text-sm font-mono text-neutral-400 mb-6">{city}, {province}</p>
       <div className="space-y-4 text-sm font-mono text-neutral-600 dark:text-neutral-400">
          {address && (
            <div className="flex gap-4">
               <MapPin className="w-4 h-4 flex-shrink-0 mt-1" />
               <p>{address}</p>
            </div>
          )}
          {phone && (
            <div className="flex gap-4">
               <Phone className="w-4 h-4 flex-shrink-0" />
               <a href={`tel:${phone}`} className="hover:text-black dark:hover:text-white transition-colors">{phone}</a>
            </div>
          )}
          <div className="flex gap-4">
             <Mail className="w-4 h-4 flex-shrink-0" />
             <a href={`mailto:${email}`} className="hover:text-black dark:hover:text-white transition-colors">{email}</a>
          </div>
          <div className="flex gap-4">
             <Clock className="w-4 h-4 flex-shrink-0 mt-1" />
             <div>
               <p>{STUDIO.hours.weekday}</p>
               <p>{STUDIO.hours.weekend}</p>
               <p>{STUDIO.hours.sunday}</p>
             </div>
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

          {/* International Partnerships */}
          <div className="mt-20 p-12 bg-neutral-100 dark:bg-[#0A0A0B] border border-black/5 dark:border-white/5 text-center">
             <h2 className="text-2xl font-display uppercase mb-4 text-black dark:text-white">International Partnerships</h2>
             <p className="text-neutral-500 max-w-2xl mx-auto font-mono text-sm mb-8">
                We maintain active partnerships with rental houses in {STUDIO.partnerships.international.map(p => p.city).join(', ')} to support travelling productions using {STUDIO.shortName} proprietary optics.
             </p>
             <div className="flex flex-wrap justify-center gap-4">
                {STUDIO.partnerships.international.map(partner => (
                   <span key={partner.city} className="px-4 py-2 border border-black/10 dark:border-white/10 text-[10px] uppercase tracking-widest font-bold text-neutral-400 flex items-center gap-2">
                      {partner.city}
                      {partner.status === 'planned' && (
                        <span className="text-[8px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded uppercase">
                          Planned Expansion
                        </span>
                      )}
                   </span>
                ))}
             </div>
          </div>
       </div>
    </div>
  );
}
