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
- [Collection tracking](#collection-tracking)
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

The app has four tabs: **Play**, **Deck Builder**, **Simulate**, and
**Collection**. A
"Use official card images" toggle in the header switches every card face
between the built-in HTML card frame (always available) and official card
art (only where [image fetching](#official-card-images) has been run
locally).

**Starting a game:** on the Play tab, pick a deck for yourself and one for
the AI (the two bundled starter decks — Arasaka's "Embracing Power" and the
Mercs' "The Heist" — are always available, plus anything you've saved in the
Deck Builder), optionally set a seed for a reproducible shuffle, and click
**Start Game**. You'll get one optional full mulligan on your opening hand.

**Playing your turn:** the playmat is laid out like the physical table. The
rival's row sits along the top (their field, Legends, and Eddies — sold
cards rendered as small face-down backs that tap 90° when spent and ready at
turn start, same as a Legend spent as currency); yours, larger, sits along
the bottom. Between the two, the **street strip** faces both players' gig
pools at each other — polyhedral dice for each fixer, unrolled ones drawn as
dim outlined silhouettes — with the turn number, whose turn it is, and "first
to 7 gigs wins" (or Overtime messaging, once it kicks in) centered between
them. A hand of cards fans out along your own bottom edge, tightening its
overlap as it grows so even a large hand stays on-screen; the right rail
holds the turn-by-turn feed (color-coded: cyan for you, red for the rival,
yellow for turn/system markers) above the action buttons. Every affordance on
screen (which cards glow as playable, which dice/cards are legal attack or
ability targets) is derived directly from the engine's own legal-action
list — if something isn't highlighted, it isn't a legal move right now, by
construction. Click a card in hand to play it, a ready Unit to attack, or use
the control bar to sell a card, Call a Legend, or end your turn.

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

Hovering (or clicking, or tabbing to) any card face opens the **zoom panel**:
a large, always-legible rendition of that exact card with its full printed
rules text, RAM pips, and tag capsules — even when the board itself is
showing official art rather than the HTML frame. Below the card face, a
compact live-state strip lists whatever the printed card alone can't show:
its current effective power (once buffed or reduced), any keywords it has
gained, and the names of any Gear attached to it.

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

## Collection tracking

The **Collection** tab tracks which physical cards you own, per *printing* —
`data/printings.json` holds 426 printings of the 141 cards across 12 sets, so
an alt art is a separate thing to own rather than a flag on the card.

- One tile per card showing `owned/target`, plus **✓** when the playset is
  complete and **★** when you own every printing of it. The playset target is
  3, or **1 for a Legend** (decks run one of each). Clicking a tile expands
  per-printing rows with `+`/`−` steppers.
- **Quick-add** for cracking packs: pick the set you are opening once, then
  type a few letters and press Enter to add 1 — every add lands in that set,
  with single-level undo. Where the set holds more than one printing of the
  matched card (an Iconic variant, say), Enter deliberately does *not* guess:
  the row lists the candidates with collector number and rarity to click.
- Completion stats, a copy-able buy-list of what is missing, and JSON / text
  export and import (replace or merge). **The JSON export is your backup** —
  counts live in `localStorage` and nothing is stored anywhere else.

In the Deck Builder, each card carries an `owned x/3` badge and the deck gets
a "missing N cards for this deck" summary with its own buy-list button. That
is **informational only** — ownership never blocks an add, a save, or a game.

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
locally fetched image keep showing the HTML frame either way. Either way,
board cards carry the same status overlays — a cyan ready ring (red for the
rival's), a yellow pulse while a card is legally playable/attackable, a
"LAG" banner, and a power chip when a card's effective power differs from
its printed value — so toggling images never changes what a card's current
state means, only how its face is drawn. Re-run the script occasionally if
you want fresher art — the database's image URLs are signed and expire.

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
└── ui/       # React components for the Play, Deck Builder, Simulate and
           # Collection views

data/
├── cards.json           # all 141 cards: stats, verbatim text, effect definitions
├── printings.json       # 426 physical printings of those 141 cards across 12 sets
│                        # (generated — see data/printings.schema.md)
├── decks/                # the two bundled starter decks
└── images/               # (gitignored) official art, populated by scripts/fetch-images.mjs
                          # (printing art under images/printings/, from fetch-printings.ts)

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
