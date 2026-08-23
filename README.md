# Cyberpunk TCG Simulator

An unofficial, fan-made playtesting simulator for **WeirdCo's Official
Cyberpunk Trading Card Game** (Cyberpunk 2077 license), built against the
public **Beta** card pool ahead of the game's retail launch. It runs entirely
in your browser: build a deck from the full 141-card beta pool, then play a
complete game against a heuristic AI opponent, or batch-simulate thousands of
AI-vs-AI games to see how decks and cards perform.

**This is not an official product and is not affiliated with, endorsed by,
or connected to WeirdCo, CD Projekt Red, or CD Projekt S.A.** Card names,
card text, and game rules are the intellectual property of their respective
owners and are reproduced here only as far as needed for personal,
non-commercial playtesting and rules learning. If you're looking for the real
thing, see [cyberpunktcg.com](https://cyberpunktcg.com).

Card data was transcribed from the official card database (via
[cyberpunktcg.com/cards](https://cyberpunktcg.com/cards), powered by
Netdeck.gg) and the two print-and-play demo decks, cross-checked against the
official Beta gameplay guide. Every non-obvious rules interpretation made
while building this simulator is recorded, with reasoning, in
[`docs/rulings.md`](docs/rulings.md).

## Contents

- [Setup](#setup)
- [How to play](#how-to-play)
- [Deck building](#deck-building)
- [Simulation](#simulation)
- [Official card images](#official-card-images)
- [Where the rules live](#where-the-rules-live)
- [Project architecture](#project-architecture)
- [Tests](#tests)

## Setup

Requires Node.js (developed against Node 24).

```sh
git clone <this repo>
cd cyberpunk_tcg_simulator
npm install
npm run dev
```

Then open the printed local URL (Vite's default is `http://localhost:5173`).
There is no backend and nothing is sent over the network at runtime — all
state lives in your browser's `localStorage`, and the app works fully
offline once loaded.

To also run the end-to-end browser tests, Playwright needs its own bundled
Chromium once:

```sh
npx playwright install chromium
```

Other useful scripts:

| Command | What it does |
|---|---|
| `npm run dev` | Start the app in development mode |
| `npm run build` | Type-check and produce a production build in `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run the Vitest unit/integration suite |
| `npm run e2e` | Run the Playwright end-to-end suite against a real browser |
| `npm run sim -- <flags>` | Run a batch AI-vs-AI simulation from the CLI (see [Simulation](#simulation)) |

## How to play

The app has three tabs: **Play**, **Deck Builder**, and **Simulate**. A
"Use official card images" toggle in the header switches every card face
between the built-in HTML card frame (always available) and official card
art (only where [image fetching](#official-card-images) has been run
locally).

**Starting a game:** on the Play tab, pick a deck for yourself and one for
the AI (the two bundled starter decks — Arasaka's "Embracing Power" and the
Mercs' "The Heist" — are always available, plus anything you've saved in the
Deck Builder), optionally set a seed for a reproducible shuffle, and click
**Start Game**. You'll get one optional full mulligan on your opening hand.

**Playing your turn:** the playmat shows your area on the bottom and the
AI's, mirrored, on top. Every affordance on screen (which cards glow as
playable, which dice/cards are legal attack or ability targets) is derived
directly from the engine's own legal-action list — if something isn't
highlighted, it isn't a legal move right now, by construction. Click a card
in hand to play it, a ready Unit to attack, or use the control bar to sell a
card, Call a Legend, or end your turn.

**Reaction windows:** when you attack (or the AI does), a reaction bar
appears letting the defender respond before the attack resolves — Call a
Legend, play or activate a Quick effect, or spend a Blocker to redirect the
attack to itself — before choosing to pass and let the attack resolve as
declared.

**Target disambiguation:** whenever an action could apply to more than one
legal target (which rival Unit to attack, which of several dice a steal
effect should take, which face-down Legend to flip), a choice bar appears
listing the specific options so you pick exactly one before the action
resolves.

**Undo and save/resume:** the **Undo** button rewinds your last move (undo
only ever removes your own most recent action-group, never anything the AI
did, so it can't leak hidden information). **Save** stores the current game
under a name you choose (in `localStorage`); reopening the Play tab's
"Resume a saved game" list lets you pick it back up later, including after
closing the browser.

Card zoom is available by clicking any card face for a larger, always-legible
view (falling back to the text face even when official art is toggled on).

## Deck building

A legal deck needs:

- **Exactly 3 Legends**, each with a unique name.
- **40–50 non-Legend cards** total (the two bundled starter decks are
  30-card `demo` decks and are exempted from this size check — official
  demo decks are intentionally smaller than a constructed deck).
- **At most 3 copies** of any single card.
- **Per-color RAM legality**: every non-Legend card has a colored RAM value;
  each of your 3 Legends contributes a RAM *limit* in its own color, and a
  card can only be included if its RAM value is at or under the combined
  limit your Legends provide in that card's color. (Two Legends with a
  2-value Green RAM limit plus one Legend with a 2-value Red limit lets you
  run Green cards up to RAM 4 and Red cards up to RAM 2, but no Blue cards at
  all.)

The **Deck Builder** tab is a filterable browser over all 141 cards
(faction, type, cost, keyword, free text) plus a deck list showing a live
per-color RAM budget and every validation error found, if any — an invalid
deck is shown, not hidden or blocked, so you can see exactly what to fix.
Decks save to `localStorage`; editing one of the bundled starter decks forks
a separate local copy rather than overwriting the original.

**Import/export** uses a plain-text format, so decks are easy to share or
back up:

```
# My Deck Name
[optional " [demo]" suffix marks it as a demo deck, exempt from the size check]

## Legends
Goro Takemura — Hands Unclean
Yorinobu Arasaka — Embracing Destruction
Saburo Arasaka — Stubborn Patriarch

## Cards
1x Minotaur
2x Swordwise Huscle
3x Mantis Blades
...
```

Card names that are ambiguous on their own (multiple printings sharing a
name) must be written as `Name — Subtitle`; export always disambiguates this
way automatically when needed.

## Simulation

The **Simulate** tab picks two decks, runs N AI-vs-AI games in a background
Web Worker (so the UI stays responsive), and reports win rates, average game
length, and per-card play-count/win-correlation stats, exportable as JSON or
CSV.

The same runner is available from the command line, which is how the
project's own 1,000-game acceptance check is run:

```sh
npm run sim -- --games 1000 \
  --deckA data/decks/arasaka-embracing-power.json \
  --deckB data/decks/mercs-the-heist.json \
  --seed 7
```

Flags: `--games` (default 100), `--seed` (default 1), and `--agentA`/
`--agentB` (`heuristic` (default) or `random`).

## Official card images

`scripts/fetch-images.mjs` is a best-effort, one-off script that re-queries
the same public card database used for card transcription and downloads
each card's official art to `data/images/<card-id>.<ext>` (that directory is
gitignored and not part of this repo — nobody's card art ships with the
source):

```sh
node scripts/fetch-images.mjs
```

It tolerates any card (or the whole run) failing to fetch — the app is fully
playable with zero images present; the HTML card frame (name, cost, power,
RAM, rules text, keywords) is the real baseline visual, not a fallback of
last resort. Once any images exist in `data/images/`, the header's "Use
official card images" toggle switches to them automatically; cards without a
locally fetched image keep showing the HTML frame either way. Re-run the
script occasionally if you want fresher art — the database's image URLs are
signed and expire.

## Where the rules live

- [`docs/rules/`](docs/rules/) — the official Beta gameplay guide, reminder
  sheet, and the two demo decks' print-and-play PDFs. The gameplay guide is
  the rules authority for this project; card text overrides it on conflict.
- [`docs/rulings.md`](docs/rulings.md) — every rules ambiguity, transcription
  judgment call, and engine-design decision made while building this
  simulator, numbered and cross-referenced (currently §1–§153). If the
  simulator does something you didn't expect, this is the first place to
  check for the reasoning.
- [`data/transcription-report.md`](data/transcription-report.md) — how the
  141-card pool was transcribed and independently double-checked against the
  card database and the print-and-play PDFs, including the two verification
  passes' findings.
- [`data/cards.schema.md`](data/cards.schema.md) — the shape of
  `data/cards.json`, the machine-readable source of truth for every card's
  stats, verbatim text, and effect definition.

## Project architecture

```
src/
├── engine/   # pure TS rules engine: GameState, newGame/legalActions/applyAction,
│             # seeded RNG, deck validation, event log — no UI, no card-specific logic
├── cards/    # effect primitives (the vocabulary cards are built from) +
│             # scripted/ escape-hatch implementations for cards that need one
├── ai/       # the heuristic opponent (src/ai/heuristic.ts) and a random-legal-mover
│             # baseline (src/ai/random.ts) used by tests and by the AI-strength benchmark
├── sim/      # batch AI-vs-AI runner (src/sim/runner.ts), driven directly by the
│             # CLI (scripts/sim.ts) and, in the browser, from a Web Worker (src/sim/worker.ts)
└── ui/       # React components for the Play, Deck Builder, and Simulate views

data/
├── cards.json           # all 141 cards: stats, verbatim text, effect definitions
├── decks/                # the two bundled starter decks
└── images/               # (gitignored) official art, populated by scripts/fetch-images.mjs

tests/
├── engine/   # rules-engine unit tests (one Vitest case per normative rule statement)
├── cards/    # per-card tests, exercising every card's effect through the public engine API
├── fuzz/     # seeded random-vs-random invariant sweep (thousands of games; see below)
├── ai/       # AI legality/strength/determinism/hidden-info tests
├── sim/      # batch-runner tests
└── ui/       # component and view tests

e2e/          # Playwright end-to-end specs, driving a full game in a real browser
```

The engine is the single source of truth for legality: `legalActions(state)`
enumerates every legal move, the UI's affordances and the AI's decisions both
derive from that same list, and `applyAction` rejects anything not in it — so
"a complete game vs the AI is playable with only official-rules-legal moves
possible" isn't a UI-layer promise, it's structural. The event log emitted by
every action *is* the game record: undo replays it minus the last human
action-group, and save/resume serializes it.

## Tests

```sh
npm test          # Vitest: engine, per-card, fuzz/invariant, AI, and UI tests
npm run e2e        # Playwright: full games driven through a real browser
npm run build      # type-check + production build
```

The fuzz/invariant suite (`tests/fuzz/invariants.test.ts`) plays many seeded
random-vs-random games to completion and asserts a battery of structural
invariants after every single applied action (dice conservation, no negative
resources, spent cards never act, every `legalActions` result applies
cleanly, games terminate with a valid reason, winner determination matches
the rules, and more). Its scale is controlled by the `FUZZ_SEEDS` environment
variable (default 300, kept small so `npm test` stays fast); it has also been
run at `FUZZ_SEEDS=2000` (and separately, 500 heuristic-vs-heuristic games
with the same invariant battery) with zero failures as part of this
project's hardening pass:

```sh
FUZZ_SEEDS=2000 npx vitest run tests/fuzz --testTimeout=600000
```
