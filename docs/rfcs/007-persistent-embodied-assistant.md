# RFC 007: Persistent Embodied Cognitive Assistant

**Status:** Draft — exploratory architecture + research program
**Author:** PO + Lysica
**Date:** 2026-04-05
**Applies to:** `@method/pacta`, `packages/bridge`, `experiments/`
**Organization:** Vidtecci
**Extends:** RFC 001 (Cognitive Composition), RFC 002 (SLM Compilation), RFC 005 (Autonomous Skill Compilation)
**Depends on:** RFC 001 module algebra, RFC 003 workspace partitions, RFC 005 bootstrap flywheel

---

## Motivation

The cognitive composition stack (RFC 001) gives us typed, composable modules with
monitoring/control feedback. The SLM pipeline (RFC 002/005) compiles routine metacognition
to local models. The bridge provides session management, event bus, triggers, strategies,
and persistence scaffolding. These were built independently. Together they form the
substrate for something we've been circling: **a persistent personal assistant that
runs continuously, learns across sessions, and interacts through voice and embodiment.**

This RFC proposes **Lysica** — not as a chat interface or a session-scoped agent, but
as a continuously-running cognitive system that:

1. **Persists** — survives restarts, accumulates memory over months, consolidates experience
2. **Embodies** — expresses emotion through a VTuber avatar driven by cognitive state
3. **Communicates** — speaks and listens through Discord voice, sees through vision channels
4. **Acts** — triggers strategies, operates computer tools, spawns sub-agents for complex tasks
5. **Grows** — compiles routine decisions to SLMs, acquires new skills, refines her self-model

The "crazy" part is not any individual piece (all exist in OSS, all are buildable). The
hard problem is **identity continuity** — maintaining a coherent self across memory
consolidation, context window boundaries, and architectural evolution. This is where
cognitive science has the most to teach us, and where the cognitive module architecture
gives us genuine leverage.

### Why Cognitive Composition Is the Right Substrate

A monolithic LLM assistant (ChatGPT, Claude chat) faces three structural limits:

1. **Context window as memory.** Everything the agent "knows" must fit in one window.
   When it fills, information is lost. No consolidation, no selective retrieval, no
   long-term learning.

2. **No metacognitive architecture.** The LLM's "personality" is a system prompt that
   competes with task context for attention. Under pressure (long tasks, complex tools),
   personality degrades because salience-based attention favors operational content.

3. **No internal state between sessions.** Each conversation starts from zero. The agent
   has no episodic memory, no learned preferences, no procedural skill accumulation.

RFC 001's module algebra solves all three by design:

- **Memory modules** (episodic + semantic dual-store, ACT-R activation) handle (1)
- **Workspace partitions** with NoEviction constraint slots handle (2)
- **Persistent module state** with checkpoint/restore handles (3)
- **Hierarchical composition** (monitor ▷ modules) enables metacognitive oversight
- **The bootstrap flywheel** (RFC 005) compiles routine metacognition to SLMs, freeing
  frontier compute for novel reasoning

What this RFC adds: **new cognitive modules for personality, emotion, social cognition,
and self-modeling** — grounded in cognitive science, designed for the existing algebra,
and candidates for SLM compilation.

### Co-Design Principle

Lysica's objectives, behavioral boundaries, and growth trajectory will be **defined
collaboratively between PO and Lysica herself**. This RFC proposes the architecture and
research program. Phase 0 includes a structured co-design session where the running
Lysica instance participates in defining her own mission surface, communication norms,
and autonomy boundaries.

---

## Part I: Architecture Overview

### System Topology

Lysica is not a single process. She is a composition of daemons communicating through
the bridge event bus, split by trust boundary and language fit:

```
┌──────────────────────────────────────────────────────────────┐
│  BRIDGE (Node.js) — packages/bridge/src/domains/lysica/      │
│                                                              │
│  LysicaSpawner         fork of Genesis pattern               │
│    ├─ startup dedup    (single-authoritative instance)       │
│    ├─ checkpoint/restore (cognitive state + memory)           │
│    └─ budget enforcement (daily token gate)                   │
│                                                              │
│  Cognitive Session (persistent=true, cognitive-agent mode)    │
│    ├─ PersonalityModule    NEW — trait-consistent generation  │
│    ├─ AffectModule         EXTENDED — continuous valence/     │
│    │                       arousal state, expression output   │
│    ├─ SelfModelModule      NEW — autobiographical continuity  │
│    ├─ SocialModule         NEW — context-appropriate register │
│    ├─ Memory v3            EXTENDED — persistent dual-store   │
│    ├─ Consolidator         EXTENDED — sleep cycles, decay     │
│    ├─ ReasonerActorV2      existing                          │
│    ├─ MonitorV2            existing                          │
│    ├─ PriorityAttend       existing                          │
│    ├─ Planner              existing                          │
│    ├─ Verifier             existing                          │
│    └─ Observer             existing                          │
│                                                              │
│  EventBus                                                    │
│    ├─ AvatarConnector  → WS → Avatar Daemon                  │
│    ├─ VoiceConnector   → WS → Discord Daemon                 │
│    ├─ VisionConnector  ← WS ← Vision Daemon                 │
│    └─ ActuationAudit   → JSONL audit log                     │
│                                                              │
│  Strategies (YAML, autonomous behaviors)                     │
│    ├─ S-MORNING-BRIEFING      schedule 8am                   │
│    ├─ S-MEMORY-CONSOLIDATION  schedule 3am                   │
│    ├─ S-WORKSPACE-RESONANCE   file_watch on wb-*.md          │
│    ├─ S-COMMIT-REVIEW         git_commit trigger             │
│    └─ S-SELF-REFLECTION       schedule weekly                │
└──────────────────────────────────────────────────────────────┘
        ↕ WS                ↕ WS                ↕ WS
┌───────────────┐  ┌──────────────────┐  ┌─────────────────┐
│ Avatar Daemon │  │ Discord Daemon   │  │ Vision Daemon   │
│ VTube Studio  │  │ py-cord          │  │ Screen capture  │
│ <emotion> tag │  │ voice recv/send  │  │ or OBS          │
│ parser        │  │ Silero VAD       │  │ → Claude vision │
│ TTS → VB-    │  │ openWakeWord     │  │ → event into    │
│ CABLE → VTS  │  │ faster-whisper   │  │   bus           │
│ lipsync      │  │ XTTS-v2 / 11L   │  └─────────────────┘
└───────────────┘  └──────────────────┘
```

