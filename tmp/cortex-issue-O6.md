# Draft: issue O6 for PlataformaT1/t1-cortex

**Labels:** ctx.auth, PRD-061, method-integration, enhancement

**Title:** feat(auth): ctx.auth.issueServiceToken(scope) — service-account JWTs for platform-capability actions

---

Method's PRD-066 needs to call Cortex's tool-registry API to register
methodology tools. This is a platform-capability action on behalf of
the app itself, not a user-delegated action — the current RFC 8693
token exchange flow (user → agent) is the wrong primitive here.

## Ask

New `ctx.auth` method:

```ts
ctx.auth.issueServiceToken(scope: ServiceTokenScope)
  → Promise<ScopedToken>
```

Where `ServiceTokenScope` is a narrow capability grant (e.g.
`'tool:register'`, `'methodology:install'`).

Semantics:

- Issues a JWT for the calling app's service account.
- Platform refuses to issue scopes the app doesn't have pre-authorized
  in its manifest's `spec.authz.serviceScopes` (new field).
- Short TTL (≤ 5 min default, configurable with ceiling per-tier).
- Audit event `auth.service_token_issued` on every call.

## Related

- Method's S1 surface (method-agent-port) takes this as an additive
  optional amendment: `CortexAuthFacade.issueServiceToken?`
  Marked optional for backward compat with existing ctx shapes that
  don't implement it.
- RFC-005 §4.1 (Auth pipeline) — extends the 5-stage pipeline with a
  service-account issuance stage.

## Blocks

Method PRD-066 Track B (which needs this to call the tool-registry
API introduced in issue O5).
