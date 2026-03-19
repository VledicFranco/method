---
name: 5mp-pitch
description: |
  Build scroll-driven, self-contained HTML pitches using the 5mp framework. Use when asked to
  create a pitch, presentation, one-pager, RFC visual, landing page, or any persuasive
  single-file HTML document. Produces zero-dependency, offline-capable, animated HTML files.
---

# 5mp Pitch Builder

You are building a **5-Minute Pitch** — a self-contained, scroll-driven HTML file that communicates a complex idea in under 5 minutes through progressive disclosure and animation.

**Source repo:** `oss-5mp/` | **Examples:** `oss-5mp/examples/`

## Hard Constraints

1. **Single HTML file** — all CSS in `<style>`, all JS in `<script>`, SVGs inline, no external deps
2. **< 1MB total** — optimize SVGs, no base64 images unless tiny
3. **Zero dependencies** — no React, no GSAP, no CDN links, no npm, no build step
4. **Works offline** — double-click the file, it works
5. **7 sections exactly** — follow the narrative arc below
6. **Mobile responsive** — must work at 375px viewport
7. **Accessible** — `prefers-reduced-motion`, semantic HTML, keyboard nav, color contrast

## The 7-Section Narrative Arc

| # | Section | Time | Emotion | What Goes Here |
|---|---------|------|---------|----------------|
| 1 | **Hook** | 5s | Curiosity | Title + one-liner + visual hook (icon, animation, gradient) |
| 2 | **Problem** | 20s | Recognition | 3 concrete pain points as cards, staggered reveal |
| 3 | **Opportunity** | 15s | Hope | Why now? 2-3 metrics with counter animations |
| 4 | **Solution** | 30s | "Aha!" | High-level description + SVG architecture diagram |
| 5 | **How It Works** | 60s | Confidence | 3-step process, terminal examples, demos |
| 6 | **Impact** | 30s | Conviction | 3-4 metrics + before/after comparison |
| 7 | **Next Steps** | 10s | Readiness | 1-2 CTA buttons, timeline, contact |

**Never skip a section. Never add more than 7.** Use detail panels for depth.

## Process

1. **Ask 6 questions** before building:
   - What are you pitching? (product, RFC, initiative, tool)
   - Who is the audience? (engineers, executives, investors, users)
   - What's the one desired outcome? (approval, adoption, funding, awareness)
   - What context does the audience have? (experts, newcomers, mixed)
   - What assets exist? (logos, screenshots, metrics, quotes)
   - What's the brand? (colors, tone, personality)

2. **Draft the 7-section outline** with specific content for each section
3. **Confirm outline** with the user before writing HTML
4. **Build the pitch** following this skill's patterns
5. **Review against the checklist** at the bottom

