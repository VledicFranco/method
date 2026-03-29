import { useGenesisAction } from './useGenesisAction';

/** Headless component — handles universal Genesis actions (navigate, toast, highlight) */
export function GenesisActionHandler() {
  useGenesisAction(); // No callback needed — universal actions handled internally
  return null;
}
