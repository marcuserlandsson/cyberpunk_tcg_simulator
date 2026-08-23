# Afterlife Visual Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the simulator's placeholder UI with the "Afterlife" premium game-table presentation — restyled cards, a proper playmat with a central gig "street" strip, hand fan, feed-style log, spotlight prompts, physical eddies, showpiece animations, and restyled Deck Builder/Simulate views — with zero engine/AI behavior change.

**Architecture:** Pure presentation-layer work. Every interaction still derives from `legalActions` via `playAffordances.ts`; components keep their names, props, handlers, and `data-testid`s, and get restructured markup + a new design system CSS (split into `src/ui/styles/*.css`, imported by `src/ui/theme.css`). New components: `StreetStrip` (both gig pools + turn block), `ZoomPanel` (hover/click card preview), `useAnimations` (event-driven transient animation states). The committed mockup is the visual reference: `docs/superpowers/specs/2026-08-23-visual-overhaul-mockup.html` (open it in a browser; `{{IMG_*}}` tokens are image placeholders — everything else is the real CSS).

**Tech Stack:** React 18 + TypeScript + Vite; CSS (no CSS-in-JS); `@fontsource/rajdhani`, `@fontsource/chakra-petch`, `@fontsource/ibm-plex-mono` (the ONLY new dependencies); Vitest + Testing Library; Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-08-23-visual-overhaul-design.md` — read it first; it is binding. The mockup HTML above is its visual companion.

## Global Constraints

- **Zero behavior change:** engine, AI, sim, storage, and `useGame` logic untouched except where a view needs new read-only data already available in state/events. `legalActions` remains the single affordance source.
- **Every existing `data-testid` and data attribute survives** (`playmat`, `data-awaiting`, `data-turn`, `playable-card`, `attacker-card`, `reaction-bar`, `choice-bar`, `fixer-die`, `gig-die`, `log-line`, `end-turn`, `undo`, save/resume ids, …). All 5 Playwright e2e tests and all 1155 vitest tests must pass; test edits allowed only for assertions about pure presentation, and must be justified in the task report.
- **No clipping/overlap at any state:** field rows accommodate tapped (90°) cards and 8+ units per side (cards shrink evenly to keep one row, down to a 56px-width floor, then the row wraps; row height always reserves the tapped diagonal); hand fan handles 10+ cards; the board fits a 1366×768 viewport without vertical scroll of the board itself (feed scrolls internally).
- **Offline-safe:** fonts via `@fontsource` npm packages; no runtime requests to external hosts. New dependencies limited to `@fontsource/*`.
- **Rival information hygiene unchanged:** never render rival hand contents, deck order, or face-down legend identities — card backs only.
- **Reduced motion:** every animation gated behind `@media (prefers-reduced-motion: no-preference)`; showpiece animations additionally disabled when `aiDelayMs === 0`.
- **Color semantics (binding):** cyan `#00E5FF` = the human player / interactive; red `#FF3D5A` = the rival / danger; yellow `#FCEE0A` = actionable right now; RAM colors (`#FF4655 #FCEE0A #2DFF87 #38A8FF`) appear ONLY on cards and deck budgets, never on chrome. Exactly one yellow primary button per screen state.
- Run `npm test` before every commit; run `npx playwright test` at every task that touches the Play view DOM (Tasks 3–8) — note: run it as `npx playwright test` from the repo root; the config starts its own dev server on `localhost` (never `127.0.0.1` on this machine).

---

## File structure

| File | Responsibility |
|---|---|
| `src/ui/styles/tokens.css` (create) | All custom properties: palette, RAM colors, fonts, spacing, clip polygons |
| `src/ui/styles/chrome.css` (create) | body/base, buttons, panels, capsules/tags, form controls, focus, scrollbars, app header/nav |
| `src/ui/styles/cards.css` (create) | CardFrame (all sizes/states), card backs, overlays, BoardCard glows, tap rotation |
| `src/ui/styles/board.css` (create) | Playmat grid, zones, street strip, dice, hand fan, feed, action bar, setup screen |
| `src/ui/styles/prompts.css` (create) | Spotlight prompt bars, game-over overlay, board dimming |
| `src/ui/styles/motion.css` (create) | All keyframes + showpiece classes, reduced-motion guards |
| `src/ui/styles/deckbuilder.css` (create) | Deck Builder both panes |
| `src/ui/styles/simulate.css` (create) | Simulate view |
| `src/ui/theme.css` (rewrite) | Becomes only `@import './styles/….css'` lines, in the order above |
| `src/ui/CardFrame.tsx` (modify) | Compact board face (no rules text), full zoom face, image overlays, owner-colored back |
| `src/ui/StreetStrip.tsx` (create) | Both players' fixer+gig dice + center turn block (markup moves out of ZonePanels) |
| `src/ui/ZonePanels.tsx` (modify) | Loses dice panels; gains physical eddies row and deck/trash piles |
| `src/ui/Field.tsx` (modify) | BoardCard gains owner keying + hover reporting |
| `src/ui/HandStrip.tsx` (modify) | Fan layout (inline `--i`/`--n` custom props) |
| `src/ui/ZoomPanel.tsx` (create) | Pinned large card preview for hover/click |
| `src/ui/LogPanel.tsx` (modify) | Feed styling + actor color-coding |
| `src/ui/PlayView.tsx` (modify) | New grid layout, right rail, spotlight prompts, setup screen restyle |
| `src/ui/useAnimations.ts` (create) | Event-driven transient animation states (lunge/tumble/steal/glitch) |
| `src/ui/Dice.tsx` (modify) | Value plate + unrolled styling hooks (SVG silhouettes stay) |
| `src/ui/DeckPanel.tsx` (modify) | RAM budget bars, size meter, legend silhouettes, empty-slot error fix |
| `src/ui/CardBrowser.tsx` (modify) | Capsule filters, grid of zoom-rendition cards |
| `src/ui/SimulateView.tsx` (modify) | Panel chrome, win split bar, stat blocks |
| `src/App.tsx` (modify) | Header/nav restyle markup |
| `src/main.tsx` (modify) | `@fontsource` imports |

Engine files: **no modifications anywhere in this plan.**

---

### Task 1: Design system foundation (tokens, chrome, fonts, app shell)

**Files:**
- Create: `src/ui/styles/tokens.css`, `src/ui/styles/chrome.css`, and empty-but-imported `src/ui/styles/{cards,board,prompts,motion,deckbuilder,simulate}.css`
- Modify: `src/ui/theme.css` (becomes an import hub; move every existing rule into the new files unchanged for now — cards/board rules into `cards.css`/`board.css` etc., so nothing visually regresses before its task), `src/main.tsx`, `src/App.tsx`, `package.json`
- Test: `tests/ui/theme.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: the token vocabulary every later task's CSS uses (exact names below); `.btn`, `.btn--primary`, `.btn--ghost`, `.btn--danger`, `.chip`, `.tag-capsule`, `.kw-capsule`, `.panel`, `.clip-corners` utility classes.

- [ ] **Step 1: Install fonts**

```bash
npm install @fontsource/rajdhani @fontsource/chakra-petch @fontsource/ibm-plex-mono
```

- [ ] **Step 2: Write the failing test** — a Vitest that reads the built CSS token file and asserts the binding palette exists (guards against later drift):

```ts
// tests/ui/theme.test.ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('design tokens', () => {
  const css = readFileSync('src/ui/styles/tokens.css', 'utf8')
  it.each([
    ['--void', '#07070d'],
    ['--panel', '#10101a'],
    ['--you', '#00e5ff'],
    ['--rival', '#ff3d5a'],
    ['--act', '#fcee0a'],
    ['--ram-red', '#ff4655'],
    ['--ram-yellow', '#fcee0a'],
    ['--ram-green', '#2dff87'],
    ['--ram-blue', '#38a8ff'],
  ])('defines %s: %s', (name, value) => {
    expect(css.toLowerCase()).toContain(`${name}: ${value}`)
  })
  it('imports no external font hosts anywhere in styles', () => {
    expect(css).not.toMatch(/https?:\/\//)
  })
})
```

- [ ] **Step 3: Run it** — `npx vitest run tests/ui/theme.test.ts` — expect FAIL (file missing).

- [ ] **Step 4: Write `src/ui/styles/tokens.css`** (exact content; later files reference these names):

```css
:root {
  /* grounds */
  --void: #07070d;
  --panel: #10101a;
  --panel-2: #161624;
  --line: #262638;
  --line-bright: #3a3a52;
  /* text */
  --text: #e8ecf2;
  --muted: #8b94a8;
  /* semantics: cyan = you, red = rival, yellow = actionable now */
  --you: #00e5ff;
  --rival: #ff3d5a;
  --act: #fcee0a;
  /* RAM colors: cards and deck budgets ONLY, never chrome */
  --ram-red: #ff4655;
  --ram-yellow: #fcee0a;
  --ram-green: #2dff87;
  --ram-blue: #38a8ff;
  /* legacy aliases so unmigrated rules keep resolving until their task */
  --bg: var(--void);
  --panel-bg: var(--panel);
  --neon-cyan: var(--you);
  --neon-magenta: var(--rival);
  --neon-yellow: var(--act);
  /* type */
  --font-display: 'Rajdhani', 'Arial Narrow', sans-serif;
  --font-body: 'Chakra Petch', 'Segoe UI', sans-serif;
  --font-mono: 'IBM Plex Mono', Consolas, monospace;
  /* geometry */
  --cut: 10px; /* corner clip size */
}
```

- [ ] **Step 5: Write `src/ui/styles/chrome.css`** — base + shared components. Exact core (extend with focus/scrollbar/nav rules in the same vocabulary):

```css
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--void);
  color: var(--text);
  font-family: var(--font-body);
  font-size: 15px;
}
h1, h2, h3, h4 { font-family: var(--font-display); text-transform: uppercase; letter-spacing: 0.05em; color: var(--text); }

