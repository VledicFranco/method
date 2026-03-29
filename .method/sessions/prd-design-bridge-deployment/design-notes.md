# PRD Design Notes — bridge-deployment

## Tier: standard
## Phase: 1 (Discovery)

### Layer 1: WHY

- Q1 (Problem): The bridge runs as a single-instance Node.js process on mission-control. There is no mechanism for agents to spin up isolated test instances without risking interference with the 24/7 production bridge. Secrets (.env) are gitignored — every new machine or clone requires manual secret copying. There is no packaging mechanism to install the bridge on another machine beyond cloning the full repo and building from source.

- Q2 (Who): The human operator (Franco) who runs the bridge across multiple machines on a Tailscale mesh. Also: Claude Code agents that need to validate bridge changes against isolated test instances. Also: any new machine joining the mesh that needs to run a bridge.

- Q3 (Evidence): `.env` is gitignored with 2 API keys (ANTHROPIC_API_KEY, VOYAGE_API_KEY). 1Password 8 is installed but `op` CLI is not on PATH. No Docker, systemd, pm2, or packaging config exists. Guide 15 documents manual start as a known limitation. The bridge already supports PORT env var but there's no profile/instance orchestration layer.

- Q4 (Cost of inaction): Each new machine requires manual secret setup (error-prone, blocks automation). Agents testing bridge changes risk colliding with production bridge. No reproducible "install the bridge" path — each machine is a bespoke setup.

- Q5 (Urgency): The bridge has reached operational maturity (137+ projects, event bus, strategies, genesis). The next growth vector is multi-machine operation and agent-driven testing — both blocked without deployment infrastructure.

### Layer 2: WHAT

- Q6 (Solution): Three capabilities: (1) Instance profiles — named .env files that configure isolated bridge instances on different ports with separate state. (2) 1Password CLI integration — `.env.tpl` files with `op://` references, resolved at runtime by `op run`. (3) npm pack packaging — tarballs published to GitHub Releases for portable installation.

- Q7 (Alternatives):
  - Alt 1: Docker for everything (including production). Rejected: production bridge needs direct filesystem access to 137+ repos for discovery, file watchers, git polling. Container volume mounts add complexity and latency for no gain on the primary machine.
  - Alt 2: SOPS/git-crypt for secrets. Rejected: requires distributing decryption keys to each machine — moves the secret distribution problem rather than solving it. 1Password already handles credential sync.
  - Alt 3: Full cloud deployment (AWS/GCP). Rejected: the bridge is tightly coupled to local filesystem and Claude Code CLI. Cloud adds latency and complexity for a private, single-user tool.

- Q8 (Out of scope): Docker containerization (deferred), cloud deployment, systemd/launchd auto-start services, pv-silky portal packaging, CI/CD pipeline, multi-user auth.

- Q9 (Success): (1) An agent can spin up and tear down a test bridge instance in <30s without affecting production. (2) A fresh machine with 1Password + Node.js can run the bridge with zero manual secret copying. (3) `npm pack` produces a working tarball installable on any Node.js machine.

- Q10 (Acceptance criteria): See PRD AC section.

### Layer 3: HOW

- Q11 (Dependencies): 1Password 8 desktop app (installed), 1Password CLI `op` (needs enabling), Node.js 22+ (installed), Tailscale (installed on mission-control), npm pack (built-in).

- Q12 (Risks): (1) `op` CLI availability varies across machines — need graceful fallback. (2) Instance profile port collisions if not managed. (3) npm pack may not capture all needed files (frontend dist, registry).

- Q13 (Rollout): Phased — profiles first (immediate utility), then secrets, then packaging. Each phase is independently useful.

- Q14 (Monitoring): Bridge health endpoint already exists. Instance identity should be visible in /health response.

- Q15 (Rollback): All changes are additive. Remove profiles dir, revert start-bridge.js, done.

### Layer 4: CONSTRAINTS

- Q16 (Appetite): Small — 3 phases, each ~1 session of work.
- Q17 (NFRs): Instance startup <5s, zero impact on existing `npm run bridge` workflow.
- Q18 (Cross-cutting): Must update CLAUDE.md deployment section, Guide 15, bridge arch doc.

### Open Markers
(none)
