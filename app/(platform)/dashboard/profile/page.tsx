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
import AddressAutocomplete from '@/components/ui/AddressAutocomplete';
import type { AddressResult } from '@/components/ui/AddressAutocomplete';
import BankingDetails from '@/components/dashboard/BankingDetails';

function RequiredLabel({ children }: { children: React.ReactNode }) {
  return (
    <span>
      {children} <span className="text-red-400">*</span>
    </span>
  );
}

export default function ProfileEditPage() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [bio, setBio] = useState('');
  const [phone, setPhone] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [skills, setSkills] = useState<string[]>([]);
  const [newSkill, setNewSkill] = useState('');
  const [socialLinks, setSocialLinks] = useState<Record<string, string>>({});
  const [address, setAddress] = useState<AddressResult | null>(null);

  // Creator settings
  const [availableForHire, setAvailableForHire] = useState(false);
  const [hourlyRate, setHourlyRate] = useState('');
  const [crewBio, setCrewBio] = useState('');
  const [yearsExperience, setYearsExperience] = useState('');
  const [specializations, setSpecializations] = useState<string[]>([]);
  const [isVerified, setIsVerified] = useState(false);

  const [hasBanking, setHasBanking] = useState(false);

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
    checkBankingStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function checkBankingStatus() {
    try {
      const res = await fetch('/api/banking', { credentials: 'include' });
      setHasBanking(res.ok);
    } catch {
      setHasBanking(false);
    }
  }

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
      setFirstName(profile.first_name ?? '');
      setLastName(profile.last_name ?? '');
      setBio(profile.bio ?? '');
      setPhone(profile.phone ?? '');
      setAvatarUrl(profile.avatar_url ?? '');
      setSkills(profile.skills ?? []);
      setSocialLinks(profile.social_links ?? {});
      // Load creator settings
      setAvailableForHire((data as Record<string, unknown>).available_for_hire as boolean ?? false);
      setHourlyRate(String((data as Record<string, unknown>).hourly_rate ?? ''));
      setCrewBio((data as Record<string, unknown>).crew_bio as string ?? '');
      setYearsExperience(String((data as Record<string, unknown>).years_experience ?? ''));
      setSpecializations((data as Record<string, unknown>).specializations as string[] ?? []);
      setIsVerified((data as Record<string, unknown>).verification_status === 'verified');

      if (profile.street_address || profile.city || profile.province) {
        setAddress({
          streetAddress: profile.street_address ?? '',
          city: profile.city ?? '',
          province: profile.province ?? '',
          postalCode: profile.postal_code ?? '',
          country: profile.country ?? 'South Africa',
          lat: profile.address_lat,
          lng: profile.address_lng,
          placeId: profile.address_place_id,
        });
      }
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

      const folder = `profiles/${user.id}`;

      const signRes = await fetch('/api/cloudinary/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          paramsToSign: { folder, resource_type: 'image' },
        }),
      });

      if (!signRes.ok) {
        const err = await signRes.json();
        throw new Error(err.error || 'Failed to sign upload.');
      }

      const { signature, timestamp, cloudName, apiKey } = await signRes.json();

      const formData = new FormData();
      formData.append('file', file);
      formData.append('signature', signature);
      formData.append('timestamp', timestamp);
      formData.append('api_key', apiKey);
      formData.append('folder', folder);

      const uploadRes = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
        { method: 'POST', body: formData },
      );
      const uploadData = await uploadRes.json();

      if (uploadData.secure_url) {
        const {
          data: { user: currentUser },
        } = await supabase.auth.getUser();
        if (currentUser) {
          const { error: dbError } = await supabase
            .from('profiles')
            .update({
              avatar_url: uploadData.secure_url,
              avatar_public_id: uploadData.public_id || null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', currentUser.id);

          if (dbError) {
            throw new Error('Photo uploaded but failed to save. Please click Save Profile.');
          }
        }

        setAvatarUrl(uploadData.secure_url);
        setMessage({ type: 'success', text: 'Profile photo updated.' });
        setTimeout(() => setMessage(null), 3000);
      } else {
        throw new Error(uploadData.error?.message || 'Upload failed.');
      }
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to upload avatar.',
      });
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

    // Block save if available for hire without banking details
    if (availableForHire && !hasBanking) {
      setMessage({ type: 'error', text: 'You must add your banking details before going available for hire.' });
      setSaving(false);
      return;
    }

    // Validate required fields
    const missingFields: string[] = [];
    if (!firstName.trim()) missingFields.push('First Name');
    if (!lastName.trim()) missingFields.push('Last Name');
    if (!address?.streetAddress?.trim()) missingFields.push('Street Address');
    if (!address?.city?.trim()) missingFields.push('City');
    if (!address?.province?.trim()) missingFields.push('Province');
    if (!address?.postalCode?.trim()) missingFields.push('Postal Code');
    if (!phone.trim()) missingFields.push('Phone');

    if (missingFields.length > 0) {
      setMessage({ type: 'error', text: `Please complete all required fields: ${missingFields.join(', ')}` });
      setSaving(false);
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setMessage({ type: 'error', text: 'Not authenticated.' });
      setSaving(false);
      return;
    }

    // Validate social link URLs
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

    // Auto-generate display_name from first + last name
    const displayName = firstName.trim() && lastName.trim()
      ? `${firstName.trim()} ${lastName.trim()}`
      : firstName.trim() || lastName.trim() || null;

    // Sync legacy location field
    const locationLegacy = address?.city && address?.province
      ? `${address.city}, ${address.province}`
      : null;

    const payload = {
      first_name: firstName.trim() || null,
      last_name: lastName.trim() || null,
      display_name: displayName,
      bio: bio.trim() || null,
      location: locationLegacy,
      phone: phone.trim() || null,
      avatar_url: avatarUrl || null,
      skills: skills.length > 0 ? skills : null,
      social_links:
        Object.keys(safeSocialLinks).length > 0 ? safeSocialLinks : null,
      street_address: address?.streetAddress?.trim() || null,
      city: address?.city?.trim() || null,
      province: address?.province?.trim() || null,
      postal_code: address?.postalCode?.trim() || null,
      country: address?.country?.trim() || 'South Africa',
      address_lat: address?.lat ?? null,
      address_lng: address?.lng ?? null,
      address_place_id: address?.placeId ?? null,
      available_for_hire: availableForHire,
      hourly_rate: hourlyRate ? parseInt(hourlyRate, 10) : null,
      crew_bio: crewBio.trim() || null,
      years_experience: yearsExperience ? parseInt(yearsExperience, 10) : null,
      specializations: specializations.length > 0 ? specializations : [],
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
      <h2 className="text-lg font-display font-medium uppercase text-white mb-8">
        Edit Profile
      </h2>

      <form onSubmit={handleSubmit} className="space-y-10">
        {/* Section 1: Profile Photo */}
        <div className="flex items-center gap-6">
          <div className="relative w-20 h-20 rounded-full overflow-hidden border border-white/10 bg-neutral-900 flex-shrink-0">
            {avatarUrl ? (
              <Image
                src={avatarUrl}
                alt="Avatar"
                fill
                sizes="80px"
                className="object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-neutral-800 text-neutral-300 text-lg font-display font-bold uppercase">
                {firstName
                  ? `${firstName[0] || ''}${lastName[0] || ''}`.toUpperCase()
                  : <Camera className="w-6 h-6 text-neutral-400" />}
              </div>
            )}
          </div>
          <div>
            <label className="cursor-pointer">
              <span className="inline-block text-[10px] font-mono uppercase tracking-widest border border-white/20 text-white px-4 py-2 hover:bg-white hover:text-black transition-all">
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

        {/* Section 2: Personal Details (REQUIRED) */}
        <div className="space-y-5">
          <div>
            <p className="block text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-3">
              <RequiredLabel>Full Name (as on your ID)</RequiredLabel>
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Input
                label="First Name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First name"
                required
              />
              <Input
                label="Last Name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Last name"
                required
              />
            </div>
            <p className="text-[9px] font-mono text-neutral-600 mt-2">
              Must match the name on your SA ID for verification.
            </p>
          </div>

          {/* Address */}
          <div>
            <p className="block text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-3">
              <RequiredLabel>Address</RequiredLabel>
            </p>
            <AddressAutocomplete
              onSelect={(addr) => setAddress(addr)}
              defaultValue={address?.streetAddress}
              defaultAddress={address ? {
                city: address.city,
                province: address.province,
                postalCode: address.postalCode,
              } : undefined}
            />
          </div>

          <div>
            <Input
              label="Phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+27..."
              required
            />
            <p className="text-[9px] font-mono text-neutral-600 mt-1">
              <span className="text-red-400">*</span> Required
            </p>
          </div>
        </div>

        {/* Section 3: Social Links (optional) */}
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

        {/* Banking Details */}
        <div id="banking-details-section">
          <p className="block text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-3">
            Banking Details
          </p>
          <BankingDetails onSaved={() => checkBankingStatus()} />
        </div>

        {/* Section 4: Creator Settings (only for verified users) */}
        {isVerified && (
          <div className="border-t border-white/10 pt-8">
            <p className="block text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-4">
              Creator Settings
            </p>

            {/* Available for hire toggle */}
            <div className="flex items-center justify-between mb-2 bg-neutral-900 border border-white/5 p-4">
              <div>
                <p className="text-xs font-mono font-bold text-white">Available for Hire</p>
                <p className="text-[9px] font-mono text-neutral-500 mt-0.5">
                  {availableForHire
                    ? 'You appear on the creator listing and in Ubunye search results.'
                    : "You're hidden from the creator listing."}
                </p>
              </div>
              <button
                type="button"
                disabled={!hasBanking}
                onClick={() => {
                  if (hasBanking) setAvailableForHire(!availableForHire);
                }}
                className={`relative w-10 h-5 rounded-full transition-colors ${
                  !hasBanking
                    ? 'bg-neutral-800 cursor-not-allowed opacity-50'
                    : availableForHire
                      ? 'bg-emerald-500'
                      : 'bg-neutral-700'
                }`}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                    availableForHire && hasBanking ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
            {!hasBanking && (
              <p className="text-[9px] font-mono text-[#D4A843] mb-5 px-1">
                You must add your banking details before going available for hire.{' '}
                <span className="underline cursor-pointer" onClick={() => {
                  document.getElementById('banking-details-section')?.scrollIntoView({ behavior: 'smooth' });
                }}>
                  Go to Banking Details
                </span>
              </p>
            )}
            {hasBanking && <div className="mb-5" />}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
              <Input
                label="Hourly Rate (ZAR)"
                type="number"
                value={hourlyRate}
                onChange={(e) => setHourlyRate(e.target.value)}
                placeholder="1500"
              />
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
                  Years of Experience
                </label>
                <select
                  value={yearsExperience}
                  onChange={(e) => setYearsExperience(e.target.value)}
                  className="w-full bg-neutral-900 border border-white/10 text-white px-4 py-3 min-h-[44px] text-sm font-mono focus:outline-none focus:border-white transition-colors"
                >
                  <option value="">Select...</option>
                  {Array.from({ length: 20 }, (_, i) => (
                    <option key={i + 1} value={String(i + 1)}>
                      {i + 1} {i === 0 ? 'year' : 'years'}
                    </option>
                  ))}
                  <option value="20">20+ years</option>
                </select>
              </div>
            </div>

            {/* Specializations */}
            <div className="mb-5">
              <p className="block text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
                Specializations
              </p>
              <div className="flex flex-wrap gap-2">
                {['Photography', 'Cinematography', 'Editing', 'Sound', 'Directing', 'Lighting', 'Producing'].map(
                  (spec) => (
                    <button
                      key={spec}
                      type="button"
                      onClick={() =>
                        setSpecializations((prev) =>
                          prev.includes(spec.toLowerCase())
                            ? prev.filter((s) => s !== spec.toLowerCase())
                            : [...prev, spec.toLowerCase()],
                        )
                      }
                      className={`text-[10px] font-mono uppercase tracking-widest px-4 py-2 border transition-all min-h-[36px] ${
                        specializations.includes(spec.toLowerCase())
                          ? 'bg-white text-black border-white'
                          : 'bg-transparent text-neutral-500 border-white/10 hover:border-white/30'
                      }`}
                    >
                      {spec}
                    </button>
                  ),
                )}
              </div>
            </div>

            {/* Bio (moved from Personal Details) */}
            <div className="mb-5">
              <Textarea
                label="Bio"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Tell us about yourself and your work..."
                maxLength={500}
                rows={4}
              />
            </div>

            {/* Skills (moved from Personal Details) */}
            <div className="mb-5">
              <p className="block text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-3">
                Skills
              </p>
              <div className="flex flex-wrap gap-2 mb-3">
                {skills.map((skill) => (
                  <span
                    key={skill}
                    className="inline-flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-widest border border-white/10 px-2.5 py-1 text-neutral-400"
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

            {/* Creator Bio */}
            <Textarea
              label="Creator Bio (shown on your public creator profile)"
              value={crewBio}
              onChange={(e) => setCrewBio(e.target.value)}
              placeholder="Tell clients about your professional experience..."
              maxLength={500}
              rows={3}
            />
          </div>
        )}

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
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : 'bg-red-500/10 border-red-500/30 text-red-400',
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
