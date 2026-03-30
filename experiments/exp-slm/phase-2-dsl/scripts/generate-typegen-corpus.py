#!/usr/bin/env python3
"""
Generate synthetic JSON Schema -> TypeScript type definition corpus.

Produces (input, output) pairs where the input is a JSON Schema string
and the output is the corresponding TypeScript type definition.

No API calls — entirely synthetic generation with controlled complexity
distribution: 30% simple, 40% medium, 30% complex.

Output:
  - phase-2-dsl/corpus/typegen/train.jsonl   (10,000 pairs)
  - phase-2-dsl/corpus/typegen/holdout.jsonl  (2,500 pairs)

Usage:
    python phase-2-dsl/scripts/generate-typegen-corpus.py
"""

from __future__ import annotations

import json
import random
import string
from pathlib import Path
from typing import Any

# ── Paths ────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).resolve().parent
PHASE2_DIR = SCRIPT_DIR.parent
CORPUS_DIR = PHASE2_DIR / "corpus" / "typegen"
TRAIN_PATH = CORPUS_DIR / "train.jsonl"
HOLDOUT_PATH = CORPUS_DIR / "holdout.jsonl"

# ── Name pools ───────────────────────────────────────────────────

PROPERTY_NAMES = [
    "id", "name", "email", "age", "title", "description", "status",
    "createdAt", "updatedAt", "isActive", "count", "value", "label",
    "type", "category", "priority", "score", "url", "path", "key",
    "data", "items", "result", "message", "code", "version", "tags",
    "metadata", "config", "options", "enabled", "visible", "index",
    "width", "height", "color", "size", "limit", "offset", "total",
    "firstName", "lastName", "username", "password", "token", "role",
    "permission", "level", "duration", "timestamp", "format", "mode",
    "source", "target", "parent", "children", "content", "body",
    "header", "footer", "prefix", "suffix", "min", "max", "step",
    "ratio", "threshold", "timeout", "retries", "interval", "delay",
    "capacity", "weight", "depth", "rank", "order", "position",
]

TYPE_NAMES = [
    "User", "Product", "Order", "Config", "Event", "Response",
    "Request", "Item", "Record", "Entry", "Node", "Edge",
    "Metric", "Report", "Task", "Action", "Rule", "Filter",
    "Schema", "Payload", "Header", "Session", "Token", "Address",
    "Contact", "Profile", "Setting", "Option", "Result", "Error",
]

ENUM_STRING_VALUES = [
    "active", "inactive", "pending", "archived", "draft", "published",
    "error", "success", "warning", "info", "debug", "critical",
    "low", "medium", "high", "urgent", "normal", "elevated",
    "read", "write", "admin", "guest", "owner", "editor", "viewer",
    "open", "closed", "in_progress", "completed", "cancelled",
    "small", "large", "xl", "xxl", "xs",
]


# ── Helpers ──────────────────────────────────────────────────────

def pick_names(count: int, exclude: set[str] | None = None) -> list[str]:
    """Pick unique property names from the pool."""
    available = [n for n in PROPERTY_NAMES if not exclude or n not in exclude]
    if count > len(available):
        count = len(available)
    return random.sample(available, count)


def pick_type_name(exclude: set[str] | None = None) -> str:
    available = [n for n in TYPE_NAMES if not exclude or n not in exclude]
    return random.choice(available)


# ── JSON Schema -> TypeScript converter ──────────────────────────
# This is the "ground truth" converter used to generate correct outputs.