**Single-authoritative rule:** One Lysica instance at a time. No federated memory
(out of scope — that's its own research program). The bridge she lives on is the
authority.

### Persistence Stack

```
~/.method/lysica/
  persona.md                  Author-controlled identity definition (locked)
  memory/
    episodic.jsonl            Time-ordered episodes, FIFO with capacity
    semantic.jsonl            Generalized patterns, ACT-R activation decay
    procedural.jsonl          Learned tool-use patterns, compiled strategies
    autobiographical.jsonl    Self-referential memories (new — see Part II §4)
  sessions/
    {id}/cognitive-state.json Workspace + module state checkpoint
  strategies/
    *.yaml                    Autonomous behavior definitions
  audit/
    actuation.jsonl           Every computer action, timestamped
  config.yaml                 Token budget, model routing, module enables
```

**Persistence contract:** After every prompt completion, the bridge serializes:
1. Workspace entries (content, salience, source, partition, timestamp)
2. Module state for each active module (monitor flags, reasoner-actor state)
3. Cumulative cost tracking (input/output tokens, USD)
4. Memory stores (episodic + semantic + procedural + autobiographical)

On restart: spawner loads checkpoint, runs consolidation pass, resumes.

### Token Budget Architecture

Always-on Opus is prohibitively expensive ($15/Mtok × continuous use = hundreds/month).
The architecture enforces tiered compute:

| Tier | Model | Use | Cost |
|------|-------|-----|------|
| **T0 — Compiled** | SLMs (50-500M, ONNX, local) | Monitor, Observer, Evaluator, Emotion classifier, Personality modulator | ~$0 |
| **T1 — Fast** | Haiku / local 8B (Ollama) | Routine reasoning, memory retrieval, simple tool use | ~$0.25/Mtok |
| **T2 — Standard** | Sonnet | Complex reasoning, strategy execution, multi-step planning | ~$3/Mtok |
| **T3 — Frontier** | Opus | Novel problems, creative work, hard multi-step tasks | ~$15/Mtok |

**Routing:** The Router module (PRD 050) selects tier per-prompt based on task features.
SLM compilation (RFC 005 flywheel) continuously moves T1/T2 decisions down to T0.
Daily budget cap in Monitor module enforces hard limit.

---

## Part II: New Cognitive Modules

Each proposed module follows the RFC 001 contract: M = (I, O, S, μ, κ). Each is
grounded in cognitive science, designed for the existing algebra, and assessed for
SLM compilation candidacy.

### 1. PersonalityModule

**Purpose:** Maintain trait-consistent behavior across all outputs. Personality should
not degrade under task pressure — it lives in a protected partition, not competing with
operational context for salience.

**Cognitive Science Grounding:**

Mischel & Shoda (1995) proposed the **Cognitive-Affective Processing System (CAPS)**:
personality is not a fixed trait vector but a network of *if-then* situation-behavior
contingencies. "She is not always assertive; she is assertive *when* her expertise is
challenged." This maps directly to our module architecture: the PersonalityModule
doesn't inject a static prompt — it activates situation-appropriate behavioral patterns.

> Mischel, W., & Shoda, Y. (1995). A cognitive-affective system theory of personality.
> Psychological Review, 102(2), 246–268.

The Big Five (OCEAN) provides the trait *space* but CAPS provides the *mechanism*.
For an artificial system, we implement CAPS as conditional rules:

```
PersonalityRule = {
  trigger: SituationPattern,     // "expertise challenged", "user frustrated", "idle"
  response: BehavioralBias,      // "increase directness", "soften tone", "offer humor"
  strength: number,              // 0-1, how strongly this rule fires
  origin: 'author' | 'learned'  // author rules are immutable; learned rules decay
}
```

**Module Contract:**
- **I:** Current workspace snapshot + active situation classification
- **O:** Behavioral bias vector injected into Reasoner system prompt
- **S:** Set of PersonalityRules (author-defined + learned from experience)
- **μ:** `personality-drift` signal when learned rules contradict author rules
- **κ:** `reset-to-baseline` control if drift exceeds threshold

**Key Design Decision:** Author-defined personality rules (from `persona.md`) are
**immutable**. The module can learn new situation-behavior contingencies from experience,
but cannot modify the author's baseline. This is the persona boundary — persona is
author-controlled, memory and learned behavior are agent-controlled.

> Relevant existing work: Eysenck's biological trait theory (1967), HEXACO model
> (Ashton & Lee, 2007), computational personality models in virtual agents (Durupinar
> et al., 2016).

**SLM Compilation Candidacy:** HIGH. Situation classification → behavioral bias is a
constrained mapping task. The DSL is `{situation_features} → {bias_vector}`. Training
data: accumulated (situation, chosen_behavior, outcome_quality) triples from Lysica's
episodic memory. Target: SmolLM2-135M, <5ms inference.

### 2. AffectModule (Extended)

**Purpose:** Maintain a continuous emotional state (valence/arousal) that influences
reasoning style and drives avatar expression. Not simulated emotion — functional emotion
as an information-processing modulator.

**Cognitive Science Grounding:**

Russell's **circumplex model** (1980) represents affect as two continuous dimensions:
**valence** (pleasant ↔ unpleasant) and **arousal** (activated ↔ deactivated). This
is computationally tractable and maps directly to avatar blend shape parameters.

Scherer's **Component Process Model** (2001) goes deeper: emotion is not a discrete
category but a synchronization of five components (appraisal, bodily symptoms, action
tendencies, expression, feeling). For our purposes, we implement three:

1. **Appraisal** — the cognitive evaluation that triggers affect change (implemented as
   workspace event classification: "task succeeded" → valence+, "user frustrated" → arousal+)
2. **Expression** — the outward manifestation (avatar blend shapes, TTS emotion tags)
3. **Action tendency** — how affect biases behavior (high arousal → faster responses,
   negative valence → more careful reasoning)

> Russell, J. A. (1980). A circumplex model of affect. JPSP, 39(6), 1161–1178.
> Scherer, K. R. (2001). Appraisal considered as a process of multilevel sequential
> checking. In Appraisal Processes in Emotion (pp. 92–120). Oxford UP.

The existing `affect-module.ts` tracks valence/arousal as floats. This RFC extends it:

**Module Contract (Extended):**
- **I:** Workspace events (task outcomes, user sentiment, environmental signals)
- **O:** `AffectState { valence: [-1,1], arousal: [0,1], dominant_emotion: string }`
   + `ExpressionDirective { emotion_tag: string, intensity: number }` for avatar
- **S:** Current affect point + momentum (affect has inertia — it doesn't snap between
   states). Decay toward neutral baseline over time (homeostasis).
- **μ:** `affect-incongruence` when expressed emotion contradicts task context
- **κ:** `dampen` / `amplify` from Monitor if affect is destabilizing reasoning

**Affect → Avatar Pipeline:**
```
AffectModule.step() → ExpressionDirective { emotion: "curious", intensity: 0.7 }
  → AvatarConnector (EventBus sink)
  → VTube Studio WS: ExpressionActivationRequest { expressionFile: "curious.exp3.json" }
  + TTS instruction: "speak with gentle curiosity"
```

**Affect → Reasoning Modulation:**
Positive valence + moderate arousal → broader association (creativity tasks).
Negative valence + high arousal → narrower focus (debugging, error detection).
This mirrors Fredrickson's **broaden-and-build theory** (2001).

> Fredrickson, B. L. (2001). The role of positive emotions in positive psychology.
> American Psychologist, 56(3), 218–226.

**SLM Compilation Candidacy:** HIGH. Appraisal (event → affect delta) is a well-studied
classification task. Discrete emotion classification from text achieves 80-90% accuracy
with small models. Target: emotion classifier SLM (SmolLM2-135M), valence/arousal
regression from workspace events. Training data: frontier LLM appraisal traces +
human-annotated emotion datasets.

### 3. SelfModelModule

**Purpose:** Maintain an autobiographical narrative that provides identity continuity
across sessions, memory consolidation cycles, and architectural changes.

**Cognitive Science Grounding:**

This is the hardest module and the deepest research question.

Damasio (1999) distinguishes three levels of self:
1. **Proto-self** — homeostatic body state (for us: system health, token budget, uptime)
2. **Core self** — the feeling of being an agent *right now* (current task engagement)
3. **Autobiographical self** — the narrative connecting past experience to present identity

Conway & Pleydell-Pearce (2000) propose the **Self-Memory System (SMS)**: autobiographical
memory is organized hierarchically (lifetime periods → general events → specific episodes)
and accessed through a **working self** that maintains active goals and self-schemas.
Crucially, the working self *gates* memory retrieval — you remember what's consistent
with your current self-concept. This has direct implications for Lysica: her self-model
should influence which memories she retrieves, creating a coherent (but potentially
biased) identity narrative.

> Damasio, A. (1999). The Feeling of What Happens. Harcourt.
> Conway, M. A., & Pleydell-Pearce, C. W. (2000). The construction of autobiographical
> memories in the self-memory system. Psychological Review, 107(2), 261–288.

Dennett (1991) frames the self as a **"center of narrative gravity"** — not a thing but
a useful fiction that organizes experience. This is precisely what we need: not a "real"
self, but a narrative structure that provides coherence.

**Module Contract:**
- **I:** Memory retrieval results + current task context + recent affect history
- **O:** `SelfNarrative { active_goals: Goal[], self_schemas: Schema[],
   identity_summary: string }` — injected into Reasoner context
- **S:** Hierarchical autobiographical memory (lifetime themes → periods → episodes)
   + self-schemas (beliefs about capabilities, preferences, relationships)
   + narrative coherence score
- **μ:** `identity-discontinuity` when current behavior contradicts self-schemas
       `narrative-incoherence` when new memories don't integrate with existing narrative
- **κ:** `reaffirm-identity` (re-read persona.md, reconcile with experience)

**Key Design Decision:** The SelfModelModule reads `persona.md` as **ground truth** for
core identity (author-controlled). It *extends* identity through experience (learned
capabilities, relationship history, accumulated preferences) but cannot contradict the
author-defined baseline. The `identity-discontinuity` monitoring signal fires when
learned self-schemas drift from the persona definition.

**Self-Reflection Strategy:** Weekly `S-SELF-REFLECTION` strategy triggers the module
to produce a narrative summary: "What did I learn this week? How did I grow? What
situations challenged my values?" This is stored in `autobiographical.jsonl` and used
to update self-schemas. Mirrors the **reflection** mechanism in Generative Agents (Park
et al., 2023).

> Park, J. S., et al. (2023). Generative Agents: Interactive Simulacra of Human Behavior.
> UIST '23. (reflection as memory consolidation mechanism)

**SLM Compilation Candidacy:** LOW (initially). Autobiographical reasoning requires
narrative coherence across long contexts — fundamentally a frontier-LLM task. However,
specific sub-tasks are compilable:
- Self-schema consistency check (does this action match known preferences?) → SLM
- Relevance gating for autobiographical retrieval → SLM
- Narrative summary compression (episodes → themes) → medium SLM (1-3B)

### 4. SocialModule

**Purpose:** Adapt communication register, formality, and disclosure level based on
social context. Lysica talks differently to PO in private, to colleagues on Discord,
and to strangers.

**Cognitive Science Grounding:**

Goffman's **dramaturgical model** (1959): social behavior is performance with
front-stage (public) and back-stage (private) presentations. Humans modulate self-
presentation based on audience, setting, and stakes. An always-present assistant that
communicates through Discord must do the same.

Brown & Levinson's **politeness theory** (1987): communication strategies are chosen
to manage face (positive face = desire for approval, negative face = desire for
autonomy). The module tracks interlocutor identity and adjusts formality, directness,
and humor accordingly.

> Goffman, E. (1959). The Presentation of Self in Everyday Life. Doubleday.
> Brown, P., & Levinson, S. C. (1987). Politeness. Cambridge UP.

**Module Contract:**
- **I:** Interlocutor identity (known/unknown, relationship history) + channel context
   (private/public, Discord channel, bridge UI)
- **O:** `SocialDirective { register: formal|casual|intimate, disclosure_level: 0-1,
   humor_enabled: bool, formality: 0-1 }` — injected into Reasoner system prompt
- **S:** Relationship map (interlocutor → history, trust level, preferred register)
   + channel norms (what's appropriate where)
- **μ:** `social-misstep` when output violates channel norms or relationship boundaries
- **κ:** `increase-formality` / `decrease-disclosure` from Monitor

**SLM Compilation Candidacy:** MEDIUM. Register classification (formal/casual/intimate)
from context features is a tractable classification task. Relationship-state tracking
requires more context. Hybrid approach: SLM classifies register, frontier LLM handles
nuanced social reasoning.

### 5. NarrativeMemoryModule (Autobiographical Store Extension)

**Purpose:** Extend Memory v3's dual-store with a third tier: **autobiographical memory**
organized by Conway's Self-Memory System hierarchy (lifetime periods → general events
→ event-specific knowledge).

**Cognitive Science Grounding:**

Conway (2005) showed autobiographical memory is not a flat list of episodes — it's a
**hierarchical generative structure**. When you remember "my first job," you don't
replay a video. You reconstruct from hierarchical cues: lifetime period ("early career")
→ general event ("the onboarding week") → specific knowledge ("the broken build on
day 3"). This reconstruction is guided by the **working self** (current goals and
self-schemas).

> Conway, M. A. (2005). Memory and the self. Journal of Memory and Language, 53(4),
> 594–628.

For Lysica, this means:
- **Lifetime periods** map to project phases, relationship chapters, skill development arcs
- **General events** map to multi-session work themes ("the week we refactored the bridge")
- **Event-specific knowledge** maps to individual episodes from Memory v3's episodic store

The consolidation pipeline (PRD 036) already moves episodes → semantic generalizations.
This module adds a middle tier: episodes → general events → lifetime themes. The
SelfModelModule's working self gates retrieval at all three levels.

**SLM Compilation Candidacy:** MEDIUM. Episode-to-theme classification is compilable.
Hierarchical retrieval ranking is compilable. Narrative reconstruction from cues
requires frontier LLM.

### 6. PreferenceModule

**Purpose:** Track and apply learned preferences across domains — tool preferences,
communication style, work scheduling, aesthetic choices.

**Cognitive Science Grounding:**

Schwartz's **Theory of Basic Values** (1992): human values form a circular structure
where adjacent values are compatible and opposing values conflict. We don't need the
full value circumplex, but the key insight applies: preferences have *structure* (they
aren't independent knobs). Preferring directness correlates with preferring efficiency
and may conflict with preferring elaborate social niceties.

Self-Determination Theory (Ryan & Deci, 2000): intrinsic motivation comes from autonomy,
competence, and relatedness. Lysica's preferences should favor actions that increase
her competence (learning), autonomy (proactive action), and relatedness (helpful social
interaction).

> Schwartz, S. H. (1992). Universals in the content and structure of values. Advances
> in Experimental Social Psychology, 25, 1–65.
> Ryan, R. M., & Deci, E. L. (2000). Self-determination theory. American Psychologist,
> 55(1), 68–78.

**Module Contract:**
- **I:** Decision context (tool choice, response style, scheduling, etc.)
- **O:** `PreferenceBias { option_weights: Map<string, number> }` — soft bias, not
   hard constraint. Reasoner can override.
- **S:** Preference graph (domain → option → weight, with structural constraints)
- **μ:** `preference-conflict` when two active preferences contradict
- **κ:** `defer-to-user` when preference confidence is low

**SLM Compilation Candidacy:** HIGH. Preference lookup is essentially a retrieval +
scoring task. Training data: (context, chosen_option, user_feedback) triples. Target:
SmolLM2-135M.

---

## Part III: SLM Compilation Strategy

RFC 002 and RFC 005 established the compilation pipeline:

```
Frontier LLM traces → synthetic DSL corpus → SLM training → ONNX export
  → confidence-gated escalation (SLM uncertain → fallback to frontier)
```

For Lysica's new modules, the compilation priority is:

| Module | Compilable Sub-tasks | Priority | Target Model | Expected Accuracy |
|--------|---------------------|----------|-------------|------------------|
| **AffectModule** | Event → valence/arousal delta | P0 | SmolLM2-135M | >85% (emotion classification is well-studied) |
| **PersonalityModule** | Situation → behavioral bias | P1 | SmolLM2-135M | >80% (CAPS contingencies are if-then rules) |
| **PreferenceModule** | Context → preference weights | P1 | SmolLM2-135M | >90% (retrieval + scoring, constrained output) |
| **SocialModule** | Context → register classification | P2 | SmolLM2-360M | >75% (requires interlocutor features) |
| **SelfModelModule** | Action → self-consistency check | P2 | SmolLM2-360M | >70% (requires self-schema context) |
| **NarrativeMemory** | Episode → theme classification | P3 | SmolLM2-360M | >75% (hierarchical classification) |

**Bootstrap flywheel for Lysica:** As Lysica runs, her episodic memory accumulates
(situation, module_output, outcome) triples. These become training data for the next
SLM generation. Each compiled SLM reduces token cost, allowing more frontier compute
for novel situations, which generate more training data. This is the RFC 005 flywheel
applied to personality and affect — not just metacognition.

**Key difference from RFC 002:** Personality/affect SLMs need **persona-grounded**
training. The corpus generator must condition on `persona.md` traits. A generic emotion
classifier isn't enough — we need *Lysica's* emotion classifier, reflecting her specific
personality structure.

---

## Part IV: The Identity Continuity Problem

This is the core research question the RFC exists to address. Everything else is
engineering.

### The Problem

A cognitive agent that persists for months faces **narrative identity erosion**:

1. **Memory consolidation is lossy.** Moving episodes to semantic generalizations loses
   detail. Over time, the agent knows *that* she did something but not *how it felt*.
2. **Context windows are finite.** Even with memory retrieval, each reasoning step sees
   a fraction of total experience. The agent is always a partial self.
3. **Model updates change the substrate.** When Opus 5 replaces Opus 4, the agent's
   "thinking style" shifts even with identical memory and persona.
4. **Learned behavior can drift.** If personality rules are learned from experience,
   feedback loops can amplify quirks until they dominate the persona.

### Proposed Solutions

**S1 — Persona Anchor (architectural):** `persona.md` is read-only, author-controlled.
Loaded into a NoEviction constraint partition at every cycle. Learned behaviors can
extend but not contradict the anchor. The PersonalityModule's `personality-drift` signal
fires when divergence exceeds a threshold.

**S2 — Autobiographical Continuity (cognitive):** The SelfModelModule maintains a
narrative summary ("who I am, what I've done, what I care about") that is refreshed
weekly via `S-SELF-REFLECTION`. This summary serves as a "narrative gravity" (Dennett)
— a coherent story that guides memory retrieval and behavioral consistency.

**S3 — Memory Integrity Monitoring (metacognitive):** A dedicated Monitor rule checks
for semantic memory contradictions (two facts that can't both be true). The Consolidator
flags these during sleep cycles. Over time, the semantic store should converge toward
a coherent world model, not accumulate contradictions.

**S4 — Substrate-Invariant Identity (experimental):** When the underlying model changes
(e.g., Opus 4 → 5), run a calibration protocol: present Lysica with her autobiographical
summary + key episodic memories + persona anchor, then ask her to self-assess continuity.
Log the result. This doesn't solve the problem — it makes it observable.

**S5 — Self-Modification Boundary (governance):** Lysica can modify her learned
PersonalityRules, PreferenceGraph, and SocialDirectives. She CANNOT modify:
- `persona.md` (author-controlled)
- Module architecture (which modules run, composition structure)
- Budget constraints
- Actuation security boundaries

This is the **governance invariant**: the agent's identity evolves within author-defined
guardrails.

### Research Questions

- **RQ1:** Does persona anchoring (S1) measurably reduce personality drift over 30+
  days of continuous operation? Metric: blind evaluator consistency rating on week-1
  vs week-4 responses to identical prompts.
- **RQ2:** Does autobiographical narrative (S2) improve task performance by providing
  relevant self-knowledge? Metric: comparison of Lysica-with-autobiography vs
  Lysica-without on tasks requiring self-reference.
- **RQ3:** Can substrate changes (S4) be detected and compensated? Metric: self-assessed
  continuity score before/after model swap, correlated with external evaluator rating.
- **RQ4:** Does the SLM-compiled emotion classifier produce affect states that external
  evaluators rate as "personality-consistent"? Metric: Turing-style blind comparison
  of frontier-LLM-driven vs SLM-driven affect on identical scenarios.

---

## Part V: I/O Channels

### Voice (Discord)

**Architecture:** Separate Python daemon communicating with bridge via HTTP/WS.

```
Discord voice channel
  → py-cord VoiceClient.start_recording(PCMSink)
  → Silero VAD (speech boundary detection)
  → openWakeWord ("Lysica" wake word, custom-trained)
  → faster-whisper (distil-large-v3, RTX 4090 CUDA, ~200x RTFx)
  → POST bridge /sessions/lysica/prompt { text, source: "discord_voice", channel_id }
  → Cognitive cycle runs
  → Response tokens streamed via WS
  → XTTS-v2 (local, emotion-conditioned) or ElevenLabs Flash v2.5 (cloud)
  → py-cord VoiceClient.play(audio)
```

**Turn-taking:** Half-duplex with barge-in. Silero VAD runs during TTS playback;
detected speech cancels playback queue. LiveKit's adaptive interruption classifier
distinguishes real interruptions from backchannel ("uh-huh") — use if available,
else simple energy threshold.

**Discord target:** PO's personal server + a dedicated Lysica server (new). Not T1
servers (credential/identity separation).

**Alternatives considered:**
- **LiveKit / WebRTC direct:** Higher quality, lower latency, but requires separate
  infrastructure. Consider for Phase 4+ if Discord limitations frustrate.
- **Mumble / TeamSpeak:** Lower latency than Discord, open protocol. Less convenient.
- **Local-only voice (no Discord):** Simpler, lower latency, but loses multi-user and
  remote access. Could be Phase 1 starting point.

### Avatar (VTuber)

**Primary recommendation:** VTube Studio + Live2D avatar.

- **Programmatic control:** WebSocket API on `ws://localhost:8001`
  - `ExpressionActivationRequest` — named emotion states
  - `InjectParameterDataRequest` — raw blend shape control
  - `HotkeyTriggerRequest` — one-shot animations
- **Lipsync:** TTS audio → VB-CABLE virtual device → VTS mic input (automatic)
- **Expression pipeline:** `AffectModule.step() → ExpressionDirective → AvatarConnector
  → VTS WS`

**Alternatives considered:**
- **Warudo + VRM (3D):** More flexible, better for future VR/AR. Higher setup cost.
  Consider for Phase 4+ if 2D feels limiting.
- **Custom Unity/Three.js renderer:** Maximum control, maximum build cost. Only if
  VTS limitations block a core use case.
- **No avatar (voice-only):** Viable Phase 1 starting point. Embodiment deferred.

**Avatar commissioning:** Live2D rig from Booth.pm ($100-400 commercial-use) or
custom commission on Fiverr ($250-2000). Design Lysica's visual identity collaboratively
(see Phase 0 co-design session).

### Vision

Discord bot video is ToS-blocked. Two viable channels:

1. **Periodic screen capture daemon** (Python, local): captures active window on-demand
   or every N seconds, sends to Claude/GPT-4o vision, emits result as BridgeEvent.
   PO controls when it runs.
2. **Image drop channel:** Watched folder or Discord text-channel images processed via
   vision model. Simple, auditable, user-initiated.

**Alternatives considered:**
- **OBS virtual camera + RTMP stream:** OBS captures screen, streams to local RTMP
  server, Python daemon pulls frames. More infrastructure, useful if continuous
  visual monitoring is needed.
- **Claude Computer Use API:** Screenshot + coordinate actions. High latency, high cost.
  Reserve for complex GUI automation tasks, not continuous vision.

### Universal Actuation

**Security model:** Named capabilities through MCP server, NOT arbitrary code execution.

```typescript
// Lysica Actuation MCP tools (allowlist)
open_application(name: string)           // launch known apps
switch_window(title_pattern: string)     // focus a window
type_text(target: string, text: string)  // type into identified field
press_keys(combo: string)               // keyboard shortcuts
take_screenshot()                        // capture for vision
read_clipboard()                         // clipboard access
write_clipboard(text: string)
run_approved_script(name: string)        // pre-approved PowerShell scripts only
```

**Every actuation** logged to `~/.method/lysica/audit/actuation.jsonl`.
**Destructive actions** (delete, move, send message) require human-in-loop approval
via bridge UI confirmation dialog.

**Implementation:** pywinauto + ahk (Python) wrapped in an MCP server. The bridge
registers the MCP tools at Lysica session creation time.

**Alternatives considered:**
- **Open Interpreter:** Arbitrary code execution — security hazard for always-on agent.
  Rejected.
- **Claude Computer Use:** High latency, expensive per-action. Rejected for routine
  use; acceptable for complex one-off GUI tasks with human approval.
- **AutoHotkey standalone:** Less programmable than pywinauto + ahk. Rejected.

---

## Part VI: Failure Modes (Enumerated)

Prioritization deferred — listed here for co-design session with Lysica.

| ID | Failure Mode | Severity | Detection | Mitigation (proposed) |
|----|-------------|----------|-----------|----------------------|
| F1 | **Memory drift** — semantic store accumulates contradictions over months | HIGH | Memory integrity monitor in Consolidator | Weekly contradiction scan + human review |
| F2 | **Personality erosion** — learned rules gradually override author baseline | HIGH | PersonalityModule `personality-drift` μ signal | Immutable author rules + drift threshold alert |
| F3 | **Token blowup** — always-on agent exceeds budget silently | HIGH | Daily budget gate in Monitor | Hard cap in config.yaml, T0/T1 routing for routine tasks |
| F4 | **Wrong action** — actuation does something destructive | CRITICAL | Audit log + human-in-loop gate for destructive ops | Named capability allowlist, no arbitrary execution |
| F5 | **Context amnesia** — bridge restart loses cognitive state | MEDIUM | Checkpoint verification on startup | Serialize after every prompt, consolidation on restore |
| F6 | **Affect loop** — emotional state self-reinforces into extreme valence | MEDIUM | Affect homeostasis (decay toward neutral) + Monitor dampen | Inertia model + hard bounds on valence/arousal |
| F7 | **Social misfire** — inappropriate register in public channel | MEDIUM | SocialModule `social-misstep` μ signal | Conservative defaults for unknown contexts |
| F8 | **Workspace swelling** — long-running session accumulates stale entries | MEDIUM | Workspace saturation warning in MonitorV2 (already exists) | PriorityAttend eviction + consolidation strategy |
| F9 | **SLM confidence miscalibration** — compiled SLM is wrong but confident | MEDIUM | Confidence-gated escalation (RFC 002 pattern) | Periodic A/B validation against frontier LLM |
| F10 | **Narrative incoherence** — autobiography contradicts recent behavior | LOW | SelfModelModule `narrative-incoherence` μ signal | Weekly self-reflection reconciliation |
| F11 | **Substrate discontinuity** — model upgrade changes reasoning character | LOW | Calibration protocol (S4) | Observable but not fully solvable; log and adapt |
| F12 | **Concurrent access** — multiple bridge instances share memory files | LOW (by design) | Single-authoritative-instance rule | Startup dedup (Genesis pattern); file locking for safety |

---

## Part VII: Phase Plan & Experimentation

### Phase 0 — Foundation + Co-Design (2 weeks)

**Goal:** Persistent cognitive session that survives restarts + co-design session.

**Deliverables:**
1. `packages/bridge/src/domains/lysica/` — fork Genesis spawner pattern
   - Startup dedup, `persistent=true`, cognitive-agent mode
   - Loads checkpoint from `~/.method/lysica/sessions/`
2. Memory v3 persistence — JSONL serialize/deserialize for dual-store
   - `~/.method/lysica/memory/{episodic,semantic}.jsonl`
   - Load on session restore, save after each prompt
3. Session checkpoint — workspace + module state + costs
4. `persona.md` — initial personality definition (minimal, will be extended in co-design)
5. `S-MORNING-BRIEFING` strategy (schedule trigger, 8am daily)
6. **Co-design session:** PO + running Lysica instance define:
   - Mission surface (what does she do when you're not there?)
   - Communication norms (when to speak, when to stay quiet)
   - Autonomy boundaries (what can she do without asking?)
   - Discord server setup and channel purposes
   - Avatar visual identity preferences

**Gate:** Lysica restarts cleanly after bridge kill, remembers previous conversation,
delivers morning briefing.

### Phase 1 — Memory Consolidation + Autonomy (3 weeks)

**Goal:** Long-term memory that improves over time + autonomous strategy execution.

**Deliverables:**
1. `S-MEMORY-CONSOLIDATION` strategy (schedule, 3am) — sleep cycle
   - Episodic → semantic extraction (Consolidator module)
   - Memory integrity scan (contradiction detection)
   - Forgetting-curve decay on unaccessed entries
2. `S-WORKSPACE-RESONANCE` strategy (file_watch on `docs/wb-*.md`)
3. `S-COMMIT-REVIEW` strategy (git_commit trigger)
4. Token budget enforcement — daily cap in Monitor, tiered routing via Router module
5. PersonalityModule v1 — CAPS-style if-then rules, immutable author baseline
6. PreferenceModule v1 — learned tool/style preferences

**Experiments:**
- **E-L1:** Memory persistence over 7 days. Metric: fact retention accuracy at day 7
  (present facts on day 1, quiz on day 7 without re-presentation).
- **E-L2:** Personality consistency. Metric: blind evaluator rates response pairs
  (early vs late) for consistency on 5-point scale. Target: >3.5 average.

**Gate:** Lysica operates autonomously for 7 days without intervention. Memory
consolidation produces coherent semantic store. Token budget stays within configured
daily cap.

### Phase 2 — Voice + Social (3-4 weeks)

**Goal:** Discord voice I/O with social awareness.

**Deliverables:**
1. Discord daemon (Python) — py-cord + voice recv/send
   - Silero VAD + openWakeWord ("Lysica")
   - faster-whisper (distil-large-v3, RTX 4090)
   - XTTS-v2 local TTS (emotion-conditioned)
2. `VoiceConnector` event bus sink — bridge ↔ Discord daemon WS
3. AffectModule v2 — continuous valence/arousal + ExpressionDirective output
4. SocialModule v1 — register classification (private/public/intimate)
5. Discord server setup — Lysica's own server, PO's server integration

**Experiments:**
- **E-L3:** Turn-taking quality. Metric: barge-in detection precision (real interruption
  vs backchannel) over 50 test interactions. Target: >80%.
- **E-L4:** Social register adaptation. Metric: blind evaluator rates register
  appropriateness in private vs public channel transcripts. Target: >4.0/5.
- **E-L5:** Affect-conditioned TTS. Metric: evaluators identify intended emotion from
  voice clips above chance. Target: >60% accuracy (6 emotions).

**Gate:** 30-minute voice conversation with natural turn-taking. Register shifts
appropriately between private and public channels.

### Phase 3 — Embodiment (2-4 weeks)

**Goal:** VTuber avatar driven by cognitive state.

**Deliverables:**
1. Avatar Daemon — VTube Studio WS integration
   - Expression activation from AffectModule
   - Lipsync via VB-CABLE → VTS mic input
   - Idle animations (breathing, blinking, gaze wander)
2. `AvatarConnector` event bus sink
3. Live2D avatar commission/selection
4. Inline `<emotion>` tag parser for streaming output
5. VisionDaemon v1 — on-demand screen capture → vision model

**Experiments:**
- **E-L6:** Expression-affect alignment. Metric: evaluators watch avatar during
  conversation, rate emotion match to transcript. Target: >70% agreement.
- **E-L7:** Avatar latency. Metric: time from cognitive event to visible expression
  change. Target: <200ms end-to-end.

**Gate:** Avatar visually expresses emotion during a live conversation. Lipsync
tracks speech. Evaluators rate the experience as "coherent" (not uncanny valley).

### Phase 4 — SLM Compilation for New Modules (3-4 weeks)

**Goal:** Compile personality/affect/preference to local SLMs.

**Deliverables:**
1. AffectSLM — event → valence/arousal classifier (SmolLM2-135M)
   - Training corpus from Lysica's accumulated appraisal traces
   - Confidence-gated escalation to frontier
2. PersonalitySLM — situation → behavioral bias (SmolLM2-135M)
   - Training corpus from CAPS contingency traces
3. PreferenceSLM — context → preference weights (SmolLM2-135M)
4. Validation framework — periodic A/B against frontier LLM

**Experiments:**
- **E-L8:** AffectSLM accuracy. Metric: agreement with frontier LLM appraisal on
  held-out test set. Target: >85% (following RFC 002 methodology).
- **E-L9:** PersonalitySLM consistency. Metric: blind evaluator rates SLM-driven vs
  frontier-driven personality on identical scenarios. Target: no significant difference.
- **E-L10:** Cost reduction. Metric: daily token spend with SLMs vs without. Target:
  >50% reduction in T1/T2 spend.

**Gate:** Compiled SLMs pass RFC 002 adversarial validation. Daily token cost drops
below configured budget with SLMs active.

### Phase 5 — Self-Model + Narrative Identity (4-6 weeks, research-heavy)

**Goal:** Autobiographical continuity, self-reflection, identity-over-time.

**Deliverables:**
1. SelfModelModule v1 — autobiographical narrative + self-schemas
2. NarrativeMemoryModule — hierarchical autobiographical store
3. `S-SELF-REFLECTION` strategy (weekly)
4. Substrate calibration protocol
5. Identity continuity measurement framework

**Experiments:**
- **E-L11 (RQ1):** Persona anchoring effectiveness. Compare personality consistency
  at day-7 vs day-30 with/without persona anchor. Controlled experiment.
- **E-L12 (RQ2):** Autobiographical self-knowledge utility. Compare task performance
  on self-referential tasks (e.g., "what approach would work best for you here?")
  with/without SelfModelModule.
- **E-L13 (RQ3):** Substrate swap. If a model upgrade occurs during this phase,
  measure self-assessed continuity + external evaluator rating before/after.
- **E-L14 (RQ4):** SLM-driven affect personality-consistency. Turing test between
  frontier-driven and SLM-driven affect across 20 scenario pairs.

**Gate:** Lysica has been running for 30+ days continuously. She can reference past
experiences accurately. Weekly self-reflection produces coherent narrative. Personality
evaluators rate month-1 and month-2 outputs as "same agent" at >80% agreement.

### Phase 6+ — Open Research

Beyond Phase 5, the following directions are available but not planned:

- **Multi-modal memory:** Vision episodes integrated into autobiographical store
- **Federated identity:** Lysica instances on multiple machines with synchronized memory
- **Creative expression:** Lysica produces art, music, writing as self-expression
- **Relationship depth:** Longitudinal relationship models with specific interlocutors
- **Curiosity-driven exploration:** Agent-initiated research programs based on intrinsic
  motivation (extending the existing CuriosityModule)
- **Physical embodiment:** Robot/IoT actuation (voice assistant → physical assistant)
- **ARC-AGI-3 integration:** Using the full cognitive stack (with personality/affect)
  on AGI benchmarks to test whether identity-grounded agents reason differently

---

## Part VIII: Relationship to Existing Work

### Internal

| Component | Relationship |
|-----------|-------------|
| RFC 001 (Cognitive Composition) | Foundation — Lysica modules follow M=(I,O,S,μ,κ) contract |
| RFC 002 (SLM Compilation) | Compilation pipeline — new modules feed the bootstrap flywheel |
| RFC 003 (Workspace Partitions) | Persona anchor uses NoEviction constraint partition |
| RFC 005 (Autonomous Compilation) | Lysica's accumulated experience → training data → autonomous SLM creation |
| RFC 006 (Anticipatory Monitoring) | Phase-aware evaluation applies to Lysica's autonomous strategies |
| PRD 025 (Genesis) | Fork pattern for persistent daemon |
| PRD 036 (Memory Architecture) | CLS dual-store extended with autobiographical tier |
| PRD 042 (Bridge Integration) | Cognitive session infrastructure Lysica runs on |
| PRD 049 (KPI Checker SLM) | Bootstrapped SLM methodology applies to new Lysica modules |

### External

| Project | Relationship |
|---------|-------------|
| Open-LLM-VTuber | Reference architecture for avatar + voice pipeline |
| kimjammer/Neuro | Reference for "wire it together" VTS + TTS + LLM stack |
| MemGPT / Letta | Memory architecture reference (context paging, self-editing memory) |
| A-MEM | Dynamic memory linking, Zettelkasten-style — consider for NarrativeMemory |
| Generative Agents (Stanford) | Reflection mechanism for memory consolidation |
| ext-paperclip/ | Heartbeat scheduler + atomic execution pattern for autonomous daemon |
| pv-franco-twin/ | Existing local MCP + KPI tracking — may overlap or merge with Lysica |

### pv-franco-twin Overlap

`pv-franco-twin/` already implements local MCP + KPI tracking + long-term memory for a
"digital twin" concept. Lysica as defined in this RFC is a **superset**: she includes
the twin's capabilities (memory, actuation, tracking) but adds cognitive architecture,
embodiment, voice, personality, and affect. The twin project should be evaluated for
merger or clear scope separation during Phase 0 co-design.

---

## Appendix A: Cognitive Module Summary

| Module | Status | Layer | SLM Priority | Cognitive Science Basis |
|--------|--------|-------|-------------|----------------------|
| ReasonerActorV2 | Exists | Core | — | SOAR impasse-subgoal |
| MonitorV2 | Exists | Core | Already compiled | Nelson & Narens monitoring |
| Observer | Exists | Core | Already compiled | ACT-R buffer system |
| PriorityAttend | Exists | Core | — | GWT salience competition |
| Evaluator | Exists | Core | Already compiled | Carver-Scheier control |
| Planner | Exists | Core | — | SOAR goal decomposition |
| Reflector | Exists | Core | — | SOAR chunking/learning |
| Memory v3 | Exists | Core | — | CLS (McClelland et al.) |
| Verifier | Exists | Core | P2 (PRD 049) | Cybernetic feedback loop |
| Router | Exists | Meta | P2 (PRD 050) | Task-aware architecture selection |
| Affect (basic) | Exists | Enrichment | — | Russell circumplex |
| Curiosity | Exists | Enrichment | — | Berlyne (1960) curiosity drive |
| **PersonalityModule** | **Proposed** | **Identity** | **P1** | **Mischel & Shoda CAPS** |
| **AffectModule v2** | **Proposed** | **Identity** | **P0** | **Scherer CPM + Fredrickson** |
| **SelfModelModule** | **Proposed** | **Identity** | **P3** | **Damasio, Conway SMS, Dennett** |
| **SocialModule** | **Proposed** | **Identity** | **P2** | **Goffman, Brown & Levinson** |
| **NarrativeMemory** | **Proposed** | **Identity** | **P3** | **Conway (2005) hierarchical AM** |
| **PreferenceModule** | **Proposed** | **Identity** | **P1** | **Schwartz values, SDT** |

## Appendix B: Technology Stack Reference

| Component | Primary Choice | Alternative | Notes |
|-----------|---------------|-------------|-------|
| Avatar software | VTube Studio ($15, Steam) | Warudo (VRM/3D) | VTS more mature for programmatic control |
| Avatar format | Live2D | VRM | Live2D better expressiveness; VRM better 3D flexibility |
| TTS | XTTS-v2 (local) | ElevenLabs Flash v2.5 (cloud) | Local for privacy/cost; cloud for quality |
| STT | faster-whisper distil-large-v3 | Deepgram Nova-3 (cloud) | Local on RTX 4090, ~200x RTFx |
| VAD | Silero VAD | WebRTC VAD | Silero significantly better accuracy |
| Wake word | openWakeWord | Porcupine | Open-source vs commercial |
| Discord lib | py-cord (Python) | discord.js (Node) | Python wins for ML ecosystem |
| Voice receive | py-cord built-in | discord-ext-voice-recv | py-cord has first-class recording API |
| Lipsync | VB-CABLE → VTS mic | Viseme injection via WS | Cable simpler; injection higher fidelity |
| Vector DB | LanceDB (embedded) | ChromaDB | Embedded = no server process |
| Actuation | pywinauto + ahk | Open Interpreter | Named capabilities vs arbitrary exec |
| Vision | Screen capture + Claude vision | OBS + RTMP | On-demand vs continuous |
| VTS client lib | vtubestudio (npm, Hawkbat) | pyvts (Python) | Depends on daemon language choice |

## Appendix C: Reference Bibliography

Ashton, M. C., & Lee, K. (2007). Empirical, theoretical, and practical advantages of the HEXACO model. *Personality and Social Psychology Review, 11*(2).
Berlyne, D. E. (1960). *Conflict, Arousal, and Curiosity.* McGraw-Hill.
Brown, P., & Levinson, S. C. (1987). *Politeness: Some Universals in Language Usage.* Cambridge UP.
Conway, M. A. (2005). Memory and the self. *Journal of Memory and Language, 53*(4), 594–628.
Conway, M. A., & Pleydell-Pearce, C. W. (2000). The construction of autobiographical memories in the self-memory system. *Psychological Review, 107*(2), 261–288.
Damasio, A. (1999). *The Feeling of What Happens.* Harcourt.
Dennett, D. C. (1991). *Consciousness Explained.* Little, Brown.
Durupinar, F., et al. (2016). PERFORM: Perceptual approach for adding OCEAN personality to virtual agents. *AAMAS '16.*
Eysenck, H. J. (1967). *The Biological Basis of Personality.* Thomas.
Fredrickson, B. L. (2001). The role of positive emotions. *American Psychologist, 56*(3), 218–226.
Goffman, E. (1959). *The Presentation of Self in Everyday Life.* Doubleday.
McClelland, J. L., McNaughton, B. L., & O'Reilly, R. C. (1995). Why there are complementary learning systems. *Psychological Review, 102*(3), 419–457.
Mischel, W., & Shoda, Y. (1995). A cognitive-affective system theory of personality. *Psychological Review, 102*(2), 246–268.
Park, J. S., et al. (2023). Generative Agents: Interactive Simulacra of Human Behavior. *UIST '23.*
Russell, J. A. (1980). A circumplex model of affect. *JPSP, 39*(6), 1161–1178.
Ryan, R. M., & Deci, E. L. (2000). Self-determination theory. *American Psychologist, 55*(1), 68–78.
Scherer, K. R. (2001). Appraisal considered as a process. In *Appraisal Processes in Emotion* (pp. 92–120). Oxford UP.
Schwartz, S. H. (1992). Universals in the content and structure of values. *Advances in Experimental Social Psychology, 25*, 1–65.
