'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * The payment provider's display name ("Paystack"), read on the server
 * (lib/consent/legal-facts activePaymentProviderLabel) and handed to client
 * pages that name it, as /privacy does. Null when not provided.
 */
const PaymentProviderNameContext = createContext<string | null>(null);

export function PaymentProviderNameProvider({ name, children }: { name: string; children: ReactNode }) {
  return <PaymentProviderNameContext.Provider value={name}>{children}</PaymentProviderNameContext.Provider>;
}

export function usePaymentProviderName(): string | null {
  return useContext(PaymentProviderNameContext);
}
