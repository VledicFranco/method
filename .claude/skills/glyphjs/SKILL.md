---
name: glyphjs
description: |
  GlyphJS authoring reference. Load when creating, editing, or advising on GlyphJS documents —
  Markdown files that embed interactive ui: components (charts, graphs, tables, timelines, KPIs,
  architecture diagrams, and more). Use when the user asks to "create a document", "add a chart",
  "make a dashboard", "visualize data", or any task involving ui: blocks. Also applies when
  auditing GlyphJS docs for overuse, schema errors, or structural problems.
---

# GlyphJS — Authoring Reference

GlyphJS turns Markdown into interactive visual documents. Authors write regular Markdown with embedded `ui:*` fenced code blocks (YAML data); the pipeline compiles them to React components at render time.

**Pipeline:** Markdown → Parser → AST → Compiler → IR → Runtime (React) → UI

---

## When to Use Components

**Use a component when:**
- Data has structure that a table, chart, or diagram conveys faster than prose
- The reader needs to interact (sort, filter, drill down)
- Visual hierarchy genuinely aids comprehension (steps, timelines, architecture)
- You're presenting metrics, comparisons, or relationships between entities

**Do NOT use a component when:**
- A sentence or short paragraph communicates the same thing just as clearly
- You're wrapping prose in a `ui:callout` just to make it look important
- The data set is 2-3 numbers (just write them inline)
- The structure is forced — component overuse buries the narrative
- You have more than 3-4 components per document section (cognitive load)

**Rule of thumb:** a document should be readable as plain Markdown with the `ui:` blocks removed. If the prose doesn't hold up without the components, rewrite the prose.

---

## Component Menu (32 total)

### Layout
| Type | Use for |
|---|---|
| `ui:columns` | Arrange blocks side by side with proportional `ratio` widths |
| `ui:rows` | Stack blocks vertically; nestable inside column cells for 2D layouts |
| `ui:panel` | Wrap a block in a styled container: `card`, `bordered`, `elevated`, `ghost` |

Layout components use **suppressed block variables** — define child blocks with `=_name`, reference by name in `children`/`child`. See Variables & Layouts section below.

### Data Visualization
| Type | Use for |
|---|---|
| `ui:chart` | Line, bar, area, OHLC time series — any quantitative trend or comparison |
| `ui:table` | Structured tabular data with sorting/filtering |
| `ui:graph` | Node-edge relationship graphs (force-directed layout) |
| `ui:relation` | Entity relationship diagrams |
| `ui:architecture` | System architecture diagrams with zones and connections |

### Narrative & Progress
| Type | Use for |
|---|---|
| `ui:timeline` | Chronological events, roadmaps, history |
| `ui:steps` | Sequential how-to instructions or processes |
| `ui:flowchart` | Decision trees, conditional flows |
| `ui:sequence` | Message sequence / protocol diagrams |
| `ui:mindmap` | Topic hierarchies and concept maps |

### Info Display
| Type | Use for |
|---|---|
| `ui:callout` | Highlighted tips, warnings, notes, info boxes |
| `ui:kpi` | Key metrics with labels, values, and trend indicators |
| `ui:card` | Individual content card with title, body, optional image |
| `ui:accordion` | Collapsible FAQ or detail sections |
| `ui:comparison` | Side-by-side option comparisons |
| `ui:infographic` | Mixed visual layout — icons, stats, mini-charts |

### Code & Markup
| Type | Use for |
|---|---|
| `ui:codediff` | Before/after code diffs with syntax highlighting |
| `ui:equation` | LaTeX math equations |
| `ui:filetree` | Directory/file hierarchy |

### Interactive & Input
| Type | Use for |
|---|---|
| `ui:tabs` | Tabbed content panels |
| `ui:quiz` | Multiple-choice questions with feedback |
| `ui:poll` | Single-question voting |
| `ui:rating` | Star rating input |
| `ui:ranker` | Drag-to-rank ordered list |
| `ui:slider` | Numeric range input |
| `ui:matrix` | Grid of options (rows × columns) |
| `ui:form` | Multi-field input form |
| `ui:kanban` | Kanban board with columns and cards |
| `ui:annotate` | Image or diagram with click-to-annotate overlay |

---

## YAML Syntax Quick Reference

```markdown
```ui:chart
title: Revenue by Quarter        # optional but recommended
type: bar                        # line | bar | area | ohlc
xAxis:
  key: quarter
  label: Quarter
yAxis:
  key: revenue
  label: Revenue ($k)
series:
  - name: 2025
    data:
      - { quarter: Q1, revenue: 120 }
      - { quarter: Q2, revenue: 145 }
```
```

**Key rules:**
- YAML is strict — indent with 2 spaces, no tabs
- String values with special characters need quotes
- Arrays of objects: `- { key: value }` or multiline `- \n  key: value`
- `markdown: true` enables inline markdown (`**bold**`, `_italic_`, `[links]()`) in text fields

