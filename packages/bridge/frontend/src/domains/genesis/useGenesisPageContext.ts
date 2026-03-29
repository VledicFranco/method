import { useEffect } from 'react';
import { useGenesisStore } from '@/shared/stores/genesis-store';

/**
 * Call from any page to publish its context to the Genesis store.
 * Genesis reads this to tailor responses to what the user is viewing.
 *
 * @param domain - The FCA domain name (e.g., 'sessions', 'strategies', 'registry')
 * @param context - Page-specific data (selected items, counts, filters, etc.)
 */
export function useGenesisPageContext(
  domain: string,
  context: Record<string, unknown>,
) {
  const setPageContext = useGenesisStore((s) => s.setPageContext);

  useEffect(() => {
    // Get the current route from window.location
    const route = window.location.pathname.replace('/app', '') || '/';
    setPageContext(route, domain, context);
  }, [domain, JSON.stringify(context), setPageContext]);
}
