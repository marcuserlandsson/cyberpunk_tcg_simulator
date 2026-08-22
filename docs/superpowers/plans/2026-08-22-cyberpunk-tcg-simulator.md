# Cyberpunk TCG Simulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local web app (Vite + React + TypeScript) implementing WeirdCo's Cyberpunk TCG Beta rules with the full 131-card beta set, a heuristic AI opponent, deck builder, game log/undo, and AI-vs-AI batch simulation.

**Architecture:** A pure, UI-free TypeScript game engine (immutable state, `legalActions`/`applyAction` reducer, seeded RNG, event sourcing) consumed by three clients: the React UI, the heuristic AI, and a headless simulation runner. Card behavior is data-driven (`data/cards.json` effect definitions interpreted by an effect system) with a scripted-function escape hatch.

**Tech Stack:** Vite, React 18, TypeScript (strict), Vitest, zod (data validation), Playwright (E2E smoke), tsx (CLI scripts). No backend; localStorage + file import/export for persistence.

**Spec:** `docs/superpowers/specs/2026-08-22-cyberpunk-tcg-simulator-design.md` — read it before starting any task. The extracted official rules are in `docs/rules/gameplay-guide-extracted.txt` and `docs/rules/page12-deckbuilding.png` (deck-building rules).

## Global Constraints

- **Unsupervised run:** never block on user input. When a rule or card is ambiguous, make the most rules-faithful ruling, implement it, and append it to `docs/rulings.md` (format: card/rule, question, ruling, source reasoning). Card text verbatim beats the guide on conflict.
- **Rule precedence:** card text > gameplay guide > official FAQ (https://cyberpunktcg.com/faq) > your ruling.
- **TDD:** every task writes failing tests first. `npm test` and `npm run build` must be green at every commit. Commit at minimum at each task boundary; more often is better.
- **Engine purity:** nothing under `src/engine/`, `src/cards/`, `src/ai/`, `src/sim/` may import from `react`, `react-dom`, or `src/ui/`. Guarded by a test (Task 3).
- **Determinism:** all randomness (shuffles, die rolls, AI tie-breaks) flows through the seeded RNG. Same seed + same actions = identical state. No `Math.random()` outside `src/ui/` cosmetics; no `Date.now()` in engine code.
- **Immutability:** `applyAction` never mutates its input; it returns a new state. Tests assert this.
- **TypeScript strict mode**, no `any` in `src/engine/` (use `unknown` + narrowing where needed).
- **Dice:** each player owns exactly 6 dice (d4, d6, d8, d10, d12, d20); 12 dice total in play, conserved forever.
- **Node:** assume Node 20+. Verify with `node --version` in Task 1; if missing, stop and report (the only allowed hard stop).
- Windows environment: shell commands in this plan are Git Bash (POSIX). Paths in code are repo-relative.

---

## File Structure (target)

```
├── data/
│   ├── cards.json               # CardDef[] — all 131 cards
│   ├── cards.schema.md          # field-by-field schema doc + effect vocabulary
│   ├── transcription-report.md  # per-card verification status (pass 1 / pass 2)
│   └── decks/arasaka-embracing-power.json, mercs-the-heist.json
├── docs/rulings.md
├── scripts/
│   ├── extract-pnp-images.py    # print-and-play PDF → page PNGs (uses pymupdf)
│   ├── fetch-images.mjs         # best-effort official card image fetch
│   └── sim.ts                   # CLI batch simulation (tsx)
├── src/
│   ├── engine/
│   │   ├── types.ts             # all shared types: state, actions, events, cards
│   │   ├── rng.ts               # mulberry32 seeded RNG
│   │   ├── cardDb.ts            # load + zod-validate cards.json → CardDb
│   │   ├── deck.ts              # DeckList type, validateDeck (RAM rules)
│   │   ├── game.ts              # newGame, setup, turn transitions, win/loss
│   │   ├── legal.ts             # legalActions(db, state)
│   │   ├── reduce.ts            # applyAction(db, state, action)
│   │   ├── combat.ts            # attack/react/fight/steal resolution helpers
│   │   ├── economy.ts           # sell/payment/call-legend helpers
│   │   ├── query.ts             # derived reads: streetCred, power, canAttack…
│   │   └── replay.ts            # GameRecord, replay, undo
│   ├── cards/
│   │   ├── effects.ts           # EffectNode interpreter + trigger dispatch
│   │   ├── targets.ts           # target-spec resolution
│   │   └── scripted/index.ts    # scripted card implementations registry
│   ├── ai/
│   │   ├── evaluate.ts          # board evaluation function
│   │   ├── heuristic.ts         # createHeuristicAgent
│   │   └── random.ts            # createRandomAgent (fuzz + benchmark baseline)
│   ├── sim/
│   │   ├── runner.ts            # runGames + stats aggregation
│   │   └── worker.ts            # web-worker wrapper for the UI
│   ├── ui/
│   │   ├── theme.css            # cyberpunk palette, tokens
│   │   ├── CardFrame.tsx        # HTML card render (+ official-image variant)
│   │   ├── Dice.tsx             # polyhedral die display
│   │   ├── useGame.ts           # GameRecord state hook: act/undo/save/load
│   │   ├── PlayView.tsx + playmat components (Field.tsx, HandStrip.tsx, ReactionBar.tsx, LogPanel.tsx, ZonePanels.tsx)
│   │   ├── DeckBuilderView.tsx + CardBrowser.tsx + DeckPanel.tsx
│   │   ├── SimulateView.tsx
│   │   └── storage.ts           # localStorage decks/settings/stats + import/export
│   ├── App.tsx                  # tab navigation: Play / Deck Builder / Simulate
│   └── main.tsx
├── tests/
│   ├── engine/*.test.ts         # rng, setup, turns, economy, combat, effects, replay, purity
│   ├── cards/*.test.ts          # per-card tests, batched by color
│   ├── fuzz/invariants.test.ts
│   ├── ai/*.test.ts
│   ├── sim/runner.test.ts
│   └── ui/*.test.tsx            # component tests (vitest + @testing-library/react)
├── e2e/play.spec.ts             # Playwright full-game smoke
├── index.html, vite.config.ts, tsconfig.json, package.json, playwright.config.ts
```

---

### Task 1: Scaffold & toolchain

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/ui/theme.css`, `.gitignore`, `tests/smoke.test.ts`

**Interfaces:**
- Produces: working `npm run dev`, `npm test`, `npm run build`; `App` renders three tab placeholders ("Play", "Deck Builder", "Simulate").

- [ ] **Step 1: Verify environment**

Run: `node --version && npm --version && python -c "import pymupdf; print('pymupdf ok')"`
Expected: Node ≥ 20. pymupdf is already installed; if the import fails run `python -m pip install pymupdf`.

- [ ] **Step 2: Write scaffold files manually** (do NOT use `npm create vite` — it prompts interactively in a non-empty directory)

`package.json`:
```json
{
  "name": "cyberpunk-tcg-simulator",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test",
    "sim": "tsx scripts/sim.ts"
  }
}
```

Run: `npm install react react-dom zod && npm install -D typescript vite @vitejs/plugin-react vitest @types/react @types/react-dom @testing-library/react @testing-library/user-event jsdom @playwright/test tsx`

`vite.config.ts`:
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environmentMatchGlobs: [['tests/ui/**', 'jsdom']],
  },
} as any)
```
(If the installed Vitest major version has dropped `environmentMatchGlobs`, use `// @vitest-environment jsdom` pragma comments at the top of each UI test file instead — check the installed version's docs, don't guess.)