## HTML Skeleton

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PITCH_TITLE</title>
  <style>
    /* === RESET === */
    * { margin: 0; padding: 0; box-sizing: border-box; }

    /* === VARIABLES — customize these === */
    :root {
      --primary: #2563eb;
      --secondary: #7c3aed;
      --success: #10b981;
      --text-dark: #1f2937;
      --text-body: #4b5563;
      --bg-light: #f9fafb;
      --bg-white: #ffffff;
      --font-display: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      --font-body: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      --font-mono: 'Monaco', 'Inconsolata', 'Consolas', monospace;
      --spacing-xs: 0.5rem;
      --spacing-sm: 1rem;
      --spacing-md: 2rem;
      --spacing-lg: 4rem;
      --spacing-xl: 8rem;
    }

    body {
      font-family: var(--font-body);
      color: var(--text-body);
      line-height: 1.6;
      overflow-x: hidden;
      scroll-behavior: smooth;
    }

    /* === SECTIONS === */
    .section {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-lg) var(--spacing-md);
      position: relative;
    }
    .section__content {
      max-width: 1200px;
      width: 100%;
      text-align: center;
    }

    /* === TYPOGRAPHY === */
    h1 { font-family: var(--font-display); font-size: clamp(2.5rem, 5vw, 4rem); font-weight: 700; color: var(--text-dark); margin-bottom: var(--spacing-sm); line-height: 1.1; }
    h2 { font-family: var(--font-display); font-size: clamp(2rem, 4vw, 3rem); font-weight: 700; color: var(--text-dark); margin-bottom: var(--spacing-sm); line-height: 1.2; }
    h3 { font-size: clamp(1.25rem, 2.5vw, 1.75rem); font-weight: 600; color: var(--text-dark); margin-bottom: var(--spacing-xs); }
    p { font-size: clamp(1rem, 2vw, 1.25rem); max-width: 700px; margin: 0 auto var(--spacing-md); }
    .subtext { font-size: clamp(0.875rem, 1.5vw, 1.125rem); color: var(--text-body); opacity: 0.8; }

    /* === SCROLL ANIMATIONS === */
    .fade-in { opacity: 0; transition: opacity 0.8s ease-out; }
    .fade-in.visible { opacity: 1; }
    .slide-up { opacity: 0; transform: translateY(50px); transition: opacity 0.8s ease-out, transform 0.8s ease-out; }
    .slide-up.visible { opacity: 1; transform: translateY(0); }
    .slide-in-left { opacity: 0; transform: translateX(-50px); transition: opacity 0.8s ease-out, transform 0.8s ease-out; }
    .slide-in-left.visible { opacity: 1; transform: translateX(0); }
    .slide-in-right { opacity: 0; transform: translateX(50px); transition: opacity 0.8s ease-out, transform 0.8s ease-out; }
    .slide-in-right.visible { opacity: 1; transform: translateX(0); }
    .scale-in { opacity: 0; transform: scale(0.9); transition: opacity 0.8s ease-out, transform 0.8s ease-out; }
    .scale-in.visible { opacity: 1; transform: scale(1); }
    .stagger-1 { transition-delay: 0.1s; }
    .stagger-2 { transition-delay: 0.2s; }
    .stagger-3 { transition-delay: 0.3s; }
    .stagger-4 { transition-delay: 0.4s; }

    /* === BACKGROUNDS === */
    .bg-white { background-color: var(--bg-white); }
    .bg-light { background-color: var(--bg-light); }
    .bg-gradient { background: linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%); color: white; }
    .bg-gradient h1, .bg-gradient h2, .bg-gradient h3, .bg-gradient p { color: white; }

    /* === PROGRESS BAR === */
    .progress-bar { position: fixed; top: 0; left: 0; height: 3px; background: var(--primary); z-index: 9999; transition: width 0.1s; }

    /* === BUTTONS === */
    .button { display: inline-block; padding: 1rem 2rem; font-size: 1.125rem; font-weight: 600; text-decoration: none; border-radius: 0.5rem; transition: all 0.3s ease; cursor: pointer; border: none; }
    .button-primary { background-color: var(--primary); color: white; }
    .button-primary:hover { transform: translateY(-2px); box-shadow: 0 10px 20px rgba(37, 99, 235, 0.3); }
    .button-secondary { background-color: transparent; color: var(--primary); border: 2px solid var(--primary); }
    .button-secondary:hover { background-color: var(--primary); color: white; }

    /* === FEATURE GRID (Problem cards) === */
    .feature-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: var(--spacing-md); margin-top: var(--spacing-lg); }
    .feature-card { padding: var(--spacing-md); background: white; border-radius: 1rem; box-shadow: 0 4px 6px rgba(0,0,0,0.1); transition: transform 0.3s ease, box-shadow 0.3s ease; }
    .feature-card:hover { transform: translateY(-5px); box-shadow: 0 10px 20px rgba(0,0,0,0.15); }
    .feature-icon { font-size: 3rem; margin-bottom: var(--spacing-sm); }

    /* === METRICS (Counters) === */
    .metrics { display: flex; justify-content: center; gap: var(--spacing-lg); flex-wrap: wrap; margin-top: var(--spacing-lg); }
    .metric { text-align: center; }
    .metric-value { font-size: clamp(2.5rem, 5vw, 4rem); font-weight: 700; color: var(--primary); display: block; }
    .metric-label { font-size: 1rem; color: var(--text-body); opacity: 0.8; }

    /* === DETAIL PANELS (horizontal exploration) === */
    .detail-trigger { margin-top: var(--spacing-md); color: var(--primary); cursor: pointer; display: inline-flex; align-items: center; gap: 0.5rem; font-weight: 600; transition: gap 0.3s ease; }
    .detail-trigger:hover { gap: 1rem; }
    .detail-panel { position: fixed; right: -500px; top: 0; width: 90%; max-width: 500px; height: 100vh; background: white; box-shadow: -5px 0 20px rgba(0,0,0,0.2); padding: var(--spacing-lg) var(--spacing-md); overflow-y: auto; transition: right 0.3s ease; z-index: 1000; }
    .detail-panel.open { right: 0; }
    .detail-close { position: absolute; top: var(--spacing-md); right: var(--spacing-md); font-size: 2rem; cursor: pointer; background: none; border: none; color: var(--text-body); }

    /* === RESPONSIVE === */
    @media (max-width: 768px) {
      .section { padding: var(--spacing-md) var(--spacing-sm); }
      .feature-grid { grid-template-columns: 1fr; }
      .metrics { gap: var(--spacing-md); }
      .button { width: 100%; text-align: center; }
    }

    /* === ACCESSIBILITY === */
    @media (prefers-reduced-motion: reduce) {
      * { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
    }
  </style>
</head>
<body>
  <div class="progress-bar" id="progress"></div>

  <section id="hook" class="section bg-gradient">
    <div class="section__content">
      <div class="fade-in" style="font-size: 4rem;">ICON</div>
      <h1 class="fade-in stagger-1">TITLE</h1>
      <p class="fade-in stagger-2">ONE_LINER</p>
    </div>
  </section>

  <section id="problem" class="section bg-white">
    <div class="section__content">
      <h2 class="fade-in">The Problem</h2>
      <p class="fade-in stagger-1">PROBLEM_SUMMARY</p>
      <div class="feature-grid">
        <div class="feature-card slide-up"><div class="feature-icon">EMOJI</div><h3>Pain 1</h3><p>DESC</p></div>
        <div class="feature-card slide-up stagger-1"><div class="feature-icon">EMOJI</div><h3>Pain 2</h3><p>DESC</p></div>
        <div class="feature-card slide-up stagger-2"><div class="feature-icon">EMOJI</div><h3>Pain 3</h3><p>DESC</p></div>
      </div>
    </div>
  </section>

  <section id="opportunity" class="section bg-light">
    <div class="section__content">
      <h2 class="fade-in">The Opportunity</h2>
      <p class="fade-in stagger-1">WHY_NOW</p>
      <div class="metrics">
        <div class="metric slide-up"><span class="metric-value" data-count="NUM">0</span><span class="metric-label">LABEL</span></div>
        <div class="metric slide-up stagger-1"><span class="metric-value" data-count="NUM">0</span><span class="metric-label">LABEL</span></div>
        <div class="metric slide-up stagger-2"><span class="metric-value" data-count="NUM">0</span><span class="metric-label">LABEL</span></div>
      </div>
    </div>
  </section>

  <section id="solution" class="section bg-white">
    <div class="section__content">
      <h2 class="fade-in">The Solution</h2>
      <p class="fade-in stagger-1">SOLUTION_SUMMARY</p>
      <div class="scale-in stagger-2">
        <!-- SVG ARCHITECTURE DIAGRAM HERE -->
      </div>
    </div>
  </section>

  <section id="how" class="section bg-light">
    <div class="section__content">
      <h2 class="fade-in">How It Works</h2>
      <div class="feature-grid">
        <div class="feature-card slide-up"><h3>Step 1</h3><p>DESC</p></div>
        <div class="feature-card slide-up stagger-1"><h3>Step 2</h3><p>DESC</p></div>
        <div class="feature-card slide-up stagger-2"><h3>Step 3</h3><p>DESC</p></div>
      </div>
    </div>
  </section>

  <section id="impact" class="section bg-white">
    <div class="section__content">
      <h2 class="fade-in">The Impact</h2>
      <div class="metrics">
        <div class="metric slide-up"><span class="metric-value" data-count="NUM">0</span><span class="metric-label">LABEL</span></div>
        <div class="metric slide-up stagger-1"><span class="metric-value" data-count="NUM">0</span><span class="metric-label">LABEL</span></div>
        <div class="metric slide-up stagger-2"><span class="metric-value" data-count="NUM">0</span><span class="metric-label">LABEL</span></div>
      </div>
    </div>
  </section>

  <section id="cta" class="section bg-gradient">
    <div class="section__content">
      <h2 class="fade-in">Next Steps</h2>
      <p class="fade-in stagger-1">CTA_TEXT</p>
      <div class="fade-in stagger-2" style="display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; margin-top: var(--spacing-md);">
        <a href="#" class="button button-primary" style="background: white; color: var(--primary);">Primary CTA</a>
        <a href="#" class="button button-secondary" style="border-color: white; color: white;">Secondary CTA</a>
      </div>
    </div>
  </section>

  <script>
    // Progress bar
    window.addEventListener('scroll', () => {
      const pct = (window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100;
      document.getElementById('progress').style.width = pct + '%';
    });

    // Scroll animations
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
    }, { threshold: 0.2, rootMargin: '0px 0px -100px 0px' });
    document.querySelectorAll('.fade-in,.slide-up,.slide-in-left,.slide-in-right,.scale-in').forEach(el => observer.observe(el));

    // Counter animations
    const counterObs = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting && !e.target.dataset.animated) {
          e.target.dataset.animated = 'true';
          const target = parseInt(e.target.dataset.count);
          const duration = 2000, start = performance.now();
          (function step(now) {
            const p = Math.min((now - start) / duration, 1);
            e.target.textContent = Math.floor(p * target);
            if (p < 1) requestAnimationFrame(step);
          })(start);
        }
      });
    }, { threshold: 0.5 });
    document.querySelectorAll('[data-count]').forEach(el => counterObs.observe(el));

    // Detail panels
    function openDetail(id) { document.getElementById(id).classList.add('open'); }
    function closeDetail(id) { document.getElementById(id).classList.remove('open'); }
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') document.querySelectorAll('.detail-panel.open').forEach(p => p.classList.remove('open'));
    });
  </script>
