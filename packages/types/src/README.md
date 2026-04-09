# @method/types — Canonical Shared Types

L3 package. Canonical TypeScript type definitions shared across all method packages. Import shared types from here — never redefine them locally.

## Purpose

Prevents type drift across packages. When `SessionId`, `ProjectId`, or `BridgeEvent` need to change, there is one place to change them. All method packages depend on this package; none define their own versions of these types.

## Contents

Shared domain types used by bridge, mcp, cluster, methodts, and pacta. Includes identifiers, event types, project metadata, and common value objects.
