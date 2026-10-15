'use client';

import { createContext, useContext } from 'react';

/**
 * Whether People (roles_v1) is on, for the dashboard's client components.
 * The dashboard layout reads the flag on the server and provides it here.
 *
 * With People on, the old creator areas that compete with it (Gigs,
 * Portfolio, the Pricing Guide and "You appear in creator search") are
 * hidden: a person offers work through one People profile (/offer).
 * Off (the default), the dashboard is exactly as before.
 */
const PeopleModeContext = createContext(false);

export function PeopleModeProvider({ on, children }: { on: boolean; children: React.ReactNode }) {
  return <PeopleModeContext.Provider value={on}>{children}</PeopleModeContext.Provider>;
}

export function usePeopleMode(): boolean {
  return useContext(PeopleModeContext);
}

/** The old creator pages hidden from the menus while People is on. Reachable by URL (a paid job link still works). */
export const HIDDEN_WITH_PEOPLE: readonly string[] = ['/dashboard/gigs', '/dashboard/portfolio', '/dashboard/pricing'];

/** Where "My People profile" goes. */
export const PEOPLE_PROFILE_HREF = '/offer';
