'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Terminal, AlertTriangle, FileText, CheckCircle2 } from 'lucide-react';

export default function TechSupportPage() {
  const [ticketState, setTicketState] = useState('idle'); // idle, sending, sent

  return (
    <div className="min-h-screen bg-white dark:bg-[#050505] pt-32 pb-20 transition-colors duration-500">
      <div className="container mx-auto px-6">
         <div className="flex flex-col md:flex-row justify-between items-end mb-16">
            <div>
              <span className="text-[10px] font-mono text-neutral-500 dark:text-accent uppercase tracking-widest mb-4 block">00 // System Diagnostics</span>
              <h1 className="text-4xl md:text-6xl font-display font-medium text-black dark:text-white tracking-tighter uppercase">
                Technical Support
              </h1>
            </div>
            <div className="bg-green-500/10 border border-green-500/20 px-4 py-2 flex items-center gap-2 mt-4 md:mt-0">
               <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
               <span className="text-[10px] font-mono font-bold text-green-600 dark:text-green-400 uppercase tracking-widest">
                 Live Support Online
               </span>
            </div>
         </div>

         <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
            {/* Quick Actions */}
            <div className="space-y-4">
               <h3 className="text-sm font-bold uppercase tracking-widest border-b border-black/10 dark:border-white/10 pb-4 mb-6">Quick Diagnostics</h3>

               {[
                 { title: 'Firmware Status', icon: Terminal, desc: 'Check latest builds for DXL2 and Venice' },
                 { title: 'Lens Charts', icon: FileText, desc: 'Download distortion maps and illumination data' },
                 { title: 'Emergency Procedures', icon: AlertTriangle, desc: 'Critical failure protocols' }
               ].map((item, i) => (
                 <motion.div
                   key={i}
                   whileHover={{ x: 5 }}
                   className="p-6 border border-black/10 dark:border-white/10 bg-neutral-50 dark:bg-[#0A0A0B] cursor-pointer group hover:border-black/30 dark:hover:border-white/30 transition-all"
                 >
                    <item.icon className="w-6 h-6 mb-4 text-neutral-400 group-hover:text-black dark:group-hover:text-white transition-colors" />
                    <h4 className="font-bold text-black dark:text-white uppercase text-sm mb-1">{item.title}</h4>
                    <p className="text-xs font-mono text-neutral-500">{item.desc}</p>
                 </motion.div>
               ))}
            </div>

            {/* Ticket Form */}
            <div className="lg:col-span-2">
               <div className="bg-white dark:bg-[#0A0A0B] border border-black/10 dark:border-white/10 p-8 md:p-12">
                  <h3 className="text-xl font-display font-medium uppercase mb-8 text-black dark:text-white">Submit Support Ticket</h3>

                  {ticketState === 'sent' ? (
                     <div className="text-center py-12">
                        <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-6" />
                        <h4 className="text-2xl font-display uppercase mb-2">Ticket #8829 Created</h4>
                        <p className="text-neutral-500 font-mono text-sm">A technician has been assigned to your case.</p>
                        <button onClick={() => setTicketState('idle')} className="mt-8 text-xs underline uppercase font-bold">New Ticket</button>
                     </div>
                  ) : (
                     <form onSubmit={(e) => { e.preventDefault(); setTicketState('sent'); }} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                           <div>
                              <label className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2">Serial Number / Asset ID</label>
                              <input type="text" className="w-full bg-neutral-100 dark:bg-neutral-900 border border-black/10 dark:border-white/10 p-3 font-mono text-sm" placeholder="e.g. CAM-A-042" />
                           </div>
                           <div>
                              <label className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2">Urgency Level</label>
                              <select className="w-full bg-neutral-100 dark:bg-neutral-900 border border-black/10 dark:border-white/10 p-3 font-mono text-sm uppercase">
                                 <option>Low - Question</option>
                                 <option>Medium - Performance Issue</option>
                                 <option>High - On Set Stoppage</option>
                              </select>
                           </div>
                        </div>
                        <div>
                           <label className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2">Issue Description</label>
                           <textarea rows={5} className="w-full bg-neutral-100 dark:bg-neutral-900 border border-black/10 dark:border-white/10 p-3 font-mono text-sm" placeholder="Describe the technical fault..." />
                        </div>
                        <div>
                           <label className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2">Contact Email</label>
                           <input type="email" required className="w-full bg-neutral-100 dark:bg-neutral-900 border border-black/10 dark:border-white/10 p-3 font-mono text-sm" />
                        </div>
                        <button className="bg-black text-white dark:bg-white dark:text-black px-8 py-4 text-xs font-mono font-bold tracking-widest uppercase hover:opacity-80 transition-opacity w-full md:w-auto">
                           Initiate Ticket
                        </button>
                     </form>
                  )}
               </div>
            </div>
         </div>
      </div>
    </div>
  );
}
