import { MessageCircle, Phone } from 'lucide-react';
import { STUDIO } from '@/lib/constants';
import { telLink, whatsappLink } from '@/lib/payments/eft';

/** WhatsApp (with a message ready to send) and a call link. */
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
      <a
        href={telLink}
        className="min-h-[44px] inline-flex items-center gap-2 px-5 border border-white/20 text-white text-xs font-mono font-bold uppercase tracking-widest"
      >
        <Phone className="w-4 h-4" aria-hidden="true" />
        Call {STUDIO.whatsapp.display}
      </a>
    </div>
  );
}
