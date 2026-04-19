# Draft: issue O5 for PlataformaT1/t1-cortex

**Labels:** ctx.apps, PRD-043, method-integration, enhancement

**Title:** feat(apps): runtime tool registration API for per-methodology tools

---

Method's PRD-066 ships Cortex adapters for the `@methodts/mcp` layer.
Each methodology declares a `Step.tools[]` list. When a tenant app
installs a new methodology at runtime (via PRD-064
CortexMethodologySource hot-reload), the resulting tools must register
with Cortex's platform tool registry so operation-grammar authz is
enforced.

Today PRD-043 supports static `spec.tools[]` at deploy time only.

## Ask

1. **Manifest block addition:**

    ```yaml
    spec:
      methodology:
        pool: string                              # logical grouping
        toolRegistration: 'static' | 'dynamic'    # new
    ```

2. **Runtime API** (authz: requires `tool:register` service scope —
   see O6):

    ```
    POST /v1/platform/apps/:appId/tools
      body: { name, description, inputSchema, methodologyId, version }
      → 201 with authzTemplate auto-generated
    ```

3. **Authz auto-approval:**
    - When `toolRegistration: 'dynamic'`, Cortex generates Layer-2 authz
      templates from the tool's `methodologyId` role mappings and emits
      them as `suggestedPolicy` (admin still approves, but pre-filled).

4. Platform emits `methodology.toolRegistered` on `ctx.events` (see
   PRD-072).

## Related

- Method surface frozen in
  `.method/sessions/fcd-surface-mcp-cortex-transport/decision.md`
  (status: needs-follow-up pending this answer) in `VledicFranco/method`.
- RFC-005 §3.4 (operation grammar), §3.4.2 (Layer-2 policy admin-owned).

## Blocks

Method PRD-066 Track B. Track A (deploy-time static manifest) ships
regardless.