.clip-corners { clip-path: polygon(var(--cut) 0, 100% 0, 100% calc(100% - var(--cut)), calc(100% - var(--cut)) 100%, 0 100%, 0 var(--cut)); }
.panel { background: var(--panel); border: 1px solid var(--line); }

button, .btn {
  font-family: var(--font-display); font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.12em; font-size: 12px; padding: 8px 16px; cursor: pointer; border: none;
  background: transparent; color: var(--you); box-shadow: inset 0 0 0 1.5px var(--you);
  clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);
}
button:hover:not(:disabled) { background: rgba(0, 229, 255, 0.12); }
button:disabled { color: var(--muted); box-shadow: inset 0 0 0 1.5px var(--line-bright); cursor: default; }
.btn--primary, button.btn--primary { background: var(--act); color: #131200; box-shadow: none; }
.btn--primary:hover:not(:disabled) { background: #fff65e; }
.btn--danger, button.btn--danger { color: var(--rival); box-shadow: inset 0 0 0 1.5px var(--rival); }
.btn--danger:hover:not(:disabled) { background: rgba(255, 61, 90, 0.12); }
button:focus-visible, .btn:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }

.chip {
  display: inline-flex; align-items: center; gap: 0.35em;
  font-family: var(--font-mono); font-size: 11px; padding: 3px 10px;
  background: var(--panel-2); border: 1px solid var(--line); color: var(--muted);
}
.tag-capsule {
  font-family: var(--font-display); font-weight: 700; font-size: 10px; letter-spacing: 0.14em;
  text-transform: uppercase; padding: 2px 8px; border: 1px solid var(--line-bright); color: var(--muted);
  clip-path: polygon(5px 0, 100% 0, calc(100% - 5px) 100%, 0 100%);
}
.kw-capsule {
  font-family: var(--font-display); font-weight: 700; font-size: 10px; letter-spacing: 0.12em;
  text-transform: uppercase; padding: 1px 7px;
  clip-path: polygon(5px 0, 100% 0, calc(100% - 5px) 100%, 0 100%);
  background: var(--act); color: #131200;
}
input, select, textarea {
  font-family: var(--font-mono); font-size: 13px; color: var(--text);
  background: var(--panel-2); border: 1px solid var(--line-bright); padding: 6px 10px;
}
input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--you); outline-offset: 1px; }
```

Also style the app header in `chrome.css`: `header` as a slim bar (`display:flex; align-items:center; gap:24px; padding:10px 20px; border-bottom:1px solid var(--line);`), `h1` at 20px with a subtle red/cyan `text-shadow: 2px 0 0 rgba(255,61,90,.5), -2px 0 0 rgba(0,229,255,.45)`, nav tabs as ghost buttons where `aria-pressed="true"` gets `background: var(--you); color: var(--void); box-shadow: none;`.

- [ ] **Step 6: Rewrite `src/ui/theme.css`** as the import hub, and relocate every existing rule (verbatim, minus the now-token-covered `:root`/`body`/`button` blocks) into the matching new file:

```css
@import './styles/tokens.css';
@import './styles/chrome.css';
@import './styles/cards.css';
@import './styles/board.css';
@import './styles/prompts.css';
@import './styles/motion.css';
@import './styles/deckbuilder.css';
@import './styles/simulate.css';
```

- [ ] **Step 7: Add font imports to `src/main.tsx`** (before the theme import):

```ts
import '@fontsource/rajdhani/500.css'
import '@fontsource/rajdhani/600.css'
import '@fontsource/rajdhani/700.css'
import '@fontsource/chakra-petch/400.css'
import '@fontsource/chakra-petch/500.css'
import '@fontsource/chakra-petch/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './ui/theme.css'
```

- [ ] **Step 8: In `src/App.tsx`**, give the settings toggle its chip styling hook (`className="settings-toggle chip"`) — no testid changes.

- [ ] **Step 9: Run** `npx vitest run tests/ui/theme.test.ts` (PASS), then `npm test` (all pass), then `npm run build` (clean), then eyeball `npm run dev` — the app should look like today's app with better buttons/typography, nothing broken.

- [ ] **Step 10: Commit** — `git add -A && git commit -m "feat(ui): Afterlife design system foundation — tokens, chrome, fonts"`

### Task 2: Card renditions (CardFrame rewrite)

**Files:**
- Modify: `src/ui/CardFrame.tsx`, `src/ui/styles/cards.css`
- Test: `tests/ui/cardframe.test.tsx` (extend/adjust)

**Interfaces:**
- Consumes: Task 1 tokens/utilities.
- Produces: `CardFrameProps` gains `owner?: 'you' | 'rival'` (default `'you'`, colors the back and ready ring) and `showLiveChips?: boolean` (zoom-panel live-state strip, used by Task 6). Size semantics later tasks rely on: `size="small"` = compact board face (NO rules text), `size="medium"` = hand card (name+cost+power+keyword pips, no rules text), `size="zoom"` = full print-like face. Class names later CSS relies on: `card-frame--spent` (tap rotation), `card-frame__power-chip`, `card-frame__kw-pips`, `card-frame__lag-band`, `card-frame__back`.

- [ ] **Step 1: Write failing tests** (replace assertions that small cards render rules text — justified: presentation change is the point of the task):

```tsx
// added to tests/ui/cardframe.test.tsx
it('small size omits rules text and subtitle', () => {
  render(<CardFrame def={unitDef} size="small" useOfficialImages={false} />)
  expect(screen.queryByText(unitDef.text)).toBeNull()
  expect(screen.getByText(unitDef.name)).toBeInTheDocument()
})
it('zoom size renders rules text with keyword capsules', () => {
  render(<CardFrame def={blockerDef} size="zoom" useOfficialImages={false} />)
  expect(screen.getByText(/redirect a rival/i)).toBeInTheDocument()
  expect(document.querySelector('.card-frame__keyword')).not.toBeNull()
})
it('image mode shows a power chip only when effective differs from printed', () => {
  const { rerender } = render(
    <CardFrame def={unitDef} size="small" useOfficialImages tempPower={0} />
  )
  expect(document.querySelector('.card-frame__power-chip')).toBeNull()
  rerender(<CardFrame def={unitDef} size="small" useOfficialImages tempPower={2} />)
  expect(document.querySelector('.card-frame__power-chip')).toHaveTextContent(
    String(unitDef.power! + 2)
  )
})
it('face-down back is keyed by owner', () => {
  render(<CardFrame def={unitDef} size="small" faceDown owner="rival" useOfficialImages={false} />)
  expect(document.querySelector('.card-frame--rival')).not.toBeNull()
})
```

(Use the existing test file's `unitDef`/fixture pattern; add a `blockerDef` fixture whose text contains `{Blocker}`.)

- [ ] **Step 2: Run** `npx vitest run tests/ui/cardframe.test.tsx` — new tests FAIL.

- [ ] **Step 3: Rewrite `CardFrame.tsx`.** Structure (key logic; keep `data-testid="card-frame"`, `data-def-id`):
  - `CardFrameFace` gains a `compact: boolean` arg: compact renders top row (hex cost badge + sell tag, type capsule + RAM pips), art placeholder block, name (no subtitle), keyword pips column (first letter of each of `adrenaline/quick/blocker/go-solo` present in `def.keywords`), power box, LAG band; non-compact (zoom) additionally renders subtitle, faction/tag capsules, rules text via `renderRulesText` (keep `card-frame__keyword` spans — restyle as `.kw-capsule` in CSS), barcode strip decor (pure CSS div).
  - Image mode: render `<img>`; overlay `card-frame__power-chip` when `tempPower !== 0` (classed `is-buffed`/`is-reduced` by sign), keyword pips overlay, LAG band. Remove the old always-mounted `card-frame__zoom-fallback` (the zoom panel from Task 6 replaces its job) — keep the text face as the `onError` fallback: `useState` flag flips to the HTML face if the image fails to load.
  - `owner` prop adds `card-frame--you`/`card-frame--rival` class.
- [ ] **Step 4: Write `cards.css`** — the mockup's `.fc`/`.bc` rules translated onto the real class names. Exact essentials:

```css
.card-frame { position: relative; font-family: var(--font-display); background: #0d0d15;
  border: 2px solid var(--card-border-color, var(--line-bright)); border-radius: 7px;
  color: var(--text); transition: transform 160ms ease, box-shadow 160ms ease; }
