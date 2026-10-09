'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, X, Upload, Film, Camera, Trash2, Loader2, Check, AlertCircle,
} from 'lucide-react';
import { uploadFile, portfolioFolder } from '@/lib/cloudinary/upload';
import { STUDIO } from '@/lib/constants';
import { DashboardSubTabs, STUDIO_TABS } from '@/components/dashboard/DashboardSubTabs';
import type { PortfolioProject, PortfolioPhoto, PortfolioVideo } from '@/types/portfolio';
import { hasCompletePortfolio } from '@/lib/portfolio/validation';
import CreatorBookableChecklist from '@/components/onboarding/CreatorBookableChecklist';

export const dynamic = 'force-dynamic';

// ─── Constants from STUDIO ───────────────────────────────────────────────────

const {
  maxProjects,
  maxPhotosPerProject,
  maxPhotoSizeMB,
  maxVideoSizeMB,
  maxVideoDurationSeconds,
  acceptedImageTypes,
  acceptedVideoTypes,
} = STUDIO.creators.portfolio;

const PROJECT_TYPES = STUDIO.creators.projectTypes;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateId(): string {
  return crypto.randomUUID();
}

function emptyProject(): PortfolioProject {
  return {
    id: generateId(),
    title: '',
    project_type: PROJECT_TYPES[0],
    photos: [],
    video: null,
  };
}

function cloudinaryThumb(url: string, width = 400): string {
  return url.replace(
    /\/upload\/(?:v\d+\/)?/,
    `/upload/w_${width},c_fill,f_auto,q_auto/`,
  );
}

