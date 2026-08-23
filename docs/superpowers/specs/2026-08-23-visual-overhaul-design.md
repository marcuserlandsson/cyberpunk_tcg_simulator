# Visual Overhaul ("Afterlife") — Design Spec

**Date:** 2026-08-23
**Status:** Approved direction (mockups reviewed in artifact), pending implementation plan
**Purpose:** Replace the simulator's placeholder UI (text-in-boxes, overlapping/rotated rival cards, raw HTML forms) with a premium game-table presentation, without touching engine, AI, or sim behavior.
**Mockups:** https://claude.ai/code/artifact/1e41c556-728f-4ad3-8036-03a2bfdd1d79 (all mockups are live HTML/CSS and are the visual reference for this spec; where prose and mockup disagree, this spec wins)

## Settled decisions (user-approved 2026-08-23)

| Decision | Choice |
|---|---|
| Board card rendition | **Official card images by default**, with status overlays; redesigned HTML frames are the images-off fallback (settings toggle stays) |
| Hand layout | **Fan with hover-lift** (arc, slight overlap, hover lifts + enlarges) |
| Spent cards | **Rotate 90° (tap)**, plus slight desaturation; layout must reserve room so tapped cards never clip or overlap |
| Motion scope | **Baseline + showpieces in this pass**: attack lunge, dice tumble on roll, gig die visibly flying between pools when stolen, game-over glitch flash |

## Design language

Three anchors: the official card frames (hex cost badge, angular clipped corners, RAM-colored frames, keyword capsules, barcode strips, large power box), the Cyberpunk 2077 interface language (soft neon red + cyan on near-black, angular clipped geometry, corner brackets, subtle scanlines), and digital-TCG layout conventions (player side ~60% of board height; hand fan; contested resource centered).

### Color tokens

| Token | Value | Role |
|---|---|---|
| `--void` | `#07070D` | page ground |
| `--panel` | `#10101A` | surfaces |
| `--panel-2` | `#161624` | raised surfaces / wells |
| `--line` | `#262638` | hairline borders |
| `--line-bright` | `#3A3A52` | emphasized borders |
| `--text` | `#E8ECF2` | primary text |
| `--muted` | `#8B94A8` | secondary text |
| `--cyan` | `#00E5FF` | **the human player** and interactive affordances |
| `--red` | `#FF3D5A` | **the rival** and danger |
| `--yellow` | `#FCEE0A` | **actionable right now** (playable glow, primary button, active turn) |
| `--ram-red/-yellow/-green/-blue` | `#FF4655` `#FCEE0A` `#2DFF87` `#38A8FF` | card identity ONLY (frames, RAM pips, deck budgets) — never chrome |

**Semantic rule (binding):** cyan = yours, red = rival's, yellow = something you can do right now. RAM colors never appear on app chrome. Exactly one yellow primary button per screen state.

### Typography

Bundled locally via `@fontsource` packages (the app must keep working offline; no runtime Google Fonts requests):

- **Rajdhani** (500/600/700) — display: card names, zone headers, buttons, numerals, dice values. Uppercase for names/labels; wide letter-spacing on labels.
- **Chakra Petch** (400/500/600) — body: rules text, UI copy.
- **IBM Plex Mono** (400/500) — data: game log, seeds, sim numbers, deck import/export.

### Shared chrome

Clipped-corner panels (`clip-path` 12px cuts), corner brackets on key panels, subtle scanline texture on the playmat, angular capsule tags (parallelogram clips), buttons as clipped blocks: yellow filled = primary, cyan ghost = secondary, red ghost = destructive. Focus-visible outlines on all interactive elements. All motion honors `prefers-reduced-motion` (disabled entirely).

## Card renditions

Three renditions of every card; **board cards never render rules text**.

