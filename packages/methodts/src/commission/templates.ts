/**
 * Built-in commission templates — 4 standard agent deployment patterns.
 *
 * Each template is a function that returns a Prompt<Config> rendering a full
 * commission prompt with markdown sections. Templates use the Prompt algebra
 * (sequence, constant, section) to compose structured prompts from typed configs.
 *
 * Templates:
 * - implementation — sub-agent for code implementation tasks
 * - review — sub-agent for code/PR review
 * - council — steering council governance session
 * - retro — retrospective generation from session trace
 *
 * @see PRD 021 Component 12
 */

import { Prompt, sequence, constant } from "../prompt/prompt.js";
import { bulletList, numberedList, section, joinSections } from "./render.js";

/** Configuration for an implementation commission. */
export type ImplementationConfig = {
  readonly taskId: string;
  readonly description: string;
  readonly scope: readonly string[];
  readonly rules: readonly string[];
  readonly branch?: string;
};

/** Configuration for a review commission. */
export type ReviewConfig = {
  readonly target: string;
  readonly criteria: readonly string[];
  readonly advisors?: readonly string[];
};

/** Configuration for a council commission. */
export type CouncilConfig = {
  readonly agenda: readonly string[];
  readonly participants?: readonly string[];
  readonly projectCard?: string;
};

/** Configuration for a retrospective commission. */
export type RetroConfig = {
  readonly sessionId: string;
  readonly trace: string;
  readonly focus?: string;
};

/**
 * Built-in commission templates.
 *
 * Each template function accepts an optional partial config for defaults/overrides,
 * then returns a Prompt that renders against the full config at commission time.
 */
export const templates = {
  /**
   * Implementation template — renders a sub-agent commission for code tasks.
   *
   * Sections: Role, Scope, Constraints, Git.
   */
  implementation: (
    defaults?: Partial<ImplementationConfig>,
  ): Prompt<ImplementationConfig> => {
    const role = new Prompt<ImplementationConfig>(
      (c) =>
        `You are an implementation sub-agent. Task: ${c.description}`,
    );
    const scopeSection = new Prompt<ImplementationConfig>((c) => {
      return bulletList(c.scope);
    });
    const constraints = new Prompt<ImplementationConfig>((c) => {
      return numberedList(c.rules);
    });
    const git = new Prompt<ImplementationConfig>(
      (c) =>
        `Branch: ${c.branch ?? defaults?.branch ?? "create a new feature branch"}`,
    );

    return sequence(
      role.section("Role"),
      scopeSection.section("Scope"),
      constraints.section("Constraints"),
      git.section("Git"),
    );
  },

  /**
   * Review template — renders a sub-agent commission for code/PR review.
   *
   * Sections: Role, Target, Criteria, Advisors (optional).
   */
  review: (defaults?: Partial<ReviewConfig>): Prompt<ReviewConfig> => {
    const role = constant<ReviewConfig>(
      "You are a review sub-agent. Evaluate the target against the listed criteria.",
    );
    const target = new Prompt<ReviewConfig>(
      (c) => `Target: ${c.target}`,
    );
    const criteria = new Prompt<ReviewConfig>((c) => {
      return numberedList(c.criteria);
    });
    const advisors = new Prompt<ReviewConfig>((c) => {
      const items = c.advisors ?? defaults?.advisors;
      return bulletList(items);
    }).when((c) => {
      const items = c.advisors ?? defaults?.advisors;
      return items !== undefined && items.length > 0;
    });

    return sequence(
      role.section("Role"),
      target.section("Target"),
      criteria.section("Criteria"),
      advisors.section("Advisors"),
    );
  },

  /**
   * Council template — renders a steering council governance session.
   *
   * Sections: Role, Agenda, Participants (optional), Project Card (optional).
   */
  council: (defaults?: Partial<CouncilConfig>): Prompt<CouncilConfig> => {
    const role = constant<CouncilConfig>(
      "You are running a steering council session. Review the agenda and produce decisions.",
    );
    const agenda = new Prompt<CouncilConfig>((c) => {
      return numberedList(c.agenda);
    });
    const participants = new Prompt<CouncilConfig>((c) => {
      const items = c.participants ?? defaults?.participants;
      return bulletList(items);
    }).when((c) => {
      const items = c.participants ?? defaults?.participants;
      return items !== undefined && items.length > 0;
    });
    const projectCard = new Prompt<CouncilConfig>(
      (c) => c.projectCard ?? defaults?.projectCard ?? "",
    ).when(
      (c) =>
        (c.projectCard ?? defaults?.projectCard) !== undefined,
    );

    return sequence(
      role.section("Role"),
      agenda.section("Agenda"),
      participants.section("Participants"),
      projectCard.section("Project Card"),
    );
  },

  /**
   * Retro template — renders a retrospective generation commission.
   *
   * Sections: Role, Session, Trace, Focus (optional).
   */
  retro: (defaults?: Partial<RetroConfig>): Prompt<RetroConfig> => {
    const role = constant<RetroConfig>(
      "You are a retrospective agent. Analyze the session trace and produce a structured retrospective.",
    );
    const sessionSection = new Prompt<RetroConfig>(
      (c) => `Session ID: ${c.sessionId}`,
    );
    const trace = new Prompt<RetroConfig>(
      (c) => c.trace,
    );
    const focus = new Prompt<RetroConfig>(
      (c) => `Focus area: ${c.focus ?? defaults?.focus ?? ""}`,
    ).when(
      (c) => (c.focus ?? defaults?.focus) !== undefined,
    );

    return sequence(
      role.section("Role"),
      sessionSection.section("Session"),
      trace.section("Trace"),
      focus.section("Focus"),
    );
  },
};