`tsconfig.json`: strict, `"jsx": "react-jsx"`, `"module": "ESNext"`, `"moduleResolution": "bundler"`, `"target": "ES2022"`, `"noEmit": true`, include `src`, `tests`, `scripts`.

`index.html` loads `/src/main.tsx`; `main.tsx` renders `<App/>`; `App.tsx` renders a header "Cyberpunk TCG Simulator" and three tab buttons switching a `view` state between placeholder `<section>`s. `theme.css`: dark background `#0a0a12`, neon accents `--neon-cyan: #00f0ff; --neon-magenta: #ff2a6d; --neon-yellow: #f9f002`, monospace-ish display font stack.

`.gitignore`: `node_modules/`, `dist/`, `data/images/`, `test-results/`, `playwright-report/`.

- [ ] **Step 3: Write smoke test** `tests/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
describe('toolchain', () => { it('runs', () => expect(1 + 1).toBe(2)) })
```

- [ ] **Step 4: Verify everything is green**

Run: `npm test && npm run build && (npx playwright install chromium)`
Expected: test PASS, build succeeds, chromium installed for later E2E.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: scaffold Vite/React/TS/Vitest toolchain"`

---

### Task 2: Card transcription → `data/cards.json`

The most correctness-critical task. A silently wrong card corrupts all playtesting. Budget generous time.

**Files:**
- Create: `scripts/extract-pnp-images.py`, `data/cards.json`, `data/cards.schema.md`, `data/transcription-report.md`, `data/decks/arasaka-embracing-power.json`, `data/decks/mercs-the-heist.json`, `docs/rulings.md`

