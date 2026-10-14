import { Camera, Car, Clapperboard, Lightbulb, MapPin, Sparkles, User, type LucideIcon } from 'lucide-react';
import type { RoleGroup } from '@/lib/roles';

const ICONS: Record<RoleGroup, LucideIcon> = {
  on_camera: User,
  hair_makeup: Sparkles,
  crew: Lightbulb,
  camera: Camera,
  post: Clapperboard,
  transport: Car,
  places: MapPin,
};

export function RoleIcon({ group, className = 'w-6 h-6' }: { group: RoleGroup; className?: string }) {
  const Icon = ICONS[group] ?? User;
  return <Icon className={className} aria-hidden="true" />;
}
