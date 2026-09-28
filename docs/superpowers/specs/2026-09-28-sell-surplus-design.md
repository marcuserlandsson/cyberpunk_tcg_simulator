# Sell surplus — design

Date: 2026-09-28 · Status: approved in conversation, awaiting spec review

## Intent

Marcus sells cards on Cardmarket as a **private seller**. He wants to open the
app, see which owned cards he does not need, choose which of those to sell, and
export the choice in a form that makes listing on Cardmarket fast. "Need" is
decided by the decks he chooses to keep physically — decks may use several
copies of one card — plus optional binder and playset holds.

Success: from an up-to-date collection, producing a correct per-expansion sell
list takes a couple of minutes, and recording the sale afterwards is one
confirmed action that shows up in History.

Cyberpunk TCG joined Cardmarket in September 2026. Private sellers have no file
import; they list through a per-expansion **bulk listing form** (type
quantities, pick condition/language, set price). The community
[Cardmarket Bulk Import](https://github.com/PedroPerpetua/cardmarket-bulk-import/)
browser extension fills that form from a CSV.

## Decisions

| Question | Decision |
|---|---|
| Where it lives | A fifth Collection mode, **Sell**, after Plan purchases |
| Which decks hold copies | Decks the user picks, with shared / kept-in-every-deck toggle (as Plan purchases); choice persisted per browser |
| Condition, language, price | Export-wide defaults (condition NM, language English), per-line condition override; price left blank, set on Cardmarket |
| After export | Persistent sell list plus explicit **Mark sold** that decrements the collection |
| Target | Cardmarket bulk listing form (text) and the Bulk Import extension (CSV) |

## 1. Surplus arithmetic — `src/ui/surplus.ts`

Pure module, no React.

- Extract the per-identity requirement loop of `acquisitionPlan`
  (`src/ui/acquisitionPlan.ts`) into an exported
  `deckRequirements(db, decks, mode): Map<identity, { id, count }>` and make
  `acquisitionPlan` call it. Its behavior and tests are unchanged.
- `surplusPlan(db, decks, printings, counts, { mode, keepBinderArt, keepPlayset }): SurplusRow[]`
  returns one row per card identity with any owned copies:
  `{ identity, id, owned, deckNeed, binderHold, playsetHold, keep, surplus, split }`.
- `owned` counts **every** held printing of the identity, including
  collection-only (`playable: false`) printings — they can be sold.
- `binderHold` (when `keepBinderArt`) is the number of distinct artworks of the
  identity the user holds (one copy each), using `artworkGroups`.
- `playsetHold` (when `keepPlayset`) is `playsetTarget(def)`.
- `keep = min(owned, max(deckNeed + binderHold, playsetHold))` and
  `surplus = owned − keep`. Deck copies count toward the playset, so the
  playset hold never adds on top of deck need. The binder copy of an artwork
  prefers a held collection-only printing (the `acquisitionPlan` rule), which
  only affects *which* copies are kept (see the split), not how many.
- A deck with validation errors still reserves its cards (the UI warns, as in
  Plan purchases). Card ids in a deck that are missing from `db` are ignored.

### Suggested split

`split: { key: string; count: number }[]` distributes `surplus` across held
printings, deterministically:

1. When `keepBinderArt`, one copy of each held artwork is untouchable (the
   binder copy, chosen with the same preference as above).
2. `deckNeed` copies are reserved from playable printings, and the playset
   hold (beyond that) from any printing; neither is taken from a printing's
   binder copy.
3. `surplus` copies are then picked one at a time from the printing with the
   most unreserved copies left, ties broken retail before beta sets, then by
   printing key. Collection-only printings sort after all playable ones, so
   they are suggested for sale only when no playable copy is spare.

The user can override the split in the sell list.

Multiple printings of one card in one set (31 such combinations, e.g.
`v-streetkid` β005a/β005b) are separate printings throughout — nothing
resolves "the printing of card X in set Y" by first match.

## 2. Sell mode UI — `src/ui/SellMode.tsx`

Layout is Plan purchases' two-column `plan` / `plan__side`, built only from
existing tools.css vocabulary (`card`, `tool-actions`, `check-chip`,
`deckchip`, `seg`, `data-table`, `tool-note`, `tool-figure`, `tool-error`,
steppers as in the drawer). No bare `<details>` or unstyled labels.

**Keep for (left card).** Deck chips and the shared/kept `seg` from Plan
purchases; check-chips "One of each artwork in the binder" and "A full
playset". Selected deck names and toggles persist in localStorage key
`ctcg:sell:prefs:v1` (read/write wrapped in try/catch; unknown deck names
dropped on read).

**Surplus table.** Rows with `surplus > 0`, sorted by surplus then name.
Columns: Card · Own · Keep · Surplus · Suggested split · Add (stepper plus an
add button that stages N copies using the suggested split). A `tool-figure`
line: "N surplus copies · M cards". An **Add all surplus** button stages every
row's suggested split. When ownership is unavailable, the mode shows the same
"Ownership unavailable" note as Plan purchases.

**Sell list (right card).** Header row: default condition select (Cardmarket
scale MT · NM · EX · GD · LP · PL · PO, default NM) and language select
(default English). One line per printing: name, set, collector number,
quantity stepper, condition select (defaults to the header value), remove.
When the sell list's total for an identity exceeds that identity's
`surplus` (selling it would leave fewer than `keep`), its lines are flagged
"below keep" (`tool-note`), not blocked.

**Card drawer.** `CardDrawer.tsx` gets an "Add to sell list" action per
printing row (adds one copy; repeated clicks add more).

**Header.** `CollectionModeHeader` gains `{ id: 'sell', label: 'Sell' }` with a
`colhead__count` badge showing the number of sell-list lines when non-zero.
`CollectionMode` gains `'sell'`. Modes still mount on first visit and stay
mounted.

## 3. Sell list store — `src/ui/sellDraft.ts`

Modelled on `sessionDraft.ts` (`useSyncExternalStore`, in-memory fallback and a
visible storage error when localStorage fails).

- Key `ctcg:sellList:v1`; shape
  `{ version: 1, condition, language, lines: { key, count, condition? }[] }`,
  validated with zod on read; unreadable data falls back to empty with the
  storage error surfaced.
- `addToSellList(key, n)`, `setSellCount(key, n)`, `setLineCondition`,
  `removeSellLine`, `setSellDefaults`, `clearSold(keys)`.
- **Ownership cap:** the effective count of a line is `min(count, owned)`.
  When the collection drops below a line's count, the UI shows
  "reduced: you now own N" and exports use the capped value. Lines for
  printings owned zero times remain visible with count 0 until removed.

## 4. Exports — `src/ui/cardmarketExport.ts`

Pure functions over sell lines, printings, card names and the expansion map.

**Expansion map — `data/cardmarket-expansions.json`.** Hand-maintained,
`setCode → { expansion: string; variant?: string }`, covering the 13 set codes
in `data/printings.json`. If Cardmarket merges Beta and Retail into one
expansion with variants, `variant` records it. Validated with zod at load. An
unmapped set exports under our `setName` with a `⚠ check expansion` marker in
the text export and an empty expansion cell plus a status toast for the CSV —
never silently.

The names must be read from Cardmarket before the map is written.
Cardmarket rejects automated fetches, so implementation starts with a
read-only look at the Cyberpunk expansion list and one bulk listing page,
either in the user's logged-in Chrome session (with his go-ahead) or from
names he pastes. The same look records the form's row order.

**Text: "Copy for bulk listing".** Grouped by Cardmarket expansion, groups in
map order, rows in the bulk form's order (expected: collector number):

```
## Welcome to Night City (7 copies)
2× Arasaka Kiroshi Optics · #047 · NM · English
```

**CSV: "Download CSV".** Columns follow what the Bulk Import extension's parser
actually reads; confirm them from its source before implementing and record
the version checked in a comment. Price column blank. One file per expansion
if the extension requires it, otherwise one file with an expansion column.
Filename `cardmarket-sell-YYYY-MM-DD[-expansion].csv`. RFC 4180 quoting.
Downloads use the existing `downloadFile`; copy uses the Plan purchases
clipboard pattern with its ok/error status line.

## 5. Mark sold

Each sell-list line has a checkbox. **Mark N sold…** opens an inline confirm
(same pattern as the Add cards review) listing before → after per printing
and total copies. Confirming:

1. Refuses with "Collection changed; review again." if the counts differ from
   those the confirm was computed against (the `applyDraft` guard).
2. Calls `replaceCollection({ counts: after }, { kind: 'Sale', date: today, source: 'Cardmarket' })`
   — one revision, one journal entry, one auto-commit.
3. Removes the sold lines from the sell list only after the write call
   returns without throwing; unsold lines stay.

History renders `Sale` like any other journal kind; no special handling is
needed beyond confirming its label reads well.

## Testing

- `tests/ui/surplus.test.ts`: shared vs kept; binder hold; playset hold
  with and without deck need; collection-only printing held; multi-printing
  card in one set; split tie-break order; deck with unknown card id.
- `tests/ui/acquisition-plan.test.ts`: passes unchanged after the extraction.
- `tests/ui/sell-draft.test.ts`: merge, cap at owned, persistence across
  reload, invalid stored data, storage-error fallback.
- `tests/ui/cardmarket-export.test.ts`: grouping and ordering, unmapped-set
  marker, CSV quoting/columns, golden outputs for both formats.
- `tests/ui/sell-mode.test.tsx` (jsdom): deck choice changes surplus; Add all
  surplus; below-keep flag; Mark sold writes a `Sale` entry; refusal when the
  collection changed.
- `tests/ui/collection-mode-header.test.tsx`: fifth segment and badge.
- `e2e/collection-sell.spec.ts` on the scratch collection
  (`CTCG_COLLECTION_FILE`): pick a deck, add surplus, download CSV, mark sold,
  counts drop and History shows a Sale.

## Out of scope

Prices or any live Cardmarket data; the Cardmarket API; condition or language
stored in the collection; tracking listed-but-unsold state beyond the sell list
itself; an undo for Mark sold beyond what History already offers.

## Docs

Create `docs/selling-surplus.md` (there is no collection doc yet): the
keep order (decks, binder, playset), the suggested split rules, and how to
update `data/cardmarket-expansions.json`.