**Interfaces:**
- Produces: `data/cards.json` as `CardDef[]` (schema below, authoritative in Task 3's `types.ts`); two starter `DeckList` JSON files `{ "name": string, "legends": [id,id,id], "cards": { [cardId]: count } }`.
- Card `id` convention: kebab-case name plus disambiguating subtitle where needed, e.g. `"v-streetkid"`, `"mantis-blades"`.

- [ ] **Step 1: Extract print-and-play pages as images**

`scripts/extract-pnp-images.py`:
```python
import pymupdf, pathlib
out = pathlib.Path('data/pnp-pages'); out.mkdir(parents=True, exist_ok=True)
for pdf in ['docs/rules/print-and-play-arasaka.pdf', 'docs/rules/print-and-play-mercs.pdf']:
    doc = pymupdf.open(pdf)
    stem = pathlib.Path(pdf).stem
    for i, page in enumerate(doc):
        page.get_pixmap(dpi=200).save(out / f'{stem}-p{i+1}.png')
print('done')
```
Run it; add `data/pnp-pages/` to `.gitignore`. Read each PNG with the Read tool to view the cards.

- [ ] **Step 2: Harvest the online card database**

The official database https://cyberpunktcg.com/cards lists all 131 beta cards (60/page — fetch all pages, e.g. `?page=2`). It is powered by Netdeck.gg — first probe for a JSON API (try WebFetch on `https://cyberpunktcg.com/cards` looking for XHR/fetch URLs in scripts, and try obvious endpoints like `netdeck.gg/api/...` seen in page source). If an API yields structured card data, prefer it. Otherwise WebFetch each card's detail page and transcribe the listed fields (name, subtitle, type, color, cost, power, RAM, keywords, rules text, faction/set). Record for every card which source it came from in `data/transcription-report.md`.

- [ ] **Step 3: Define the schema and effect vocabulary** in `data/cards.schema.md`. Document every `CardDef` field and the starting `EffectNode` vocabulary (Task 7 lists it). While transcribing, when a card's text doesn't fit the vocabulary, either extend the vocabulary (document the extension here) or mark the card `"scripted": "<functionName>"`.

- [ ] **Step 4: Transcribe all cards into `data/cards.json`.** For each card: id, name, subtitle, color, faction, type (`legend|unit|program|gear`), cost, power (units/legends; null otherwise), ram `{color, value}` (non-legends), ramLimit `{color, value}` (legends), sellTag (boolean — visible as the sell icon in the top-left), keywords array, `text` (verbatim rules text), `effects` array (may be empty for vanilla units; fill what the vocabulary supports now, Task 8 completes them).

- [ ] **Step 5: Verification pass 2.** For EVERY card, independently re-read its source (image or database page) and compare field-by-field against `cards.json`. Log each card as `verified` or `discrepancy → fixed → re-verified` in `data/transcription-report.md`. Cards appearing in both the print-and-play PDFs and the database must agree; on mismatch, the database (newer, Beta) wins — note it.

- [ ] **Step 6: Build the two starter deck lists** from the print-and-play PDFs (they show the exact demo deck contents — count copies from the sheets). Save as the two `data/decks/*.json` files.

- [ ] **Step 7: Sanity checks.** Write a throwaway node script (or a permanent test in `tests/engine/cardDb.test.ts`, moved there in Task 3) asserting: exactly 131 unique ids; every card has type/name/text; every non-legend has ram; every legend has ramLimit; deck files reference only existing ids. Fix all failures.

- [ ] **Step 8: Start `docs/rulings.md`** with any ambiguities already encountered (e.g. unclear keyword wording), then commit: `git commit -m "feat: transcribe full 131-card beta set with double-check pass"`

---

### Task 3: Engine foundation — types, RNG, card DB, deck validation

**Files:**
- Create: `src/engine/types.ts`, `src/engine/rng.ts`, `src/engine/cardDb.ts`, `src/engine/deck.ts`
- Test: `tests/engine/rng.test.ts`, `tests/engine/cardDb.test.ts`, `tests/engine/deck.test.ts`, `tests/engine/purity.test.ts`

**Interfaces (produced — later tasks depend on these exact names):**

`src/engine/types.ts` (core excerpts — write the full file):
```ts
export type PlayerId = 0 | 1
export type DieSize = 4 | 6 | 8 | 10 | 12 | 20
export interface GigDie { size: DieSize; value: number }        // value 0 = unrolled (in fixer)
export type CardType = 'legend' | 'unit' | 'program' | 'gear'
export type Keyword = 'rush' | 'quick' | 'blocker' | 'merc' | string // extend during transcription

export interface CardDef {
  id: string; name: string; subtitle?: string
  color: string; faction?: string; type: CardType
  cost: number; power: number | null
  ram: { color: string; value: number } | null       // null for legends
  ramLimit: { color: string; value: number } | null  // legends only
  sellTag: boolean; keywords: Keyword[]; text: string
  effects: EffectDef[]; scripted?: string
}
export type CardDb = Record<string, CardDef>

export interface CardInstance {
  uid: number; defId: string; owner: PlayerId
  ready: boolean; lag: boolean; faceUp: boolean       // faceUp for legends/eddies; true otherwise
  attachedGear: number[]; tempPower: number           // until-end-of-turn power delta
}

export interface PlayerState {
  deck: number[]; hand: number[]; field: number[]
  legends: number[]                                   // order preserved, index 0 = leftmost
  eddies: number[]; trash: number[]
  gigArea: GigDie[]; fixer: GigDie[]
  soldThisTurn: boolean; calledLegendThisTurn: boolean; mulliganDone: boolean
}

export type Phase = 'chooseOrder' | 'mulligan' | 'start' | 'main' | 'react' | 'chooseGig' | 'gameOver'

export interface GameState {
  players: [PlayerState, PlayerState]
  cards: Record<number, CardInstance>
  nextUid: number
  turnNumber: number                 // increments when player 'first' begins a turn; each player's Nth turn
  activePlayer: PlayerId
  firstPlayer: PlayerId
  phase: Phase
  pendingAttack: { attacker: number; target: number | 'gigArea'; redirectedTo?: number } | null
  pendingSteal: { attacker: number; remaining: number } | null
  winner: PlayerId | null
  rng: RngState
  events: GameEvent[]
}

export type Action =
  | { type: 'choosePlayOrder'; goFirst: boolean }
  | { type: 'mulligan' } | { type: 'keepHand' }
  | { type: 'chooseGigDie'; size: DieSize }
  | { type: 'sellCard'; card: number }
  | { type: 'playCard'; card: number; payment: number[]; targets: number[] }
  | { type: 'callLegend'; payment: number[] }
  | { type: 'activateAbility'; card: number; abilityIndex: number; targets: number[] }
  | { type: 'attack'; attacker: number; target: number | 'gigArea' }
  | { type: 'chooseGig'; dieIndex: number }
  | { type: 'react'; reaction: Reaction }
  | { type: 'endTurn' }

export type Reaction =
  | { type: 'pass' }
  | { type: 'block'; blocker: number }
  | { type: 'callLegend'; payment: number[] }
  | { type: 'quick'; card: number; payment: number[]; targets: number[] }
  | { type: 'quickAbility'; card: number; abilityIndex: number; targets: number[] }

export type GameEvent =
  | { type: 'gameStarted'; seed: number; orderRolls: [number, number] }
  | { type: 'playOrderChosen'; first: PlayerId }
  | { type: 'mulliganTaken'; player: PlayerId } | { type: 'handKept'; player: PlayerId }
  | { type: 'turnStarted'; player: PlayerId; turn: number }
  | { type: 'cardDrawn'; player: PlayerId; uid: number }
  | { type: 'dieRolled'; player: PlayerId; size: DieSize; value: number }
  | { type: 'cardSold'; player: PlayerId; uid: number }
  | { type: 'cardPlayed'; player: PlayerId; uid: number }
  | { type: 'legendCalled'; player: PlayerId; uid: number }
  | { type: 'attackDeclared'; attacker: number; target: number | 'gigArea' }
  | { type: 'attackBlocked'; blocker: number }
  | { type: 'unitDefeated'; uid: number }
  | { type: 'gigStolen'; from: PlayerId; die: GigDie }
  | { type: 'effectResolved'; sourceUid: number; description: string }
  | { type: 'cardTrashed'; uid: number } | { type: 'cardBottomDecked'; uid: number }
  | { type: 'turnEnded'; player: PlayerId }
  | { type: 'gameEnded'; winner: PlayerId; reason: 'sevenGigs' | 'overtimeMajority' | 'deckout' | 'concede' }
// EffectDef / EffectNode / TargetSpec are defined in Task 7 and also live in this file.
```

`src/engine/rng.ts`:
```ts
export type RngState = number
export function createRng(seed: number): RngState
export function nextInt(rng: RngState, maxExclusive: number): [number, RngState]  // mulberry32
export function rollDie(rng: RngState, size: DieSize): [number, RngState]         // 1..size
export function shuffle<T>(rng: RngState, items: readonly T[]): [T[], RngState]   // Fisher-Yates
```

`src/engine/cardDb.ts`:
```ts
export function loadCardDb(): CardDb            // imports data/cards.json, zod-validates every card
export const cardDbSchema: z.ZodType<CardDef[]> // exported for scripts
```

`src/engine/deck.ts`:
```ts
export interface DeckList { name: string; legends: [string, string, string]; cards: Record<string, number> }
export function validateDeck(db: CardDb, deck: DeckList): string[]  // [] = legal; else human-readable errors
export function deckSize(deck: DeckList): number
```

- [ ] **Step 1: Write failing RNG tests** — determinism (same seed → same sequence), `rollDie` within 1..size, `shuffle` is a permutation and deterministic, distributions roughly uniform over 10k rolls (each face of a d6 between 1300 and 2000).
- [ ] **Step 2:** Run `npx vitest run tests/engine/rng.test.ts` — expect FAIL (module missing). Implement mulberry32 in `rng.ts`. Re-run → PASS.
- [ ] **Step 3: Write failing cardDb tests** — loads 131 cards; every id unique; zod rejects a card missing `type`; every legend has `ramLimit` and null `ram`; every non-legend has `ram`. Implement `cardDb.ts` (import cards.json with `import cards from '../../data/cards.json'`; ensure `resolveJsonModule` in tsconfig). PASS.
- [ ] **Step 4: Write failing deck validation tests** covering every official rule: exactly 3 legends with unique **names** (not ids); 40–50 non-legend cards; ≤3 copies per card; RAM — for each non-legend card, `card.ram.value` ≤ sum of `ramLimit.value` over the deck's legends whose `ramLimit.color === card.ram.color`; unknown ids rejected. Include the worked example from the rules page (2 Green + 2 Green + 2 Red legends → Green ≤ 4, Red ≤ 2) using synthetic defs. Also test both starter decks validate as legal against the real DB (if they don't, investigate transcription before "fixing" validation). Implement `deck.ts`. PASS.
- [ ] **Step 5: Write the purity test** `tests/engine/purity.test.ts`: recursively read all files under `src/engine`, `src/cards`, `src/ai`, `src/sim` (use `fs` in the test) and assert none match `/from ['"]react|from ['"].*\/ui\//`. PASS trivially now; it guards forever.
- [ ] **Step 6: Commit** — `git commit -m "feat: engine foundation - types, seeded RNG, card DB, deck validation"`

