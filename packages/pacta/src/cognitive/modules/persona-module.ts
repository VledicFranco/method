// SPDX-License-Identifier: Apache-2.0
/**
 * Persona Module — dynamic reasoning style injection (PRD 032, P4).
 *
 * A cognitive module that selects a reasoning persona based on task context
 * and writes persona guidance into the workspace for the reasoner-actor
 * to consume. Supports both auto-selection (from workspace task signals)
 * and explicit persona assignment.
 *
 * The module follows the standard CognitiveModule pattern: it receives a
 * workspace snapshot as input, writes persona guidance entries to the
 * workspace, and returns monitoring data about persona selection.
 *
 * Supports mid-task persona switching: when the detected task type changes
 * between cycles, the module updates the active persona and writes fresh
 * guidance to the workspace.
 *
 * Grounded in: cognitive style theory (Sternberg 1997), expert performance
 * research (Ericsson & Charness 1994), PRD 032 P4 specification.
 */

import type {
  CognitiveModule,
  MonitoringSignal,
  ControlDirective,
  StepResult,
  StepError,
  WorkspaceWritePort,
  WorkspaceEntry,
  ReadonlyWorkspaceSnapshot,
} from '../algebra/index.js';
import { moduleId } from '../algebra/index.js';
import type { PersonaProfile } from '../config/personas.js';
import { selectPersona, getPersona } from '../config/personas.js';

// ── Types ────────────────────────────────────────────────────────

/** Input to the persona module: a workspace snapshot to read task context from. */
export interface PersonaModuleInput {
  snapshot: ReadonlyWorkspaceSnapshot;
}

/** Output of the persona module. */
export interface PersonaModuleOutput {
  /** The active persona ID, or null if no persona is active. */
  activePersonaId: string | null;
  /** The active persona profile, or null if no persona is active. */
  activePersona: PersonaProfile | null;
  /** Whether a persona switch occurred this cycle. */
  switched: boolean;
  /** How the persona was selected: 'auto', 'explicit', or 'none'. */
  selectionMethod: 'auto' | 'explicit' | 'none';
}

/** Persona module internal state. */
export interface PersonaModuleState {
  /** Currently active persona ID, or null. */
  activePersonaId: string | null;
  /** How many times the persona has been switched during this task. */
  switchCount: number;
  /** The last detected task type string (for change detection). */
  lastDetectedTaskType: string | null;
}

/** Control directive for the persona module. */
export interface PersonaModuleControl extends ControlDirective {
  /** Explicitly set a persona by ID. Overrides auto-selection. */
  forcePersona?: string;
  /** Disable the persona module for this cycle. */
  disable?: boolean;
}

/** Monitoring signal emitted by the persona module. */
export interface PersonaModuleMonitoring extends MonitoringSignal {
  type: 'persona';
  /** The active persona ID, or null. */
  activePersonaId: string | null;
  /** Whether a persona switch occurred. */
  switched: boolean;
  /** The detected task type that drove selection, or null. */
  detectedTaskType: string | null;
  /** Selection method used. */
  selectionMethod: 'auto' | 'explicit' | 'none';
}

/** Configuration for the persona module factory. */
export interface PersonaModuleConfig {
  /** Custom module ID. Defaults to 'persona'. */
  id?: string;
  /** Default persona to use when auto-selection finds no match. */
  defaultPersona?: string;
  /** Enable auto-selection based on task context. Defaults to true. */
  autoSelect?: boolean;
  /** Salience score for persona guidance workspace entries. Defaults to 0.85. */
  guidanceSalience?: number;
}

// ── Task Type Extraction ────────────────────────────────────────

/**
 * Task-type signal keywords to look for in workspace entries.
 *
 * These are common words that indicate the nature of the current task.
 * We scan workspace content for these keywords to infer task type.
 */
const TASK_SIGNAL_KEYWORDS = [
  'debug', 'fix', 'error', 'bug', 'troubleshoot',
  'design', 'architect', 'refactor', 'restructure', 'plan',
  'review', 'audit', 'check', 'validate', 'lint',
  'explore', 'research', 'investigate', 'discover', 'creative', 'brainstorm',
  'implement', 'standard', 'comply', 'specification', 'domain',
];

/**
 * Extract a task type signal from the workspace snapshot.
 *
 * Scans the highest-salience entries for task-type keywords. Returns the
 * most frequently occurring keyword, or null if no signal is found.
 */
function extractTaskType(snapshot: ReadonlyWorkspaceSnapshot): string | null {
  if (snapshot.length === 0) return null;

  // Sort by salience descending, take top entries
  const sorted = [...snapshot].sort((a, b) => b.salience - a.salience);
  const topEntries = sorted.slice(0, 5);

  // Count keyword occurrences across top entries
  const counts = new Map<string, number>();

  for (const entry of topEntries) {
    const text = typeof entry.content === 'string'
      ? entry.content.toLowerCase()
      : JSON.stringify(entry.content).toLowerCase();

    for (const keyword of TASK_SIGNAL_KEYWORDS) {
      if (text.includes(keyword)) {
        counts.set(keyword, (counts.get(keyword) ?? 0) + 1);
      }
    }
  }

  if (counts.size === 0) return null;

  // Return the most frequent keyword
  let bestKeyword = '';
  let bestCount = 0;
  for (const [keyword, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      bestKeyword = keyword;
    }
  }

  return bestKeyword || null;
}

