'use client';

import { useState, useCallback } from 'react';
import { Upload, Keyboard, Loader2 } from 'lucide-react';

interface StepIdCaptureProps {
  onComplete: (data: {
    firstName: string;
    lastName: string;
    idNumber: string;
    dateOfBirth: string;
  }) => void;
}

export default function StepIdCapture({ onComplete }: StepIdCaptureProps) {
  const [mode, setMode] = useState<'choose' | 'upload' | 'manual'>('choose');
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');

  const canConfirm =
    firstName.trim().length >= 2 &&
    lastName.trim().length >= 2 &&
    idNumber.trim().length >= 6 &&
    dateOfBirth.trim().length >= 8;

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setError('Please upload a JPG or PNG image.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Image must be under 10MB.');
      return;
    }

    setAnalyzing(true);
    setError(null);

    try {
      // Upload to Cloudinary via existing sign endpoint
      const signRes = await fetch('/api/cloudinary/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ paramsToSign: { folder: 'id-captures', resource_type: 'image' } }),
      });

      if (!signRes.ok) throw new Error('Failed to sign upload.');
      const { signature, timestamp, cloudName, apiKey } = await signRes.json();

      const formData = new FormData();
      formData.append('file', file);
      formData.append('signature', signature);
      formData.append('timestamp', timestamp);
      formData.append('api_key', apiKey);
      formData.append('folder', 'id-captures');

      const uploadRes = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
        { method: 'POST', body: formData },
      );
      const uploadData = await uploadRes.json();

      if (!uploadData.secure_url) throw new Error('Upload failed.');

      // Send to agent for extraction
      const agentRes = await fetch('/api/agents/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'capture-id', imageUrl: uploadData.secure_url }),
      });

      const agentData = await agentRes.json();

      if (!agentRes.ok) throw new Error(agentData.error || 'ID analysis failed.');

      // Auto-fill fields
      if (agentData.data?.firstName) setFirstName(agentData.data.firstName);
      if (agentData.data?.lastName) setLastName(agentData.data.lastName);
      if (agentData.data?.idNumber) setIdNumber(agentData.data.idNumber);
      if (agentData.data?.dateOfBirth) setDateOfBirth(agentData.data.dateOfBirth);

      setMode('upload');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze ID. Try manual entry.');
      setMode('manual');
    } finally {
      setAnalyzing(false);
    }
  }, []);

  const handleConfirm = () => {
    if (!canConfirm) return;
    onComplete({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      idNumber: idNumber.trim(),
      dateOfBirth: dateOfBirth.trim(),
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-mono font-bold uppercase tracking-widest text-white mb-1">
          Identity Verification
        </h2>
        <p className="text-[10px] font-mono text-neutral-500 leading-relaxed">
          Upload a photo of your South African ID document, or enter details manually.
          All fields are required.
        </p>
      </div>

      {/* Mode selection */}
      {mode === 'choose' && !analyzing && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="cursor-pointer group">
            <div className="border border-white/10 p-6 flex flex-col items-center gap-3 hover:border-[#D4A843]/50 transition-colors">
              <Upload className="w-6 h-6 text-neutral-400 group-hover:text-[#D4A843] transition-colors" />
              <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-400 group-hover:text-white transition-colors">
                Upload ID Photo
              </span>
              <span className="text-[8px] font-mono text-neutral-600 text-center">
                AI will auto-fill your details
              </span>
            </div>
            <input
              type="file"
              accept="image/jpeg,image/png"
              onChange={handleUpload}
              className="hidden"
            />
          </label>

          <button
            type="button"
            onClick={() => setMode('manual')}
            className="border border-white/10 p-6 flex flex-col items-center gap-3 hover:border-[#D4A843]/50 transition-colors group"
          >
            <Keyboard className="w-6 h-6 text-neutral-400 group-hover:text-[#D4A843] transition-colors" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-400 group-hover:text-white transition-colors">
              Type Manually
            </span>
            <span className="text-[8px] font-mono text-neutral-600 text-center">
              Enter your details by hand
            </span>
          </button>
        </div>
      )}

      {/* Loading state */}
      {analyzing && (
        <div className="flex flex-col items-center gap-4 py-8">
          <Loader2 className="w-8 h-8 text-[#D4A843] animate-spin" />
          <p className="text-xs font-mono text-neutral-400">Analyzing your ID document...</p>
        </div>
      )}

      {/* Form fields (shown after upload or in manual mode) */}
      {(mode === 'upload' || mode === 'manual') && !analyzing && (
        <div className="space-y-4">
          {mode === 'upload' && (
            <div className="bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 mb-4">
              <p className="text-[10px] font-mono text-emerald-400">
                Fields auto-filled from your ID. Please verify and correct if needed.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2">
                First Name *
              </label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="As on your ID"
                className="w-full bg-neutral-900 border border-white/10 text-white px-4 py-3 min-h-[44px] text-sm font-mono placeholder:text-neutral-700 focus:outline-none focus:border-[#D4A843] transition-colors"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2">
                Last Name *
              </label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="As on your ID"
                className="w-full bg-neutral-900 border border-white/10 text-white px-4 py-3 min-h-[44px] text-sm font-mono placeholder:text-neutral-700 focus:outline-none focus:border-[#D4A843] transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2">
              SA ID Number *
            </label>
            <input
              type="text"
              value={idNumber}
              onChange={(e) => setIdNumber(e.target.value)}
              placeholder="13-digit ID number"
              maxLength={13}
              className="w-full bg-neutral-900 border border-white/10 text-white px-4 py-3 min-h-[44px] text-sm font-mono placeholder:text-neutral-700 focus:outline-none focus:border-[#D4A843] transition-colors"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2">
              Date of Birth *
            </label>
            <input
              type="date"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              className="w-full bg-neutral-900 border border-white/10 text-white px-4 py-3 min-h-[44px] text-sm font-mono placeholder:text-neutral-700 focus:outline-none focus:border-[#D4A843] transition-colors"
            />
          </div>

          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="w-full bg-[#D4A843] text-black py-3 px-6 text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity disabled:opacity-20 disabled:cursor-not-allowed min-h-[44px]"
          >
            Confirm Identity
          </button>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 px-4 py-3">
          <p className="text-xs text-red-400 font-mono">{error}</p>
        </div>
      )}
    </div>
  );
}
