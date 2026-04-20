import { AlertTriangle } from 'lucide-react';
import { STUDIO } from '@/lib/constants';

interface SuspensionBannerProps {
  reason: string | null;
}

export function SuspensionBanner({ reason }: SuspensionBannerProps) {
  return (
    <div className="flex items-start gap-3 p-4 mb-6 bg-red-500/10 border border-red-500/20 text-red-400">
      <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-mono font-bold">Account Suspended</p>
        {reason && (
          <p className="text-[11px] font-mono text-red-400/80 mt-1">{reason}</p>
        )}
        <p className="text-[10px] font-mono text-red-400/60 mt-2">
          Some features are restricted while your account is suspended. Contact{' '}
          <a
            href={`mailto:${STUDIO.supportEmail}`}
            className="underline hover:text-red-300 transition-colors"
          >
            {STUDIO.supportEmail}
          </a>{' '}
          if you believe this is an error.
        </p>
      </div>
    </div>
  );
}
