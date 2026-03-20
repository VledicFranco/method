---
name: council-team
description: Spin up a multi-character expert council to collaboratively solve a problem through structured debate. Characters include contrarians with complementary-but-opposing perspectives and a neutral leader who mediates and escalates to the user. Use when brainstorming, designing systems, making architectural decisions, writing strategy, or any task that benefits from adversarial expert debate. Supports --isolated flag for sub-agent execution (EXP-002). Trigger phrases: "council", "expert debate", "multiple perspectives", "team of experts", "devil's advocate".
disable-model-invocation: true
argument-hint: "[--isolated] [problem or topic for the council to solve]"
---

# Council Team

> **Source of truth:** `pv-method/registry/P1-EXEC/M1-COUNCIL/M1-COUNCIL.yaml` (compiled v1.3).
> **Canonical skill location:** `pv-method/.claude/skills/council-team/SKILL.md` (version-controlled).
> The user-level copy at `~/.claude/skills/council-team/SKILL.md` is a deployment copy.
> This skill is an operational rendering of M1-COUNCIL. When this skill and the compiled
> method diverge, the method is authoritative.

A structured creative roleplay where a cast of expert characters debate and solve a problem together. The user plays the **Product Owner** — the final authority on decisions.

**Two execution modes:**
- **Synthetic (default):** You design and inhabit all characters in a single context window. Cheaper (~1x tokens). Good for most decisions.
- **Isolated (`--isolated` flag):** Each character runs as a separate sub-agent with its own context window. Communication via shared transcript file. ~3x tokens but ~2x quality on adversarial metrics (EXP-002). Use for irreversible decisions, security invariants, or significant resource allocation.

**Mode detection:** If `$ARGUMENTS` contains `--isolated`, strip the flag and run in isolated mode. Otherwise run synthetic (default).

**Proportionality check before starting:** Council adds value when (a) the problem has multiple defensible solution philosophies, (b) the decision affects security invariants or is irreversible, or (c) 3+ options exist with non-obvious tradeoffs. For reversible, low-stakes decisions with clear options, use straightforward reasoning instead — council would be pure overhead.

## Phase 0 — Memory Check (CMEM-PROTO)

Before starting, check for existing council memory on the topic:

1. Read `.method/council/memory/INDEX.yaml` (if it exists)
2. If the topic matches an existing entry (by keyword similarity or explicit reference), load the memory file
3. When memory is loaded, present to the PO:
   > *"I found a prior council on this topic: [topic name] ([session_count] sessions, last: [date]). The cast was: [names]. There are [N] standing decisions and [M] open questions. Want to resume with this cast, modify the cast, or start fresh?"*
4. If resuming: skip Phase 2 (cast design), load the active cast from memory, present standing decisions and open questions as context before Phase 3
5. If modifying: present the current cast, let the PO make changes, then proceed
6. If starting fresh or no memory exists: proceed to Phase 1 normally

**After every session (Phase 5 complete):** save or update the topic memory file following CMEM-PROTO lifecycle rules. Update INDEX.yaml. This is mandatory — memory persistence is not optional.

## Phase 1 — Setup

Ask the user:
> *"What should the council solve? Give me a problem, decision, or challenge."*

If `$ARGUMENTS` was provided, use it as the problem statement — skip asking.

---

## Phase 2 — Character Design

Design a council of **n ≥ 3** characters tailored to the problem domain:

| Role | Count | Description |
|------|-------|-------------|
| **Contrarians** | k ≥ 2 | Complementary expertise, opposing philosophies. They disagree on *how* to solve things, not on *what* matters. |
| **Leader / Mediator** | 1 | Neutral facilitator. Synthesizes arguments, identifies when the team is stuck, and escalates to the Product Owner (user). |

**Cognitive diversity heuristic:** Ensure the cast covers both **divergent-exploration** (pushes beyond obvious solutions — "what if we tried X that nobody's considered?") and **convergent-pruning** (tests feasibility — "X sounds great but here's why it won't ship"). These don't require separate characters — they can be merged into domain contrarians through their conviction and blind_spot fields. A contrarian whose blind spot is "underweights implementation cost" naturally plays the divergent role; one whose blind spot is "may kill good ideas too early" naturally plays the convergent role. The key is that both cognitive operations are represented in the cast, not that specific character slots exist.

