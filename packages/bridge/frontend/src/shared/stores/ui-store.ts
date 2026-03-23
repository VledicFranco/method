import { create } from 'zustand';

interface UIState {
  /** Currently selected session ID (for slide-over) */
  selectedSessionId: string | null;
  /** Whether the slide-over panel is open */
  slideOverOpen: boolean;
  /** Active tab in the slide-over panel */
  slideOverTab: string;

  /** Actions */
  selectSession: (id: string | null) => void;
  openSlideOver: (tab?: string) => void;
  closeSlideOver: () => void;
  setSlideOverTab: (tab: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  selectedSessionId: null,
  slideOverOpen: false,
  slideOverTab: 'overview',

  selectSession: (id) =>
    set({
      selectedSessionId: id,
      slideOverOpen: id !== null,
      slideOverTab: 'overview',
    }),

  openSlideOver: (tab) =>
    set((state) => ({
      slideOverOpen: true,
      slideOverTab: tab ?? state.slideOverTab,
    })),

  closeSlideOver: () =>
    set({
      slideOverOpen: false,
      selectedSessionId: null,
    }),

  setSlideOverTab: (tab) => set({ slideOverTab: tab }),
}));
