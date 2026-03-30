
# Cognitive Provider Summary

• **Multi-tool Architecture**: Upgraded from v1 to v2 with support for up to 5 tool calls per cycle (configurable via maxToolsPerCycle) before monitor evaluation, enabling more complex multi-step operations

• **Workspace & Cost Management**: Features persistent workspace across prompts within sessions using TTL-based eviction, plus comprehensive tracking of input/output tokens and cumulative cost in USD across all LLM calls

• **Impasse Detection & Prevention**: Implements detection of consecutive identical tool calls (same toolName+toolInput) and automatically injects "try a different approach" workspace guidance to break infinite loops
