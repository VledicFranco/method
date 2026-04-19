// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for commission render helpers — bulletList, numberedList, section, joinSections.
 *
 * Covers all functions exported from render.ts, including edge cases
 * for empty inputs, undefined arrays, and section composition.
 *
 * @see PRD 021 Component 9 — Commission render helpers
 */

import { describe, it, expect } from "vitest";
import { bulletList, numberedList, section, joinSections } from "../render.js";

// ── bulletList ──

describe("bulletList", () => {
  it("renders items with bullet prefix", () => {
    const result = bulletList(["alpha", "beta", "gamma"]);
    expect(result).toBe("- alpha\n- beta\n- gamma");
  });

  it("renders a single item", () => {
    const result = bulletList(["only one"]);
    expect(result).toBe("- only one");
  });

  it("returns empty string for empty array", () => {
    expect(bulletList([])).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(bulletList(undefined)).toBe("");
  });

  it("preserves items with special characters", () => {
    const result = bulletList(["file: `src/index.ts`", "path with spaces"]);
    expect(result).toBe("- file: `src/index.ts`\n- path with spaces");
  });
});

// ── numberedList ──

describe("numberedList", () => {
  it("renders items with 1-based numbering", () => {
    const result = numberedList(["first", "second", "third"]);
    expect(result).toBe("1. first\n2. second\n3. third");
  });

  it("renders a single item", () => {
    const result = numberedList(["only"]);
    expect(result).toBe("1. only");
  });

  it("returns empty string for empty array", () => {
    expect(numberedList([])).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(numberedList(undefined)).toBe("");
  });
});

// ── section ──

describe("section", () => {
  it("renders heading and body", () => {
    const result = section("Title", "Body text here");
    expect(result).toBe("## Title\n\nBody text here");
  });

  it("returns empty string when body is empty", () => {
    expect(section("Title", "")).toBe("");
  });

  it("preserves multi-line body", () => {
    const result = section("Details", "Line 1\nLine 2\nLine 3");
    expect(result).toBe("## Details\n\nLine 1\nLine 2\nLine 3");
  });
});

// ── joinSections ──

describe("joinSections", () => {
  it("joins non-empty sections with double newlines", () => {
    const result = joinSections("## A\n\nBody A", "## B\n\nBody B");
    expect(result).toBe("## A\n\nBody A\n\n## B\n\nBody B");
  });

  it("filters out empty strings", () => {
    const result = joinSections("## A\n\nBody A", "", "## C\n\nBody C");
    expect(result).toBe("## A\n\nBody A\n\n## C\n\nBody C");
  });

  it("returns empty string when all sections are empty", () => {
    expect(joinSections("", "", "")).toBe("");
  });

  it("returns single section unchanged when others are empty", () => {
    expect(joinSections("", "## Only\n\nContent", "")).toBe("## Only\n\nContent");
  });

  it("handles no arguments", () => {
    expect(joinSections()).toBe("");
  });
});