def schema_to_ts(schema: dict, indent: int = 0, top_level: bool = True,
                 ref_map: dict[str, dict] | None = None) -> str:
    """Convert a JSON Schema dict to a TypeScript type string."""
    pad = "  " * indent

    # Handle $ref
    if "$ref" in schema:
        ref_name = schema["$ref"].split("/")[-1]
        return ref_name

    # Handle allOf (intersection)
    if "allOf" in schema:
        parts = []
        for sub in schema["allOf"]:
            ts = schema_to_ts(sub, indent, top_level=False, ref_map=ref_map)
            parts.append(ts)
        result = " & ".join(parts)
        if top_level:
            return f"type Generated = {result};"
        return result

    # Handle oneOf (union)
    if "oneOf" in schema:
        parts = []
        for sub in schema["oneOf"]:
            ts = schema_to_ts(sub, indent, top_level=False, ref_map=ref_map)
            parts.append(ts)
        result = " | ".join(parts)
        if top_level:
            return f"type Generated = {result};"
        return result

    # Handle anyOf (union, same as oneOf for TS)
    if "anyOf" in schema:
        parts = []
        for sub in schema["anyOf"]:
            ts = schema_to_ts(sub, indent, top_level=False, ref_map=ref_map)
            parts.append(ts)
        result = " | ".join(parts)
        if top_level:
            return f"type Generated = {result};"
        return result

    # Handle enum
    if "enum" in schema:
        literals = []
        for val in schema["enum"]:
            if isinstance(val, str):
                literals.append(f'"{val}"')
            elif isinstance(val, bool):
                literals.append("true" if val else "false")
            elif isinstance(val, (int, float)):
                literals.append(str(val))
            elif val is None:
                literals.append("null")
        result = " | ".join(literals)
        if top_level:
            return f"type Generated = {result};"
        return result

    # Handle const
    if "const" in schema:
        val = schema["const"]
        if isinstance(val, str):
            result = f'"{val}"'
        elif isinstance(val, bool):
            result = "true" if val else "false"
        elif isinstance(val, (int, float)):
            result = str(val)
        elif val is None:
            result = "null"
        else:
            result = str(val)
        if top_level:
            return f"type Generated = {result};"
        return result

    schema_type = schema.get("type")

    # Primitive types
    if schema_type == "string":
        if top_level:
            return "type Generated = string;"
        return "string"

    if schema_type in ("number", "integer"):
        if top_level:
            return "type Generated = number;"
        return "number"

    if schema_type == "boolean":
        if top_level:
            return "type Generated = boolean;"
        return "boolean"

    if schema_type == "null":
        if top_level:
            return "type Generated = null;"
        return "null"

    # Array type
    if schema_type == "array":
        # Tuple array (prefixItems or items as array)
        if "prefixItems" in schema:
            items_ts = []
            for item_schema in schema["prefixItems"]:
                items_ts.append(schema_to_ts(item_schema, indent, top_level=False, ref_map=ref_map))
            result = f"[{', '.join(items_ts)}]"
            if top_level:
                return f"type Generated = {result};"
            return result

        items = schema.get("items", {})
        if isinstance(items, list):
            # Legacy tuple form
            items_ts = []
            for item_schema in items:
                items_ts.append(schema_to_ts(item_schema, indent, top_level=False, ref_map=ref_map))
            result = f"[{', '.join(items_ts)}]"
            if top_level:
                return f"type Generated = {result};"
            return result

        item_ts = schema_to_ts(items, indent, top_level=False, ref_map=ref_map)
        # Wrap complex types in parens for array notation
        if " | " in item_ts or " & " in item_ts:
            result = f"({item_ts})[]"
        else:
            result = f"{item_ts}[]"
        if top_level:
            return f"type Generated = {result};"
        return result

    # Object type
    if schema_type == "object":
        properties = schema.get("properties", {})
        required = set(schema.get("required", []))
        additional = schema.get("additionalProperties")
        pattern_props = schema.get("patternProperties")

        if not properties and not pattern_props:
            # Empty object or record type
            if additional is not None and additional is not False:
                if isinstance(additional, dict) and additional:
                    val_ts = schema_to_ts(additional, indent, top_level=False, ref_map=ref_map)
                    result = f"Record<string, {val_ts}>"
                else:
                    result = "Record<string, unknown>"
                if top_level:
                    return f"type Generated = {result};"
                return result
            # Empty object
            if top_level:
                return "type Generated = {};"
            return "{}"

        lines = []
        inner_pad = "  " * (indent + 1)
        for prop_name, prop_schema in properties.items():
            optional = "?" if prop_name not in required else ""
            prop_ts = schema_to_ts(prop_schema, indent + 1, top_level=False, ref_map=ref_map)
            lines.append(f"{inner_pad}{prop_name}{optional}: {prop_ts};")

        # Index signature for additionalProperties
        if additional is not None and additional is not False and isinstance(additional, dict) and additional:
            val_ts = schema_to_ts(additional, indent + 1, top_level=False, ref_map=ref_map)
            lines.append(f"{inner_pad}[key: string]: {val_ts};")

        # Pattern properties -> index signature
        if pattern_props:
            for _pattern, pschema in pattern_props.items():
                val_ts = schema_to_ts(pschema, indent + 1, top_level=False, ref_map=ref_map)
                lines.append(f"{inner_pad}[key: string]: {val_ts};")
                break  # Only one index signature allowed in TS

        body = "\n".join(lines)
        result = f"{{\n{body}\n{pad}}}"
        if top_level:
            return f"type Generated = {result};"
        return result

    # Fallback: unknown
    if top_level:
        return "type Generated = unknown;"
    return "unknown"