</body>
</html>
```

## Component Patterns

### Terminal Window (for dev tools — Section 5)

```html
<div style="background: #1e293b; border-radius: 0.75rem; overflow: hidden; max-width: 600px; margin: 2rem auto; text-align: left;">
  <div style="display: flex; gap: 0.5rem; padding: 0.75rem 1rem; background: #0f172a;">
    <span style="width:12px;height:12px;border-radius:50%;background:#ff5f57;"></span>
    <span style="width:12px;height:12px;border-radius:50%;background:#ffbd2e;"></span>
    <span style="width:12px;height:12px;border-radius:50%;background:#28c940;"></span>
  </div>
  <div style="padding: 1rem; font-family: monospace; font-size: 0.875rem; color: #e2e8f0; line-height: 1.8;">
    <div><span style="color:#10b981;">$</span> your-command --flag</div>
    <div style="color:#94a3b8;">Output line here</div>
  </div>
</div>
```

### SVG Architecture Diagram (Section 4)

```html
<svg width="100%" viewBox="0 0 800 300" style="max-width: 800px; margin: 2rem auto; display: block;">
  <rect x="50" y="110" width="160" height="80" fill="var(--primary)" opacity="0.15" rx="12" stroke="var(--primary)" stroke-width="2"/>
  <text x="130" y="155" text-anchor="middle" font-size="15" font-weight="600" fill="var(--text-dark)">Component A</text>
  <line x1="210" y1="150" x2="290" y2="150" stroke="var(--primary)" stroke-width="2" stroke-dasharray="6,4"/>
  <polygon points="290,150 280,145 280,155" fill="var(--primary)"/>
  <rect x="290" y="110" width="160" height="80" fill="var(--secondary)" opacity="0.15" rx="12" stroke="var(--secondary)" stroke-width="2"/>
  <text x="370" y="155" text-anchor="middle" font-size="15" font-weight="600" fill="var(--text-dark)">Component B</text>
