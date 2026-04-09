# meta/ — Meta-Methodology Operations

Higher-order operations that compose, derive, evolve, and verify methodologies. While `methodology/` defines the structure of individual methodologies, `meta/` enables reasoning about and transforming methodologies as objects.

## Components

| Component | Description |
|-----------|-------------|
| `compile.ts` | Compiles a methodology to a canonical representation (e.g., JSON, registry YAML) |
| `compose.ts` | Composes two methodologies into a single composite (sequential or parallel) |
| `derive.ts` | Derives a specialized methodology from a base methodology (specialization pattern) |
| `evolve.ts` | Applies a transformation delta to produce a new methodology version |
| `instantiate.ts` | Instantiates a methodology template with concrete domain parameters |
| `refinement.ts` | Refinement relation — checks if methodology A refines methodology B |
| `coherence.ts` | Coherence checker — verifies composition consistency and non-contradiction |
| `project-card.ts` | Reads/writes the `.method/project-card.yaml` meta-description |
| `promote.ts` / `promotion.ts` | Promotes a methodology from draft to registry (compilation gate check) |

## Purpose

The meta domain is used by:
- The methodology compiler (builds registry artifacts)
- The steering council (compares methodology versions)
- Research experiments (derives experimental variants from production methodologies)
