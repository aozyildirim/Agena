# Agena — Enterprise Dashboard Design System

> Status: implemented on branch `redesign/enterprise-ui-agena`.
> Scope: the **dashboard shell** (`.agena-app`) only. The marketing site keeps
> its existing teal/glass identity — nothing outside `/dashboard` changes.

The goal of this redesign is an **enterprise-grade, developer-focused, neutral**
console in the spirit of Azure DevOps (density), GitHub (cleanliness), Linear
(typography) and Datadog (observability). No colorful/emoji icons, no
glassmorphism, no neon glow, no marketing gradients.

---

## 1. Design principles (what changed and why)

| Before (consumer / "startup") | After (enterprise) |
|---|---|
| Emoji icons (🏠 📋 🤖 …) | Monochrome 24×24 line icons (`currentColor`) |
| Glassmorphism (`backdrop-filter: blur`) on sidebar/topbar | Solid `--surface` panels |
| Teal-everywhere + purple/blue/pink accents | Neutral gray palette + **one** restrained steel-blue accent |
| Neon glows / drop shadows / gradient bars | Flat surfaces, hairline borders |
| 24px rounded cards, 32px padding | 8–10px radii, 16–20px padding (denser) |
| 32px bold rainbow headings, colored KPI numbers | 22px ink headings, ink KPI numbers + small status dot |

### The leverage point
The dashboard reads colour through CSS variables (`--panel`, `--border`,
`--ink-*`, `--nav-active`, …). We **re-point those tokens** inside a single
scope class `.agena-app` instead of editing hundreds of inline styles. One token
table re-skins every existing surface, in both light and dark mode, with zero
risk to behaviour.

---

## 2. Design tokens

Defined in `app/globals.css` under `.agena-app` (dark) and `html.light .agena-app`
(light). The marketing `:root` / `html.light` tokens are untouched.

### Neutral surfaces
| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg` | `#0a0c0f` | `#f4f6f8` | App canvas |
| `--surface` | `#0f1217` | `#ffffff` | Cards, sidebar, topbar |
| `--panel` | `#0c0f13` | `#ffffff` | Inner panels |
| `--panel-alt` | `#12161c` | `#f6f8fa` | Stat cells, zebra |
| `--border` / `--panel-border` | `rgba(255,255,255,.07)` | `rgba(0,0,0,.09)` | Hairline borders |

### Text hierarchy
`--ink` → `--ink-90` → `--ink-78` → `--ink-65` → `--ink-50` → `--ink-35` → `--ink-25`
(opacity ramp; light mode uses higher opacities for WCAG AA).

### Accent (the only one)
| Token | Dark | Light | Use |
|---|---|---|---|
| `--acc` | `#5b9bd5` | `#2f6db5` | Links, primary button, active markers |
| `--acc-soft` | `rgba(91,155,213,.14)` | `rgba(47,109,181,.10)` | Subtle active backgrounds |

### Status (desaturated, fixed across themes — used only as small dots/bars)
`green #3f9d6a` · `amber #c98a2b` · `red #cf5b57` · `acc #5b9bd5`

### Active navigation
`--nav-active` = neutral ink (not teal); `--nav-active-bg` = faint neutral fill;
`--nav-active-border` = hairline. Active = a quiet highlight, never a colour pop.

### Shape & motion
- Radii: cards `10px`, controls/buttons `6–8px`, dots `50%`.
- No `transform: translateY` lift, no glow `box-shadow`. Hover = border-color shift only.
- Transitions 0.15s.

---

## 3. UI architecture / Information architecture

```
DashboardLayout (.agena-app)            packages: app/dashboard/layout.tsx
├── Topbar (fixed, 56px, solid surface)
│   ├── Brand / logo
│   ├── Org chip
│   ├── + New Task (solid accent)
│   ├── Sprint switcher
│   ├── Theme + Lang toggles
│   ├── Integration shortcuts (Sentry/NewRelic) · Usage · Bell
│   └── Profile avatar · Logout
├── Sidebar (fixed, 220 / 76px collapsed, solid surface)
│   ├── Org card / Workspace switcher
│   └── Nav groups (collapsible, text-first + mono line icon)
│        Workspace · AI · Analytics · Settings
└── Main (workspace area, marginLeft = sidebar width)
     └── <page>
```

