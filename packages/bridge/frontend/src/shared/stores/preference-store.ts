import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface PreferenceState {
  /** Auto-refresh toggle for polling hooks */
  autoRefresh: boolean;
  /** Timeline event density: compact or comfortable */
  timelineDensity: 'compact' | 'comfortable';
  /** Default workdir for session spawn */
  defaultWorkdir: string;

  /** Actions */
  setAutoRefresh: (enabled: boolean) => void;
  setTimelineDensity: (density: 'compact' | 'comfortable') => void;
  setDefaultWorkdir: (dir: string) => void;
}

export const usePreferenceStore = create<PreferenceState>()(
  persist(
    (set) => ({
      autoRefresh: true,
      timelineDensity: 'comfortable',
      defaultWorkdir: '',

      setAutoRefresh: (enabled) => set({ autoRefresh: enabled }),
      setTimelineDensity: (density) => set({ timelineDensity: density }),
      setDefaultWorkdir: (dir) => set({ defaultWorkdir: dir }),
    }),
    {
      name: 'method-bridge-preferences',
    },
  ),
);