// ── Guidance Generation ─────────────────────────────────────────

/**
 * Generate the workspace guidance entry content for a given persona.
 *
 * This content is what the reasoner-actor reads from the workspace to
 * adopt the persona's reasoning style.
 */
function generateGuidance(persona: PersonaProfile): string {
  return [
    `[PERSONA] Active reasoning persona: ${persona.name}`,
    `Reasoning style: ${persona.reasoningStyle}`,
    `Strengths: ${persona.strengths.join(', ')}`,
    `Watch for biases: ${persona.biases.join('; ')}`,
  ].join('\n');
}

// ── Factory ─────────────────────────────────────────────────────

/**
 * Create a Persona cognitive module.
 *
 * The module reads task context from the workspace snapshot, selects an
 * appropriate reasoning persona (or uses an explicitly set one), and writes
 * persona guidance into the workspace for the reasoner-actor to consume.
 *
 * @param writePort - Workspace write port for emitting persona guidance.
 * @param config - Optional configuration.
 */
export function createPersonaModule(
  writePort: WorkspaceWritePort,
  config?: PersonaModuleConfig,
): CognitiveModule<PersonaModuleInput, PersonaModuleOutput, PersonaModuleState, PersonaModuleMonitoring, PersonaModuleControl> {
  const id = moduleId(config?.id ?? 'persona');
  const defaultPersonaId = config?.defaultPersona ?? undefined;
  const autoSelect = config?.autoSelect ?? true;
  const guidanceSalience = config?.guidanceSalience ?? 0.85;

  return {
    id,

    initialState(): PersonaModuleState {
      return {
        activePersonaId: null,
        switchCount: 0,
        lastDetectedTaskType: null,
      };
    },

    async step(
      input: PersonaModuleInput,
      state: PersonaModuleState,
      control: PersonaModuleControl,
    ): Promise<StepResult<PersonaModuleOutput, PersonaModuleState, PersonaModuleMonitoring>> {
      try {
        // If disabled, pass through with no persona
        if (control.disable) {
          const monitoring: PersonaModuleMonitoring = {
            type: 'persona',
            source: id,
            timestamp: Date.now(),
            activePersonaId: null,
            switched: false,
            detectedTaskType: null,
            selectionMethod: 'none',
          };

          return {
            output: {
              activePersonaId: null,
              activePersona: null,
              switched: false,
              selectionMethod: 'none',
            },
            state,
            monitoring,
          };
        }

        let selectedPersona: PersonaProfile | undefined;
        let selectionMethod: 'auto' | 'explicit' | 'none' = 'none';
        let detectedTaskType: string | null = null;

        // 1. Explicit persona override via control directive
        if (control.forcePersona) {
          selectedPersona = getPersona(control.forcePersona);
          selectionMethod = selectedPersona ? 'explicit' : 'none';
        }

        // 2. Auto-selection from workspace context
        if (!selectedPersona && autoSelect) {
          detectedTaskType = extractTaskType(input.snapshot);
          if (detectedTaskType) {
            selectedPersona = selectPersona(detectedTaskType);
            if (selectedPersona) {
              selectionMethod = 'auto';
            }
          }
        }

        // 3. Fall back to default persona
        if (!selectedPersona && defaultPersonaId) {
          selectedPersona = getPersona(defaultPersonaId);
          if (selectedPersona) {
            selectionMethod = 'explicit';
          }
        }

        // Determine if a switch occurred
        const newPersonaId = selectedPersona?.id ?? null;
        const switched = newPersonaId !== state.activePersonaId;

        // Write guidance to workspace if persona is active and either
        // it's a new persona or the task type changed
        if (selectedPersona && (switched || detectedTaskType !== state.lastDetectedTaskType)) {
          const entry: WorkspaceEntry = {
            source: id,
            content: generateGuidance(selectedPersona),
            salience: guidanceSalience,
            timestamp: Date.now(),
          };
          writePort.write(entry);
        }

        // Update state
        const newState: PersonaModuleState = {
          activePersonaId: newPersonaId,
          switchCount: switched ? state.switchCount + 1 : state.switchCount,
          lastDetectedTaskType: detectedTaskType ?? state.lastDetectedTaskType,
        };

        const monitoring: PersonaModuleMonitoring = {
          type: 'persona',
          source: id,
          timestamp: Date.now(),
          activePersonaId: newPersonaId,
          switched,
          detectedTaskType,
          selectionMethod,
        };

        return {
          output: {
            activePersonaId: newPersonaId,
            activePersona: selectedPersona ?? null,
            switched,
            selectionMethod,
          },
          state: newState,
          monitoring,
        };
      } catch (err: unknown) {
        const error: StepError = {
          message: err instanceof Error ? err.message : String(err),
          recoverable: true,
          moduleId: id,
          phase: 'persona-select',
        };

        const monitoring: PersonaModuleMonitoring = {
          type: 'persona',
          source: id,
          timestamp: Date.now(),
          activePersonaId: null,
          switched: false,
          detectedTaskType: null,
          selectionMethod: 'none',
        };

        return {
          output: {
            activePersonaId: null,
            activePersona: null,
            switched: false,
            selectionMethod: 'none',
          },
          state,
          monitoring,
          error,
        };
      }
    },
  };
}