> **Note on the IA:** the existing route map and RBAC/module guards are
> preserved exactly — only the *visual language* of the nav changed (icons +
> palette + density). The aspirational top-level taxonomy from the brief
> (Overview · Agents · Workflows · Knowledge Bases · Tools · Tasks ·
> Executions · Observability · API Keys · Team · Billing · Settings) maps onto
> current routes as follows; the wireframes below are drawn against it.

| Brief item | Current route |
|---|---|
| Overview | `/dashboard` |
| Agents | `/dashboard/agents` |
| Workflows | `/dashboard/flows` |
| Knowledge Bases | (new surface — `/memory` API exists; see §5.4) |
| Tools | `/dashboard/integrations` |
| Tasks | `/dashboard/tasks` |
| Executions | `/dashboard/tasks/[id]` (monitoring view) |
| Observability | `/dashboard/dora`, `/dashboard/insights` |
| API Keys | `/dashboard/integrations` |
| Team | `/dashboard/team` |
| Billing | `/dashboard/usage` |
| Settings | `/dashboard/modules`, `/dashboard/permissions` |

---

## 4. Component hierarchy

```
NavIcon (components/NavIcon.tsx)      — 40+ monochrome 24×24 line glyphs, currentColor
Shell primitives (globals.css, .agena-app scope)
├── .card                — flat 10px panel
├── .button / .button-primary / .button-outline — 6–8px, no glow
├── .section-label       — muted uppercase kicker
├── .ent-table           — dense professional table (uppercase header, hairline rows, hover)
└── .ent-dot             — 7px status dot
Page composition (inline styles reading the tokens)
├── KPI strip            — single bordered container, divided cells
├── Stat cell            — label + dot + ink number
├── Quota bar            — label + value + 5px progress
├── Operations panel     — metric grid + queue forecast list
├── Pipeline rail        — vertical dotted timeline
└── Quick-link row       — title + desc + chevron
```

---

## 5. Page wireframes

### 5.1 Overview (`/dashboard`) — implemented
```
┌───────────────────────────────────────────────────────────────────────┐
│ OVERVIEW                                                   [ Pro ]      │
│ Dashboard                                                               │
├───────────────────────────────────────────────────────────────────────┤
│ Setup checklist (only while incomplete)  ▆▆▆▆▆░░░  5/8                  │
├───────────────────────────────────────────────────────────────────────┤
│ ● Total │ ● Running │ ● Completed │ ● Queued │ ● Failed │ ● Tokens      │
│   128   │    4      │    96       │    6     │    3     │  1,204,556    │
├──────────────────────────────────┬────────────────────────────────────┤
│ Tasks   12/500     ▆▆░░░░░░       │ Members   3/10     ▆▆▆░░░░          │
├──────────────────────────────────┴────────────────────────────────────┤
│ Operations Radar               Open tasks → │ ┌── Pipeline ──────────┐ │
│ ┌────────┬────────┬────────┬────────┐       │ │ ● fetch_context      │ │
│ │●Success│●Queue  │●SLA    │●Repo   │       │ │ │ generate_code      │ │
│ │ 96%    │ 12s    │ 0      │ 1      │       │ │ │ review_code        │ │
│ └────────┴────────┴────────┴────────┘       │ │ ● finalize           │ │
│ Queue forecast                              │ └──────────────────────┘ │
│  task title …                       ~3m     │ ┌── Vector Memory ●online┐│
│  task title …                       ~7m     │ │ backend: qdrant  ...   ││
├─────────────────────────────────────────────┴────────────────────────┤
│ Analytics    [cost] [tokens] [success] [avg]                           │
│ ┌── Cost trend (line) ──────┐ ┌── Task completion (bar) ─────────────┐ │
│ Model breakdown (ent-table: model · calls · tokens · cost)            │
├───────────────────────────────────────────────────────────────────────┤
│ Manage Tasks → │ Sprint Board → │ Repo Mappings → │ Agents → │ …       │
└───────────────────────────────────────────────────────────────────────┘
```

### 5.2 Agents list (`/dashboard/agents`)
```
┌───────────────────────────────────────────────────────────────────────┐
│ AGENTS                                              [ + New Agent ]     │
│ ent-table:                                                              │
│ ┌─────────────┬────────┬───────────┬────────────┬────────┬──────────┐  │
│ │ NAME        │ STATUS │ LAST RUN  │ SUCCESS    │ COST   │ ACTIONS  │  │
│ ├─────────────┼────────┼───────────┼────────────┼────────┼──────────┤  │
│ │ ▢ Developer │ ●active│ 2m ago    │ 94%        │ $12.40 │ ⋯        │  │
│ │ ▢ Reviewer  │ ●idle  │ 1h ago    │ 99%        │ $3.10  │ ⋯        │  │
│ └─────────────┴────────┴───────────┴────────────┴────────┴──────────┘  │
└───────────────────────────────────────────────────────────────────────┘
```

