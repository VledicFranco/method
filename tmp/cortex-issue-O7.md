# Draft: issue O7 for PlataformaT1/t1-cortex

**Labels:** ctx.apps, PRD-043, method-integration, enhancement

**Title:** feat(apps): DELETE /v1/platform/apps/:appId/tools/:toolName

---

Method's PRD-066 needs to deregister methodology-owned tools when
the parent methodology is removed (PRD-064 CortexMethodologySource
supports methodology removal via admin API).

## Ask

```
DELETE /v1/platform/apps/:appId/tools/:toolName
  → 204 No Content
```

Must:

- Require `tool:register` service scope (pairs with issue O6).
- Emit `platform.app.toolRemoved` on `ctx.events` for subscribers.
- Idempotent (404 on second call acceptable).
- Refuse to delete tools registered via static `spec.tools[]` — those
  are platform-owned and only deploy-time changes remove them.
- Cascade: referenced-by-other-methodology tools fail with 409 Conflict.

## Blocks

Method PRD-066 Track B.
