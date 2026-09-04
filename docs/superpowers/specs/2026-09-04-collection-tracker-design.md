# Collection Tracker — Design

**Date:** 2026-09-04
**Status:** Approved design, pre-implementation
**Depends on:** existing card database (`data/cards.json`, 141 cards), UI storage
patterns (`src/ui/storage.ts`), card rendering (`src/ui/CardFrame.tsx`,
`src/ui/images.ts`), deck rules (`src/engine/deck.ts`: max 3 copies per card,
decks run 3 legends).

## Goal

Track which physical cards the player owns — per *printing*, so alt arts are
tracked separately — and surface what is missing: for a playable playset
(3 copies of each card, 1 of each legend) and for the collector goal (at least
1 of every printing). Adding cards while cracking packs must be fast. The
collection is visible in the Deck Builder ("owned x/3", per-deck buy-list) but
never blocks building hypothetical decks.

Chosen approach ("Approach A"): a separate printings dataset joined against
`cards.json`, with the collection stored as a flat `printingKey -> count` map.
`cards.json` stays the byte-audited gameplay-authoritative file; collection
metadata never touches it or the engine types.

## 1. Data layer

### 1.1 `data/printings.json`

A JSON array of `Printing` objects, generated (not hand-written) by the fetch
script below:

```ts
interface Printing {
  key: string            // "<setCode>/<collectorNumber>", e.g. "welcometonightcitybeta/β025"
  cardId: string         // FK into cards.json ids, e.g. "mantis-blades"
  setCode: string        // "welcometonightcitybeta"
  setName: string        // "Welcome to Night City — Beta"
  collectorNumber: string // "β025" — kept verbatim, including the β prefix
  rarity: string         // "Common" | "Uncommon" | ... (verbatim from API; not an enum on purpose)
  finish: string | null  // verbatim from API (null for normal cards)
  artist: string
  sourcePrintingId: string // the API's printing uuid, for provenance and re-sync
}
```

- `key` is the app's stable identifier for a printing: human-readable,
  meaningful in exports, and independent of the API's uuids. Collector numbers
  are unique within a set; the fetch script fails loudly if that assumption is
  ever violated.
- `rarity` and `finish` are open strings, not enums: the API's vocabulary is
  not under our control and new values (e.g. a foil finish at retail) must not
  break the loader.
- Distinct printings of the same card — different set, different collector
  number, or different finish — are separate rows. "Alt art" is not a flag; it
  is simply a second printing of the same `cardId`.
- A `data/printings.schema.md` documents the format and provenance with the
  same discipline as `cards.schema.md`.

### 1.2 Fetch script — `scripts/fetch-printings.ts`

Run manually with `tsx` (npm script `fetch:printings`), like `scripts/sim.ts`.
Not part of any build or CI step.

- Source: `https://api.netdeck.gg/api/cards/cyberpunk/{slug}` for each of the
  141 ids in `cards.json` (the ids are the API's slugs verbatim — established
  during transcription, see `data/transcription-report.md`). Each response
  carries a `printings[]` array with printing uuid, `collector_number`,
  `set {code, name}`, `rarity`, `finish`, `artist`, and image URLs.
- Writes `data/printings.json` sorted by (setCode, collectorNumber) for stable
  diffs across re-runs.
- Validates before writing, and refuses to write on failure:
  - every printing's `cardId` exists in `cards.json`;
  - every card in `cards.json` has at least 1 printing;
  - `key` values are globally unique.
  Anomalies are printed as a report, mirroring the transcription-report style.
- Polite fetching: sequential requests with a small delay; no parallel
  hammering of the API.
- `--images` flag additionally downloads each printing's image (the API's
  image URLs are signed and expire, so images must be fetched at script-run
  time) into the gitignored `data/images/printings/<key with '/' replaced by
  '__'>.webp`. Base-art images for cards keep using the existing
  `data/images/<cardId>.<ext>` files untouched.
- Re-running the script later (e.g. when official-release alt arts appear in
  the database) adds new rows; existing keys never change, so saved
  collections need no migration.

### 1.3 Loader — `src/ui/printings.ts`

- Imports `data/printings.json` statically (like decks are imported today) and
  validates it with zod at load time (zod is already a dependency).
- Exposes:
  - `loadPrintings(): Printing[]`
  - `printingsByCard(): Map<cardId, Printing[]>`
  - `getPrinting(key): Printing | undefined`
  - `listSets(): { code, name }[]` (derived, ordered)
- Printing images: a small extension of the `images.ts` pattern — a second
  `import.meta.glob('/data/images/printings/*')` index keyed by printing key;
  falls back to the card's base image, then to the drawn `CardFrame`, exactly
  as card art falls back today.

## 2. Collection storage — `src/ui/collection.ts`

Follows `storage.ts` conventions (small JSON blob, versioned key, read with
fallback):

- localStorage key `ctcg:collection:v1`, value shape
  `{ counts: Record<printingKey, number> }`. Zero counts are pruned on write —
  absence means 0.