### 5.3 Agent detail
```
┌───────────────────────────────────────────────────────────────────────┐
│ ‹ Agents  ·  Developer                                  [ Run ] [ ⋯ ]  │
│ Tabs: Configuration | Prompt | Tools | Memory | Logs | History | Perf   │
├───────────────────────────────────────────────────────────────────────┤
│ ┌── Configuration ────────────┐  ┌── Performance ──────────────────┐    │
│ │ provider  openai            │  │ ● success 94%   ● p95 42s       │    │
│ │ model     gpt-5             │  │ cost/run $0.21  runs 312        │    │
│ └─────────────────────────────┘  └─────────────────────────────────┘    │
│ Execution history (ent-table: run · status · duration · tokens · PR)    │
└───────────────────────────────────────────────────────────────────────┘
```

### 5.4 Execution monitoring (`/dashboard/tasks/[id]`)
```
┌───────────────────────────────────────────────────────────────────────┐
│ ‹ Tasks  ·  #482 Fix null deref          ●running   tokens 18,204      │
│ ┌── Timeline ─────────────────┐ ┌── Live logs ────────────────────────┐│
│ │ ● fetch_context   0.4s      │ │ 12:01:03  fetch_context start       ││
│ │ ● analyze         1.2s      │ │ 12:01:04  3 files matched           ││
│ │ │ generate_code   running   │ │ 12:01:07  tool: read_file(...)      ││
│ │ │ review_code     —         │ │ …                                   ││
│ │ ● finalize        —         │ └─────────────────────────────────────┘│
│ └─────────────────────────────┘ Tool calls · Input/Output · Errors tabs │
└───────────────────────────────────────────────────────────────────────┘
```

### 5.5 Knowledge base (vector memory)
```
┌───────────────────────────────────────────────────────────────────────┐
│ KNOWLEDGE BASES                                  [ Sync ] ●online       │
│ ┌── Indexes ─────────────┐  ┌── Search ──────────────────────────────┐ │
│ │ collection  agena_mem  │  │ [ query…                         ] 🔍 │ │
│ │ points      12,403     │  │ result · score 0.82 · kind=code        │ │
│ │ mode        deterministic │ result · score 0.78 · kind=doc         │ │
│ └────────────────────────┘  └────────────────────────────────────────┘ │
│ Documents (ent-table: source · kind · points · synced)                  │
└───────────────────────────────────────────────────────────────────────┘
```

---

## 6. Responsive behavior

| Breakpoint | Sidebar | KPI strip | 2-col grids |
|---|---|---|---|
| Desktop ≥ 1181px | 220px (collapsible to 76px) | 6 columns | side-by-side |
| Tablet 769–1180px | 220 / 76px | **3 columns** (`@media`) | side-by-side |
| Mobile ≤ 768px | off-canvas overlay (`☰` toggle) | **2 columns** | stacked (`.dash-grid-responsive → 1fr`) |

- KPI cell dividers (`border-left`) are recomputed per breakpoint so the grid
  never shows orphan borders when it wraps.
- Sidebar collapse state persists in `localStorage` (`agena_sidebar_collapsed`).
- Topbar progressively hides org chip / sprint switcher / username on narrow
  viewports (existing `.topbar-*` rules).

---

## 7. Files

| File | Change |
|---|---|
| `frontend/app/globals.css` | Added `.agena-app` enterprise token + component layer (additive, scoped) |
| `frontend/components/NavIcon.tsx` | **New** — monochrome line-icon set |
| `frontend/app/dashboard/layout.tsx` | `agena-app` class, emoji→NavIcon, de-glass shell, neutral accents |
| `frontend/app/dashboard/page.tsx` | Overview re-skinned to neutral/dense (data logic unchanged) |

### Theme safety
Both light and dark are defined for every overridden token, so toggling
`ThemeToggle` works exactly as before. Because the layer is **scoped to
`.agena-app`**, the marketing site, auth pages, and emails are visually
unchanged. RBAC, module gating, routing, WebSocket and data fetching are
untouched.
