---
type: outbound
scope: comms-document
channel: ceo-arturo
date: 2026-04-19
status: draft
author: CTO
direction: outbound
summary: Short nudge to CEO — method libraries shipped to npm, S1 ratified, Cortex action items pending. Five bullets, one ask.
token_estimate: 500
key_points:
  - 14 @methodts/* packages published to npm at v0.2.0 (2026-04-19), including @methodts/pacta-provider-claude-agent-sdk (the SDK-backed provider that lets tenant apps reuse Anthropic's claude-agent-sdk as the inner loop while keeping budget/audit enforcement).
  - S1 (method-agent-port) frozen method-side; awaits Cortex countersignature + Surface Advocate nomination per co-design/CHANGES.md §RACI.
  - Four Cortex asks (O1/O5/O6/O7) drafted and ready to file — SDK-path currently runs in degraded mode until O1 (ctx.llm.reserve/settle) lands.
  - April 21 influencer demo leverages method-backed agents running under real Cortex governance; the SDK provider was the missing rung and is now shipped.
  - Escalation path per ov-t1/projects/t1-cortex/method-integration.md §7 (one-week Cortex response SLA; escalate via this channel thereafter).
key_asks:
  - Amplify the 4 Cortex issues (O1/O5/O6/O7) via Antar / Fernando Martínez so they get prioritized this sprint.
stakeholder_position: proactive nudge — no decision pending, informational + amplification ask
---

# Nudge — Method libraries shipped to npm + S1 ratified

**De:** Franco
**Para:** Arturo
**Fecha:** 19 de abril de 2026

Arturo, cinco bullets:

1. **Shipped hoy:** las 14 librerías `@methodts/*` están publicadas en npm a `v0.2.0`. Incluye el nuevo `@methodts/pacta-provider-claude-agent-sdk` — el provider que deja que las tenant apps de Cortex reusen el `claude-agent-sdk` de Anthropic como inner loop, manteniendo budget + audit + auth enforcement de Cortex. Es la pieza que nos faltaba para el demo del 21.

2. **S1 (method-agent-port) frozen** método-side con compilation_record completo. Falta countersignature de Cortex — necesito que Cortex nombre Surface Advocate (sugerido: Fernando Martínez, ya tiene track record con `/fcd-debate` en ADR-02) y firme per `co-design/CHANGES.md §RACI`. Contexto completo en `ov-t1/projects/t1-cortex/method-integration.md §3.1`.

3. **Cuatro asks a Cortex pendientes de filing** (O1/O5/O6/O7) — ya tengo drafts en `tmp/cortex-issue-O{1,5,6,7}.md` en el repo `method`. El más importante es O1 (`ctx.llm.reserve/settle`) porque el SDK-path actualmente corre en **degraded mode** hasta que eso aterrice. Los otros tres desbloquean PRD-066 Track B.

4. **Demo 21 de abril** apalanca agentes method-backed corriendo sobre governance real de Cortex. El SDK provider era el peldaño faltante y ya está en producción; el degraded mode no bloquea el demo (emite audit post-turn con costo real, solo no reserva pre-flight).

5. **Escalation path** en `method-integration.md §7`: SLA de una semana para respuesta de Cortex; si no hay señal, escalo por este mismo canal. Lo que te pido hoy es que **empujes a Antar / Fernando para que los 4 issues (O1/O5/O6/O7) entren a sprint este ciclo** — sin O1 no flipeamos el SDK path a full mode, y sin O5/O6/O7 no arranca Track B de PRD-066.

— Franco
