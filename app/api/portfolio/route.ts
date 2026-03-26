import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { STUDIO } from '@/lib/constants';
import type { PortfolioProject } from '@/types/portfolio';

export const dynamic = 'force-dynamic';

// ─── GET: Fetch current user's portfolio ─────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('portfolio_projects, verification_status')
    .eq('id', user.id)
    .single();

  if (error) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  if (profile.verification_status !== 'verified') {
    return NextResponse.json({ error: 'Verification required' }, { status: 403 });
  }

  return NextResponse.json({
    projects: (profile.portfolio_projects as PortfolioProject[]) ?? [],
  });
}

// ─── PUT: Save portfolio projects ────────────────────────────────────────────

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check verification status
  const { data: profile } = await supabase
    .from('profiles')
    .select('verification_status')
    .eq('id', user.id)
    .single();

  if (!profile || profile.verification_status !== 'verified') {
    return NextResponse.json({ error: 'Verification required' }, { status: 403 });
  }

  const body = await request.json() as { projects: unknown };
  const projects = body.projects;

  // Validate structure
  if (!Array.isArray(projects)) {
    return NextResponse.json({ error: 'projects must be an array' }, { status: 400 });
  }

  const { maxProjects, maxPhotosPerProject } = STUDIO.creators.portfolio;

  if (projects.length > maxProjects) {
    return NextResponse.json(
      { error: `Maximum ${maxProjects} projects allowed` },
      { status: 400 },
    );
  }

  // Validate each project
  for (const project of projects as PortfolioProject[]) {
    if (!project.id || typeof project.id !== 'string') {
      return NextResponse.json({ error: 'Each project must have an id' }, { status: 400 });
    }
    if (!project.title || typeof project.title !== 'string' || project.title.trim().length === 0) {
      return NextResponse.json({ error: 'Each project must have a title' }, { status: 400 });
    }
    if (!project.project_type || typeof project.project_type !== 'string') {
      return NextResponse.json({ error: 'Each project must have a project_type' }, { status: 400 });
    }
    if (!Array.isArray(project.photos)) {
      return NextResponse.json({ error: 'photos must be an array' }, { status: 400 });
    }
    if (project.photos.length > maxPhotosPerProject) {
      return NextResponse.json(
        { error: `Maximum ${maxPhotosPerProject} photos per project` },
        { status: 400 },
      );
    }
    for (const photo of project.photos) {
      if (!photo.url || !photo.public_id) {
        return NextResponse.json({ error: 'Each photo must have url and public_id' }, { status: 400 });
      }
    }
    if (project.video != null) {
      if (!project.video.url || !project.video.public_id) {
        return NextResponse.json({ error: 'Video must have url and public_id' }, { status: 400 });
      }
    }
  }

  // Save to profiles
  const { error } = await supabase
    .from('profiles')
    .update({
      portfolio_projects: projects,
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id);

  if (error) {
    console.error('[portfolio:PUT]', error.message);
    return NextResponse.json({ error: 'Failed to save portfolio' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
