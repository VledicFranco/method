/**
 * Tool<S> type and utility tests.
 *
 * Validates F1-FTH Definition 3.1: tau = (pre_tau, post_tau, description)
 * Hoare-typed tools with preconditions and postconditions.
 */

import { describe, it, expect } from "vitest";
import type { Tool } from "../tool.js";
import { canUseTool, buildToolSet, authorizedTools } from "../tool.js";
import { TRUE, FALSE, check } from "../../predicate/predicate.js";

// ── Test state ──

type ProjectState = {
  readonly phase: "init" | "dev" | "review" | "done";
  readonly coverage: number;
  readonly hasUncommittedChanges: boolean;
};

const devState: ProjectState = { phase: "dev", coverage: 85, hasUncommittedChanges: true };
const reviewState: ProjectState = { phase: "review", coverage: 95, hasUncommittedChanges: false };
const initState: ProjectState = { phase: "init", coverage: 0, hasUncommittedChanges: false };

// ── Tool fixtures ──

const writeFileTool: Tool<ProjectState> = {
  id: "write_file",
  name: "Write File",
  description: "Write content to a file in the workspace",
  precondition: check<ProjectState>("in-dev-or-init", (s) => s.phase === "dev" || s.phase === "init"),
  postcondition: check<ProjectState>("has-changes", (s) => s.hasUncommittedChanges),
  category: "write",
};

const runTestsTool: Tool<ProjectState> = {
  id: "run_tests",
  name: "Run Tests",
  description: "Execute the project test suite",
  precondition: TRUE,
  postcondition: check<ProjectState>("has-coverage", (s) => s.coverage > 0),
  category: "execute",
};

const readFileTool: Tool<ProjectState> = {
  id: "read_file",
  name: "Read File",
  description: "Read content from a file in the workspace",
  precondition: TRUE,
  postcondition: TRUE,
  category: "read",
};

const deployTool: Tool<ProjectState> = {
  id: "deploy",
  name: "Deploy",
  description: "Deploy to production",
  precondition: check<ProjectState>("in-done", (s) => s.phase === "done"),
  postcondition: TRUE,
  category: "execute",
};

const notifyTool: Tool<ProjectState> = {
  id: "notify",
  name: "Send Notification",
  description: "Send a notification to the team",
  precondition: TRUE,
  postcondition: TRUE,
  category: "communicate",
};

// ── Tests ──

describe("Tool — F1-FTH Definition 3.1", () => {
  it("constructs a Tool with all required fields", () => {
    expect(writeFileTool.id).toBe("write_file");
    expect(writeFileTool.name).toBe("Write File");
    expect(writeFileTool.description).toBe("Write content to a file in the workspace");
    expect(writeFileTool.precondition.tag).toBe("check");
    expect(writeFileTool.postcondition.tag).toBe("check");
    expect(writeFileTool.category).toBe("write");
  });

  it("Tool categories: all 4 variants", () => {
    expect(readFileTool.category).toBe("read");
    expect(writeFileTool.category).toBe("write");
    expect(runTestsTool.category).toBe("execute");
    expect(notifyTool.category).toBe("communicate");
  });
});

describe("canUseTool", () => {
  it("returns true when precondition is satisfied", () => {
    expect(canUseTool(writeFileTool, devState)).toBe(true);
  });

  it("returns false when precondition is not satisfied", () => {
    expect(canUseTool(writeFileTool, reviewState)).toBe(false);
  });

  it("returns true for TRUE precondition regardless of state", () => {
    expect(canUseTool(runTestsTool, devState)).toBe(true);
    expect(canUseTool(runTestsTool, reviewState)).toBe(true);
    expect(canUseTool(runTestsTool, initState)).toBe(true);
  });

  it("returns false for deploy tool when not in done phase", () => {
    expect(canUseTool(deployTool, devState)).toBe(false);
    expect(canUseTool(deployTool, reviewState)).toBe(false);
  });
});

describe("buildToolSet", () => {
  it("creates a Map keyed by tool ID", () => {
    const tools = [writeFileTool, runTestsTool, readFileTool, deployTool, notifyTool];
    const toolSet = buildToolSet(tools);

    expect(toolSet.size).toBe(5);
    expect(toolSet.get("write_file")).toBe(writeFileTool);
    expect(toolSet.get("run_tests")).toBe(runTestsTool);
    expect(toolSet.get("read_file")).toBe(readFileTool);
    expect(toolSet.get("deploy")).toBe(deployTool);
    expect(toolSet.get("notify")).toBe(notifyTool);
  });

  it("returns empty Map for empty array", () => {
    const toolSet = buildToolSet<ProjectState>([]);
    expect(toolSet.size).toBe(0);
  });

  it("returns a ReadonlyMap", () => {
    const toolSet = buildToolSet([writeFileTool]);
    // Verify the map interface — get works, has works
    expect(toolSet.has("write_file")).toBe(true);
    expect(toolSet.has("nonexistent")).toBe(false);
  });
});

describe("authorizedTools", () => {
  const allTools = buildToolSet([writeFileTool, runTestsTool, readFileTool, deployTool, notifyTool]);

  it("filters tools by authorized list", () => {
    const result = authorizedTools(allTools, ["write_file", "run_tests"], []);
    expect(result).toHaveLength(2);
    expect(result.map(t => t.id).sort()).toEqual(["run_tests", "write_file"]);
  });

  it("excludes tools in notAuthorized list", () => {
    const result = authorizedTools(
      allTools,
      ["write_file", "run_tests", "deploy"],
      ["deploy"],
    );
    expect(result).toHaveLength(2);
    expect(result.map(t => t.id).sort()).toEqual(["run_tests", "write_file"]);
  });

  it("returns empty array when no tools match authorized list", () => {
    const result = authorizedTools(allTools, ["nonexistent"], []);
    expect(result).toHaveLength(0);
  });

  it("returns empty array when all authorized tools are also notAuthorized", () => {
    const result = authorizedTools(allTools, ["write_file"], ["write_file"]);
    expect(result).toHaveLength(0);
  });

  it("handles empty authorized list", () => {
    const result = authorizedTools(allTools, [], []);
    expect(result).toHaveLength(0);
  });
});
