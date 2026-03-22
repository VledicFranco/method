/**
 * ProjectCard — Static instantiation record for binding a method to a project.
 *
 * Maps to the MIC (Method Instance Card) schema from the method system.
 * A project card captures delivery rules, role-specific notes, and context
 * bindings that customize an abstract method for a concrete project.
 *
 * Pure type — no runtime dependencies.
 */

/** A delivery rule entry in a project card. */
export type DeliveryRule = {
  readonly id: string;
  readonly description: string;
};

/** Project card for method instantiation. Maps to MIC schema. */
export type ProjectCard = {
  readonly id: string;
  readonly name: string;
  readonly deliveryRules: readonly DeliveryRule[];
  readonly roleNotes: Readonly<Record<string, string>>;
  readonly contextBindings: Readonly<Record<string, string>>;
};
