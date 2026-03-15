# Dashboard Mocks

UI mockups for the Phase 2 dashboard (`GET /dashboard`).

## Planned mockups

- `dashboard-overview.png` — Main dashboard view showing session table, health header
- `dashboard-states.png` — Session status color states (initializing, ready, working, dead)

## Design constraints

- Server-rendered HTML — no JavaScript framework, no WebSocket
- Auto-refresh via meta tag (5 second interval)
- Single page — no navigation, no routing
- Responsive but desktop-primary (operator has a browser tab open alongside terminal)
- Color coding: green (ready), yellow (working), red (dead), gray (initializing)
