# Cyberpunk TCG Simulator — Design Spec

**Date:** 2026-08-22
**Status:** Approved design, pending implementation plan
**Purpose:** A local web app for learning and playtesting WeirdCo's Official Cyberpunk Trading Card Game (Cyberpunk 2077 license, retail launch 2026-10-01) ahead of release: build decks from the full beta card set and play full games against a competent AI opponent.

## Source material (authoritative)

All downloaded to `docs/rules/`:

| File | Content |
|---|---|
| `cyberpunk-tcg-gameplay-guide.pdf` (+ `gameplay-guide-extracted.txt`) | Official Beta gameplay guide, 14 pages. **The rules authority for this project.** |
| `cyberpunk-tcg-reminder-sheet.pdf` | Official turn/reaction quick reference |
| `print-and-play-arasaka.pdf` | "Embracing Power" demo deck (Arasaka), card images |
| `print-and-play-mercs.pdf` | "The Heist" demo deck (Mercs), card images |

Additional sources: official card database at https://cyberpunktcg.com/cards (141-card beta pool, powered by Netdeck.gg), FAQ at https://cyberpunktcg.com/faq, Beta rule-change notes at https://cyberpunktcg.com/blog/beta-rule-updates.

**Rule precedence:** card text > gameplay guide > FAQ > agent ruling (documented in `docs/rulings.md`).

## Rules summary (as implemented)

- Each player: a deck, 3 face-down Legends (random order), 6 Gig dice (d4, d6, d8, d10, d12, d20) starting in their fixer area.
- **Setup:** shuffle; both roll d20 for play order (winner chooses); first player spends their 2 leftmost Legends and does not ready them on their first turn; draw 6 with one optional full mulligan.
- **Start Phase (in order):** ready all spent cards → draw 1 → take any die from fixer area (d20 always last), roll it, place in Gig area.
- **Main Phase (any order, any number):** Sell 1 card/turn (sell-tagged, face-down to Eddies area, worth 1 €$) · Play cards by spending Eddies and/or Legends (each Legend = 1 €$, face-up or down) · Call a Legend 1/turn (1 €$, flip random face-down Legend; also allowed as a reaction) · Attack with ready Units (spend the Unit; not on the turn played — Lag).
- **Attack sequence:** spend attacker → resolve on-attack triggers → declare target (spent rival Unit, or rival Gig area) → **React window** (defender may: Call a Legend, play/activate Quick effects, spend a Blocker to redirect) → resolve: *fight* = compare power, higher defeats lower, tie = mutual defeat, defeated Units (with equipped Gear) to trash, on-defeat triggers; *steal* = take 1 rival Gig die of attacker's choice, +1 more per full 10 power (0 power = 0 Gigs). A blocked/redirected direct attack steals nothing.
- **Card types:** Legend (crew centerpiece; also spendable as currency), Unit (fielded, fights/steals), Program (instant, then trash), Gear (equips a friendly Unit/Legend; moves with it).
- **Keywords:** Rush (attack turn played) · Quick (usable as reaction) · Blocker (redirect attack to self by spending) · Merc (pay Legend's cost to play it as a ready Unit that can attack; removed from game if it leaves the field) · Lag (can't attack or self-spend; all Units enter with it until end of turn) · Bottom-deck · Trash-from-deck.
- **Street Cred:** sum of face values of your Gig dice; gates some effects.
- **Deck building:** exactly 3 Legends with unique names; 40–50 cards (excluding Legends); max 3 copies of any card; RAM limit — each card has a colored RAM value, each Legend a RAM limit counting only toward its own color, and a card may be included only if its RAM value ≤ the cumulative RAM of your Legends in that card's color (e.g. two 2-Green-RAM Legends + one 2-Red-RAM Legend permit Green cards up to RAM 4 and Red cards up to RAM 2).
- **Win/loss:** start your turn with ≥7 Gig dice in your Gig area → win. After the last player's 7th turn, Overtime: majority of Gig dice wins immediately. Required to draw with an empty deck → immediate loss.
- Ready Units cannot be attacked; only spent Units can be fight targets.