- Reads validate with zod; a malformed blob falls back to empty (matching
  `readJson`'s forgiving posture) but an *explicit import* of malformed data
  errors loudly.
- Unknown printing keys found in storage (e.g. printings.json regenerated
  differently) are preserved, not dropped — they are the player's data; the UI
  simply cannot display them and the export still round-trips them.

### 2.1 Write API

- `getCollection(): Collection`
- `setCount(key: string, count: number): void` (clamped to >= 0)
- `adjustCount(key: string, delta: number): void`

### 2.2 Derived queries (pure functions over `(db, printings, collection)`)

All pure and unit-testable without DOM or localStorage:

- `cardTotal(cardId)` — owned copies summed across the card's printings.
- `playsetTarget(cardId)` — 3, or 1 when `db[cardId].type === 'legend'`.
- `playsetGaps()` — `{ cardId, owned, target, missing }[]` for cards below
  target, counting all printings together.
- `missingPrintings()` — printings with count 0 (the "all arts" goal).
- `completionStats()` — playset % and arts % complete, total cards owned.
- `buildBuyList(options)` — plain-text list of what is missing; options select
  playset gaps, missing printings, or both. Card names use the existing
  `"Name — Subtitle"` disambiguation helper from `storage.ts`.

### 2.3 Export / import

- **JSON**: `{ version: 1, counts: {...} }` downloaded as a file; full
  fidelity, includes unknown keys. Import validates with zod and offers
  **replace** or **merge-add** (counts summed).
- **Text**: one line per owned printing, `2x Mantis Blades [welcometonightcitybeta/β025]`
  — name for humans, bracketed printing key for unambiguous parsing. Import
  parses the bracketed key (authoritative) and reports unknown keys/malformed
  lines as errors, in the style of `importDeckText`. Same replace/merge choice.

## 3. Collection tab (UI)

A 4th tab in `App.tsx` (`View` union gains `'collection'`), kept mounted and
hidden like Play/Deck Builder so filter state and an in-progress quick-add
session survive tab switches. New component `src/ui/CollectionView.tsx`, with
the grid and quick-add as child components.

### 3.1 Grid

- One tile per *card* (reusing `CardFrame`), showing `owned/target` and two
  small state indicators: playset complete, all-arts complete.
- Clicking a tile expands per-printing rows: set name, collector number,
  rarity, count with +/− steppers.
- Filters: color, type, rarity, set, and goal (*missing for playset*,
  *missing arts*, *complete*, *all*). Filter mechanics follow
  `CardBrowser.tsx` patterns.

### 3.2 Quick-add bar

- A focused text input: type a few letters, matches shown live, **Enter adds
  1 of the top match**; arrow keys/click pick a different match.
- A **session set selector** beside the input (defaulting to the most recently
  used set) resolves *which printing* of the matched card is incremented —
  crack beta boosters with the selector on "Welcome to Night City — Beta" and
  every add lands on the beta printing. If the card has no printing in the
  session set, the match row says so and offers its printings inline.
- Every add shows an undo toast (single-level undo of the last add).

### 3.3 Header

- Completion stats (playset %, arts %, total owned), buy-list copy button,
  export (JSON / text) and import buttons.

## 4. Deck Builder integration (lightweight)

- "owned x/3" badge on each card in the deck builder's card browser, fed by
  `cardTotal` (a printing-agnostic count — deck legality does not care which
  art you own).
- A per-deck summary: "missing N cards for this deck" with a copy-as-buy-list
  button listing exactly the shortfalls (`deck count − owned`, floor 0).
- No blocking, no warnings while editing — informational only.
- Refresh mechanism: `collection.ts` keeps a module-level listener set and
  notifies on every write; UI components read via a `useCollection()` hook
  built on `useSyncExternalStore`. This keeps `App.tsx` free of collection
  props and lets the Deck Builder badge update live after edits in the
  Collection tab (both stay mounted).

## 5. Error handling

- printings.json failing zod validation at load: the Collection tab renders an
  error state naming the problem; the rest of the app is untouched (the
  dataset is imported only by collection code).
- Import errors (JSON or text) are collected and reported together, like
  `importDeckText`; nothing is written unless the whole import parses.
- localStorage quota/write failures: writes go through the existing
  `writeJson`; a thrown quota error surfaces as a visible toast rather than
  silent loss.

## 6. Testing

- **Vitest units** for `collection.ts`: count math and clamping, playset/arts
  derivations (legend target 1, multi-printing summing), buy-list text,
  JSON + text export/import round-trips (including unknown-key preservation
  and merge vs replace), malformed-import error reporting.
- **Vitest units** for `printings.ts`: zod rejection of malformed rows, image
  index fallback chain.
- **Data validation test**: `printings.json` joins cleanly against
  `cards.json` (both directions) and keys are unique — the same checks the
  fetch script runs, enforced in CI so a bad regeneration cannot land.
- **Component tests**: quick-add flow (type → Enter → count incremented in the
  session set; undo restores), stepper +/−, goal filters.
- **Playwright smoke**: open Collection tab, quick-add a card, reload, count
  persisted; deck builder shows the owned badge.

## Out of scope (deliberately)

- Foil/finish tracking beyond what the API reports as distinct printings.
- Prices, trade matching, or any network features.
- Official-release alt arts not yet in the database — the fetch script picks
  them up whenever they appear; no code changes anticipated.
- Blocking or warning in the Deck Builder based on ownership.