.card-frame--small { width: 92px; }
.card-frame--medium { width: 118px; }
.card-frame--zoom { width: 250px; }
.card-frame--spent { transform: rotate(90deg); filter: saturate(0.55) brightness(0.75); }
.card-frame--lag .card-frame__art { filter: brightness(0.8); }
.card-frame__cost-badge { width: 26px; height: 30px; display: grid; place-items: center;
  font-weight: 700; font-size: 15px; background: #0c0c14; border: 2px solid var(--card-border-color);
  clip-path: polygon(50% 0, 100% 26%, 100% 74%, 50% 100%, 0 74%, 0 26%); }
.card-frame__power { min-width: 30px; height: 28px; display: grid; place-items: center;
  font-weight: 700; font-size: 17px; background: #0c0c14; border: 2px solid var(--card-border-color);
  clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px); }
.card-frame__power-chip { position: absolute; right: -7px; bottom: -7px; min-width: 30px; height: 30px;
  display: grid; place-items: center; font-weight: 700; font-size: 16px; background: #0c0c14;
  border: 2px solid var(--line-bright); clip-path: polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px); }
.card-frame__power-chip.is-buffed { color: var(--ram-green); border-color: var(--ram-green); }
.card-frame__power-chip.is-reduced { color: var(--rival); border-color: var(--rival); }
.card-frame__lag-band { position: absolute; left: 0; right: 0; bottom: 24%; text-align: center;
  font-weight: 600; letter-spacing: 0.3em; font-size: 10px; padding: 1px 0;
  color: var(--void); background: rgba(252, 238, 10, 0.92); }
