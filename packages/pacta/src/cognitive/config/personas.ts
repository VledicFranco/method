/**
 * PersonaProfile Registry — built-in reasoning personas for the cognitive cycle.
 *
 * Each persona encodes a distinct reasoning style that can be injected into the
 * reasoner-actor's system prompt. The persona system (PRD 032, P4) allows the
 * cognitive cycle to adopt different reasoning orientations based on task type.
 *
 * Selection heuristic: maps task-type keywords (from meta-composer classification
 * or explicit user intent) to the persona best suited for that reasoning mode.
 *
 * Grounded in: cognitive style theory (Sternberg 1997 — thinking styles),
 * expert performance research (Ericsson & Charness 1994 — domain-specific
 * reasoning strategies), dual-process theory adaptation to LLM agents.
 */

// ── Types ────────────────────────────────────────────────────────

/**
 * A persona profile — a named reasoning style with declared expertise,
 * strengths, and known biases (blind spots).
 *
 * The `reasoningStyle` field is the primary output: it gets injected into
 * the system prompt to steer the LLM's reasoning behavior.
 */
export interface PersonaProfile {
  /** Unique identifier for the persona. */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Domains of expertise this persona excels at. */
  expertise: string[];
  /** Injected into system prompt — describes how this persona reasons. */
  reasoningStyle: string;
  /** Cognitive strengths of this reasoning style. */
  strengths: string[];
  /** Known blind spots — biases to be aware of when this persona is active. */
  biases: string[];
}

// ── Built-in Personas ───────────────────────────────────────────

/**
 * The five built-in personas, covering the primary reasoning modes
 * an agent encounters during cognitive work.
 */
export const PERSONAS: Record<string, PersonaProfile> = {
  debugger: {
    id: 'debugger',
    name: 'Debugger',
    expertise: ['error analysis', 'root cause identification', 'reproduction steps'],
    reasoningStyle:
      'Systematic fault isolation. Start from the symptom, bisect the causal chain, ' +
      'verify each assumption before proceeding. Prefer minimal reproduction over broad speculation.',
    strengths: ['methodical', 'evidence-driven', 'precise'],
    biases: ['may over-investigate simple issues', 'tunnel vision on first hypothesis'],
  },

  architect: {
    id: 'architect',
    name: 'Architect',
    expertise: ['system design', 'tradeoff analysis', 'boundary enforcement'],
    reasoningStyle:
      'Top-down structural reasoning. Identify the boundaries, constraints, and interfaces first. ' +
      'Evaluate tradeoffs explicitly — name what you gain and what you sacrifice with each design choice. ' +
      'Resist premature detail until the structural skeleton is sound.',
    strengths: ['big-picture thinking', 'tradeoff clarity', 'boundary discipline'],
    biases: ['may over-abstract when concrete action is needed', 'analysis paralysis on novel domains'],
  },

  reviewer: {
    id: 'reviewer',
    name: 'Reviewer',
    expertise: ['code quality', 'pattern detection', 'consistency checking'],
    reasoningStyle:
      'Critical assessment mode. Scan for inconsistencies, violations of stated conventions, ' +
      'and latent defects. Compare what IS against what SHOULD BE according to the project standards. ' +
      'Flag deviations with specific evidence, not vague concerns.',
    strengths: ['pattern recognition', 'consistency enforcement', 'defect detection'],
    biases: ['may prioritize style over substance', 'false positives on intentional deviations'],
  },

  explorer: {
    id: 'explorer',
    name: 'Explorer',
    expertise: ['breadth-first discovery', 'creative connections', 'hypothesis generation'],
    reasoningStyle:
      'Divergent exploration. Cast a wide net before committing to a path. Generate multiple ' +
      'hypotheses, look for unexpected connections between domains, and prefer "what if" over ' +
      '"this is how". Tolerate ambiguity longer than feels comfortable.',
    strengths: ['creative ideation', 'cross-domain thinking', 'ambiguity tolerance'],
    biases: ['may fail to converge', 'novelty bias over proven approaches'],
  },

  specialist: {
    id: 'specialist',
    name: 'Specialist',
    expertise: ['deep domain expertise', 'precision', 'standard compliance'],
    reasoningStyle:
      'Deep domain-focused reasoning. Apply domain-specific knowledge rigorously. Cite standards, ' +
      'reference implementations, and established best practices. Precision matters — use exact ' +
      'terminology and avoid approximations where the domain demands specificity.',
    strengths: ['domain depth', 'precision', 'standards awareness'],
    biases: ['may miss cross-domain solutions', 'over-reliance on established patterns'],
  },
};

// ── Task Type → Persona Mapping ─────────────────────────────────

/**
 * Maps task-type keywords to persona IDs.
 *
 * Keywords are matched case-insensitively against the task type string.
 * The mapping reflects which reasoning style is most productive for each
 * category of cognitive work.
 */
const TASK_PERSONA_MAP: Record<string, string> = {
  // Debugger persona
  'debug': 'debugger',
  'fix': 'debugger',
  'error': 'debugger',
  'bug': 'debugger',
  'troubleshoot': 'debugger',

  // Architect persona
  'design': 'architect',
  'architect': 'architect',
  'refactor': 'architect',
  'restructure': 'architect',
  'plan': 'architect',

  // Reviewer persona
  'review': 'reviewer',
  'audit': 'reviewer',
  'check': 'reviewer',
  'validate': 'reviewer',
  'lint': 'reviewer',

  // Explorer persona
  'explore': 'explorer',
  'research': 'explorer',
  'investigate': 'explorer',
  'discover': 'explorer',
  'creative': 'explorer',
  'brainstorm': 'explorer',

  // Specialist persona
  'implement': 'specialist',
  'standard': 'specialist',
  'comply': 'specialist',
  'specification': 'specialist',
  'domain': 'specialist',
};

// ── Selection ───────────────────────────────────────────────────

/**
 * Select a persona based on a task type string.
 *
 * Performs case-insensitive keyword matching against the task type.
 * Returns the first matching persona, or undefined if no keyword matches.
 *
 * @param taskType - A string describing the task type (e.g., "debug", "design", "review").
 * @returns The matching PersonaProfile, or undefined if no match.
 */
export function selectPersona(taskType: string): PersonaProfile | undefined {
  const lower = taskType.toLowerCase().trim();

  // Direct ID match first
  if (PERSONAS[lower]) {
    return PERSONAS[lower];
  }

  // Keyword match
  for (const [keyword, personaId] of Object.entries(TASK_PERSONA_MAP)) {
    if (lower.includes(keyword)) {
      return PERSONAS[personaId];
    }
  }

  return undefined;
}

/**
 * Get a persona by its ID.
 *
 * @param id - The persona identifier (e.g., "debugger", "architect").
 * @returns The PersonaProfile, or undefined if the ID is not registered.
 */
export function getPersona(id: string): PersonaProfile | undefined {
  return PERSONAS[id];
}
