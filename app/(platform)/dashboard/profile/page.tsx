'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { Camera, Loader2, X, Plus } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { Profile } from '@/lib/supabase/queries/profiles';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Button } from '@/components/ui/Button';

export default function ProfileEditPage() {
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [location, setLocation] = useState('');
  const [phone, setPhone] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [skills, setSkills] = useState<string[]>([]);
  const [newSkill, setNewSkill] = useState('');
  const [socialLinks, setSocialLinks] = useState<Record<string, string>>({});

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const supabase = createClient();

  useEffect(() => {
    loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadProfile() {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (error && error.code !== 'PGRST116') {
      setMessage({ type: 'error', text: error.message });
    } else if (data) {
      const profile = data as Profile;
      setDisplayName(profile.display_name ?? '');
      setBio(profile.bio ?? '');
      setLocation(profile.location ?? '');
      setPhone(profile.phone ?? '');
      setAvatarUrl(profile.avatar_url ?? '');
      setSkills(profile.skills ?? []);
      setSocialLinks(profile.social_links ?? {});
    }

    setLoading(false);
  }

  const handleAvatarUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingAvatar(true);
    setMessage(null);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated.');

      const signRes = await fetch('/api/cloudinary/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: `profiles/${user.id}` }),
      });
      const { signature, timestamp, api_key, cloud_name } =
        await signRes.json();

      const formData = new FormData();
      formData.append('file', file);
      formData.append('signature', signature);
      formData.append('timestamp', String(timestamp));
      formData.append('api_key', api_key);
      formData.append('folder', `profiles/${user.id}`);

      const uploadRes = await fetch(
        `https://api.cloudinary.com/v1_1/${cloud_name}/image/upload`,
        { method: 'POST', body: formData },
      );
      const uploadData = await uploadRes.json();

      if (uploadData.secure_url) {
        setAvatarUrl(uploadData.secure_url);
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to upload avatar.' });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const addSkill = () => {
    const trimmed = newSkill.trim();
    if (trimmed && !skills.includes(trimmed)) {
      setSkills([...skills, trimmed]);
      setNewSkill('');
    }
  };

  const removeSkill = (skill: string) => {
    setSkills(skills.filter((s) => s !== skill));
  };

  const handleSocialChange = (platform: string, value: string) => {
    setSocialLinks((prev) => {
      const next = { ...prev };
      if (value.trim()) {
        next[platform] = value.trim();
      } else {
        delete next[platform];
      }
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setMessage({ type: 'error', text: 'Not authenticated.' });
      setSaving(false);
      return;
    }

    // H10: Validate social link URLs — only allow http/https protocols
    const safeSocialLinks: Record<string, string> = {};
    for (const [platform, url] of Object.entries(socialLinks)) {
      if (!url.trim()) continue;
      try {
        const parsed = new URL(url);
        if (['https:', 'http:'].includes(parsed.protocol)) {
          safeSocialLinks[platform] = url;
        }
      } catch {
        // Skip invalid URLs
      }
    }

    const payload = {
      display_name: displayName.trim() || null,
      bio: bio.trim() || null,
      location: location.trim() || null,
      phone: phone.trim() || null,
      avatar_url: avatarUrl || null,
      skills: skills.length > 0 ? skills : null,
      social_links:
        Object.keys(safeSocialLinks).length > 0 ? safeSocialLinks : null,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('profiles')
      .update(payload)
      .eq('id', user.id);

    if (error) {
      setMessage({ type: 'error', text: error.message });
    } else {
      setMessage({ type: 'success', text: 'Profile saved successfully.' });
      setTimeout(() => setMessage(null), 3000);
    }

    setSaving(false);
  };

  const socialPlatforms = [
    'website',
    'instagram',
    'youtube',
    'linkedin',
    'twitter',
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 gap-2 text-neutral-500 font-mono text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading profile...
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <h2 className="text-lg font-display font-medium uppercase text-black dark:text-white mb-8">
        Edit Profile
      </h2>

      <form onSubmit={handleSubmit} className="space-y-10">
        {/* Avatar */}
        <div className="flex items-center gap-6">
          <div className="relative w-20 h-20 rounded-full overflow-hidden border border-black/10 dark:border-white/10 bg-neutral-100 dark:bg-neutral-900 flex-shrink-0">
            {avatarUrl ? (
              <Image
                src={avatarUrl}
                alt="Avatar"
                fill
                className="object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-neutral-400">
                <Camera className="w-6 h-6" />
              </div>
            )}
          </div>
          <div>
            <label className="cursor-pointer">
              <span className="inline-block text-[10px] font-mono uppercase tracking-widest border border-black/20 dark:border-white/20 text-black dark:text-white px-4 py-2 hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black transition-all">
                {uploadingAvatar ? 'Uploading...' : 'Upload Photo'}
              </span>
              <input
                type="file"
                accept="image/*"
                onChange={handleAvatarUpload}
                disabled={uploadingAvatar}
                className="hidden"
              />
            </label>
            <p className="text-[9px] font-mono text-neutral-500 mt-2">
              JPG, PNG or WebP. Max 2MB.
            </p>
          </div>
        </div>

        {/* Basic Info */}
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Input
              label="Display Name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your public name"
            />
            <Input
              label="Location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Johannesburg, SA"
            />
          </div>

          <Input
            label="Phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+27..."
          />

          <Textarea
            label="Bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Tell us about yourself and your work..."
            maxLength={500}
            rows={4}
          />
        </div>

        {/* Skills */}
        <div>
          <p className="block text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-3">
            Skills
          </p>
          <div className="flex flex-wrap gap-2 mb-3">
            {skills.map((skill) => (
              <span
                key={skill}
                className="inline-flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-widest border border-black/10 dark:border-white/10 px-2.5 py-1 text-neutral-600 dark:text-neutral-400"
              >
                {skill}
                <button
                  type="button"
                  onClick={() => removeSkill(skill)}
                  className="text-neutral-400 hover:text-red-500 transition-colors"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <Input
                value={newSkill}
                onChange={(e) => setNewSkill(e.target.value)}
                placeholder="Add a skill..."
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addSkill();
                  }
                }}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addSkill}
            >
              <Plus className="w-3 h-3" />
            </Button>
          </div>
        </div>

        {/* Social Links */}
        <div>
          <p className="block text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-3">
            Social Links
          </p>
          <div className="space-y-3">
            {socialPlatforms.map((platform) => (
              <Input
                key={platform}
                label={platform}
                value={socialLinks[platform] ?? ''}
                onChange={(e) =>
                  handleSocialChange(platform, e.target.value)
                }
                placeholder={
                  platform === 'website'
                    ? 'https://yoursite.com'
                    : `https://${platform}.com/...`
                }
              />
            ))}
          </div>
        </div>

        {/* Message */}
        {message && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="overflow-hidden"
          >
            <div
              className={[
                'px-4 py-3 border text-xs font-mono leading-relaxed',
                message.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                  : 'bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400',
              ].join(' ')}
            >
              {message.text}
            </div>
          </motion.div>
        )}

        {/* Submit */}
        <div className="flex justify-end">
          <Button type="submit" loading={saving}>
            Save Profile
          </Button>
        </div>
      </form>
    </motion.div>
  );
}