---

### Task 4: Game setup & turn skeleton

**Files:**
- Create: `src/engine/game.ts`, `src/engine/legal.ts`, `src/engine/reduce.ts`, `src/engine/query.ts`
- Test: `tests/engine/setup.test.ts`, `tests/engine/turns.test.ts`

**Interfaces:**
- Consumes: types/rng/cardDb/deck from Task 3.
- Produces:
```ts
// game.ts
export interface NewGameConfig { decks: [DeckList, DeckList]; seed: number }
export function newGame(db: CardDb, config: NewGameConfig): GameState
// legal.ts
export function legalActions(db: CardDb, state: GameState): Action[]
// reduce.ts
export class IllegalActionError extends Error {}
export function applyAction(db: CardDb, state: GameState, action: Action): GameState
// query.ts
export function streetCred(state: GameState, player: PlayerId): number
export function effectivePower(db: CardDb, state: GameState, uid: number): number
export function actingPlayer(state: GameState): PlayerId  // whose decision is pending (defender during 'react')
```

Semantics to implement (all from the guide):
- `newGame`: build card instances from deck lists, shuffle decks, shuffle legends face-down into `legends`, fill both fixers with the 6 unrolled dice, roll both players' d20 for play order (reroll ties; record `orderRolls`), phase `chooseOrder`; roll winner gets the `choosePlayOrder` action.
- `choosePlayOrder`: sets `firstPlayer`; the first player's 2 leftmost legends become spent (`ready: false`) and are skipped by the ready step on their first turn only. Both players draw 6. Phase → `mulligan` (first player decides first: legal action is `mulligan` or `keepHand`).
- `mulligan`: shuffle hand back, draw 6, once per player.
- After both keep: phase → `start` for firstPlayer, `turnStarted` event, turnNumber 1.
- Start-of-turn sequence inside the transition (automatic, no actions): (1) win check — ≥7 dice in gigArea → `gameEnded(sevenGigs)`; (2) ready all spent cards (except the first-turn penalty above); (3) reset `soldThisTurn`/`calledLegendThisTurn`, clear `lag` and `tempPower` on that player's cards; (4) draw 1 — empty deck → rival wins (`deckout`). Then if fixer non-empty, phase `start` with legal actions = one `chooseGigDie` per distinct die size in fixer, **excluding d20 unless it's the only die left**. If fixer empty (turn 7+), skip straight to `main`.
- `chooseGigDie`: roll it (`dieRolled` event), move `{size, value}` to gigArea, phase → `main`.
- `endTurn`: only legal in `main`; passes turn to the other player and runs their start-of-turn.
- **Overtime:** after BOTH players have completed 7 turns, from that moment on, after every applied action check: if one player's gigArea has strictly more dice than the other's, they win (`overtimeMajority`). Record this interpretation of "majority" in `docs/rulings.md`.
- `applyAction` first checks the action is in `legalActions` (deep-equal on the relevant fields), else throws `IllegalActionError`. All reducers return fresh objects (spread-copy the paths you touch).

- [ ] **Step 1: Write failing setup tests** — after `newGame`+`choosePlayOrder`+both `keepHand`: 6-card hands, 44-card decks (starter decks are 50 minus 6… use actual counts), 3 face-down legends each, 6 unrolled dice per fixer, first player's leftmost 2 legends spent; mulligan redraws to 6 and is once-only; d20 order roll recorded in events; determinism — same seed twice → deep-equal states.
- [ ] **Step 2:** Run → FAIL. Implement `game.ts` + minimal `legal.ts`/`reduce.ts` for these actions. → PASS.
- [ ] **Step 3: Write failing turn tests** — die choice list excludes d20 while others remain, includes only d20 when alone; rolled die lands in gigArea with 1 ≤ value ≤ size; streetCred sums correctly; ready step readies spent cards but not first-player-penalty legends on turn 1 (and DOES ready them turn 2); 7 dice at own turn start → win; drawing from empty deck → rival wins; turn 8+ has no die gain; overtime majority triggers immediately when dice counts diverge after both turn-7s; `endTurn` alternates activePlayer; 12 dice conserved.
- [ ] **Step 4:** Implement in `game.ts`/`reduce.ts`/`query.ts`. → PASS. Also add an immutability test: `applyAction` leaves the input state deep-equal to a pre-call clone.
- [ ] **Step 5: Commit** — `git commit -m "feat: game setup, turn structure, dice, win/loss/overtime"`

---

### Task 5: Economy — sell, payments, playing cards, Call a Legend

**Files:**
- Create: `src/engine/economy.ts`
- Modify: `src/engine/legal.ts`, `src/engine/reduce.ts`
- Test: `tests/engine/economy.test.ts`

**Interfaces:**
- Produces (`economy.ts`, used by reduce.ts and later by combat/effects):
```ts
export function canPayWith(state: GameState, player: PlayerId, payment: number[], cost: number): boolean
export function canonicalPayment(state: GameState, player: PlayerId, cost: number): number[] | null // ready eddies first, then legends left-to-right; null if unaffordable
export function pay(state: GameState, payment: number[]): GameState                                  // spends each uid
```

Semantics: valid payment uids are ready cards in the payer's `eddies` or `legends` zones, each worth 1 €$, total exactly `cost`. Sell: only in `main`, once/turn, card must have `sellTag`; card moves face-down (`faceUp: false`) into `eddies` (it enters ready and can pay immediately — the guide doesn't restrict it; record as ruling). Play (this task: vanilla cards only, effects come in Task 7): units enter `field` ready with `lag: true`; programs go to trash immediately; gear requires a `targets: [friendlyUnitOrLegendUid]` and appends to that card's `attachedGear`. Call a Legend: 1 €$, once/turn, flips a **random** face-down legend (use state RNG); legal only if a face-down legend exists. Legends spent as payment stay in the legends zone whether face-up or down.

`legalActions` in `main` emits: one `sellCard` per sellable card (if not soldThisTurn); one `playCard` per affordable hand card with `payment: canonicalPayment(...)` and one entry per legal target choice for gear; `callLegend` with canonical payment; `endTurn`. (`applyAction` accepts ANY valid payment, not just the canonical one — legality check must compare actions ignoring the `payment` field, validating payment via `canPayWith`.)

- [ ] **Step 1: Write failing tests** — sell adds an eddie and blocks a second sell that turn; non-sellTag card can't be sold; playing a 2-cost unit spends 2 eddies and the unit has lag; unit without payment is not in legalActions; paying with a legend spends it; call-a-legend flips exactly one face-down legend at random (seeded: assert deterministic which), once per turn, costs 1; gear attaches to chosen target and is not playable with no valid target; program goes to trash; playing a card removes it from hand; lag clears at that player's next turn start.
- [ ] **Step 2:** Run → FAIL. Implement. → PASS.
- [ ] **Step 3: Commit** — `git commit -m "feat: economy - sell, payments, play cards, call a legend"`

