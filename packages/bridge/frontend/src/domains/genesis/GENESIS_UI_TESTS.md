# Genesis FAB & Chat Panel — UI Test Coverage

## Component Overview

### GenesisFAB Component (`GenesisFAB.tsx`)

**Purpose:** Floating action button for opening/closing Genesis chat, positioned in bottom-right corner.

**Key Features:**
1. **Rendering & Layout**
   - Circular button (h-14 w-14) with fixed positioning
   - Positioned in bottom-right corner (bottom-sp-4, right-sp-4)
   - Rounded-full for circular appearance
   - Shadow and hover effects

2. **Status Indicator**
   - Animated pulse badge when Genesis is active
   - Status indicator color: bio (active) or txt-dim (idle)
   - Positioned in top-right corner of button

3. **Icon Behavior**
   - Shows MessageCircle icon when closed
   - Shows ChevronUp icon when open
   - Smooth rotation (45°) when expanded

4. **Dragging**
   - Uses native mouse drag API (no jQuery UI)
   - mouseDown → mouseMov → mouseUp event sequence
   - Position constrained to prevent off-screen placement
   - Position persisted to localStorage (genesis-fab-position)

5. **State Management**
   - Loads initial position from localStorage on mount
   - Handles invalid JSON gracefully (defaults to x: 0, y: 0)
   - Saves position on drag end
   - Tracks isDragging state

6. **User Interactions**
   - Click toggles chat open/closed state
   - Hover effect: scale-110
   - Active effect: scale-95
   - Grab cursor on hover, grabbing on drag

7. **Accessibility**
   - title attribute shows "Genesis is active/idle"
   - Button semantic element
   - Clear visual feedback for all states

---

### GenesisChatPanel Component (`GenesisChatPanel.tsx`)

**Purpose:** Draggable modal for Genesis chat interaction with PTY output streaming.

**Key Features:**
1. **Rendering & Layout**
   - Fixed positioning modal (500px width, 600px height)
   - Only renders when isOpen=true
   - Rounded corners with border and shadow
   - Z-index: 50 (high stacking context)

2. **Header Bar**
   - Title: "Genesis Chat"
   - Status badge (Active/Idle) with color-coded background
   - Budget percentage and progress bar
   - Close button (X icon)
   - Draggable by clicking/holding header

3. **Terminal Area**
   - Scrollable content area (flex-1, overflow-y-auto)
   - Monospace font (font-mono)
   - Auto-scroll to bottom on new content
   - Displays SSE stream data from `/sessions/{sessionId}/stream`
   - Shows "[Genesis Chat Panel Ready]" on initial load
   - Shows "[Connecting...]" when SSE stream is connecting

4. **SSE Integration**
   - useSSE hook with `/sessions/genesis-root/stream` endpoint
   - Auto-reconnect every 3 seconds on connection loss
   - Only enables SSE when isOpen=true
   - Handles JSON and raw string data
   - Displays connection errors as "[Connection Error: ...]"

5. **Input Area**
   - Textarea for prompt input
   - Placeholder text: "Type a prompt (Shift+Enter for newline)..."
   - Send button with icon (Send or Loader2 spinner)
   - Button disabled when input is empty or sending

6. **Prompt Sending**
   - Enter key (without Shift) sends prompt
   - Shift+Enter inserts newline
   - POST `/sessions/{sessionId}/prompt` with { prompt: string }
   - Shows loading spinner during send
   - Clears input on successful send
   - Appends "> {prompt}" to terminal
   - Appends response from API to terminal
   - Handles API errors and displays them in terminal

7. **Dragging**
   - Header has grab cursor
   - mouseDown on header → mousemove → mouseup sequence
   - Position constrained within viewport (0, maxX) x (0, maxY)
   - Position persisted to localStorage (genesis-chat-position)
   - Header has select-none for smooth dragging

8. **Budget Tracking**
   - Shows budget percentage in top-right
   - Progress bar: bg-error when > 80%, else bg-bio
   - Width reflects budgetPercent

9. **Status Display**
   - Active status: bg-bio-dim text-bio
   - Idle status: bg-txt-muted/10 text-txt-dim

10. **State Management**
    - Loads position from localStorage on mount
    - Handles invalid JSON gracefully (defaults to x: 50, y: 50)
    - Saves position on drag end
    - Tracks isDragging state
    - Manages terminalOutput as array of strings
    - Manages inputValue state
    - Tracks isSending state during API calls

11. **Error Handling**
    - Gracefully handles SSE connection errors
    - Catches API errors on prompt send
    - Displays errors in terminal output
    - Sets sseError state for connection issues

