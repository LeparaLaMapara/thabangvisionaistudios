import { MessageCircle } from 'lucide-react';
import { STUDIO } from '@/lib/constants';
import { whatsappLink } from '@/lib/payments/eft';

/** WhatsApp, with a message ready to send. The number is for WhatsApp only (no calls). */
export function ContactButtons({ message, className = '' }: { message?: string; className?: string }) {
  return (
    <div className={`flex flex-wrap gap-3 ${className}`}>
      <a
        href={whatsappLink(message)}
        target="_blank"
        rel="noopener noreferrer"
        className="min-h-[44px] inline-flex items-center gap-2 px-5 bg-[#25D366] text-[#050505] text-xs font-mono font-bold uppercase tracking-widest"
      >
        <MessageCircle className="w-4 h-4" aria-hidden="true" />
        WhatsApp {STUDIO.whatsapp.display}
      </a>
    </div>
  );
}
