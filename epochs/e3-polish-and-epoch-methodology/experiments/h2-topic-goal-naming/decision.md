# H2 — Decision

**Verdict:** Confirmed resolved — no action taken
**Date:** 2026-03-01

## Finding

Investigation found no occurrence of 'goal' or 'topic' in CLAUDE.md (the parameter
concept is not mentioned there at all). README.md uses 'topic' consistently throughout
all code examples and descriptions.

The 'goal' language cited in E1/E2 existed only in the epoch hypothesis.md files
(historical artifacts written before the parameter was stabilised). It has since
been cleaned up. CLAUDE.md itself was never the source of the inconsistency in
its current form.

## What Was Learned

The issue was more contained than reported. Epoch decision.md files are retrospective
artifacts — they describe the state at the time of writing, not necessarily the
current state. H2 is a good example of checking before fixing.

## No Changes Made