---

### Task 6: Combat & reactions

**Files:**
- Create: `src/engine/combat.ts`
- Modify: `src/engine/legal.ts`, `src/engine/reduce.ts`
- Test: `tests/engine/combat.test.ts`

**Interfaces:**
- Consumes: `effectivePower` from query.ts (base power + tempPower + gear bonuses — gear power bonuses arrive in Task 7; until then effectivePower = base + tempPower).
- Produces: attack flow driven entirely through `applyAction`; `state.pendingAttack` / `state.pendingSteal` as defined in types.ts.

Semantics (guide pages 8–9):
- `attack` legal in `main` for each ready, non-lag friendly unit (or rush unit played this turn), against each **spent** rival unit and against `'gigArea'` (only if rival gigArea non-empty — attacking an empty gig area is pointless but the guide doesn't forbid it; forbid it and note as ruling). Applying it: spend the attacker, fire on-attack triggers (Task 7), set `pendingAttack`, phase → `react`; `actingPlayer()` = defender.
- React window: defender's `legalActions` = `react:pass`, `react:block` per ready Blocker unit (spends it, sets `redirectedTo`), `react:callLegend` (if not used this turn + affordable — flips, may fire on-call triggers, window stays open), `react:quick`/`quickAbility` (Task 7; none yet). Multiple reactions allowed before pass — the window closes only on `pass` (or when a redirect resolves the attack — after a block, resolve immediately: blocked direct attacks steal nothing, guide p9).
- Resolution on `pass`: target spent unit (or blocker) → fight: compare effectivePower; strictly higher defeats lower; tie → both defeated; defeated units (with attached gear) → trash, fire on-defeat triggers. Target gigArea un-blocked → steal count = `1 + floor(power/10)` (power 0 → 0 steals), capped by rival gigArea size; phase → `chooseGig`, attacker picks dice via `chooseGig` actions (one per die, `pendingSteal.remaining` counts down); each moves the die to attacker's gigArea (`gigStolen` event). Then phase → `main`.
- Ready units are never legal attack targets. Attacker spent even if the attack is blocked or steals nothing.

- [ ] **Step 1: Write failing tests** — attacker must be ready/non-lag/rush-exempt; legal targets are exactly spent rival units + gigArea; fight higher-power wins, tie mutual, loser+gear to trash; steal thresholds: power 1 → 1 die, 9 → 1, 10 → 2, 20 → 3, 0 → 0; chooseGig moves chosen die and attacker picks each die when stealing multiple; blocker redirect → fight vs blocker and NO steal even on win; blocker must be ready and is spent by blocking; call-a-legend as reaction consumes the once-per-turn call; defender can chain block after call; pass with no reaction resolves; 12-dice conservation across steals; a steal reaching 7 dice does NOT win instantly (win checks at turn start — but overtime majority DOES apply if active).
- [ ] **Step 2:** Run → FAIL. Implement `combat.ts` + reducer/legal wiring. → PASS.
- [ ] **Step 3: Commit** — `git commit -m "feat: combat - attacks, react window, blockers, fights, gig stealing"`

---

### Task 7: Effect system & keywords

**Files:**
- Create: `src/cards/effects.ts`, `src/cards/targets.ts`, `src/cards/scripted/index.ts`
- Modify: `src/engine/types.ts` (EffectDef/EffectNode/TargetSpec), `src/engine/reduce.ts` (trigger dispatch points), `src/engine/legal.ts` (activated abilities, quick plays), `src/engine/query.ts` (gear/static power)
- Test: `tests/engine/effects.test.ts` (synthetic card defs, not real cards)

**Interfaces:**
```ts
// types.ts additions
export type Trigger = 'onPlay' | 'onCall' | 'onAttack' | 'onDefeat' | 'activated' | 'static'
export interface EffectDef {
  trigger: Trigger
  cost?: { selfSpend?: boolean; eddies?: number }      // for activated abilities
  condition?: { streetCredAtLeast?: number }
  quick?: boolean                                       // usable in react window
  effect: EffectNode
}
export type TargetSpec =
  | 'self' | 'friendlyUnit' | 'rivalUnit' | 'rivalSpentUnit' | 'anyUnit' | 'friendlyUnitOrLegend'
export type EffectNode =
  | { kind: 'draw'; count: number }
  | { kind: 'discardRandomRival'; count: number }
  | { kind: 'buffPower'; amount: number; target: TargetSpec; duration: 'turn' | 'permanent' }
  | { kind: 'staticPower'; amount: number }             // gear/static: applies while attached/fielded
  | { kind: 'defeat'; target: TargetSpec }
  | { kind: 'bounce'; target: TargetSpec }              // return to owner's hand
  | { kind: 'readyCard'; target: TargetSpec } | { kind: 'spendCard'; target: TargetSpec }
  | { kind: 'stealGig'; count: number } | { kind: 'returnGig'; count: number }
  | { kind: 'rerollGig'; whose: 'friendly' | 'rival' }
  | { kind: 'trashFromDeck'; whose: 'friendly' | 'rival'; count: number }
  | { kind: 'bottomDeck'; target: TargetSpec }
  | { kind: 'gainEddieFromTopDeck'; count: number }
  | { kind: 'sequence'; effects: EffectNode[] }
  | { kind: 'scripted'; name: string }
// effects.ts
export interface EffectCtx { player: PlayerId; sourceUid: number; targets: number[] }
export function fireTrigger(db: CardDb, state: GameState, trigger: Trigger, sourceUid: number, targets: number[]): GameState
export function resolveEffect(db: CardDb, state: GameState, node: EffectNode, ctx: EffectCtx): GameState
export function effectTargetChoices(db: CardDb, state: GameState, uid: number, def: EffectDef): number[][] // enumerate legal target tuples for legalActions
// scripted/index.ts
export type ScriptedCard = (db: CardDb, state: GameState, ctx: EffectCtx) => GameState
export const scriptedCards: Record<string, ScriptedCard>
```

Wiring: reduce.ts fires `onPlay` after a card resolves, `onCall` when a legend flips via call, `onAttack` after spending the attacker but before the react window (guide: "before your Rival reacts"), `onDefeat` when a unit hits the trash from the field. `activated` abilities appear in `legalActions` as `activateAbility` (self-spend requires ready + non-lag; eddies cost paid with canonical payment); `quick: true` defs/programs appear as reactions during rival attacks. `staticPower` on gear/units feeds `effectivePower`. `condition.streetCredAtLeast` checks the controller's street cred at activation/trigger time. **Keywords rush/quick/blocker/merc are engine-level flags** (rush handled in Task 6; merc: a legend with `merc` gains a `playCard` legal action from the legends zone at its cost, entering the field ready without lag, removed from game — not trash — if it leaves the field).

Extend the vocabulary as Task 8 demands; every new node kind gets a synthetic-card test here first.

- [ ] **Step 1: Write failing tests with a synthetic CardDb** (build `CardDef`s inline in the test) — one test per node kind above; trigger timing tests (onPlay fires once; onAttack before react — assert a rival unit defeated by an onAttack effect can't block; onDefeat fires on fight loss); streetCred gating (below threshold → ability absent from legalActions / trigger skipped); activated ability self-spend blocked by lag; quick program playable only during rival attack react window and paid normally; merc legend fields ready+rush and is removed-from-game on defeat; gear staticPower changes fight outcomes; targets enumerated correctly.
- [ ] **Step 2:** Run → FAIL. Implement interpreter + wiring. → PASS.
- [ ] **Step 3: Commit** — `git commit -m "feat: data-driven effect system, triggers, keywords, activated abilities"`

---

### Task 8: Implement all 131 cards

**Files:**
- Modify: `data/cards.json` (complete every card's `effects`), `src/cards/scripted/index.ts`, `data/cards.schema.md` (vocabulary extensions), `docs/rulings.md`
- Test: `tests/cards/<color>.test.ts` (one file per card color/faction batch)

**Interfaces:**
- Consumes: everything from Task 7. No new public interfaces.

Procedure — work in batches of ~15 cards, grouped by color; per batch:

- [ ] **Step 1:** For each card in the batch, read its verbatim `text` and encode it as `effects` (extend the vocabulary via Task 7's test-first process if needed) or write a scripted function. Any interpretation call → `docs/rulings.md`.
- [ ] **Step 2:** Write at least one test per card in the batch file, driving the REAL card through the public engine API. Worked example shape (use for every card):
```ts
it('kiroshi-optics grants its power bonus to the equipped unit', () => {
  const { db, state } = fixtureWithHand(0, ['some-unit', 'kiroshi-optics']) // helper: tests/cards/fixtures.ts
  let s = playCardByDef(db, state, 0, 'some-unit')
  s = endBothTurnsOnce(db, s)                       // clear lag
  s = playCardByDef(db, s, 0, 'kiroshi-optics', { targetDef: 'some-unit' })
  const unit = findFielded(s, 0, 'some-unit')
  expect(effectivePower(db, s, unit)).toBe(basePower(db, 'some-unit') + kiroshiBonus)
})
```
Build `tests/cards/fixtures.ts` in the first batch: `fixtureWithHand`, `playCardByDef`, `findFielded`, `endBothTurnsOnce`, `forceStreetCred` (directly sets gig dice values in a copied state), `startAttack`. Vanilla units (no text) get a one-line test asserting cost/power/keywords match the def via a fight or play.
- [ ] **Step 3:** Run the batch file + full suite → PASS. Commit per batch: `git commit -m "feat: implement <color> cards batch N (X/131 done)"`
- [ ] **Step 4 (after all batches):** Write a completeness test: every card in the DB either has `effects.length > 0`, is in `scriptedCards`, or has empty rules `text` (vanilla). Assert 131/131. Commit.

---

### Task 9: Fuzz harness & invariants

**Files:**
- Create: `src/ai/random.ts`, `tests/fuzz/invariants.test.ts`

**Interfaces:**
```ts
// random.ts
export interface Agent { chooseAction(db: CardDb, state: GameState, actions: Action[]): Action }
export function createRandomAgent(seed: number): Agent   // uniform random legal action
```

- [ ] **Step 1: Write the fuzz test** — for 300 seeds (`vitest` with 120s timeout; scale count so runtime < 60s): play random-vs-random with the two starter decks (and, for 100 of the seeds, two synthetic 40-card decks sampled legally from the full DB with a seeded generator) to completion or 200 actions-per-game cap. After EVERY `applyAction` assert: total dice across all four dice zones = 12; no negative eddies/hand/deck sizes; every uid appears in exactly one zone; spent cards never in `legalActions` as attackers/payers; the chosen action came from `legalActions` and applied without throw; game ends by turn 30 at the latest (overtime majority forces termination — if a stalemate is possible, investigate and fix or document). On any failure, print the seed + action history for reproduction.
- [ ] **Step 2:** Run → fix every engine bug it finds (each fix gets its own targeted regression test in the relevant `tests/engine/*.test.ts` file first, then the fix). Loop until 300 seeds pass twice in a row.
- [ ] **Step 3: Commit** — `git commit -m "test: fuzz harness with engine invariants, N engine fixes"`

---

### Task 10: Heuristic AI

**Files:**
- Create: `src/ai/evaluate.ts`, `src/ai/heuristic.ts`
- Test: `tests/ai/heuristic.test.ts`

**Interfaces:**
```ts
// evaluate.ts
export function evaluate(db: CardDb, state: GameState, perspective: PlayerId): number
// heuristic.ts
export function createHeuristicAgent(seed: number): Agent   // same Agent interface as random.ts
```

Design: `chooseAction` = for each legal action, `applyAction` on a copy → `evaluate` the result from the AI's perspective → pick the max (seeded random tie-break). Evaluation weights (starting point, tune in Step 3): gig dice count ×1000 (win proximity dominates), overtime majority ±5000, street cred ×10, sum of friendly fielded power ×15, rival fielded power ×−12, hand size ×20, ready eddies+legends ×15, face-up legends ×25, cards in deck ×1 (deckout aversion when <5: ×50). Terminal states ±1e9. Hidden-info safety: `evaluate` and `chooseAction` must not read the rival's `hand` contents, `deck` order, or face-down legends' `defId` — enforce with a test that shuffles those in a cloned state and asserts the chosen action is unchanged. Special handling: during `chooseGig` steal picks, take the highest-value die; during `react`, simulate each reaction one-ply too (this falls out of the generic loop). End-turn guard: never `endTurn` while a strictly-evaluation-improving action exists (falls out of argmax since endTurn is scored by simulating the rival NOT moving — score endTurn as the current state value minus a small tempo penalty of 5).

- [ ] **Step 1: Write failing tests** — (a) legality: 50 seeded heuristic-vs-heuristic games complete with zero `IllegalActionError`; (b) strength: heuristic beats random ≥ 90% over 200 games (100 as each side, alternating first player, starter decks, fixed seed set — if it fails, tune weights, don't lower the bar below 85% without documenting why in rulings.md); (c) hidden-info invariance test described above; (d) determinism: same seed → same action sequence; (e) tactical spot-checks: with 6 gigs and an open steal for the win in overtime, it attacks the gig area; it blocks a lethal-majority steal when a blocker is ready.
- [ ] **Step 2:** Run → FAIL → implement → PASS (expect real tuning iterations on (b)).
- [ ] **Step 3: Commit** — `git commit -m "feat: heuristic AI agent, >90% vs random baseline"`

---

### Task 11: Simulation runner & stats

**Files:**
- Create: `src/sim/runner.ts`, `src/sim/worker.ts`, `scripts/sim.ts`
- Test: `tests/sim/runner.test.ts`

**Interfaces:**
```ts
// runner.ts
export interface SimOptions {
  deckA: DeckList; deckB: DeckList; games: number; seed: number
  agentA: 'heuristic' | 'random'; agentB: 'heuristic' | 'random'
}
export interface CardStat { defId: string; timesPlayed: number; gamesSeen: number; winRateWhenPlayed: number }
export interface SimResult {
  games: { winner: 0 | 1; turns: number; reason: string; seed: number }[]
  winRateA: number; avgTurns: number; cardStatsA: CardStat[]; cardStatsB: CardStat[]
}
export function runGames(db: CardDb, opts: SimOptions, onProgress?: (done: number, total: number) => void): SimResult
export function toCsv(result: SimResult): string
// worker.ts — a standard Worker: postMessage(SimOptions) in, progress + SimResult messages out
```
Alternate which deck goes first each game; derive per-game seeds from `opts.seed + gameIndex`.

- [ ] **Step 1: Write failing tests** — 20-game run returns 20 results, winRateA consistent with games array, deterministic for a fixed seed, per-card stats: a card played in N games shows `gamesSeen === N`; `toCsv` round-trips headers + one row per game. Implement. → PASS.
- [ ] **Step 2:** `scripts/sim.ts`: CLI `npm run sim -- --games 1000 --deckA data/decks/arasaka-embracing-power.json --deckB data/decks/mercs-the-heist.json --seed 42` printing a summary table. Run 1000 games — must complete with no throw (this is the spec's acceptance criterion). Note games/second in the commit message.
- [ ] **Step 3: Commit** — `git commit -m "feat: AI-vs-AI simulation runner, stats, CLI; 1000-game run clean"`

---

### Task 12: UI shell, card rendering, storage

**Files:**
- Create: `src/ui/CardFrame.tsx`, `src/ui/Dice.tsx`, `src/ui/storage.ts`
- Modify: `src/App.tsx`, `src/ui/theme.css`
- Test: `tests/ui/cardframe.test.tsx`, `tests/ui/storage.test.ts`

**Interfaces:**
```ts
// CardFrame.tsx
export function CardFrame(props: { def: CardDef; size: 'small' | 'medium' | 'zoom'
  faceDown?: boolean; ready?: boolean; lag?: boolean; tempPower?: number
  useOfficialImages: boolean; onClick?: () => void }): JSX.Element
// Dice.tsx
export function Die(props: { die: GigDie; rolled: boolean }): JSX.Element
// storage.ts
export function saveDeck(deck: DeckList): void
export function listDecks(): DeckList[]                    // bundled starter decks + localStorage decks
export function deleteDeck(name: string): void
export function exportDeckText(db: CardDb, deck: DeckList): string   // "3x Card Name" lines, Legends section
export function importDeckText(db: CardDb, text: string): DeckList   // throws with message on unknown names
export function getSettings(): { useOfficialImages: boolean }
export function saveSettings(s: { useOfficialImages: boolean }): void
export function saveGameRecord(name: string, record: GameRecord): void
export function listGameRecords(): { name: string; record: GameRecord }[]
```
CardFrame renders: cost badge (top-left, with sell tag icon), type label (top-right), RAM pips colored by `ram.color`, name/subtitle, rules text with keyword highlighting, power (bottom-right), color-tinted border; spent = rotated 90° via CSS transform; lag = dimmed with "LAG" chip; face-down = card-back pattern. Official image variant: if `useOfficialImages` and `import.meta.glob('/data/images/*')` contains `<defId>.(png|jpg)`, render the image with a hover/zoom text fallback. Die renders an SVG polygon per size (triangle d4, square d6, pentagon d10 etc.) with the value centered, cyan for friendly styling handled by parent.

- [ ] **Step 1:** Write failing component tests (jsdom + @testing-library/react): CardFrame shows name, cost, power, keyword text for a real card def; faceDown hides the name; storage save/list/delete round-trip (mock localStorage via jsdom); `exportDeckText`/`importDeckText` round-trip a starter deck; import rejects unknown card names with a useful error. Implement. → PASS.
- [ ] **Step 2:** Commit — `git commit -m "feat: UI shell, card frame rendering, dice, local storage"`

---

### Task 13: Play view

**Files:**
- Create: `src/engine/replay.ts`, `src/ui/useGame.ts`, `src/ui/PlayView.tsx`, `src/ui/Field.tsx`, `src/ui/HandStrip.tsx`, `src/ui/ReactionBar.tsx`, `src/ui/LogPanel.tsx`, `src/ui/ZonePanels.tsx`
- Modify: `src/App.tsx`
- Test: `tests/engine/replay.test.ts`, `tests/ui/usegame.test.ts`; Create `e2e/play.spec.ts`, `playwright.config.ts`

**Interfaces:**
```ts
// replay.ts (engine — pure)
export interface GameRecord { config: NewGameConfig; actions: Action[] }
export function replay(db: CardDb, record: GameRecord): GameState
export function undoToLastDecisionOf(db: CardDb, record: GameRecord, player: PlayerId): GameRecord
  // strips trailing actions up to AND including that player's last action (AI actions after it fall away too)
// useGame.ts (React hook)
export function useGame(db: CardDb): {
  state: GameState | null; record: GameRecord | null
  legal: Action[]                       // for the human (player 0); [] when AI is deciding
  start: (humanDeck: DeckList, aiDeck: DeckList, seed?: number) => void
  act: (a: Action) => void              // applies human action, then runs AI (async, small delay per AI action for readability) until human decision or game over
  undo: () => void
  save: (name: string) => void; load: (record: GameRecord) => void
  eventsForLog: { text: string; turn: number }[]   // rendered from GameEvent via a describeEvent function
}
```
PlayView layout: rival zones mirrored on top (hand as face-down count, field, gig area + fixer dice, legends, eddies count, trash count), human zones bottom, center strip shows turn/phase/street-cred for both. Interaction model driven by `legal`: hand cards with a legal `playCard` glow cyan (click → if multiple target variants, click a highlighted target to disambiguate); sellable cards get a sell button on hover; ready units with legal attacks glow magenta (click unit → highlight legal targets incl. rival gig area → click target); during `chooseGig`, rival dice glow (click to steal); ReactionBar appears during `react` phase listing each legal reaction as a button (Pass always last); "Call Legend" and "End Turn" as fixed buttons enabled per legality. LogPanel: scrolling `eventsForLog`, newest at bottom. Undo button calls `undo`. Seed shown in a corner; "New game" opens deck pickers (from `listDecks()`) + optional seed input. Human is always player 0. UI never constructs an action not present in `legal` (payment pickers unnecessary — use canonical payments; note in rulings.md that manual payment selection is a UI simplification, engine supports it).

- [ ] **Step 1: Write failing replay tests** — replay(record) after N actions deep-equals the live state (compare a fuzz game); undoToLastDecisionOf removes the human's last action and any trailing AI actions; undo twice works; save/load round-trips through JSON. Implement `replay.ts`. → PASS.
- [ ] **Step 2: Write failing useGame test** (jsdom, `renderHook`): start a game vs heuristic AI with a fixed seed → hook reaches a state where `legal.length > 0` for the human; `act` on a legal action advances; `undo` returns to the prior decision point. Implement `useGame.ts`. → PASS.
- [ ] **Step 3:** Build the PlayView components. Manual check: `npm run dev`, play several turns yourself using browser automation or by reasoning over the DOM — but the binding check is Step 4.
- [ ] **Step 4: Playwright E2E smoke** `e2e/play.spec.ts`: launch dev server (`webServer` in playwright.config.ts), start a game (pick both starter decks, fixed seed), then loop: if reaction bar visible click "Pass", else click the first glowing hand card / attack the gig area when highlighted / click "End Turn" — a scripted policy sufficient to reach turn 3 with at least: one card played, one attack declared, log lines appearing, undo pressed once and the last log line disappearing. Run: `npm run e2e` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: play view - full game vs AI with log, undo, save/resume"`

---

### Task 14: Deck builder view

**Files:**
- Create: `src/ui/DeckBuilderView.tsx`, `src/ui/CardBrowser.tsx`, `src/ui/DeckPanel.tsx`
- Modify: `src/App.tsx`
- Test: `tests/ui/deckbuilder.test.tsx`

**Interfaces:**
- Consumes: `validateDeck`, `storage.ts` functions, `CardFrame`.
- Produces: no new programmatic interfaces (leaf view).

Layout: left = CardBrowser (search box over name+text, filter chips for color/type/keyword, cost range, sorted grid of `CardFrame size="small"`, click adds to deck / right-click or a “+/−” overlay adjusts count); right = DeckPanel (chosen 3 legend slots first — picking legends shows the resulting per-color RAM limits; card rows grouped by type with counts; live counters "cards: 43/40–50", per-color RAM limit chips; every `validateDeck` error shown in red; Save (named, localStorage), Export (textarea + copy), Import (paste → `importDeckText`, errors surfaced), New, Load from `listDecks()`).

- [ ] **Step 1: Write failing component tests** — renders 131 cards; typing in search filters; clicking a card increments its count and a 4th copy is refused with the validation error visible; selecting legends updates RAM chips; an over-RAM card add shows the error; export text contains "3x" lines; import of the export reproduces the deck; save then reload lists the deck. Implement. → PASS.
- [ ] **Step 2: Commit** — `git commit -m "feat: deck builder with RAM validation, import/export"`

---

### Task 15: Simulate view

**Files:**
- Create: `src/ui/SimulateView.tsx`
- Modify: `src/App.tsx`, `src/sim/worker.ts` wiring
- Test: `tests/ui/simulate.test.tsx`

Layout: two deck pickers (any saved/bundled deck), agent pickers (heuristic/random), games count (default 200), seed input, Run button → progress bar fed by worker progress messages → results panel: win rate per deck (with count), average game length, end-reason breakdown, per-deck card table (times played, games seen, win% when played, sortable), Export JSON + Export CSV buttons (download via Blob). Store the last result in localStorage (`storage.ts` gains `saveSimResult`/`getLastSimResult` — add to its tests).

- [ ] **Step 1: Write failing tests** — mock the worker (inject a `runGamesInWorker` prop or module mock) to return a canned `SimResult`; assert win rates, table rows, and that CSV export produces `toCsv(result)`. Implement view + real worker wiring (worker used in the browser; tests use the mock). → PASS.
- [ ] **Step 2:** Manual verification via Playwright: extend `e2e/play.spec.ts` or add `e2e/simulate.spec.ts` — run a 20-game sim in the real UI and assert a win-rate figure renders. → PASS.
- [ ] **Step 3: Commit** — `git commit -m "feat: simulate view - batch AI matches with stats and export"`

---

### Task 16: Hardening, images, README, final review

**Files:**
- Create: `scripts/fetch-images.mjs`, `README.md` (rewrite), final `docs/rulings.md` pass
- Test: extend `tests/fuzz/invariants.test.ts`

- [ ] **Step 1: Big fuzz** — temporarily run the fuzz suite at 2000 seeds plus 500 heuristic-vs-heuristic games with invariants on (a one-off `npx vitest run tests/fuzz --testTimeout=600000` with an env var like `FUZZ_SEEDS=2000` read by the test). Fix anything found (regression test per fix). Restore default counts so `npm test` stays < ~2 min.
- [ ] **Step 2: Official images (best effort)** — `scripts/fetch-images.mjs`: try to resolve each card's official image (from the database pages / netdeck CDN URLs found in Task 2), download to `data/images/<defId>.png` with polite 500ms delays. Tolerate total failure: the script reports N/131 fetched and the app works fully without images. Do not commit images (gitignored). If zero images fetchable, note it in README.
- [ ] **Step 3: README** — rewrite with: what this is (unofficial playtesting simulator for WeirdCo's Cyberpunk TCG Beta; rules © their owners; card text used for personal playtesting), setup (`npm install && npm run dev`), how to play (UI walkthrough incl. reaction bar and undo), deck building rules recap, simulation CLI + UI usage, where rulings live, project architecture map, test commands.
- [ ] **Step 4: Final review sweep** — run the full gate: `npm test && npm run build && npm run e2e && npm run sim -- --games 1000 --deckA data/decks/arasaka-embracing-power.json --deckB data/decks/mercs-the-heist.json --seed 7`. Re-read `docs/rulings.md` for completeness (every assumption made anywhere must be listed). Verify the spec's Success Criteria section item by item; fix any gap.
- [ ] **Step 5: Commit** — `git commit -m "chore: hardening, image fetch, README, final review"`

---

## Self-Review Notes (already applied)

- Spec coverage: platform/stack (T1), transcription+rulings (T2), deck rules incl. RAM (T3/T14), full rules engine (T4–T7), 131 cards (T8), fuzz invariants (T9), AI + benchmarks (T10), 1000-game sim criterion (T11), hybrid card visuals + settings toggle (T12/T16), play view with log/undo/save (T13), deck builder import/export (T14), stats view + export (T15), README + success criteria check (T16).
- Undo semantics, overtime "majority" interpretation, empty-gig-area attacks, sold-eddie readiness, and canonical payments are called out as explicit rulings — executors must record them in `docs/rulings.md` when implementing.
- Type/name consistency: `Agent` defined once in `src/ai/random.ts` (T9) and reused by T10/T11; `GameRecord` in `src/engine/replay.ts` (T13) and consumed by `storage.ts` (T12) — Task 12's `saveGameRecord` may be implemented with a local type alias and unified in T13 if T12 executes first.