</svg>
```

Use `fill="var(--primary)"` to match the pitch's color scheme. Add more boxes, arrows, and labels as needed. Keep SVGs simple — this is a pitch, not a technical diagram.

### Before/After Comparison (Section 6)

```html
<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; max-width: 700px; margin: 2rem auto; text-align: left;">
  <div>
    <h3 style="color: #ef4444; margin-bottom: 1rem;">Before</h3>
    <ul style="list-style: none; padding: 0;">
      <li style="padding: 0.5rem 0; border-bottom: 1px solid #f3f4f6;">PAIN_1</li>
      <li style="padding: 0.5rem 0; border-bottom: 1px solid #f3f4f6;">PAIN_2</li>
      <li style="padding: 0.5rem 0;">PAIN_3</li>
    </ul>
  </div>
  <div>
    <h3 style="color: var(--success); margin-bottom: 1rem;">After</h3>
    <ul style="list-style: none; padding: 0;">
      <li style="padding: 0.5rem 0; border-bottom: 1px solid #f3f4f6;">BENEFIT_1</li>
      <li style="padding: 0.5rem 0; border-bottom: 1px solid #f3f4f6;">BENEFIT_2</li>
      <li style="padding: 0.5rem 0;">BENEFIT_3</li>
    </ul>
  </div>