---

## Variables & Layouts (v0.9.0)

### Scalar variables
Define in frontmatter or a `ui:vars` block, reference with `{{key}}`:

```markdown
---
vars:
  product: Acme Pro
  version: "2.4"
---

Released **{{product}}** version {{version}}.
```

### Block variables & suppressed blocks

```markdown
```ui:callout=status          ← renders AND binds to "status"
type: info
content: All systems nominal.
```

```ui:kpi=_metrics            ← suppressed: compiled but NOT rendered here
metrics:
  - label: Uptime
    value: "99.97%"
    trend: up
```

{{status}}                    ← expands a clone of the "status" block here
```

### Layout components (columns / rows / panel)

Children must be **suppressed** (`=_name`) and defined **before** the layout block:

```markdown
```ui:callout=_left
type: tip
content: Left side.
```

```ui:kpi=_right
metrics:
  - label: MRR
    value: $48k
    trend: up
```

```ui:columns
ratio: [2, 1]
gap: 1.5rem
children: [left, right]
```
```

Nest `ui:rows` inside a column cell for 2D layouts:

```markdown
```ui:rows=_stack
gap: 1rem
children: [top, bottom]
```

```ui:columns
ratio: [3, 2]
children: [main, stack]
```
```

### Parameterized templates

```markdown
```ui:callout=_alert(level,msg)
type: {{level}}
content: "{{msg}}"
```

{{alert("warning", "Deployment window starts in 1 hour.")}}
{{alert("error", "Service degraded — investigating.")}}
```

---

## CLI Reference

```bash
# Validate blocks before rendering — catch schema errors early
glyphjs lint doc.md
glyphjs lint doc.md --format json   # structured output for tooling
glyphjs lint doc.md --strict        # warnings become errors

# Get the JSON Schema for any component (for authoring assistance)
glyphjs schemas chart
glyphjs schemas --list              # all 32 type names
glyphjs schemas --all               # dump all schemas as JSON

# Compile to IR (JSON) — useful for debugging
glyphjs compile doc.md

# Export — PDF options
glyphjs export doc.md --format pdf -o output.pdf
glyphjs export doc.md --format pdf --page-size A4 --landscape -o output.pdf
glyphjs export doc.md --format pdf --continuous -o output.pdf   # single tall page
glyphjs export doc.md --format pdf --margin "0.75in 1in" --padding "2rem" -o output.pdf
glyphjs export doc.md --format pdf --theme dark --theme-file themes/catppuccin-mocha.yml -o output.pdf

# Export — other formats
glyphjs export doc.md --format html -o output.html
glyphjs export doc.md --format md --images-dir ./imgs -o output.md   # PNG images

# Render individual blocks as PNG
glyphjs render doc.md -o ./screenshots/ --device-scale-factor 2

# Live dev server with hot reload
glyphjs serve doc.md
```

**Available themes** (pass via `--theme-file themes/<name>.yml`):
`default` · `dark` · `minimal` · `high-contrast` · `warm` · `catppuccin-mocha` · `tokyo-night` · `solarized-dark` · `gruvbox-dark` · `nord` · `dracula` · `one-dark`

**Always lint before exporting.** Exit code 0 = clean, 1 = errors, 2 = I/O failure.

---

## Common Patterns

### KPI dashboard header
```yaml
```ui:kpi
metrics:
  - label: Total Users
    value: "12,400"
    trend: up
  - label: Churn Rate
    value: "2.1%"
    trend: down
  - label: MRR
    value: "$48k"
    trend: up
```
```

### Comparison table alternative
```yaml
```ui:comparison
left:
  label: Option A
  points:
    - Simple to implement
    - Lower cost
right:
  label: Option B
  points:
    - More scalable
    - Better DX
```
```

### Callout types
```yaml
type: info | warning | error | success | tip
```

### Chart types
```yaml
type: line | bar | area | ohlc
```

### Architecture zones
```yaml
```ui:architecture
title: System Overview
nodes:
  - id: api
    label: API Gateway
    group: edge
  - id: svc
    label: Auth Service
    group: backend
edges:
  - from: api
    to: svc
    label: JWT
```
```

---

## Anti-Patterns

- **Component soup** — 8+ components in a single section with minimal prose. Adds noise, not clarity.
- **Callout inflation** — Every paragraph wrapped in a callout. They lose meaning when overused.
- **Chart for 3 data points** — Just write "Revenue grew from $40k → $48k → $55k across Q1–Q3."
- **Steps for 2 steps** — "First do X, then do Y" is cleaner as a sentence.
- **Empty title fields** — Always include `title:` on charts and diagrams; untitled visuals are disorienting.
- **Skipping lint** — Schema errors silently fall back to error cards in the renderer. Always lint.