# ── Schema generators by complexity ──────────────────────────────

def gen_primitive_schema() -> dict:
    """Generate a simple primitive type schema."""
    ptype = random.choice(["string", "number", "integer", "boolean", "null"])
    return {"type": ptype}


def gen_primitive_array_schema() -> dict:
    """Generate an array of primitives."""
    ptype = random.choice(["string", "number", "integer", "boolean"])
    return {"type": "array", "items": {"type": ptype}}


def gen_simple_enum_schema() -> dict:
    """Generate a simple string enum."""
    count = random.randint(2, 5)
    values = random.sample(ENUM_STRING_VALUES, count)
    return {"enum": values}


def gen_const_schema() -> dict:
    """Generate a const value schema."""
    choice = random.choice(["string", "number", "boolean"])
    if choice == "string":
        return {"const": random.choice(ENUM_STRING_VALUES)}
    elif choice == "number":
        return {"const": random.randint(0, 100)}
    else:
        return {"const": random.choice([True, False])}


def gen_simple_object_schema() -> dict:
    """Generate a simple flat object (2-5 primitive properties)."""
    num_props = random.randint(2, 5)
    names = pick_names(num_props)
    properties = {}
    for name in names:
        ptype = random.choice(["string", "number", "integer", "boolean"])
        properties[name] = {"type": ptype}

    num_required = random.randint(0, num_props)
    required = random.sample(names, num_required) if num_required > 0 else []

    schema: dict[str, Any] = {"type": "object", "properties": properties}
    if required:
        schema["required"] = required
    return schema


# ── Medium complexity generators ─────────────────────────────────

def gen_nested_object_schema() -> dict:
    """Generate an object with nested object properties."""
    outer_count = random.randint(2, 4)
    outer_names = pick_names(outer_count)

    properties = {}
    required_names = []

    for i, name in enumerate(outer_names):
        if random.random() < 0.4:
            # Nested object
            inner_count = random.randint(1, 3)
            inner_names = pick_names(inner_count, exclude=set(outer_names))
            inner_props = {}
            inner_required = []
            for iname in inner_names:
                inner_props[iname] = {"type": random.choice(["string", "number", "boolean"])}
                if random.random() > 0.5:
                    inner_required.append(iname)
            nested: dict[str, Any] = {"type": "object", "properties": inner_props}
            if inner_required:
                nested["required"] = inner_required
            properties[name] = nested
        else:
            properties[name] = {"type": random.choice(["string", "number", "integer", "boolean"])}

        if random.random() > 0.4:
            required_names.append(name)

    schema: dict[str, Any] = {"type": "object", "properties": properties}
    if required_names:
        schema["required"] = required_names
    return schema