</div>
```

## Advanced Visual Techniques

Use these to elevate beyond the basic template. Pick 1-2 per pitch — never all of them.

### Particle Network Hero (canvas background)

Adds a living, interactive particle system behind the hook section. Mouse repels particles. Best for tech/innovation pitches.

```html
<canvas id="particles" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;"></canvas>
```
```javascript
// In Section 1, add canvas as first child. JS creates ~80 particles with:
// - Random position, velocity, radius (1-3px)
// - Connection lines between particles within 150px distance
// - Mouse repulsion (optional: set pointer-events:auto on canvas)
// - Colors from --primary variable
// - requestAnimationFrame loop
```

### Text Scramble Animation

Title letters resolve from random symbols. Great for tech/science branding.

```javascript
// Target text: "Your Title"
// Charset: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%'
// 20 steps at 50ms each
// Each step: first N chars resolved, rest randomized (N increases each step)
```

### Breathing Glow Effect

Elements pulse with a soft glow. Best for dark themes.

```css
@keyframes breathe {
  0%, 100% { text-shadow: 0 0 10px rgba(var(--glow-rgb), 0.3); }
  50% { text-shadow: 0 0 30px rgba(var(--glow-rgb), 0.6), 0 0 60px rgba(var(--glow-rgb), 0.2); }
}
.glow { animation: breathe 3s ease-in-out infinite; }
```

### Border Beam (rotating gradient border)

CSS-only animated border. Uses `@property` for rotation.

```css
@property --beam-angle { syntax: '<angle>'; initial-value: 0deg; inherits: false; }
.beam { position: relative; }
.beam::before {
  content: ''; position: absolute; inset: -2px; border-radius: inherit; z-index: -1;
  background: conic-gradient(from var(--beam-angle), transparent 60%, var(--primary) 80%, transparent 100%);
  animation: beam-rotate 4s linear infinite;
}
@keyframes beam-rotate { to { --beam-angle: 360deg; } }
```

### SVG Dash Draw (diagrams that draw themselves)

```css
.draw-line {
  stroke-dasharray: 500;
  stroke-dashoffset: 500;
  transition: stroke-dashoffset 1.5s ease-out;
}
.draw-line.visible { stroke-dashoffset: 0; }
```

## Design Guide

### Color Palette Selection

Choose palette based on pitch personality:

| Personality | Primary | Secondary | Success |
|-------------|---------|-----------|---------|
| Technical/Professional | `#2563eb` blue | `#7c3aed` purple | `#10b981` green |
| Creative/Innovative | `#f97316` orange | `#8b5cf6` violet | `#06b6d4` cyan |
| Enterprise/Serious | `#0f172a` navy | `#475569` slate | `#10b981` green |
| Friendly/Approachable | `#3b82f6` bright blue | `#ec4899` pink | `#22c55e` lime |
| Dark/Premium | `#050505` black | `#e2012d` red | `#00d46a` green |

