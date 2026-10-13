import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/auth';
import { logEvent } from '@/lib/data/events';
import { isWriteDenied, writeDeniedEvent } from '@/lib/supabase/write-denied';
import { STUDIO } from '@/lib/constants';
import type { PortfolioProject } from '@/types/portfolio';

export const dynamic = 'force-dynamic';

/**
 * The signed-in creator's own portfolio (profiles.portfolio_projects).
 *
 * A creator may build it before their ID check: an unverified creator's
 * portfolio is not shown to anyone, because every public surface that shows
 * creators requires a verified ID (and available for hire, and a complete
 * portfolio): lib/supabase/queries/crew.ts, getPublishedCreatorProfiles and
 * the daily auto-publish in lib/supabase/queries/smartProductions.ts.
 * The column was always writable by its owner (migration 067), so the old
 * verification check here protected nothing; it only made creators wait.
 */

// ─── GET: Fetch current user's portfolio ─────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('portfolio_projects, verification_status, available_for_hire')
    .eq('id', user.id)
    .single();

  if (error) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  return NextResponse.json({
    projects: (profile.portfolio_projects as PortfolioProject[]) ?? [],
    verification_status: profile.verification_status ?? null,
    available_for_hire: profile.available_for_hire === true,
  });
}

// ─── PUT: Save portfolio projects ────────────────────────────────────────────

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!(await checkRateLimit(`portfolio:${user.id}`, 30, 60_000))) {
    return NextResponse.json({ error: 'Too many saves. Please wait a moment.' }, { status: 429 });
  }

  let body: { projects: unknown };
  try {
    body = await request.json() as { projects: unknown };
  } catch {
    return NextResponse.json({ error: 'Send the portfolio as JSON.' }, { status: 400 });
  }
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
    if (isWriteDenied(error)) {
      logEvent(writeDeniedEvent({ userId: user.id, route: 'PUT /api/portfolio', table: 'profiles', error }));
    }
    return NextResponse.json({ error: 'Failed to save portfolio' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
