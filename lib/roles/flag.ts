import { NextResponse } from 'next/server';
import { getFlag } from '@/lib/features';

/**
 * The roles_v1 switch, for API routes. With the flag off every roles route
 * answers 404 before touching the roles tables, so a deploy to an
 * environment without migration 090 changes nothing and errors nowhere.
 */
export async function rolesEnabled(): Promise<boolean> {
  return getFlag('roles_v1');
}

/** null when roles_v1 is on; a 404 response to return when it is off. */
export async function rolesOffResponse(): Promise<NextResponse | null> {
  return (await rolesEnabled()) ? null : NextResponse.json({ error: 'Not found.' }, { status: 404 });
}