def gen_array_of_objects_schema() -> dict:
    """Generate an array of objects."""
    inner = gen_simple_object_schema()
    return {"type": "array", "items": inner}


def gen_optional_required_mix_schema() -> dict:
    """Generate an object with a deliberate mix of optional and required fields."""
    num_props = random.randint(4, 7)
    names = pick_names(num_props)
    properties = {}
    for name in names:
        ptype = random.choice(["string", "number", "boolean", "null"])
        properties[name] = {"type": ptype}

    # Ensure a clear mix: some required, some optional
    num_required = random.randint(1, num_props - 1)
    required = sorted(random.sample(names, num_required))

    return {"type": "object", "properties": properties, "required": required}


def gen_enum_object_schema() -> dict:
    """Generate an object with enum fields."""
    num_props = random.randint(2, 5)
    names = pick_names(num_props)
    properties = {}
    required = []

    for name in names:
        if random.random() < 0.4:
            # Enum field
            count = random.randint(2, 4)
            values = random.sample(ENUM_STRING_VALUES, count)
            properties[name] = {"enum": values}
        elif random.random() < 0.3:
            # Const field
            properties[name] = {"const": random.choice(ENUM_STRING_VALUES)}
        else:
            properties[name] = {"type": random.choice(["string", "number", "boolean"])}
        if random.random() > 0.4:
            required.append(name)

    schema: dict[str, Any] = {"type": "object", "properties": properties}
    if required:
        schema["required"] = required
    return schema


def gen_mixed_array_schema() -> dict:
    """Generate arrays with various item types."""
    choice = random.choice(["enum_array", "nested_array", "nullable_array"])
    if choice == "enum_array":
        count = random.randint(2, 4)
        values = random.sample(ENUM_STRING_VALUES, count)
        return {"type": "array", "items": {"enum": values}}
    elif choice == "nested_array":
        return {"type": "array", "items": {"type": "array", "items": {"type": "string"}}}
    else:
        # Array of nullable items via oneOf
        return {"type": "array", "items": {"oneOf": [{"type": "string"}, {"type": "null"}]}}


# ── Complex generators ───────────────────────────────────────────

def gen_allof_schema() -> dict:
    """Generate an allOf intersection type."""
    parts = []
    for _ in range(random.randint(2, 3)):
        obj = gen_simple_object_schema()
        parts.append(obj)
    return {"allOf": parts}


def gen_oneof_schema() -> dict:
    """Generate a oneOf union type."""
    choice = random.choice(["objects", "primitives", "mixed"])
    parts = []
    if choice == "objects":
        for _ in range(random.randint(2, 3)):
            parts.append(gen_simple_object_schema())
    elif choice == "primitives":
        types = random.sample(["string", "number", "boolean", "null"], random.randint(2, 3))
        for t in types:
            parts.append({"type": t})
    else:
        parts.append(gen_simple_object_schema())
        parts.append({"type": random.choice(["string", "number", "null"])})
    return {"oneOf": parts}


def gen_anyof_schema() -> dict:
    """Generate an anyOf union type."""
    parts = []
    count = random.randint(2, 3)
    for _ in range(count):
        if random.random() < 0.5:
            parts.append({"type": random.choice(["string", "number", "boolean"])})
        else:
            parts.append(gen_simple_object_schema())
    return {"anyOf": parts}


