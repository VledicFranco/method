/**
 * Tests for Role scoping — scopeToRole and contramap composition.
 *
 * Verifies the epistemic projection from F1-FTH Definition 2.1:
 * a role's observe function restricts what a prompt can see.
 */
import { describe, it, expect } from "vitest";
import { type Role, scopeToRole } from "../../domain/role.js";
import { Prompt, constant } from "../../prompt/prompt.js";

// ── Fixture: world state and observable view ──

type FullState = {
  readonly tasks: readonly string[];
  readonly secrets: readonly string[];
  readonly status: "open" | "closed";
};

type ReviewerView = {
  readonly tasks: readonly string[];
  readonly status: "open" | "closed";
};

// ── Fixture: roles ──

const reviewerRole: Role<FullState, ReviewerView> = {
  id: "R-Reviewer",
  description: "Can see tasks and status, but not secrets",
  observe: (s) => ({ tasks: s.tasks, status: s.status }),
  authorized: ["review", "comment"],
  notAuthorized: ["deploy", "delete"],
};

// ── Fixture: prompts over the reviewer's view ──

const reviewerPrompt = new Prompt<ReviewerView>((view) =>
  `Review ${view.tasks.length} tasks. Status: ${view.status}`,
);

// ── Test state ──

const fullState: FullState = {
  tasks: ["T-1", "T-2", "T-3"],
  secrets: ["API_KEY=abc123"],
  status: "open",
};

// ── Tests ──

describe("scopeToRole (epistemic projection — F1-FTH Def 2.1)", () => {
  it("projects a prompt through the role's observe function", () => {
    const scoped: Prompt<FullState> = scopeToRole(reviewerRole, reviewerPrompt);
    const output = scoped.run(fullState);
    expect(output).toBe("Review 3 tasks. Status: open");
  });

  it("scoped prompt does not expose data outside the role's view", () => {
    // The reviewer prompt only has access to ReviewerView — no secrets field.
    // We verify that the observe function correctly narrows the state.
    const scoped = scopeToRole(reviewerRole, reviewerPrompt);
    const output = scoped.run(fullState);
    expect(output).not.toContain("API_KEY");
    expect(output).not.toContain("abc123");
  });

  it("composes with further contramap correctly (chained projections)", () => {
    // Outer state wrapping FullState
    type SessionState = {
      readonly sessionId: string;
      readonly project: FullState;
    };

    const sessionState: SessionState = {
      sessionId: "S-42",
      project: fullState,
    };

    // First: scope reviewer prompt to FullState via role
    const scopedToFull: Prompt<FullState> = scopeToRole(reviewerRole, reviewerPrompt);

    // Then: contramap to lift from SessionState to FullState
    const scopedToSession: Prompt<SessionState> = scopedToFull.contramap(
      (s: SessionState) => s.project,
    );

    const output = scopedToSession.run(sessionState);
    expect(output).toBe("Review 3 tasks. Status: open");
  });

  it("works with a constant prompt (identity observe case)", () => {
    const identityRole: Role<FullState, FullState> = {
      id: "R-Admin",
      description: "Full access — observe is identity",
      observe: (s) => s,
      authorized: ["*"],
      notAuthorized: [],
    };

    const staticPrompt = constant<FullState>("You have admin access.");
    const scoped = scopeToRole(identityRole, staticPrompt);
    expect(scoped.run(fullState)).toBe("You have admin access.");
  });

  it("returns empty string when composed with a conditional prompt that doesn't match", () => {
    const conditionalPrompt = new Prompt<ReviewerView>((view) =>
      view.status === "closed" ? "Project is closed." : "",
    );

    const scoped = scopeToRole(reviewerRole, conditionalPrompt);
    const output = scoped.run(fullState); // status is "open"
    expect(output).toBe("");
  });
});
