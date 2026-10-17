import { createBookingRequest, getMyPersonRoles, getPublicRoleProfile } from '@/lib/supabase/queries/roles';
import { findOpenRequest } from '@/lib/supabase/queries/role-requests';
import { saToday } from '@/lib/dates/johannesburg';
import type { SendRequestDeps } from './request-send';

/**
 * The Supabase wiring for sendPeopleRequest (lib/roles/request-send.ts), the
 * same functions POST /api/roles/requests passes. Server only: the queries
 * use the service role, so the client id must come from the session.
 */
export function peopleRequestDeps(clientId: string): SendRequestDeps {
  return {
    profile: getPublicRoleProfile,
    ownRoles: () => getMyPersonRoles(clientId),
    findOpen: findOpenRequest,
    create: createBookingRequest,
    today: () => saToday(),
  };
}