def gen_ref_schema() -> dict:
    """Generate a schema with $ref references.

    We create a 'definitions' section and reference types from it.
    The output TypeScript will use the referenced type name directly.
    """
    ref_name = pick_type_name()
    # Main schema references a named type
    num_props = random.randint(2, 4)
    names = pick_names(num_props)
    properties: dict[str, Any] = {}
    required = []

    for name in names:
        if random.random() < 0.3:
            properties[name] = {"$ref": f"#/definitions/{ref_name}"}
        elif random.random() < 0.3:
            properties[name] = {"type": "array", "items": {"$ref": f"#/definitions/{ref_name}"}}
        else:
            properties[name] = {"type": random.choice(["string", "number", "boolean"])}
        if random.random() > 0.4:
            required.append(name)

    schema: dict[str, Any] = {"type": "object", "properties": properties}
    if required:
        schema["required"] = required

    # Include definitions for completeness (though the model just sees the raw schema)
    ref_obj = gen_simple_object_schema()
    schema["definitions"] = {ref_name: ref_obj}

    return schema


def gen_additional_properties_schema() -> dict:
    """Generate a schema with additionalProperties."""
    choice = random.choice(["record_only", "mixed"])

    if choice == "record_only":
        val_type = random.choice(["string", "number", "boolean"])
        return {
            "type": "object",
            "additionalProperties": {"type": val_type},
        }
    else:
        num_props = random.randint(1, 3)
        names = pick_names(num_props)
        properties = {}
        required = []
        for name in names:
            properties[name] = {"type": random.choice(["string", "number"])}
            if random.random() > 0.5:
                required.append(name)

        val_type = random.choice(["string", "number"])
        schema: dict[str, Any] = {
            "type": "object",
            "properties": properties,
            "additionalProperties": {"type": val_type},
        }
        if required:
            schema["required"] = required
        return schema


def gen_pattern_properties_schema() -> dict:
    """Generate a schema with patternProperties."""
    patterns = {
        "^x-": {"type": "string"},
        "^data_": {"type": "number"},
        "^is[A-Z]": {"type": "boolean"},
        ".*": {"type": random.choice(["string", "number"])},
    }
    pattern, pschema = random.choice(list(patterns.items()))

    schema: dict[str, Any] = {
        "type": "object",
        "patternProperties": {pattern: pschema},
    }

    # Maybe add some fixed properties
    if random.random() < 0.5:
        num_props = random.randint(1, 3)
        names = pick_names(num_props)
        props = {}
        required = []
        for name in names:
            props[name] = {"type": random.choice(["string", "number", "boolean"])}
            if random.random() > 0.5:
                required.append(name)
        schema["properties"] = props
        if required:
            schema["required"] = required

    return schema


def gen_tuple_array_schema() -> dict:
    """Generate a tuple-style array schema."""
    count = random.randint(2, 4)
    items = []
    for _ in range(count):
        items.append({"type": random.choice(["string", "number", "boolean"])})
    return {"type": "array", "prefixItems": items}


def gen_complex_nested_schema() -> dict:
    """Generate a deeply nested object with various features."""
    outer_count = random.randint(3, 5)
    outer_names = pick_names(outer_count)
    properties: dict[str, Any] = {}
    required = []

    for name in outer_names:
        r = random.random()
        if r < 0.25:
            # Nested object with its own nested object
            inner = gen_nested_object_schema()
            properties[name] = inner
        elif r < 0.5:
            # Array of objects
            properties[name] = {"type": "array", "items": gen_simple_object_schema()}
        elif r < 0.65:
            # Union type inline
            parts = [{"type": "string"}, {"type": "number"}]
            properties[name] = {"oneOf": parts}
        elif r < 0.8:
            # Enum
            values = random.sample(ENUM_STRING_VALUES, random.randint(2, 4))
            properties[name] = {"enum": values}
        else:
            properties[name] = {"type": random.choice(["string", "number", "boolean"])}
        if random.random() > 0.3:
            required.append(name)

    schema: dict[str, Any] = {"type": "object", "properties": properties}
    if required:
        schema["required"] = required
    return schema


# ── Complexity tiers ─────────────────────────────────────────────

SIMPLE_GENERATORS = [
    gen_primitive_schema,
    gen_primitive_array_schema,
    gen_simple_enum_schema,
    gen_const_schema,
    gen_simple_object_schema,
]

