// SPDX-License-Identifier: Apache-2.0
/**
 * Internal render helpers for commission prompt generation.
 *
 * These utilities handle common formatting patterns used across
 * commission templates — list rendering, section assembly, and
 * optional field handling.
 */

/**
 * Render an array of items as a markdown bullet list.
 * Returns empty string if the array is empty or undefined.
 */
export function bulletList(items: readonly string[] | undefined): string {
  if (!items || items.length === 0) return "";
  return items.map((item) => `- ${item}`).join("\n");
}

/**
 * Render an array of items as a numbered markdown list.
 * Returns empty string if the array is empty or undefined.
 */
export function numberedList(items: readonly string[] | undefined): string {
  if (!items || items.length === 0) return "";
  return items.map((item, i) => `${i + 1}. ${item}`).join("\n");
}

/**
 * Render a labeled markdown section with a heading and body.
 * Returns empty string if body is empty.
 */
export function section(heading: string, body: string): string {
  if (!body) return "";
  return `## ${heading}\n\n${body}`;
}

/**
 * Join non-empty text blocks with double newlines.
 * Filters out empty strings before joining.
 */
export function joinSections(...sections: string[]): string {
  return sections.filter((s) => s.length > 0).join("\n\n");
}