/** Validate video duration client-side using a temporary <video> element */
function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      resolve(video.duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      reject(new Error('Could not read video metadata'));
    };
    video.src = URL.createObjectURL(file);
  });
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const [projects, setProjects] = useState<PortfolioProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // A portfolio can be built before the ID check; it is not shown to anyone
  // until the creator is verified and available for hire.
  const [verificationStatus, setVerificationStatus] = useState<string | null>(null);
  const [availableForHire, setAvailableForHire] = useState(false);
  const [hasPayoutAccount, setHasPayoutAccount] = useState(false);

  // Upload state per project
  const [uploadingPhotos, setUploadingPhotos] = useState<Record<string, boolean>>({});
  const [uploadingVideo, setUploadingVideo] = useState<Record<string, boolean>>({});
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});

  // Delete confirmation
  const [confirmDelete, setConfirmDelete] = useState<{ projectId: string; type: 'photo' | 'video' | 'project'; index?: number } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // User ID for folder paths
  const userIdRef = useRef<string>('');

  // Fetch portfolio on mount
  useEffect(() => {
    (async () => {
      try {
        const [res, bankRes] = await Promise.all([
          fetch('/api/portfolio'),
          fetch('/api/banking').catch(() => null),
        ]);
        if (!res.ok) throw new Error('Failed to load portfolio');
        const data = await res.json() as {
          projects: PortfolioProject[];
          verification_status?: string | null;
          available_for_hire?: boolean;
        };
        setProjects(data.projects);
        setVerificationStatus(data.verification_status ?? null);
        setAvailableForHire(data.available_for_hire === true);
        // GET /api/banking answers 200 with null when nothing is saved.
        const bank = bankRes?.ok ? await bankRes.json().catch(() => null) : null;
        setHasPayoutAccount(Boolean(bank && typeof bank === 'object'));

        // Get user ID for folder paths
        const authRes = await fetch('/api/auth/me').catch(() => null);
        if (authRes?.ok) {
          const authData = await authRes.json() as { id: string };
          userIdRef.current = authData.id;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load portfolio');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ─── Save portfolio ──────────────────────────────────────────────────────

  const save = useCallback(async (updatedProjects: PortfolioProject[]) => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch('/api/portfolio', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projects: updatedProjects }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? 'Failed to save');
      }
      setSuccess('Portfolio saved');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, []);

  // ─── Add project ─────────────────────────────────────────────────────────

  const addProject = useCallback(() => {
    if (projects.length >= maxProjects) return;
    const updated = [...projects, emptyProject()];
    setProjects(updated);
  }, [projects]);

  // ─── Update project field ────────────────────────────────────────────────

  const updateProject = useCallback((projectId: string, field: keyof PortfolioProject, value: unknown) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === projectId ? { ...p, [field]: value } : p)),
    );
  }, []);

  // ─── Upload photos ──────────────────────────────────────────────────────

  const handlePhotoUpload = useCallback(async (projectId: string, files: FileList | File[]) => {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;

    const fileArray = Array.from(files);
    const remaining = maxPhotosPerProject - project.photos.length;
    if (remaining <= 0) {
      setError(`Maximum ${maxPhotosPerProject} photos per project`);
      return;
    }

    const toUpload = fileArray.slice(0, remaining);

    // Validate files
    for (const file of toUpload) {
      if (!(acceptedImageTypes as readonly string[]).includes(file.type)) {
        setError('Only JPG and PNG images accepted');
        return;
      }
      if (file.size > maxPhotoSizeMB * 1024 * 1024) {
        setError(`Photos must be under ${maxPhotoSizeMB}MB`);
        return;
      }
    }

    setUploadingPhotos((prev) => ({ ...prev, [projectId]: true }));
    setError(null);

    try {
      const folder = portfolioFolder(userIdRef.current || 'unknown', projectId);
      const uploaded: PortfolioPhoto[] = [];

      for (let i = 0; i < toUpload.length; i++) {
        setUploadProgress((prev) => ({ ...prev, [`${projectId}-photo`]: Math.round(((i) / toUpload.length) * 100) }));
        const asset = await uploadFile(toUpload[i], folder);
        uploaded.push({ url: asset.url, public_id: asset.public_id });
      }

      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId
            ? { ...p, photos: [...p.photos, ...uploaded] }
            : p,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadingPhotos((prev) => ({ ...prev, [projectId]: false }));
      setUploadProgress((prev) => ({ ...prev, [`${projectId}-photo`]: 0 }));
    }
  }, [projects]);

  // ─── Upload video ───────────────────────────────────────────────────────

  const handleVideoUpload = useCallback(async (projectId: string, file: File) => {
    if (!(acceptedVideoTypes as readonly string[]).includes(file.type)) {
      setError('Only MP4 videos accepted');
      return;
    }
    if (file.size > maxVideoSizeMB * 1024 * 1024) {
      setError(`Videos must be under ${maxVideoSizeMB}MB`);
      return;
    }

    // Check duration
    try {
      const duration = await getVideoDuration(file);
      if (duration > maxVideoDurationSeconds) {
        setError(`Showreel must be ${maxVideoDurationSeconds} seconds or shorter`);
        return;
      }
    } catch {
      setError('Could not read video duration. Please try a different file.');
      return;
    }

    setUploadingVideo((prev) => ({ ...prev, [projectId]: true }));
    setError(null);

    try {
      const folder = portfolioFolder(userIdRef.current || 'unknown', projectId);
      const asset = await uploadFile(file, folder, (pct) => {
        setUploadProgress((prev) => ({ ...prev, [`${projectId}-video`]: pct }));
      });

      const video: PortfolioVideo = { url: asset.url, public_id: asset.public_id };
      setProjects((prev) =>
        prev.map((p) => (p.id === projectId ? { ...p, video } : p)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadingVideo((prev) => ({ ...prev, [projectId]: false }));
      setUploadProgress((prev) => ({ ...prev, [`${projectId}-video`]: 0 }));
    }
  }, []);

  // ─── Delete media ───────────────────────────────────────────────────────

  const executeDelete = useCallback(async () => {
    if (!confirmDelete) return;
    setDeleting(true);

    const { projectId, type, index } = confirmDelete;

    try {
      if (type === 'project') {
        // Delete all Cloudinary assets for this project
        const project = projects.find((p) => p.id === projectId);
        if (project) {
          const publicIds = [
            ...project.photos.map((ph) => ph.public_id),
            ...(project.video ? [project.video.public_id] : []),
          ];
          await Promise.allSettled(
            publicIds.map((pid) =>
              fetch('/api/cloudinary/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ public_id: pid, resource_type: pid === project.video?.public_id ? 'video' : 'image' }),
              }),
            ),
          );
        }
        setProjects((prev) => prev.filter((p) => p.id !== projectId));
      } else if (type === 'photo' && index != null) {
        const project = projects.find((p) => p.id === projectId);
        const photo = project?.photos[index];
        if (photo) {
          await fetch('/api/cloudinary/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ public_id: photo.public_id, resource_type: 'image' }),
          }).catch(() => {});
        }
        setProjects((prev) =>
          prev.map((p) =>
            p.id === projectId
              ? { ...p, photos: p.photos.filter((_, i) => i !== index) }
              : p,
          ),
        );
      } else if (type === 'video') {
        const project = projects.find((p) => p.id === projectId);
        if (project?.video) {
          await fetch('/api/cloudinary/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ public_id: project.video.public_id, resource_type: 'video' }),
          }).catch(() => {});
        }
        setProjects((prev) =>
          prev.map((p) => (p.id === projectId ? { ...p, video: null } : p)),
        );
      }
    } catch {
      setError('Delete failed');
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  }, [confirmDelete, projects]);

  // ─── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-neutral-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <DashboardSubTabs tabs={STUDIO_TABS} />

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-display font-bold uppercase text-white mb-2">
          Portfolio
        </h1>
        <p className="text-sm text-neutral-400">
          Showcase your best work. Up to {maxProjects} projects, {maxPhotosPerProject} photos and 1 showreel ({maxVideoDurationSeconds}s max) each.
        </p>
        {verificationStatus !== 'verified' && (
          <p className="text-xs font-mono text-amber-300 mt-3">
            Your portfolio is saved but not shown to anyone yet. It goes public once your ID check passes and you switch
            on available for hire.
          </p>
        )}
      </div>

      <CreatorBookableChecklist
        className="mb-8"
        facts={{
          verificationStatus,
          portfolioComplete: hasCompletePortfolio(projects),
          hasPayoutAccount,
          availableForHire,
        }}
      />

      {/* Status messages */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mb-6 p-4 border border-red-500/30 bg-red-500/10 text-red-400 text-sm font-mono flex items-center gap-3"
          >
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
            <button onClick={() => setError(null)} className="ml-auto">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
        {success && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mb-6 p-4 border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-sm font-mono flex items-center gap-3"
          >
            <Check className="w-4 h-4 flex-shrink-0" />
            {success}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Project cards */}
      <div className="space-y-8">
        {projects.map((project, idx) => (
          <div
            key={project.id}
            className="bg-[#0A0A0B] border border-white/5 p-6"
          >
            {/* Project header */}
            <div className="flex items-start justify-between gap-4 mb-6">
              <div className="flex-grow space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-neutral-400 uppercase tracking-widest">
                    Project {idx + 1}
                  </span>
                </div>
                <input
                  type="text"
                  value={project.title}
                  onChange={(e) => updateProject(project.id, 'title', e.target.value)}
                  placeholder="Project title"
                  maxLength={100}
                  className="w-full bg-transparent border-b border-white/10 text-white text-lg font-display font-bold uppercase pb-2 focus:outline-none focus:border-[#D4A843] transition-colors placeholder:text-neutral-400"
                />
                <select
                  value={project.project_type}
                  onChange={(e) => updateProject(project.id, 'project_type', e.target.value)}
                  className="bg-neutral-900 border border-white/10 text-white text-xs font-mono uppercase tracking-widest px-3 py-2 focus:outline-none focus:border-[#D4A843] transition-colors"
                >
                  {PROJECT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={() => setConfirmDelete({ projectId: project.id, type: 'project' })}
                className="text-neutral-400 hover:text-red-400 transition-colors p-2"
                title="Delete project"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            {/* Photos section */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-mono text-neutral-400 uppercase tracking-widest flex items-center gap-2">
                  <Camera className="w-3 h-3" />
                  Photos ({project.photos.length}/{maxPhotosPerProject})
                </span>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {/* Existing photos */}
                {project.photos.map((photo, photoIdx) => (
                  <div key={photo.public_id} className="relative aspect-square group">
                    <Image
                      src={cloudinaryThumb(photo.url)}
                      alt={`${project.title} photo ${photoIdx + 1}`}
                      fill
                      className="object-cover"
                      sizes="200px"
                    />
                    <button
                      onClick={() => setConfirmDelete({ projectId: project.id, type: 'photo', index: photoIdx })}
                      className="absolute top-2 right-2 w-6 h-6 bg-black/70 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}

                {/* Upload slot */}
                {project.photos.length < maxPhotosPerProject && (
                  <label className="relative aspect-square border-2 border-dashed border-white/10 hover:border-[#D4A843]/50 transition-colors flex flex-col items-center justify-center cursor-pointer">
                    {uploadingPhotos[project.id] ? (
                      <div className="text-center">
                        <Loader2 className="w-5 h-5 text-[#D4A843] animate-spin mx-auto mb-1" />
                        <span className="text-xs font-mono text-neutral-400">
                          {uploadProgress[`${project.id}-photo`] ?? 0}%
                        </span>
                      </div>
                    ) : (
                      <>
                        <Upload className="w-5 h-5 text-neutral-400 mb-1" />
                        <span className="text-xs font-mono text-neutral-400 uppercase">
                          Add Photo
                        </span>
                        <span className="text-xs font-mono text-neutral-400 mt-0.5">
                          JPG/PNG, {maxPhotoSizeMB}MB max
                        </span>
                      </>
                    )}
                    <input
                      type="file"
                      accept={acceptedImageTypes.join(',')}
                      multiple
                      className="hidden"
                      disabled={uploadingPhotos[project.id]}
                      onChange={(e) => {
                        if (e.target.files?.length) {
                          handlePhotoUpload(project.id, e.target.files);
                          e.target.value = '';
                        }
                      }}
                    />
                  </label>
                )}
              </div>
            </div>

            {/* Video section */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-mono text-neutral-400 uppercase tracking-widest flex items-center gap-2">
                  <Film className="w-3 h-3" />
                  Showreel ({project.video ? '1' : '0'}/1)
                </span>
              </div>

              {project.video ? (
                <div className="relative aspect-video bg-neutral-900 group">
                  <video
                    src={project.video.url}
                    className="w-full h-full object-cover"
                    autoPlay
                    muted
                    loop
                    playsInline
                  />
                  <button
                    onClick={() => setConfirmDelete({ projectId: project.id, type: 'video' })}
                    className="absolute top-3 right-3 w-8 h-8 bg-black/70 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <label className="block aspect-video border-2 border-dashed border-white/10 hover:border-[#D4A843]/50 transition-colors flex items-center justify-center cursor-pointer">
                  {uploadingVideo[project.id] ? (
                    <div className="text-center">
                      <Loader2 className="w-6 h-6 text-[#D4A843] animate-spin mx-auto mb-2" />
                      <span className="text-xs font-mono text-neutral-400">
                        Uploading {uploadProgress[`${project.id}-video`] ?? 0}%
                      </span>
                    </div>
                  ) : (
                    <div className="text-center">
                      <Film className="w-6 h-6 text-neutral-400 mx-auto mb-2" />
                      <span className="text-xs font-mono text-neutral-400 uppercase block">
                        Upload Showreel
                      </span>
                      <span className="text-xs font-mono text-neutral-400 mt-1 block">
                        MP4 only, {maxVideoSizeMB}MB max, {maxVideoDurationSeconds}s max
                      </span>
                    </div>
                  )}
                  <input
                    type="file"
                    accept={acceptedVideoTypes.join(',')}
                    className="hidden"
                    disabled={uploadingVideo[project.id]}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        handleVideoUpload(project.id, file);
                        e.target.value = '';
                      }
                    }}
                  />
                </label>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add project button */}
      {projects.length < maxProjects && (
        <button
          onClick={addProject}
          className="mt-6 w-full border-2 border-dashed border-white/10 hover:border-[#D4A843]/50 transition-colors py-8 flex items-center justify-center gap-3 text-neutral-400 hover:text-[#D4A843]"
        >
          <Plus className="w-5 h-5" />
          <span className="text-xs font-mono font-bold uppercase tracking-widest">
            Add Project ({projects.length}/{maxProjects})
          </span>
        </button>
      )}

      {/* Save button */}
      {projects.length > 0 && (
        <div className="mt-8 flex justify-end">
          <button
            onClick={() => save(projects)}
            disabled={saving}
            className="inline-flex items-center gap-2 bg-[#D4A843] text-black px-8 py-3 text-xs font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity disabled:opacity-50"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                Save Portfolio
              </>
            )}
          </button>
        </div>
      )}

      {/* Delete confirmation modal */}
      <AnimatePresence>
        {confirmDelete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6"
            onClick={() => !deleting && setConfirmDelete(null)}
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-[#0A0A0B] border border-white/10 p-6 max-w-sm w-full"
            >
              <h3 className="text-lg font-display font-bold text-white uppercase mb-2">
                Confirm Delete
              </h3>
              <p className="text-sm text-neutral-400 mb-6">
                {confirmDelete.type === 'project'
                  ? 'Delete this entire project and all its media? This cannot be undone.'
                  : confirmDelete.type === 'video'
                  ? 'Delete this showreel video? This cannot be undone.'
                  : 'Delete this photo? This cannot be undone.'}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmDelete(null)}
                  disabled={deleting}
                  className="flex-1 py-2 text-xs font-mono font-bold uppercase tracking-widest border border-white/10 text-white hover:bg-white/5 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={executeDelete}
                  disabled={deleting}
                  className="flex-1 py-2 text-xs font-mono font-bold uppercase tracking-widest bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
