'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, ChevronRight, ChevronLeft, MapPin, Check } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { STUDIO } from '@/lib/constants';
import AddressAutocomplete from '@/components/ui/AddressAutocomplete';
import type { AddressResult } from '@/components/ui/AddressAutocomplete';

export const dynamic = 'force-dynamic';

const TOTAL_STEPS = 4;

export default function OnboardingPage() {
  const [step, setStep] = useState(1);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [address, setAddress] = useState<AddressResult | null>(null);
  const [avatarUrl, setAvatarUrl] = useState('');
  const [avatarPublicId, setAvatarPublicId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        window.location.href = '/login';
      } else {
        setLoading(false);
      }
    });
  }, []);

  // ─── Name validation ────────────────────────────────────────────────────

  function validateName(name: string): string | null {
    const trimmed = name.trim();
    if (trimmed.length < 2) return 'Must be at least 2 characters.';
    if (!/^[a-zA-ZÀ-ÿ\s'-]+$/.test(trimmed)) return 'Contains invalid characters.';
    return null;
  }

  // ─── Step validation ────────────────────────────────────────────────────

  function canProceed(): boolean {
    switch (step) {
      case 1:
        return !validateName(firstName) && !validateName(lastName);
      case 2:
        return !!(address?.streetAddress?.trim() && address?.city?.trim() && address?.province?.trim());
      case 3:
        return !!avatarUrl;
      default:
        return true;
    }
  }

  // ─── Avatar upload (Cloudinary signed) ──────────────────────────────────

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setError('Please upload a JPG or PNG image.');
      return;
    }

    // Validate file size (100KB - 5MB)
    if (file.size < 100 * 1024) {
      setError('Image must be at least 100KB.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be under 5MB.');
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated.');

      const folder = `profiles/${user.id}`;

      const signRes = await fetch('/api/cloudinary/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ paramsToSign: { folder, resource_type: 'image' } }),
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
        setAvatarUrl(uploadData.secure_url);
        setAvatarPublicId(uploadData.public_id || '');
      } else {
        throw new Error(uploadData.error?.message || 'Upload failed.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload photo.');
    } finally {
      setUploading(false);
    }
  };

  // ─── Final submit ───────────────────────────────────────────────────────

  const handleFinish = async () => {
    setSaving(true);
    setError(null);

    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          streetAddress: address?.streetAddress || '',
          city: address?.city || '',
          province: address?.province || '',
          postalCode: address?.postalCode || '',
          country: address?.country || 'South Africa',
          addressLat: address?.lat || null,
          addressLng: address?.lng || null,
          addressPlaceId: address?.placeId || null,
          avatarUrl,
          avatarPublicId,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to save profile.');
      }

      window.location.href = '/dashboard';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setSaving(false);
    }
  };

  // ─── Loading state ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-40">
        <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex items-center justify-center px-6 py-16 min-h-screen">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="w-full max-w-lg"
      >
        {/* Header */}
        <div className="mb-8">
          <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-neutral-600 mb-3">
            {STUDIO.shortName.toUpperCase()}
          </p>
          <h1 className="text-3xl font-display font-medium uppercase tracking-tight text-white">
            Welcome
          </h1>
          <p className="text-xs font-mono text-neutral-500 mt-3 leading-relaxed">
            Let&apos;s set up your profile. This information will be visible to clients and crew.
          </p>
          <div className="w-8 h-px bg-white mt-5" />
        </div>

        {/* Progress bar */}
        <div className="flex gap-2 mb-8">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <div
              key={i}
              className={`h-0.5 flex-1 transition-colors duration-300 ${
                i < step ? 'bg-white' : 'bg-white/10'
              }`}
            />
          ))}
        </div>

        {/* Card */}
        <div className="bg-[#0A0A0B] border border-white/10 p-8">
          <AnimatePresence mode="wait">
            {/* ─── Step 1: Name ─── */}
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                className="space-y-6"
              >
                <div>
                  <h2 className="text-sm font-mono font-bold uppercase tracking-widest text-white mb-1">
                    Your Name
                  </h2>
                  <p className="text-[10px] font-mono text-neutral-500 leading-relaxed">
                    This must match the name on your SA ID for verification.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="firstName" className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2">
                      First Name *
                    </label>
                    <input
                      id="firstName"
                      type="text"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      autoComplete="given-name"
                      autoFocus
                      placeholder="First name"
                      className="w-full bg-neutral-900 border border-white/10 text-white px-4 py-3 min-h-[44px] text-sm font-mono placeholder:text-neutral-700 focus:outline-none focus:border-white transition-colors"
                    />
                    {firstName && validateName(firstName) && (
                      <p className="text-[9px] font-mono text-red-400 mt-1">{validateName(firstName)}</p>
                    )}
                  </div>
                  <div>
                    <label htmlFor="lastName" className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2">
                      Last Name *
                    </label>
                    <input
                      id="lastName"
                      type="text"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      autoComplete="family-name"
                      placeholder="Last name"
                      className="w-full bg-neutral-900 border border-white/10 text-white px-4 py-3 min-h-[44px] text-sm font-mono placeholder:text-neutral-700 focus:outline-none focus:border-white transition-colors"
                    />
                    {lastName && validateName(lastName) && (
                      <p className="text-[9px] font-mono text-red-400 mt-1">{validateName(lastName)}</p>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {/* ─── Step 2: Location ─── */}
            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                className="space-y-6"
              >
                <div>
                  <h2 className="text-sm font-mono font-bold uppercase tracking-widest text-white mb-1">
                    Where Are You Based?
                  </h2>
                  <p className="text-[10px] font-mono text-neutral-500 leading-relaxed">
                    We use this to connect you with nearby clients and crew.
                  </p>
                </div>

                <AddressAutocomplete
                  onSelect={(addr) => setAddress(addr)}
                  defaultValue={address?.streetAddress}
                  defaultAddress={address ? {
                    city: address.city,
                    province: address.province,
                    postalCode: address.postalCode,
                  } : undefined}
                />
              </motion.div>
            )}

            {/* ─── Step 3: Profile Photo ─── */}
            {step === 3 && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                className="space-y-6"
              >
                <div>
                  <h2 className="text-sm font-mono font-bold uppercase tracking-widest text-white mb-1">
                    Add a Profile Photo
                  </h2>
                  <p className="text-[10px] font-mono text-neutral-500 leading-relaxed">
                    Clients and crew will see this photo on your profile.
                  </p>
                </div>

                <div className="flex flex-col items-center gap-6">
                  {/* Preview */}
                  <div className="relative w-32 h-32 rounded-full overflow-hidden border-2 border-white/10 bg-neutral-900 flex-shrink-0">
                    {avatarUrl ? (
                      <Image
                        src={avatarUrl}
                        alt="Profile photo"
                        fill
                        className="object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Camera className="w-8 h-8 text-neutral-600" />
                      </div>
                    )}
                  </div>

                  {/* Upload button */}
                  <label className="cursor-pointer">
                    <span className={`inline-block text-[10px] font-mono uppercase tracking-widest border px-6 py-3 min-h-[44px] flex items-center gap-2 transition-all ${
                      avatarUrl
                        ? 'border-emerald-500/30 text-emerald-400 hover:border-emerald-500/50'
                        : 'border-white/20 text-white hover:bg-white hover:text-black'
                    }`}>
                      {uploading ? (
                        <>
                          <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                          Uploading...
                        </>
                      ) : avatarUrl ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          Change Photo
                        </>
                      ) : (
                        <>
                          <Camera className="w-3.5 h-3.5" />
                          Upload Photo
                        </>
                      )}
                    </span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png"
                      capture="user"
                      onChange={handleAvatarUpload}
                      disabled={uploading}
                      className="hidden"
                    />
                  </label>

                  <p className="text-[9px] font-mono text-neutral-600 text-center leading-relaxed max-w-xs">
                    Use a clear, recent photo of your face. Professional headshots work best. JPG or PNG, 100KB&ndash;5MB.
                  </p>
                </div>
              </motion.div>
            )}

            {/* ─── Step 4: Confirmation ─── */}
            {step === 4 && (
              <motion.div
                key="step4"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                className="space-y-6"
              >
                <div>
                  <h2 className="text-sm font-mono font-bold uppercase tracking-widest text-white mb-1">
                    Your Profile is Set Up!
                  </h2>
                </div>

                <div className="flex items-center gap-5 bg-neutral-900 border border-white/5 p-5">
                  {avatarUrl && (
                    <div className="relative w-16 h-16 rounded-full overflow-hidden flex-shrink-0 border border-white/10">
                      <Image src={avatarUrl} alt="Avatar" fill className="object-cover" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-display font-medium text-white truncate">
                      {firstName.trim()} {lastName.trim()}
                    </p>
                    <p className="text-[10px] font-mono text-neutral-500 flex items-center gap-1 mt-0.5">
                      <MapPin className="w-3 h-3" />
                      {address?.city}, {address?.province}
                    </p>
                  </div>
                </div>

                <p className="text-[10px] font-mono text-neutral-500 leading-relaxed">
                  You can add a bio, skills, and social links from your dashboard.
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error */}
          {error && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="overflow-hidden mt-4">
              <div className="bg-red-500/10 border border-red-500/30 px-4 py-3">
                <p className="text-xs text-red-400 font-mono leading-relaxed">{error}</p>
              </div>
            </motion.div>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between mt-8 gap-4">
            {step > 1 ? (
              <button
                type="button"
                onClick={() => { setError(null); setStep(step - 1); }}
                className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-neutral-500 hover:text-white transition-colors min-h-[44px] px-4"
              >
                <ChevronLeft className="w-3 h-3" />
                Back
              </button>
            ) : (
              <div />
            )}

            {step < TOTAL_STEPS ? (
              <button
                type="button"
                onClick={() => { setError(null); setStep(step + 1); }}
                disabled={!canProceed()}
                className="flex items-center gap-1 bg-white text-black py-3 px-6 text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity disabled:opacity-20 disabled:cursor-not-allowed min-h-[44px]"
              >
                Continue
                <ChevronRight className="w-3 h-3" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleFinish}
                disabled={saving}
                className="flex items-center gap-2 bg-white text-black py-3 px-6 text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px]"
              >
                {saving ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-black/40 border-t-black rounded-full animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Go to Dashboard'
                )}
              </button>
            )}
          </div>
        </div>

        {/* Step indicator */}
        <p className="text-center text-[9px] font-mono text-neutral-600 mt-4">
          Step {step} of {TOTAL_STEPS}
        </p>
      </motion.div>
    </div>
  );
}
