/**
 * Admin auth utilities — re-exported from the auth abstraction layer.
 *
 * This module exists so that API routes and other consumers can import
 * admin-specific helpers from a dedicated path:
 *
 *   import { requireAdmin, isAdmin } from '@/lib/auth/admin';
 *
 * All functions delegate to the active auth provider configured in
 * lib/auth/index.ts.
 */

export { requireAdmin, isAdmin } from '@/lib/auth';
export { ADMIN_EMAILS } from '@/lib/constants';