## Agreed decisions

| Decision | Choice |
|---|---|
| Platform | Local web app (Vite + React + TypeScript), no backend; `npm install && npm run dev` |
| Card pool | Full beta card pool (141 cards after database reconciliation: 130 core + 10 starter-deck exclusives + 1 promo; see docs/rulings.md), transcribed from official database + print-and-play PDFs |
| AI | Solid heuristic AI (single difficulty) |
| Card visuals | Hybrid: HTML-rendered card frames from data (baseline); official images swapped in via settings toggle where fetching succeeded |
| Extras | Game log + undo, deck save/import/export, playtest stats incl. AI-vs-AI batch simulation |
| Not in scope | Hotseat 2-player, networked play, mobile packaging, search-based AI |

## Architecture

Approach A: a pure, UI-free TypeScript engine; the React UI and the AI are both consumers of it.

```
cyberpunk_tcg_simulator/
├── docs/
│   ├── rules/                 # official PDFs + extracted text
│   ├── rulings.md             # every agent rules ruling / assumption, auditable
│   └── superpowers/specs/     # this spec + implementation plan
├── data/
│   ├── cards.json             # all 141 cards: stats, verbatim text, effect definitions
│   ├── decks/                 # starter decks (Arasaka, Mercs) + bundled sample decks
│   └── images/                # fetched official card images (gitignored)
├── src/
│   ├── engine/                # pure TS: state, reducer, legal actions, RNG, events
│   ├── cards/                 # effect primitives + scripted card implementations
│   ├── ai/                    # heuristic agent
│   ├── sim/                   # batch AI-vs-AI runner (web worker) + stats
│   ├── ui/                    # React components (Play, DeckBuilder, Simulate views)
│   └── App.tsx
└── tests/                     # Vitest: rules, per-card, fuzz/invariants, AI, UI smoke
```

### Engine

- Immutable `GameState`: per-player zones (deck, hand, field, Legends area, Eddies area, Gig area, fixer area, trash), card instance states (ready/spent, Lag, attached Gear, modifiers), turn number, phase, active/priority player, pending reaction window, RNG state, event history.
- API: `newGame(deckA, deckB, seed)` · `legalActions(state): Action[]` · `applyAction(state, action): {state, events}`.
- `legalActions` is the single source of truth for legality; UI affordances and AI choices both derive from it. `applyAction` rejects anything not in that set.
- Seeded RNG inside the state: shuffles and die rolls fully reproducible.
- **Event sourcing:** the emitted event log is the game record. Undo = replay from start minus the last human action-group. Save/resume and replay = serialized event history. The AI is stateless between decisions, so undo cannot leak hidden information.

### Card data & effects

- `cards.json` per card: `id`, `name`, `faction`, `type`, `cost`, `power`, `ram` (value + color; Legends carry a RAM *limit* instead), `sellTag`, `keywords[]`, `text` (verbatim), `effects[]` of `{trigger, condition?, effect}` composed from primitives (draw, gainEddies, buff, stealGig, trashFromDeck, bottomDeck, readyTarget, spendTarget, streetCredGate, …).
- Escape hatch: `implementation: "scripted"` pointing to a named TS function in `src/cards/scripted/` for cards the primitive vocabulary can't express.
- **Transcription protocol:** extract card images from the print-and-play PDFs and the online database; transcribe via vision into `cards.json`; then an independent second vision pass compares every transcription against its image field-by-field; discrepancies re-checked a third time. Ambiguities resolved from rulebook/FAQ and logged in `docs/rulings.md`.

### AI

`chooseAction(state, legalActions): Action`, hidden-information-safe (never reads rival hand, deck order, or face-down Legend identities). Layers:

1. Terminal checks — take game-winning lines; react to game-losing steals.
2. One-ply greedy: apply each candidate action via the real engine, score with an evaluation function (Gig count dominant; then Street Cred, field power, card advantage, Eddies, Legend availability).
3. Tactical heuristics — sell weakest card when starved, favorable fights only, keep Blockers ready when ahead, steal the highest-value die, respect Rush/Quick timing.
4. Reaction policy — block when the trade or the Gig math favors it.

Seeded random tie-breaking for variety. Acceptance bar: 0 illegal actions ever; >90% win rate vs a random-legal-mover over ≥200 games.

### UI

- **Play view:** official-layout playmat (rival mirrored on top), card zoom on click, legal-action-driven affordances (playable cards glow, valid targets highlight, reaction bar during React windows), polyhedral dice with values, Street Cred totals, scrolling game log, undo, save/resume.
- **Deck Builder:** filterable card browser (faction/type/cost/keyword/text), deck list with legality validation per the deck-building rules above (3 unique Legends, 40–50 cards, ≤3 copies, per-color RAM limits derived from chosen Legends, shown as a live per-color RAM budget), save/load (localStorage), import/export as text lists.
- **Simulate view:** pick two decks, run N AI-vs-AI games in a web worker; report win rates, average game length, per-card play counts and win correlations; export JSON/CSV.
- Cyberpunk visual language: dark theme, neon cyan/magenta/yellow accents, faction color coding. HTML card frames from data; settings toggle for official images when present in `data/images/`.

### Persistence

localStorage for decks, settings, stats; file import/export for decks and sim results; games saved as serialized event histories.

## Testing strategy

- **Rule tests:** every normative statement in the gameplay guide → at least one Vitest case.
- **Per-card tests:** ≥1 test per card exercising its effect through the public engine API.
- **Fuzz/invariant tests:** thousands of seeded random-vs-random games asserting: 12 total dice conserved (6 per player), no negative resources, spent cards never act, every `legalActions` result applies cleanly, games terminate, winner determination matches rules.
- **AI tests:** legality (by construction, verified), strength vs random baseline, no hidden-info access (lint/API boundary).
- **UI smoke test:** headless browser drives a complete game end-to-end on the built app.
- TDD throughout; milestones do not advance on a red suite.

## Unsupervised build plan (milestone order)

Each milestone ends with a green suite and a git commit, so interruption always leaves a working state.

1. Scaffold: Vite + React + TS + Vitest, CI-style `npm test` / `npm run build` green.
2. Card transcription pipeline + `cards.json` + double-check passes + `docs/rulings.md` started.
3. Engine core: zones, setup/mulligan, turn structure, dice/Gigs/Street Cred, economy (sell, Eddies, Legends-as-currency, Call a Legend).
4. Combat: attacks, React window, Blocker/Quick, fights, Gig stealing, win/loss/Overtime/deck-out.
5. Effect system + all 141 cards implemented and tested.
6. Heuristic AI + strength benchmarks.
7. Play view UI (full game vs AI, log, undo, save/resume).
8. Deck Builder view.
9. Simulate view + stats + export.
10. Hardening: large fuzz runs, official-image fetch attempt, polish, README (setup, how to play, known rulings), final review pass.

**Standing orders for the run:** never block on user input; make the most rules-faithful assumption and record it in `docs/rulings.md`; card text verbatim wins over guide on conflict; keep `npm run dev`, `npm test`, `npm run build` green at every commit; commit at every milestone boundary at minimum.

## Success criteria

- A complete game vs the AI is playable in the browser with only official-rules-legal moves possible.
- All 141 beta-pool cards present, transcription double-checked, effects implemented and individually tested.
- Deck building with RAM validation, import/export.
- 1,000-game AI-vs-AI simulation completes without crash or invariant violation and produces a stats report.
- Fresh clone → `npm install && npm run dev` → playing, with README covering the rest.