12. **Accessibility**
    - title attributes on buttons ("Close", "Send prompt (Enter)")
    - Form semantics (textarea + button)
    - Placeholder text describes input
    - Live terminal updates visible to users

---

### Dashboard Integration

**Purpose:** Orchestrate Genesis FAB and chat panel in dashboard context.

**Key Features:**
1. **State Management**
   - isChatOpen state persisted to localStorage (genesis-chat-open)
   - genesisStatus: 'active' | 'idle'
   - budgetPercent: 0-100

2. **Genesis Status Polling**
   - Fetches /health endpoint every 5 seconds
   - Determines status: active_sessions > 1 = 'active', else 'idle'
   - Cleans up interval on unmount

3. **Budget Tracking**
   - Fetches `/sessions/genesis-root` when chat is open
   - Calculates percent: agents_spawned / max_agents * 100
   - Fetches every 10 seconds when chat is open
   - Gracefully handles missing session (sets to 0%)

4. **Component Integration**
   - Passes isChatOpen, status, budgetPercent to GenesisFAB
   - Passes isChatOpen, status, budgetPercent to GenesisChatPanel
   - handleToggleChat updates both component states and localStorage

5. **Page Layout**
   - FAB rendered outside PageShell (fixed positioning)
   - Chat panel rendered outside PageShell (fixed positioning)
   - Main content includes ProjectListView and EventStreamPanel

---

## Test Scenarios

### GenesisFAB Tests

1. ✓ Renders a circular button in bottom-right
2. ✓ Displays status indicator (active/idle)
3. ✓ Shows animated pulse when active
4. ✓ Shows correct icons (MessageCircle/ChevronUp)
5. ✓ Rotates 45° when expanded
6. ✓ Toggles chat state on click
7. ✓ Is draggable with mouse
8. ✓ Persists drag position to localStorage
9. ✓ Loads initial position from localStorage
10. ✓ Handles invalid localStorage data gracefully
11. ✓ Has hover and active effects
12. ✓ Shows correct title text based on status

### GenesisChatPanel Tests

1. ✓ Doesn't render when isOpen=false
2. ✓ Renders when isOpen=true
3. ✓ Displays status badge (Active/Idle)
4. ✓ Displays budget percentage and bar
5. ✓ Connects to SSE stream on open
6. ✓ Displays stream data in terminal
7. ✓ Auto-scrolls terminal to bottom
8. ✓ Allows typing in input
9. ✓ Sends prompt on Enter key
10. ✓ Doesn't send on Shift+Enter
11. ✓ Disables Send button when empty
12. ✓ Shows loading spinner while sending
13. ✓ Clears input after send
14. ✓ Appends prompt and response to terminal
15. ✓ Closes on close button click
16. ✓ Is draggable by header
17. ✓ Persists position to localStorage
18. ✓ Loads position from localStorage
19. ✓ Constrains position within viewport
20. ✓ Handles SSE connection errors
21. ✓ Handles API errors gracefully
22. ✓ Shows budget bar colors correctly
23. ✓ Has fixed positioning and correct dimensions
24. ✓ Has monospace terminal font
25. ✓ Retries SSE connection on failure

### Dashboard Tests

1. ✓ Renders FAB component
2. ✓ Renders chat panel when FAB is opened
3. ✓ Toggles chat open state on FAB click
4. ✓ Persists chat open state to localStorage
5. ✓ Fetches Genesis status every 5s
6. ✓ Determines active status correctly
7. ✓ Fetches session budget when chat opens
8. ✓ Passes correct props to FAB and panel
9. ✓ Handles missing Genesis session gracefully
10. ✓ Cleans up intervals on unmount

---

## Implementation Notes

### localStorage Keys
- `genesis-fab-position`: { x: number, y: number }
- `genesis-chat-position`: { x: number, y: number }
- `genesis-chat-open`: boolean

### API Endpoints
- `GET /health` — fetch Genesis status
- `GET /sessions/{sessionId}` — fetch session details
- `GET /sessions/{sessionId}/stream` — SSE stream for PTY output
- `POST /sessions/{sessionId}/prompt` — send prompt, returns { output: string }

### Component Dependencies
- **GenesisFAB**: React hooks, Lucide icons, cn utility
- **GenesisChatPanel**: React hooks, Lucide icons, cn utility, useSSE hook, API client
- **Dashboard**: React hooks, child components, API client, localStorage

### Styling
- Uses Tailwind classes with custom color tokens
- Semantic colors: bio (primary), error (danger), txt-dim (muted)
- Spacing utilities: sp-* (custom spacing scale)
- Border utilities: border, bdr (border color)

### Accessibility Considerations
- Buttons have semantic HTML
- Title attributes provide status information
- Form inputs have placeholder text
- Visual feedback for all interactions
- Proper color contrast maintained
