# reasoning/ — Step-by-Step Reasoning Chains

Composable reasoning strategies that add structured intermediate steps between agent inputs and outputs. Reasoning modules wrap an agent provider and augment each call with a reasoning phase before the final answer.

## Components

| Component | Description |
|-----------|-------------|
| `ReActReasoner` | ReAct (Reason + Act) loop — alternates between reasoning steps and tool calls |
| `ReflexionReasoner` | Reflexion-style self-critique — generates answer, critiques it, revises |
| `ReasonerMiddleware` | Middleware that injects reasoning into any provider call |
| `ReasoningPolicy` | Configuration for which reasoning strategy to apply and when |
| `FewShotInjector` | Injects few-shot examples into prompts to guide reasoning style |
| `EffortMapper` | Maps task complexity to reasoning effort level (fast/standard/deep) |

## Design

Reasoners are composable: a `ReActReasoner` can wrap a `ReflexionReasoner` for hybrid behavior. The `ReasonerMiddleware` makes this transparent to the caller — the same pact runs with or without reasoning based on the policy.

All reasoning output is structured: intermediate steps, tool calls, critiques, and revisions are captured as typed events that flow into the agent's observability trace.
