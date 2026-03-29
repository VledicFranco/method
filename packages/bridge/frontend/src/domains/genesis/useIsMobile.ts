import { useState, useEffect } from 'react';

const MOBILE_BREAKPOINT = 768;

/**
 * Reactive hook that tracks whether the viewport is below the mobile breakpoint (768px).
 * Uses resize event listener — safe for SSR-like environments (defaults to false).
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < MOBILE_BREAKPOINT : false,
  );

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  return isMobile;
}
