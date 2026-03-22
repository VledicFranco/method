/**
 * Reusable prompt templates for methodology steps.
 *
 * These are generic prompt building blocks that can be composed
 * into step-specific guidance via the Prompt algebra (andThen, contramap, etc.).
 *
 * @see src/prompt/prompt.ts — the Prompt<A> algebra
 * @see F1-FTH Definition 4.1 — guidance_sigma : Context -> Text
 */

import { Prompt, constant } from "../prompt/prompt.js";

/** Reusable prompt templates for methodology steps. */
export const prompts = {
  /**
   * Role introduction section.
   * Renders a role assignment and task description.
   */
  roleIntro: <A extends { role: string; task: string }>(): Prompt<A> =>
    new Prompt((ctx: A) => `## Role\nYou are the ${ctx.role}.\n\n## Task\n${ctx.task}`),

  /**
   * Render delivery rules as a numbered list.
   * Emits empty string if no rules are provided.
   */
  deliveryRules: <A extends { rules: readonly string[] }>(): Prompt<A> =>
    new Prompt((ctx: A) =>
      ctx.rules.length > 0
        ? `## Delivery Rules\n${ctx.rules.map((r, i) => `${i + 1}. ${r}`).join("\n")}`
        : "",
    ),

  /**
   * Insight request instruction.
   * Asks the agent to summarize findings on a given topic.
   */
  insightRequest: (topic: string, bullets: number): Prompt<unknown> =>
    constant(
      `\n\nAt the end of your response, summarize your ${topic} findings as ${bullets} bullet points.`,
    ),

  /**
   * Compilation check prompt for M1-MDES sigma_6.
   * Renders a checklist of components to verify.
   */
  compilationCheck: new Prompt<{ components: readonly string[] }>((ctx) =>
    `## Compilation Check\nVerify the following components are present and valid:\n${ctx.components.map((c) => `- [ ] ${c}`).join("\n")}`,
  ),
};