MEDIUM_GENERATORS = [
    gen_nested_object_schema,
    gen_array_of_objects_schema,
    gen_optional_required_mix_schema,
    gen_enum_object_schema,
    gen_mixed_array_schema,
]

COMPLEX_GENERATORS = [
    gen_allof_schema,
    gen_oneof_schema,
    gen_anyof_schema,
    gen_ref_schema,
    gen_additional_properties_schema,
    gen_pattern_properties_schema,
    gen_tuple_array_schema,
    gen_complex_nested_schema,
]


def generate_pair(complexity: str) -> dict:
    """Generate a single (input, output) pair at the given complexity level."""
    if complexity == "simple":
        gen = random.choice(SIMPLE_GENERATORS)
    elif complexity == "medium":
        gen = random.choice(MEDIUM_GENERATORS)
    else:
        gen = random.choice(COMPLEX_GENERATORS)

    schema = gen()
    ts_output = schema_to_ts(schema)
    schema_str = json.dumps(schema, separators=(",", ":"))

    return {"input": schema_str, "output": ts_output}


def generate_corpus(total: int) -> list[dict]:
    """Generate a corpus with controlled complexity distribution."""
    # 30% simple, 40% medium, 30% complex
    simple_count = int(total * 0.30)
    medium_count = int(total * 0.40)
    complex_count = total - simple_count - medium_count

    entries = []
    complexity_counts = {"simple": 0, "medium": 0, "complex": 0}

    for _ in range(simple_count):
        entries.append(generate_pair("simple"))
        complexity_counts["simple"] += 1

    for _ in range(medium_count):
        entries.append(generate_pair("medium"))
        complexity_counts["medium"] += 1

    for _ in range(complex_count):
        entries.append(generate_pair("complex"))
        complexity_counts["complex"] += 1

    # Shuffle to mix complexities
    random.shuffle(entries)

    return entries, complexity_counts


def write_jsonl(entries: list[dict], path: Path) -> None:
    """Write entries to a JSONL file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for entry in entries:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")


# ── Main ─────────────────────────────────────────────────────────

def main():
    random.seed(42)

    print("Generating JSON Schema -> TypeScript corpus ...")

    # Generate training set
    train_entries, train_dist = generate_corpus(10_000)
    print(f"  Training set: {len(train_entries)} entries")
    print(f"    Distribution: {train_dist}")

    # Generate holdout set
    holdout_entries, holdout_dist = generate_corpus(2_500)
    print(f"  Holdout set: {len(holdout_entries)} entries")
    print(f"    Distribution: {holdout_dist}")

    # Verify a few entries
    print("\n  Sample entries:")
    for i in range(3):
        entry = train_entries[i]
        print(f"    [{i}] Input:  {entry['input'][:80]}...")
        print(f"         Output: {entry['output'][:80]}...")

    # Check token length stats
    input_lengths = [len(e["input"]) for e in train_entries]
    output_lengths = [len(e["output"]) for e in train_entries]
    total_lengths = [len(e["input"]) + len(e["output"]) for e in train_entries]

    print(f"\n  Character length stats (training):")
    print(f"    Input  — min: {min(input_lengths)}, max: {max(input_lengths)}, "
          f"mean: {sum(input_lengths)/len(input_lengths):.0f}")
    print(f"    Output — min: {min(output_lengths)}, max: {max(output_lengths)}, "
          f"mean: {sum(output_lengths)/len(output_lengths):.0f}")
    print(f"    Total  — min: {min(total_lengths)}, max: {max(total_lengths)}, "
          f"mean: {sum(total_lengths)/len(total_lengths):.0f}")

    # Write files
    write_jsonl(train_entries, TRAIN_PATH)
    write_jsonl(holdout_entries, HOLDOUT_PATH)

    print(f"\n  Written to:")
    print(f"    {TRAIN_PATH}")
    print(f"    {HOLDOUT_PATH}")
    print("\nDone.")


if __name__ == "__main__":
    main()