1. **BoardCard (default, images on):** the official card image (`data/images/<id>.webp`) at board size with overlays:
   - Ready ring: cyan glow (rival: red ring, no glow pulse).
   - Actionable pulse: yellow animated glow when the card can be played/attacked/activated *by the human now* (driven by `legalActions`, as today's affordances are).
   - Spent: rotated 90° + slight desaturation.
   - Lag: yellow "LAG" banner across the lower art.
   - Power chip: bottom-right clipped chip showing *effective* power whenever it differs from printed (green border = buffed, red = reduced); hidden when equal to printed.
   - Keyword pips: small hex pips down the left edge for Blocker/Quick/Adrenaline/Go-Solo (single letters, tooltip with the full keyword).
   - Attachment badge: equipped Gear shows as a small offset card edge behind the host with a count chip.
2. **BoardCard (images off):** redesigned HTML mini-frame in the same layout language as the print card — hex cost badge, name, RAM-colored frame, power box, art area as faction-tinted gradient. Same overlays/states as above.
3. **ZoomCard:** full HTML frame mirroring the printed layout (hex cost, type capsule, RAM pips, art area, name + colored subtitle, tag capsules, rules text with keyword capsules — yellow for named triggers like {Play}, magenta for combat keywords — barcode strip, power box). When images are on, the zoom panel shows the official image at large size *plus* a compact live-state strip (effective power, granted keywords, attachments, turn buffs). ZoomCard appears in: a fixed zoom panel on board/hand hover, card click, and the Deck Builder browser.

Face-down cards (deck, face-down legends, sold cards, rival hand) get a proper card back: diagonal circuit-hatch in owner color over dark, replacing today's bare hatched rectangles.

## Play view

Grid: main board column + fixed right rail (~280px). Board rows top-to-bottom:

1. **Rival strip (compact, ~40% of board height together with the street):** stats line (deck/trash/hand counts in red-keyed chips), the eddies area (see below), legends row (small face-down backs / face-up minis), field row of upright BoardCards. **Rival cards are never rotated except when spent (tap), and never clip the viewport.**
2. **Street strip (the visual center):** both gig pools face each other — rival dice row above, player dice row below; each pool labeled with gig count and street cred total; unrolled fixer dice as dim outlined silhouettes (d20 last); center block shows turn number, whose turn, and "first to 7 gigs wins" (switches to Overtime messaging when relevant).
3. **Player field:** stats line + eddies area + legends row + field row, cyan-keyed, larger than rival's.

**Eddies area (both players):** rendered physically, like the tabletop game — each sold card is a small face-down card back in the owner's color; a **spent eddie taps 90°** (matching the spent-card rule) and readies upright at turn start. A small `ready / total` numeral chip sits beside the row as the at-a-glance summary, but the cards themselves are the primary display. **Legends spent as currency (or otherwise) also render tapped** in the legends row, whether face-up or face-down, readying at turn start per the rules. The eddies row compresses card spacing (overlap) as it grows so it never wraps the strip.
4. **Hand fan:** arced fan, slight overlap, hover lifts/enlarges and raises z-index; playable cards pulse yellow. Fan compresses spacing as hand size grows (up to 10+ cards without overflow).

Right rail: **Feed** (the game log) — turn-stamped, color-coded by actor (you = cyan, rival = red, system/turn markers = yellow), auto-scroll with scroll-lock when the user scrolls up; seed chip in the header. Beneath the feed, the anchored **action bar**: End turn (primary), Call legend, Undo, Save/name field, New game.

**Prompt bars** (reaction window, target choice, intercept, gig reroll, mulligan, order choice): one shared "spotlight bar" component pinned above the hand — restates the pending question in words (e.g. "Maelstrom Ganger (8) attacks your Field Operator (2)"), renders the legal responses as buttons, and dims the rest of the board except the cards involved. Target choices additionally highlight the candidate cards/dice themselves (click-to-choose stays).

**Game over:** full-board overlay with a brief red/cyan glitch flash, WIN/LOSS in display type, the winning condition in words, and buttons (New game, Review log).

**Setup screen:** same panel chrome — deck pickers as styled cards (deck name, faction, legend names), seed input, Start as the yellow primary; saved games as resumable rows with delete.

### Showpiece motion (this pass)

- **Attack lunge:** attacker nudges toward its target with a short ease-out lunge + impact flash on resolve.
- **Dice tumble:** a rolled die flickers through faces briefly before settling in the gig area.
- **Gig steal flight:** a stolen die animates across the street strip from victim pool to thief pool.
- **Game-over glitch:** single short RGB-split flash, then the overlay.
All are CSS/JS-lite (transforms + keyframes on existing DOM), never block input longer than ~600ms, are skipped entirely under `prefers-reduced-motion`, and are disabled when `?aiDelay=0` (so e2e is unaffected).

## Deck Builder

Same chrome; two-pane layout survives:

- **Browser pane:** responsive grid of ZoomCards with hover lift; filter controls restyled as capsule toggles (RAM colors as color chips, types, keywords) + name/text search and cost range in panel styling.
- **Deck pane:** 3 legend slots drawn as card-silhouette drop targets; **per-color RAM budget bars** (colored fill, `used / limit` numerals) that go red when exceeded; a 40–50 **deck size meter**; card list rows with cost hex, name, count stepper; legality errors as styled messages. Fix: an empty/new deck must not render `Unknown card id: ""` rows (today's bug — empty legend slots leak into validation display).
- Save/load/import/export controls restyled; import textarea in mono.

## Simulate view

Panel chrome for the config row (deck/agent pickers, games, seed, Run as primary). Progress as a styled bar. Results as stat blocks: win-rate split as a two-color bar (deck A cyan / deck B red), average game length, per-card table in mono with sortable columns kept, export buttons as ghosts.

## Constraints (binding)

- **Zero behavior change:** engine, AI, sim, storage, and `useGame` logic untouched except where a view needs new read-only data already available in state/events. `legalActions` remains the single affordance source.
- **Every existing `data-testid` and data attribute survives** (`playmat`, `data-awaiting`, `data-turn`, `playable-card`, `attacker-card`, `reaction-bar`, `choice-bar`, `fixer-die`, `gig-die`, `log-line`, `end-turn`, `undo`, save/resume ids, …). All 5 Playwright e2e tests and all 1155 vitest tests must pass unmodified (test edits allowed only for assertions about pure presentation, and must be justified in the task report).
- **No clipping/overlap at any state:** field rows must accommodate tapped (90°) cards and 8+ units per side (strategy: cards shrink evenly to keep one row, down to a 56px-width floor, then the row wraps; row height always reserves the tapped diagonal); hand fan handles 10+ cards; the board fits a 1366×768 viewport without vertical scroll of the board itself (feed scrolls internally).
- **Offline-safe:** fonts via `@fontsource` npm packages; no runtime requests to external hosts. New dependencies limited to `@fontsource/*`.
- **Rival information hygiene unchanged:** the UI must not render hidden info (rival hand contents, deck order, face-down legend identities) — card backs only.
- **Reduced motion:** every animation gated behind `prefers-reduced-motion: no-preference`; showpieces also disabled at `?aiDelay=0`.

## Success criteria

1. A full game vs the AI is playable with every card on both boards upright, readable, and un-clipped at 1366×768 and 1920×1080.
2. Cards render as official images with live-state overlays by default; toggling images off yields the redesigned HTML frames; hover/click shows the full ZoomCard with rules text.
3. Gig pools face each other on the street strip with polyhedral die silhouettes; a steal visibly moves a die across the strip.
4. Every pending decision (reaction, target, intercept, reroll, mulligan, order) is presented by the spotlight bar in words with button responses.
5. Deck Builder shows live RAM budget bars and a size meter; a new empty deck shows no `Unknown card id` errors.
6. Eddies render as face-down cards that visibly tap when spent and ready upright at turn start; spent legends render tapped the same way.
7. `npm test` (1155) and `npx playwright test` (5) pass; `npm run build` succeeds; no new external network requests at runtime.
