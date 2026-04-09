# adapter/ — YAML Adapter

Serialization and deserialization layer between YAML notation (`.method/manifest.yaml`, registry files) and the internal TypeScript type system.

## Components

| Component | Description |
|-----------|-------------|
| `YamlAdapter` | Bidirectional converter: YAML objects ↔ typed methodology/method/step structures |
| `yaml-types.ts` | YAML schema types — the raw parsed shapes before conversion |
| `PredicateParser` | Parses predicate expressions from YAML string notation into typed `Predicate` AST nodes |

## Usage

The adapter layer is used by:
- `runtime/` when loading methodologies from `.method/manifest.yaml`
- `strategy/dag-parser.ts` when parsing strategy YAML files
- CLI tools that serialize/deserialize registry artifacts

YAML types mirror the TypeScript domain types but allow `unknown` fields and optional everything — the adapter performs validation and type narrowing.