.card-frame--face-down .card-frame__back { position: absolute; inset: 0; border-radius: 5px;
  background: repeating-linear-gradient(45deg, rgba(0,229,255,0.14) 0 2px, transparent 2px 7px),
              linear-gradient(150deg, #101826, #0b1018); }
.card-frame--rival.card-frame--face-down .card-frame__back {
  background: repeating-linear-gradient(45deg, rgba(255,61,90,0.14) 0 2px, transparent 2px 7px),
              linear-gradient(150deg, #241018, #150b10); }
```

Plus the zoom face (name 17px/700, subtitle 10.5px tracked in the RAM color, tags row, rules text `font-family: var(--font-body); font-size: 11.5px`, barcode `repeating-linear-gradient(90deg, var(--muted) 0 2px, transparent 2px 4px …)` at 50% opacity), all sized per the mockup's `.fc.full`.

- [ ] **Step 5: Run** the cardframe tests (PASS), then `npm test` — fix any test that asserted small-size rules text (justify each in the report).
- [ ] **Step 6: Commit** — `git commit -am "feat(ui): three card renditions — compact board face, zoom face, image overlays"`

### Task 3: Street strip — dice restyle and the contested center

**Files:**
- Create: `src/ui/StreetStrip.tsx`
- Modify: `src/ui/ZonePanels.tsx` (remove `DicePanels`), `src/ui/PlayView.tsx` (mount StreetStrip in `playmat__center`), `src/ui/Dice.tsx`, `src/ui/styles/board.css`
- Test: `tests/ui/playview.test.tsx` (should pass untouched — it queries testids), plus new `tests/ui/streetstrip.test.tsx`

**Interfaces:**
- Consumes: `Die` from `Dice.tsx`; `streetCred` from `../engine/query`; `BoardAffordances`/`BoardHandlers`.
- Produces: `StreetStrip(props: { db; state; affordances; handlers; humanFixerInteractive: boolean; rivalGigStealInteractive: boolean; rivalGigAreaTargetable: boolean })` rendering BOTH players' dice. It must keep, verbatim, the existing testids and data attributes from `ZonePanels.tsx`'s `DicePanels`: `data-testid="fixer"`/`"gig-area"` with `data-player`, `fixer-die` buttons with `data-size`/`data-choosable`, `gig-die` buttons with `data-index`/`data-size`/`data-stealable`, `gig-count`, `street-cred`, `attack-gig-area`. `ZonePanels` keeps `zone-panels`, legends, and counts testids.

- [ ] **Step 1: Write the failing test:**

```tsx
// tests/ui/streetstrip.test.tsx — render a real newGame state via the
// existing tests/engine/gameHelpers.ts pattern used by playview.test.tsx
it('renders both players gig areas and street cred', () => {
  render(<StreetStrip db={db} state={state} affordances={NO_AFFORDANCES}
    handlers={noopHandlers} humanFixerInteractive={false}
    rivalGigStealInteractive={false} rivalGigAreaTargetable={false} />)
  expect(screen.getAllByTestId('gig-area')).toHaveLength(2)
  expect(screen.getAllByTestId('fixer')).toHaveLength(2)
  expect(screen.getAllByTestId('street-cred')).toHaveLength(2)
})
```

- [ ] **Step 2: Run — FAIL** (module missing).
- [ ] **Step 3: Create `StreetStrip.tsx`** by moving `DicePanels` markup wholesale (both players: rival block first with `player={AI}`, center `div.street__vs` with turn/phase — reuse the strings currently in `playmat__center`, keeping `data-testid="center-turn"` — then human block with `player={HUMAN}`). Fixer dice render inside their gig block as dim outlined silhouettes after the rolled dice (fixer + gig visually one pool per player, two testid groups as before). Delete `DicePanels` from `ZonePanels.tsx`; `ZonePanels` now renders only `CardZones`.
- [ ] **Step 4: Restyle dice** in `board.css` + `Dice.tsx`: `.die__shape { fill: currentColor; stroke: none; }`, `.die__value { fill: var(--void); font-family: var(--font-display); font-weight: 700; }`, wrapper colors: `.street__side--you { color: var(--you); }`, `.street__side--rival { color: var(--rival); }`; unrolled: `.die--unrolled .die__shape { fill: none; stroke: var(--line-bright); stroke-width: 1.5; } .die--unrolled .die__value { fill: var(--muted); }`. `is-choosable`/`is-stealable` slots pulse yellow (`box-shadow: 0 0 10px rgba(252,238,10,.5)` + `animation: pulse-act 1.6s infinite` from `motion.css`).
- [ ] **Step 5: Street layout** in `board.css`: `.street { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 8px 12px; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); background: rgba(255,255,255,0.015); }`, sides as `display:grid; gap:5px`, `.street__vs` centered display type with yellow turn line and `font-family: var(--font-mono); font-size: 10px; color: var(--muted)` for the win-condition line ("first to 7 gigs wins" / "OVERTIME — majority wins" when `state.turnNumber > 7`-completion; derive from existing phase/turn fields only).
- [ ] **Step 6: Run** new test (PASS), `npm test` (PASS — playview tests query testids that all still exist), `npx playwright test` (PASS).
- [ ] **Step 7: Commit** — `git commit -am "feat(ui): street strip — facing gig pools, restyled polyhedral dice"`

### Task 4: Physical eddies, tapped legends, deck/trash piles

**Files:**
- Modify: `src/ui/ZonePanels.tsx`, `src/ui/styles/board.css`, `src/ui/styles/cards.css`
- Test: `tests/ui/zonepanels.test.tsx` (create)

**Interfaces:**
- Consumes: `card-frame--face-down`/`--spent`/`--you`/`--rival` classes from Task 2.
- Produces: `CardZones` renders the eddies zone as `div[data-testid="eddies"]` containing one `div[data-testid="eddie-card"][data-ready="true|false"]` per card uid in `state.players[player].eddies` (mini face-down `CardFrame` with `owner` keying, `ready={state.cards[uid].ready}` so spent ones tap), plus the existing summary chip `data-testid="eddies-count"` with the same `€$ ready/total` text. Deck/trash become visual piles (stacked back + count chip) keeping `deck-count`/`trash-count`/`removed-count` testids and text.

- [ ] **Step 1: Write the failing test:**

```tsx
// tests/ui/zonepanels.test.tsx — build a state where one eddie is spent:
// play any sold-card flow via gameHelpers, or construct by applying actions;
// simplest: newGame, sell a card (enters ready), then manually assert both states
// by rendering twice with a hand-tweaked state clone (presentation test).
it('renders one card per eddie, tapped when spent', () => {
  const spent = structuredClone(state) as GameState
  const uid = spent.players[0].eddies[0]
  spent.cards[uid] = { ...spent.cards[uid], ready: false }
  render(<ZonePanels db={db} state={spent} player={0} … />)
  const cards = screen.getAllByTestId('eddie-card')
  expect(cards[0]).toHaveAttribute('data-ready', 'false')
  expect(cards[0].querySelector('.card-frame--spent')).not.toBeNull()
})
```

(Arrange the eddie via the engine where convenient: `sellCard` is a legal main-phase action and sold cards enter ready; a pure state clone is acceptable for the spent variant since this is presentation.)

- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** in `CardZones`: replace the `eddies-count`-only display with the row of mini face-down frames + the chip; add `.zone--eddies .zone__cards { display:flex; }` with negative-margin overlap after 6 cards (`.zone--eddies .card-frame { margin-right: -46px; } .zone--eddies .card-frame:last-child { margin-right: 0; }` activated via a `zone--eddies--dense` class when `eddies.length > 6`); tapped cards need the row height to fit rotation: `.zone--eddies { min-height: 96px; align-items: center; }`. Deck/trash piles: a 46×64 face-down back with a `.chip` count overlaid, same testids/text inside the chip.
- [ ] **Step 4:** Legends: no code change needed — `BoardCard` already passes `ready={instance.ready}` into `CardFrame`, and Task 2's `card-frame--spent` tap now applies; verify visually and assert in the test (`legends` zone: render with a spent legend clone, expect `.card-frame--spent`). Give `.zone--legends` the same tap headroom (`min-height` fitting the rotated diagonal).
- [ ] **Step 5: Run** tests + `npm test` + `npx playwright test`, verify no overlap at 8 eddies in the browser.
- [ ] **Step 6: Commit** — `git commit -am "feat(ui): physical eddies and tapped legends, deck/trash piles"`

### Task 5: Playmat layout, feed, action rail, setup screen

**Files:**
- Modify: `src/ui/PlayView.tsx`, `src/ui/LogPanel.tsx`, `src/ui/styles/board.css`
- Test: `tests/ui/playview.test.tsx` (must keep passing; add feed color test)

**Interfaces:**
- Consumes: `StreetStrip` (Task 3), zones (Task 4).
- Produces: the final playmat DOM order later tasks style against: `.playmat > .playmat__body { display: grid; grid-template-columns: 1fr 290px; }`; board column = `.rival-strip` (chips row + ZonePanels(AI) + Field(AI) + hidden HandStrip(AI) rendered as a compact fan of backs) → `StreetStrip` → `.player-zone` (Field(HUMAN) + ZonePanels(HUMAN)) → `HandStrip(HUMAN)`; right rail = `LogPanel` + `.action-rail` (the control-bar buttons/inputs moved here). ALL existing testids keep existing: `control-bar` stays as the rail's wrapper testid; `turn-indicator`, `phase-indicator`, `active-indicator`, `ai-thinking`, `seed-chip`, `call-legend`, `end-turn`, `undo`, `save-name`, `save-game`, `new-game`, `saved-note`.

- [ ] **Step 1:** Reorganize `PlayView.tsx` markup per the DOM order above. `end-turn` gets `className="btn--primary"`; `seed-chip` moves into the feed header; the turn/phase/active chips live in the street strip area visually but keep their testids (render them inside `StreetStrip`'s vs-block by passing the already-computed strings as children — add an optional `centerExtra?: ReactNode` prop to `StreetStrip` if cleaner, or keep them in a slim top bar; either way testids survive).
- [ ] **Step 2:** `LogPanel.tsx`: add actor classing derived from the line text only (presentation heuristic): `/^(You|Your)\b/` → `log-line--you`, `/^Rival/` → `log-line--rival`, `/^(Turn|Game|Order|Overtime)/` → `log-line--sys`, else default. Keep `log-line`, `data-turn`, auto-scroll; add scroll-lock: only auto-scroll when the user is already at the bottom (`element.scrollHeight - element.scrollTop - element.clientHeight < 40`).
- [ ] **Step 3:** `board.css`: playmat background (scanlines + the two radial glows from the mockup's `.mat-board`), zone labels (`font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.28em; text-transform: uppercase; color: var(--muted)`), rival strip red-keyed labels, feed styling (mono 11px, colored actor classes: `--you`→cyan, `--rival`→red, `--sys`→yellow, turn stamp at 50% opacity), action rail (`display:flex; flex-direction:column; gap:8px; padding:10px; border-top:1px solid var(--line)`). Height budget: `.playmat__body { height: calc(100vh - 52px); } .playmat__board { overflow: hidden; display: grid; grid-template-rows: auto auto 1fr auto; }` — the feed alone scrolls.
- [ ] **Step 4:** Setup screen: wrap in `.panel.clip-corners` with corner brackets, selects/inputs already styled by chrome.css, `start-game` gets `btn--primary`, saved-game rows as list rows with the resume button + the existing error block restyled `.panel` with `--rival` border. No testid changes.
- [ ] **Step 5:** Add feed color test to `tests/ui/playview.test.tsx`:

```tsx
it('feed lines are actor-classed', () => {
  // render a started game (existing helper), then:
  const lines = screen.getAllByTestId('log-line')
  expect(lines.some((l) => l.className.includes('log-line--sys'))).toBe(true)
})
```

- [ ] **Step 6: Run** `npm test` + `npx playwright test`; then `npm run dev` and verify at a 1366×768 window: no board scroll, nothing clipped, rival strip fully visible.
- [ ] **Step 7: Commit** — `git commit -am "feat(ui): playmat grid, feed rail, action rail, setup screen chrome"`

### Task 6: Hand fan and zoom panel

**Files:**
- Create: `src/ui/ZoomPanel.tsx`
- Modify: `src/ui/HandStrip.tsx`, `src/ui/Field.tsx` (BoardCard hover reporting), `src/ui/PlayView.tsx`, `src/ui/playAffordances.ts` (BoardHandlers only), `src/ui/styles/board.css`, `src/ui/styles/cards.css`
- Test: `tests/ui/playview.test.tsx` additions

**Interfaces:**
- Consumes: `CardFrame size="zoom"` (Task 2).
- Produces: `BoardHandlers` gains `onHover?: (uid: number | null) => void` (optional — deck builder and tests that build handlers without it stay valid). `ZoomPanel(props: { db; state; uid: number | null; useOfficialImages: boolean })` renders nothing when `uid` is null; otherwise a fixed panel (`.zoom-panel`, left edge of the rail column, `data-testid="zoom-panel"`) with the zoom rendition + a live-state strip (effective power via `effectivePower(db, state, uid)`, granted keywords via `effectiveKeywords`, attachment names) — face-down cards render the back only (information hygiene).

- [ ] **Step 1: Failing test:**

```tsx
it('hovering a hand card opens the zoom panel', async () => {
  // started game, human hand non-empty
  const card = screen.getAllByTestId(/playable-card|board-card-hit/)[0]
  fireEvent.mouseEnter(card)
  expect(screen.getByTestId('zoom-panel')).toBeInTheDocument()
  fireEvent.mouseLeave(card)
  expect(screen.queryByTestId('zoom-panel')).toBeNull()
})
```

- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3:** BoardCard: `onMouseEnter={() => handlers.onHover?.(uid)}`, `onMouseLeave={() => handlers.onHover?.(null)}`, plus focus/blur for keyboard parity. PlayView: `const [zoomUid, setZoomUid] = useState<number | null>(null)`, `onHover: setZoomUid` in handlers, `<ZoomPanel …/>` mounted in the rail above the feed.
- [ ] **Step 4:** Hand fan: in `HandStrip`, wrap human-hand cards with inline vars — `style={{ '--i': index, '--n': hand.length } as CSSProperties}` — and CSS:

```css
.zone--hand .zone__cards { display: flex; justify-content: center; min-height: 150px; align-items: flex-end; }
.zone--hand .board-card { margin: 0 calc(-6px - 14px * clamp(0, (var(--n) - 7) / 5, 1)); transform-origin: 50% 140%;
  transform: rotate(calc((var(--i) - (var(--n) - 1) / 2) * 4deg))
             translateY(calc(((var(--i) - (var(--n) - 1) / 2) * (var(--i) - (var(--n) - 1) / 2)) * 1.4px)); }
.zone--hand .board-card:hover { transform: translateY(-18px) scale(1.18); z-index: 3; }
```

(Wider hands overlap more via the `--n` clamp; 10+ cards stay inside the strip.) Rival hand: same fan at half scale with face-down backs, keeping `hand-back` testid.

- [ ] **Step 5: Run** tests (PASS) + `npm test` + `npx playwright test` (the e2e clicks `playable-card` — hover transforms must not block clicks; verify).
- [ ] **Step 6: Commit** — `git commit -am "feat(ui): hand fan and hover zoom panel"`

### Task 7: Spotlight prompts and game-over overlay

**Files:**
- Modify: `src/ui/PlayView.tsx`, `src/ui/ReactionBar.tsx`, `src/ui/styles/prompts.css`
- Test: `tests/ui/playview.test.tsx` (existing prompt tests keep passing)

**Interfaces:**
- Consumes: chrome buttons.
- Produces: `.prompt-bar` restyled as the spotlight (cyan-bordered, dim backdrop via `.playmat--prompting .playmat__board > :not(.street)` opacity drop — apply `playmat--prompting` on the `playmat` section whenever any prompt bar is rendered); every existing prompt testid unchanged. Game-over becomes `.game-over-overlay` (absolute over the board, NOT the rail) that still carries `data-testid="game-over"`, shows WIN/LOSS display type, the reason from the final `gameEnded` event (`sevenGigs` → "7 Gigs at the start of turn", `overtimeMajority` → "Overtime majority", `deckout` → "Rival deck ran out" / "You ran out of cards"), and buttons: New game (`new-game` testid moves here is NOT allowed — keep the rail's `new-game` and give the overlay button `data-testid="game-over-new-game"`).

- [ ] **Step 1:** Restyle `.prompt-bar` in `prompts.css`: `border: 1px solid var(--you); background: rgba(0,229,255,0.06); padding: 10px 14px; display:flex; gap:14px; align-items:center;` with label in display type; `.prompt-bar--react` same but the label reads the attack in words — extend `ReactionBar`'s label by deriving the attack from the latest `attackDeclared` event in `state.events` (always present when a react window is open): "X (power) attacks Y (power) — react or pass:" with names via the file's existing `nameOf` and powers via `effectivePower(db, state, uid)`; a `gigArea` target reads "…attacks your Gig area". Board dimming: `.playmat--prompting .playmat__side { opacity: 0.45; } .playmat--prompting .is-target, .playmat--prompting .is-selected { opacity: 1; }` — candidates stay lit (is-target/is-selected are per-card classes; use `filter: none` and a parent-independent approach: set opacity on non-candidate cards instead: `.playmat--prompting .board-card:not(.is-target):not(.is-selected) { opacity: 0.45; }`).
- [ ] **Step 2:** Game-over overlay markup per Produces. Reason strings from the last event: `state.events.findLast(e => e.type === 'gameEnded')`.
- [ ] **Step 3:** Run `npm test` + `npx playwright test` (e2e asserts `game-over` visible and log's final line — both preserved).
- [ ] **Step 4: Commit** — `git commit -am "feat(ui): spotlight prompt bars and game-over overlay"`

### Task 8: Showpiece motion

**Files:**
- Create: `src/ui/useAnimations.ts`
- Modify: `src/ui/PlayView.tsx`, `src/ui/Field.tsx`, `src/ui/StreetStrip.tsx`, `src/ui/styles/motion.css`
- Test: `tests/ui/useanimations.test.ts` (create)

**Interfaces:**
- Consumes: `GameEvent` union (`attackDeclared`, `dieRolled`, `gigStolen`, `gameEnded`), `state.events`.
- Produces: `useAnimations(events: readonly GameEvent[], enabled: boolean): AnimationState` where `AnimationState = { lungeUid: number | null; tumble: { player: PlayerId; size: DieSize } | null; steal: { from: PlayerId; size: DieSize; value: number } | null; glitch: boolean }` — each field is non-null for ~600ms after its triggering event index grows past the previously seen length, then reverts (single `setTimeout` per trigger; cleared on unmount). `enabled === false` (reduced motion, or `aiDelayMs === 0`) returns the all-null state always.

- [ ] **Step 1: Failing test** (fake timers):

```ts
it('exposes a lunge for 600ms after attackDeclared, none when disabled', () => {
  vi.useFakeTimers()
  const events: GameEvent[] = []
  const { result, rerender } = renderHook(({ ev, on }) => useAnimations(ev, on),
    { initialProps: { ev: events, on: true } })
  expect(result.current.lungeUid).toBeNull()
  const next = [...events, { type: 'attackDeclared', attacker: 7, target: 'gigArea' } as GameEvent]
  rerender({ ev: next, on: true })
  expect(result.current.lungeUid).toBe(7)
  act(() => vi.advanceTimersByTime(700))
  expect(result.current.lungeUid).toBeNull()
  rerender({ ev: [...next, { type: 'attackDeclared', attacker: 9, target: 'gigArea' } as GameEvent], on: false })
  expect(result.current.lungeUid).toBeNull()
})
```

- [ ] **Step 2: Run — FAIL.** **Step 3: Implement the hook** (track `lastSeen` length in a ref; on new events slice, take the newest matching each kind).
- [ ] **Step 4: Wire it:** PlayView computes `enabled = aiDelayMs !== 0 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches` (guard `matchMedia` for jsdom), passes animation state down: Field adds `is-lunging` class on the matching uid; StreetStrip renders the steal ghost (`.steal-ghost` absolutely positioned die that animates `top`/`left` from the victim side to the thief side via a keyframe, keyed so it remounts per steal) and `is-tumbling` on the most recent die of `tumble.player`; PlayView root gets `is-glitching` when `glitch`.
- [ ] **Step 5: Keyframes** in `motion.css` (all inside `@media (prefers-reduced-motion: no-preference)`):

```css
@keyframes lunge { 30% { transform: translateY(var(--lunge-dir, -14px)) scale(1.06); } 60% { transform: translateY(0); } }
.is-lunging { animation: lunge 500ms ease-out; }
@keyframes tumble { 0%, 60% { filter: brightness(1.6); transform: rotate(0turn) } 20% { transform: rotate(0.25turn) } 40% { transform: rotate(0.5turn) } }
.is-tumbling .die { animation: tumble 550ms ease-out; }
@keyframes steal-fly { from { transform: translate(0, 0); opacity: 1; } to { transform: translate(var(--fly-x, 200px), var(--fly-y, 40px)); opacity: 0.2; } }
.steal-ghost { position: absolute; pointer-events: none; animation: steal-fly 600ms ease-in forwards; }
@keyframes glitch { 0%, 100% { text-shadow: none; transform: none; } 20% { transform: translateX(2px); filter: hue-rotate(20deg); } 40% { transform: translateX(-2px); } }
.is-glitching { animation: glitch 350ms steps(4) 1; }
@keyframes pulse-act { 50% { box-shadow: 0 0 4px rgba(252,238,10,0.25); } }
```

(`--lunge-dir` set inline: human attackers lunge up, rival's lunge down. Playable/actionable pulse from Tasks 2–3 also lives here.)

- [ ] **Step 6: Run** hook test (PASS), `npm test`, `npx playwright test` (e2e runs with `?aiDelay=0` → animations disabled by construction).
- [ ] **Step 7: Commit** — `git commit -am "feat(ui): showpiece motion — lunge, tumble, gig steal flight, glitch"`

### Task 9: Deck Builder restyle + empty-slot error fix

**Files:**
- Modify: `src/ui/DeckPanel.tsx`, `src/ui/CardBrowser.tsx`, `src/ui/DeckBuilderView.tsx` (layout wrappers only), `src/ui/styles/deckbuilder.css`
- Test: `tests/ui/deckbuilder.test.tsx` (extend)

**Interfaces:**
- Consumes: `CardFrame size="zoom"` for browser cells, chrome capsules.
- Produces: `DeckPanel` renders per-color RAM budget bars — `data-testid="ram-bar-<Color>"` with `data-used`/`data-limit`, where **limit** = the existing `ramLimitsByColor` value and **used** = the highest `ram.value` among deck cards of that color (`0` when none): a filled bar (`width: min(100%, used/limit * 100%)` in the RAM color, red border + `is-over` class when `used > limit` or `limit === 0 && used > 0`). Keep the `ram-chip-<Color>` testids on the numerals inside the bar row. Size meter: `data-testid="deck-size-meter"` bar (40–50 band marked), keeping `deck-size-counter` text. Empty-slot fix: displayed errors filter out exactly `Unknown card id: "".` (the empty-legend-slot artifact); when any legend slot is `''`, show one hint row `data-testid="legend-hint"` ("Choose 3 Legends — cards unlock RAM in their colors."). `validateDeck` itself is NOT modified.

- [ ] **Step 1: Failing tests:**

```tsx
it('a new empty deck shows no Unknown-card-id errors', () => {
  // render DeckBuilderView, click new-deck-button
  expect(screen.queryByText(/Unknown card id: ""/)).toBeNull()
  expect(screen.getByTestId('legend-hint')).toBeInTheDocument()
})
it('ram bar reflects highest card demand vs legend budget', () => {
  // deck with one Green ramLimit-2 legend and one Green ram-3 card
  const bar = screen.getByTestId('ram-bar-Green')
  expect(bar).toHaveAttribute('data-used', '3')
  expect(bar).toHaveAttribute('data-limit', '2')
  expect(bar.className).toContain('is-over')
})
```

- [ ] **Step 2: Run — FAIL.** **Step 3: Implement** (`ramUsage` helper beside `ramLimitsByColor`; error filter `errors.filter(e => e !== 'Unknown card id: "".')` — keep every other error verbatim, including a *non-empty* unknown id).
- [ ] **Step 4: Restyle:** legend slots as 3 card-silhouette drop targets (dashed RAM-yellow border, hex badge ghost); browser filter row as capsule toggles (RAM color chips as colored squares, `aria-pressed` styling from chrome.css); browser grid `repeat(auto-fill, minmax(190px, 1fr))` of zoom-rendition frames with hover lift + count badge; deck rows with cost hex + name + stepper buttons; import/export in mono textareas. All existing testids preserved (`card-browser`, `deck-panel`, `legend-slot-*`, `card-row-*`, buttons, textareas).
- [ ] **Step 5: Run** `npm test` (deckbuilder tests updated only where they asserted removed presentation — justify each), `npm run build`.
- [ ] **Step 6: Commit** — `git commit -am "feat(ui): deck builder — RAM budget bars, size meter, legend slots, empty-slot error fix"`

### Task 10: Simulate view restyle + final visual QA

**Files:**
- Modify: `src/ui/SimulateView.tsx`, `src/ui/styles/simulate.css`, `README.md` (visuals section)
- Test: `tests/ui/simulate.test.tsx` (keep passing), `e2e/simulate.spec.ts` (keep passing)

**Interfaces:**
- Consumes: chrome; two-color split bar pattern.
- Produces: nothing downstream — final task.

- [ ] **Step 1:** Restyle: config row as a panel of labeled fields with Run as `btn--primary`; progress as a cyan fill bar (`data-testid` progress ids preserved); results: win split as one bar (deck A cyan fill vs deck B red fill, percentage labels), avg-length + end-reason stat chips, per-card tables in mono with the existing sortable headers; `sim-error` as a red-bordered panel. All testids preserved.
- [ ] **Step 2:** Run `npm test` + `npx playwright test` (all 5, including both simulate e2e).
- [ ] **Step 3: Full-app visual QA sweep** — with the dev server running, drive a real mid-game via the e2e's scripted policy at 1366×768 AND 1920×1080 and screenshot (adapt `e2e/play.spec.ts`'s `takeOneAction` into a throwaway script, or run Playwright headed): verify against the spec's success criteria — no clipped/overlapping cards anywhere (8-unit field, 10-card hand, tapped cards, eddies row), rival board upright/readable, street strip centered, zoom panel correct, prompts spotlight correctly, animations fire (run once WITHOUT `aiDelay=0`). Fix what the sweep finds within this task.
- [ ] **Step 4:** README: refresh the UI description (playmat layout, zoom panel, images toggle) — no setup-instruction changes.
- [ ] **Step 5:** `npm run build` + full `npm test` + `npx playwright test` one last time.
- [ ] **Step 6: Commit** — `git commit -am "feat(ui): simulate view chrome + final visual QA pass"`

---

## Self-review notes

- Spec coverage: tokens/type/chrome → T1; card renditions incl. image overlays, backs, keyword pips, power chip → T2; street strip + dice → T3; physical eddies + tapped legends → T4 (spec §Eddies area); playmat/feed/rail/setup → T5; hand fan + zoom panel → T6; spotlight prompts + game-over → T7; showpieces (lunge/tumble/steal-flight/glitch, reduced-motion + aiDelay gating) → T8; deck builder bars/meter/slots + `Unknown card id: ""` fix → T9; simulate + success-criteria QA → T10.
- The mulligan/order/reroll/intercept prompts are covered by T7's shared `.prompt-bar` restyle — their markup already exists in `PlayView.tsx` and only gains classes.
- Type consistency: `owner?: 'you' | 'rival'` (T2) is what T4 passes; `onHover?` optionality (T6) keeps `NO_AFFORDANCES`-style handler literals in tests valid; `StreetStrip` props named in T3 are what T5 mounts.
