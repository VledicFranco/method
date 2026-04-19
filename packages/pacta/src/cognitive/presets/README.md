# cognitive/presets/ — Pre-Built Cognitive Configurations

Ready-to-use cognitive compositions for common agent profiles. Each preset is a validated `CognitiveComposition` ready to pass to `createCognitiveAgent()`.

## Presets

| Preset | Description |
|--------|-------------|
| `enriched` | Full cognitive stack: memory + planning + monitoring + reflection. High quality, higher cost. |
| `affectExplore` | Affect-module augmented exploration: curiosity-driven with emotional state tracking (RFC 001 research preset) |

## Usage

```typescript
import { enriched } from '@methodts/pacta/cognitive/presets';
import { createCognitiveAgent } from '@methodts/pacta/cognitive/engine';

const agent = createCognitiveAgent({ composition: enriched, provider });
```

## Design

Presets are the recommended entry point for cognitive agent creation. Direct algebra composition is available for custom configurations, but presets encode validated module combinations that have been empirically tested (see `experiments/exp-cognitive-baseline/`).
