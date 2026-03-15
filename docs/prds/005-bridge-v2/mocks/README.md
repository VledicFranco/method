# Dashboard Mocks

UI mockups for the Phase 2 dashboard (`GET /dashboard`).

## Mockups

- `dashboard-overview.html` — Full dashboard: health cards, subscription usage meters, session table with token usage + cache hit rates, status/cache reference tables

## Design system

Follows Vidtecci OS Design Guide (`pv-vidtecci/docs/design-guides/os-design-guide.html`).

## Design constraints

- Server-rendered HTML — no JavaScript framework, no WebSocket
- Auto-refresh via meta tag (5 second interval for dashboard, 60 second for usage polling)
- Single page — no navigation, no routing
- Responsive but desktop-primary (operator has a browser tab open alongside terminal)
- Color coding for statuses: bioluminescent/green (ready), solar/amber (working), red (dead), gray (initializing)
- Color coding for subscription meters: bioluminescent (0-60%), solar (60-85%), red (85-100%)
- Color coding for cache hit rates: bioluminescent (70%+), solar (40-69%), dim (&lt;40%)
