import type { Step, LoadedMethod, SessionStatus } from './types.js';

export type Session = {
  load(method: LoadedMethod): void;
  current(): Step;
  advance(): { previousStep: string; nextStep: string | null };
  status(): SessionStatus;
  isLoaded(): boolean;
};

export function createSession(): Session {
  throw new Error('Not implemented');
}