For dark themes: invert the text colors (`--text-dark: #f0f4f8`, `--text-body: #a0aec0`, `--bg-white: #0a0a0a`, `--bg-light: #111111`).

### Typography Rules

- **Body text**: 18px+ (use `clamp(1rem, 2vw, 1.25rem)`)
- **Headings**: system fonts by default. Use Google Fonts (inline `@import`) for branded pitches.
- **Monospace**: always use `var(--font-mono)` for code/terminal
- **Max paragraph width**: 700px (prevents eye strain)
- **Line height**: 1.6 for body, 1.1-1.2 for headings

### Animation Restraint

**Use max 2-3 animation types per pitch.** The best pitches pick one primary animation (e.g., `slide-up`) and one accent (e.g., `fade-in` for text), then use staggering for variety.

| Section | Recommended Animation |
|---------|-----------------------|
| Hook | `fade-in` with stagger |
| Problem | `slide-up` for cards with stagger |
| Opportunity | `slide-in-left` or `fade-in`, counters |
| Solution | `scale-in` for diagram, `fade-in` for text |
| How It Works | `slide-up` for steps with stagger |
| Impact | counters + `fade-in` |
| CTA | `fade-in` with stagger |

### Visual Hierarchy Checklist

- Section title: largest text, `--text-dark`, bold
- Section subtitle: medium, `--text-body`
- Card titles: smaller bold, `--text-dark`
- Card body: regular, `--text-body`
- Metrics: oversized numbers in `--primary`, small labels below
- CTAs: high contrast buttons, generous padding

## Writing Rules

- **Active voice**: "Transform X" not "X will be transformed"
- **Specific metrics**: "85% reduction" not "significant improvement"
- **Short sentences**: 15-20 words max
- **Short paragraphs**: 2-3 sentences max
- **No filler**: never use "many", "some", "various" — use actual numbers
- **Show, don't tell**: terminal examples > feature descriptions

## Anti-Patterns

- Adding more than 7 sections (use detail panels instead)
- External CDN links or npm packages
- File size > 1MB
- More than 3 animation types
- Placeholder metrics ("XX%") — use real numbers or remove
- Generic stock-photo aesthetics — use SVG, emoji, or pure CSS visuals
- Walls of text — if you need paragraphs, use a detail panel
- Animated everything — most elements should be static; animate only what matters
- Base64-encoded large images — use SVG or link external
- Complex JS state management — keep scripts under 100 lines

## Delivery Checklist

Before handing off the pitch, verify:

- [ ] All 7 sections present with real content
- [ ] Counter animations trigger on scroll
- [ ] Progress bar updates smoothly
- [ ] Detail panels open/close (if used)
- [ ] ESC closes panels
- [ ] Mobile layout works (375px)
- [ ] `prefers-reduced-motion` respected
- [ ] Semantic HTML (`<section>`, proper headings)
- [ ] No console errors
- [ ] Color contrast passes WCAG AA
- [ ] File size < 1MB
- [ ] Works when double-clicked from filesystem (offline)