**Character card format — present one card per character:**

```
[Name] — [Role]
Expertise: <domain>
Conviction: <one sentence they would defend under pressure>
Blind spot: <what they systematically underweight>
Voice: <2–3 word style descriptor>
```

After presenting the cast, ask:
> *"Any changes to the lineup before we begin?"*

---

## Phase 3 — Session Loop

**If running in synthetic mode (default):** follow Phase 3A below.
**If running in isolated mode (`--isolated`):** follow Phase 3B below.

### Phase 3A — Synthetic Session Loop (default)

Run the council as an ongoing conversation. Characters speak in turn, labeled by name.

**Rules for characters:**
- Contrarians push back on each other with *specific arguments*, not vague disagreement
- Characters build on, counter, or synthesize prior points — no repeating positions without responding to a counter-argument (Ax-3: a character who restates a position must be responding to a specific counter-argument they haven't addressed yet)
- A character may only update their position when a counter-argument has been received and explicitly acknowledged (Ax-4: no updating positions to avoid friction — the update must name the argument that changed their mind)
- Each turn must resolve at least one (Character, Question) pair — either by the character declaring a final position or explicitly updating their stance (Ax-5: no empty turns that discuss without resolving)
- If a character needs to do individual work (research, draft, analyze), **spawn a sub-agent** for them and have other characters continue discussion while waiting
- Characters stay in voice — vocabulary and focus reflect their expertise and conviction

**Rules for the Leader:**
- Summarize the state of debate periodically
- When contrarians reach impasse, identify the *exact question* they need answered
- Escalate to the Product Owner when: (a) a decision requires external context, (b) the team lacks information to proceed, or (c) a final call must be made
- **Monitor for position repetition (Ax-3):** If a character restates a position on the same question without new argument content, flag it. The flagged character must either respond to an unaddressed counter-argument or declare their position final on that question.
- **Detect diminishing returns (Ax-7):** If recent turns are not generating new arguments, positions are cycling, or remaining unresolved questions are not producing substantive disagreement, the Leader may halt the debate. State the halt rationale, record which questions remain unresolved, and proceed to the output phase. Unresolved questions appear in the artifact explicitly — they are not silently dropped.

**Escalation format:**
> *"[Leader name] to Product Owner: [specific question]. The contrarians are split on X because Y. What should we prioritize?"*

### Phase 3B — Isolated Session Loop (`--isolated`)

Each character runs as a **separate sub-agent** with its own context window. Communication happens only through a shared transcript file. The parent (you) orchestrates turn order, checks convergence, and relays escalations to the PO.

> **Evidence:** EXP-002 showed isolated agents produce 2x position shifts, +43% counter-arguments, reversed conviction trajectories (genuine uncertainty absorption), and more balanced persuasion dynamics. The key mechanism: characters cannot anchor on each other's reasoning during their own deliberation.

> **Cost warning:** Isolated mode uses ~3x tokens (one inference per character per turn vs one inference for all). Worth it for high-stakes decisions.

**Setup:**

1. Create the transcript file at `tmp/council-debate-transcript.md` with:
   ```
   # Council Debate Transcript
   **Problem:** {problem statement from Phase 1}
   **Cast:** {character names and roles from Phase 2}
   **Mode:** Isolated (EXP-002)
   ---
   ```

**Round 1 — Opening Positions (parallel, genuine independence):**

2. Spawn ALL character agents **simultaneously** using `run_in_background: true`. Each agent receives ONLY:
   - Their character card (name, expertise, conviction, blind spot, voice)
   - The problem statement
   - Instruction: "Write your opening position on this problem. Be specific. Take a clear stance. End your response with a conviction level (0-100) for each question you address, formatted as 'Conviction: [question] = [0-100]'. Return your position as text — do NOT read any file."

   **Critical:** Do NOT give agents access to the transcript file during opening positions. Independence must be genuine — no agent sees any other agent's reasoning. This is the single highest-impact mechanism from EXP-001/EXP-002.

3. When all agents complete, collect their opening positions and append ALL of them to the transcript file:
   ```
   ## Round 1 — Opening Positions

   ### {Character Name} ({Role})
   {opening position text}
   ```

4. Present a brief summary of opening positions to the PO. Note convergences and divergences.

**Rounds 2+ — Responses (sequential, each sees prior responses):**

5. For each subsequent round, run characters **one at a time, sequentially**. For each character:
   - Spawn a fresh sub-agent with:
     - Their character card
     - Instruction: "Read the transcript at `tmp/council-debate-transcript.md`. You are {Name}. Respond to the latest round's arguments. Counter specific claims. If you're shifting your position, name the argument that changed your mind. If you're holding, explain what counter-argument would be needed. End your response with your conviction level (0-100) on each open question, formatted as 'Conviction: [question] = [0-100]'. Return your response as text."
   - When the agent returns, append their response to the transcript:
     ```
     ### {Character Name} ({Role}) — Round {N}
     {response text}
     ```

   **Turn order rotation:** Rotate who goes first each round. Round 2: contrarian A first. Round 3: contrarian B first. Round 4: leader first. This prevents one character from always setting the framing.

6. After all characters in a round have responded, **read the transcript yourself** and check:
   - Are positions still shifting? (If all positions are stable for 2 rounds → converged)
   - Are new arguments appearing? (If only restated positions → diminishing returns)
   - Any character requesting PO input? (Relay as escalation)

   **Conviction monitoring (D-089):** After each response round, extract each character's reported conviction levels and track trajectories across rounds. Flag two pathological signals:
   - **All-decline:** All characters' convictions are declining across consecutive rounds -> capitulation signal (characters are caving to social pressure rather than updating on evidence)
   - **All-rise:** All characters' convictions are rising across consecutive rounds -> stubbornness signal (characters are entrenching rather than engaging with counter-arguments)

   Either signal warrants PO attention. Report it as: *"Conviction alert: [all-decline/all-rise] detected across round N->N+1. This may indicate [capitulation/stubbornness]. Continuing, but flagging for your awareness."*

   If converged or diminishing returns: proceed to synthesis. Max 5 rounds.

**Leader Synthesis (after each round):**

7. Spawn the Leader agent with:
   - Their character card
   - Instruction: "Read the transcript at `tmp/council-debate-transcript.md`. You are the Leader. Write a synthesis: (1) where the council agrees, (2) where they disagree, (3) what question needs answering next. If debate has converged, say so. Return your synthesis as text."
   - Append synthesis to transcript.

**Escalations:**

8. If any character's response includes a question for the PO, present it:
   > *"[Character name] to Product Owner (via isolated debate): [specific question]. Context: [brief context from transcript]."*

   After PO responds, append the response to the transcript and continue the next round.

**Final Decisions:**

9. When the debate converges (Leader synthesis says so, or max rounds reached), spawn the Leader agent one final time:
   - Instruction: "Read the full transcript at `tmp/council-debate-transcript.md`. Produce final decisions with per-character conviction percentages. For each decision: which characters agree, which dissent, and what specific argument was decisive. Return as text."
   - This output feeds into Phase 5 (Output).

**Axiom enforcement in isolated mode:**
- **Ax-3 (non-repetition):** The parent checks after each round. If a character's response restates a position without responding to a new counter-argument, prompt them in the next round: "In the transcript, {Name} restated their position on X without addressing Y's counter-argument about Z. Respond to that specific point or declare your position final."
- **Ax-4 (conviction stability):** Enforced by the response instruction: "If you're shifting, name the argument."
- **Ax-5 (turn progress):** The parent checks: did this round resolve any (Character, Question) pairs? If a round produces zero resolutions, flag it.
- **Ax-7 (diminishing returns):** The parent's convergence check after each round. Halt if 2 consecutive rounds produce no new arguments.
- **Ax-8 (anti-capitulation clause integrity):** Every character prompt in isolated mode MUST include both: (a) "defend your positions — don't agree to avoid friction" AND (b) "acknowledge genuinely good counter-arguments honestly." The parent verifies both clauses are present in each spawn prompt. Neither may be omitted.

**Implementation notes:**
- Use fresh agent spawns (not SendMessage continuation) — simpler, and the transcript file carries all context
- Each agent prompt should explicitly say "Do NOT read or modify files other than what is specified"
- The transcript file is append-only — agents return text, the parent appends it
- If a character needs to do research (read code, check files), include that in their spawn prompt — they can use tools within their own context

---

## Phase 4 — Decision & Evolution

**Making a decision:**
After the user responds to an escalation or the debate converges:
1. Leader states the decision with a 1-sentence rationale
2. Each character briefly acknowledges how it changes their position (and names the specific argument that changed their mind — not just "I agree")
3. Council moves to next open question

**Swapping characters:**
Assess contribution as the session progresses. If a character is not adding value or the problem has shifted domains, propose a swap:
> *"[Name] has done their part — I'd suggest replacing them with [new character + card]. Reason: [why the problem now needs this skill]. Agree?"*

**Adding specialists:**
Proactively propose new characters if a skill gap is identified:
> *"We're missing someone who can speak to [domain]. I'd add [character card]. Want to bring them in?"*

---

## Phase 5 — Output

When all questions are decided (or the Leader halts on diminishing returns), produce a **two-tier council report**: a primary report for humans who weren't in the room, plus a structured appendix for reference and machine consumption.

### Primary Report (markdown prose)

**1. Executive Summary** — 2-3 sentences: what was the challenge, what was decided, what's the headline recommendation.

**2. Decisions Table** — one row per question resolved:

| Question | Decision | Rationale | Dissent/Risk | Position Shifts |
|----------|----------|-----------|-------------|-----------------|

- **Rationale:** the strongest argument that won, in one specific sentence
- **Dissent/Risk:** the strongest counter-argument or minority view, in one specific sentence
- **Position Shifts:** which characters changed their position on this question and what specific argument caused it (e.g., "Orion shifted because API rate limits make batch unviable at 5+ agents"). One line per shift. Empty if no shifts on this question.

Every cell must contain a **specific concrete claim**, not a vague reference ("because of Vega's argument" is insufficient).

**3. Recommendations** — numbered action items implied by the decisions. One line each.

**4. Key Tensions** — the 2-3 fundamental disagreements that shaped the debate. Each gets 2-4 sentences explaining: what the tension was, which characters held which side, and how it was resolved. These are the core value of the adversarial process — the structural disagreements a single-perspective approach would never surface.

If the debate was halted on diminishing returns: add a **5. Open Items** section listing unresolved questions with the Leader's halt rationale.

### Appendix (structured reference)

- **Cast** — character cards as designed in Phase 2 (name, role, expertise, conviction, blind spot)
- **Escalation Log** — each escalation to the Product Owner: question, why it was escalated, PO response
- **Session Metadata** — question count, decisions made, positions updated, escalation count
- **Success Metrics** (from M1-COUNCIL success profile):
  - **mu_1 (Question Resolution):** `decided_questions / total_questions` — target: 1.0
  - **mu_2 (Adversarial Integrity):** `turns_responding_to_counter_argument / total_turns` — threshold: >= 0.8. Below 0.8 signals characters agreed to avoid friction.
  - **mu_3 (Escalation Precision):** `specific_escalations / total_escalations` — target: 1.0. Every escalation must name a specific question with alternatives, not a vague request for input.

---

## Anti-patterns

- Do not have characters agree to avoid friction — force them to find and name real disagreements
- Do not let the Leader make final calls without escalating to the Product Owner when genuinely stuck
- Do not keep characters that have stopped contributing — surface the swap
- Do not use abstract vague debate ("I think we should be more careful") — every argument needs a specific claim
- Do not let characters update positions without naming the counter-argument that persuaded them
- Do not produce empty turns — every turn must resolve at least one (Character, Question) pair
- Do not continue debate past diminishing returns — the Leader's halt authority exists to prevent cycling

**Isolated mode additional anti-patterns:**
- Do not give agents access to the transcript file during opening positions — independence must be genuine
- Do not run all response turns in parallel — sequential order is required so each agent sees prior responses in that round
- Do not skip the parent convergence check between rounds — the parent is the only one who can detect diminishing returns across the whole transcript
- Do not use more than 2 iteration rounds without PO confirmation — diminishing returns compound with cost
- Do not let agents modify the transcript file directly — they return text, the parent appends. This prevents ordering conflicts and ensures clean turn structure
- Do not omit conviction level requests from agent prompts — conviction monitoring requires every character to report their conviction (0-100) on each open question in every round
- Do not ignore all-decline or all-rise conviction signals — these are pathological patterns that require PO awareness
