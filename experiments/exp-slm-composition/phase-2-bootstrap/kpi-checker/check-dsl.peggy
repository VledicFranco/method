/**
 * Check DSL Grammar — PEG grammar for KPI verification predicates.
 *
 * Validates SLM output from the KPI Checker model.
 * Primitives: file_exists, file_contains, file_exports, file_count_changed
 * Composition: && (AND)
 *
 * Examples:
 *   file_exists('src/handler.ts')
 *   file_exists('src/v2.ts') && file_exports('src/v2.ts', 'handleOrderV2')
 *   file_contains('src/config.ts', 'DATABASE_URL')
 */

CheckExpr
  = head:Primitive rest:(_ "&&" _ p:Primitive { return p; })*
    { return rest.length === 0 ? head : { type: 'allChecks', checks: [head, ...rest] }; }

Primitive
  = "file_exists" _ "(" _ path:StringLit _ ")"
    { return { type: 'file_exists', path: path }; }
  / "file_contains" _ "(" _ path:StringLit _ "," _ pattern:StringLit _ ")"
    { return { type: 'file_contains', path: path, pattern: pattern }; }
  / "file_exports" _ "(" _ path:StringLit _ "," _ name:StringLit _ ")"
    { return { type: 'file_exports', path: path, name: name }; }
  / "file_count_changed" _ "(" _ n:Integer _ ")"
    { return { type: 'file_count_changed', count: n }; }

StringLit
  = "'" chars:$[^']* "'" { return chars; }

Integer
  = chars:$[0-9]+ { return parseInt(chars, 10); }

_ = [ \t]*
