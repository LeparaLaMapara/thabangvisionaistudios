'use client';

import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  MapPin,
  Globe,
  CheckCircle,
} from 'lucide-react';
import type { Profile } from '@/lib/supabase/queries/profiles';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';

interface Props {
  profile: Profile;
}

const SOCIAL_ICONS: Record<string, string> = {
  website: 'Globe',
  instagram: 'Instagram',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
  twitter: 'X',
};

export default function CreatorProfileClient({ profile }: Props) {
  const skills = profile.skills ?? [];
  const socialLinks = profile.social_links ?? {};
  const hasSocials = Object.keys(socialLinks).length > 0;

  return (
    <div className="min-h-screen bg-white dark:bg-[#0A0A0B] text-black dark:text-white pt-20 transition-colors duration-500">
      {/* Breadcrumb */}
      <div className="container mx-auto px-6 py-6 flex items-center gap-4 text-xs tracking-widest text-neutral-500">
        <Link
          href="/"
          className="hover:text-black dark:hover:text-white transition-colors flex items-center gap-2"
        >
          <ArrowLeft className="w-3 h-3" /> HOME
        </Link>
        <span>/</span>
        <span className="text-black dark:text-white font-bold uppercase">
          {profile.display_name ?? 'Creator'}
        </span>
      </div>

      <div className="container mx-auto px-6 pb-32">
        <div className="max-w-3xl mx-auto">
          {/* Profile Header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="flex flex-col sm:flex-row items-start gap-8 mb-16"
          >
            {/* Avatar */}
            <div className="relative w-28 h-28 rounded-full overflow-hidden border border-black/10 dark:border-white/10 bg-neutral-100 dark:bg-neutral-900 flex-shrink-0">
              {profile.avatar_url ? (
                <Image
                  src={profile.avatar_url}
                  alt={profile.display_name ?? 'Creator'}
                  fill
                  className="object-cover"
                  priority
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-4xl font-display font-bold text-neutral-300 dark:text-neutral-700">
                  {(profile.display_name ?? '?')[0]?.toUpperCase()}
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-3xl md:text-4xl font-display font-medium uppercase tracking-tight">
                  {profile.display_name ?? 'Creator'}
                </h1>
                {profile.is_verified && (
                  <CheckCircle className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                )}
              </div>

              {profile.location && (
                <p className="flex items-center gap-1.5 text-sm text-neutral-500 font-mono mb-4">
                  <MapPin className="w-3.5 h-3.5" />
                  {profile.location}
                </p>
              )}

              {profile.bio && (
                <p className="text-neutral-600 dark:text-neutral-400 font-light leading-relaxed max-w-xl">
                  {profile.bio}
                </p>
              )}
            </div>
          </motion.div>

          {/* Skills */}
          {skills.length > 0 && (
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.4 }}
              className="mb-16"
            >
              <h2 className="text-sm font-bold tracking-tight mb-6 border-l-2 border-black dark:border-white pl-4 uppercase">
                Skills
              </h2>
              <div className="flex flex-wrap gap-2">
                {skills.map((skill) => (
                  <Badge key={skill}>{skill}</Badge>
                ))}
              </div>
            </motion.section>
          )}

          {/* Social Links */}
          {hasSocials && (
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.4 }}
              className="mb-16"
            >
              <h2 className="text-sm font-bold tracking-tight mb-6 border-l-2 border-black dark:border-white pl-4 uppercase">
                Connect
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {Object.entries(socialLinks).map(([platform, url]) => (
                  <Card key={platform} hover>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 p-4"
                    >
                      <Globe className="w-4 h-4 text-neutral-400 flex-shrink-0" />
                      <div>
                        <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-0.5">
                          {SOCIAL_ICONS[platform] ?? platform}
                        </p>
                        <p className="text-xs font-mono text-black dark:text-white truncate max-w-[200px]">
                          {url}
                        </p>
                      </div>
                    </a>
                  </Card>
                ))}
              </div>
            </motion.section>
          )}

          {/* Member Since */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.4 }}
            className="text-center border-t border-black/10 dark:border-white/10 pt-8"
          >
            <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-neutral-400 dark:text-neutral-600">
              Member since{' '}
              {new Date(profile.created_at).toLocaleDateString('en-ZA', {
                year: 'numeric',
                month: 'long',
              })}
            </p>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
