# Collection Tab Overhaul — Design

**Date:** 2026-09-09
**Status:** Draft for review (design agreed in brainstorming; spec awaiting sign-off)
**Mockup:** `2026-09-09-collection-tab-overhaul-mockup.html` (same folder; draft 3, the
version agreed in brainstorming). Where this document and the mockup disagree, this
document wins; the mockup is the visual reference, not a pixel contract.
**Supersedes:** the UI half of `2026-09-04-collection-tracker-design.md` (its data
model, derived queries and export/import functions are unchanged) and the
Collection-tab arrangement introduced by the 2026-09-08 feature commits
(acquisition sessions, bulk counts, purchase planner, change history).

**Depends on:** the merged collection tracker and file storage
(`src/ui/collection.ts`, `collectionSync.ts`, `collectionJournal.ts`,
`sessionCounts.ts`, `collectionEntry.ts`, `acquisitionPlan.ts`, `printings.ts`),
and the shared tool-panel stylesheet added on 2026-09-09 (`src/ui/styles/tools.css`).

## Goal

Every feature the Collection tab gained over the last week stays. What changes is
how they are arranged and how much reading they demand. Today the tab stacks four
unrelated jobs on one scroll — browsing what you own, entering cards, planning
purchases, and backup/history — each with its own paragraphs, dropdowns and
collapsed panels, so nothing has an obvious home and the filter row carries twenty
chips plus a select. The user's words: "difficult and unintuitive to navigate",
"so many drop down menus which are unclear what they are for", "a lot of text to
read".

Success looks like this: a person who has just opened a booster box and a demo
deck can record the whole delivery, with its source and cost, without reading a
paragraph, and can find any card's printings and counts in two clicks.

## Decisions taken during brainstorming

| Question | Decision |
|---|---|
| One long page or modes? | **Four modes** behind a segmented control: Browse, Add cards, Plan purchases, History & backup. Each mode is one screen with one job. |
| Where do filters live? | A **left rail** in Browse, grouped and labelled (Search, Goal, Color, Type, Rarity, Set). The set dropdown becomes a list with per-set progress. |
| How are a card's printings shown? | A **right-hand drawer** opened by clicking a tile, not an inline expansion that reflows the grid. |
| Does quick add write immediately or stage? | **Stages into the open session.** Immediate writes go away; typing with no session open starts one for today. The only direct edits left are the +/− steppers in the drawer and list. |
| Where do bulk counts go? | Merged into Add cards as a **"Set exact counts"** mode of the session. The separate panel is removed. |
| How does a forgotten draft get noticed? | A **staged pill** in the collection header, visible in every mode, yellow (the "actionable now" token) once it has survived a reload unapplied. |
| Whole products (demo decks, starters)? | An **"Add a whole product"** row at the top of Add cards, one button per fixed-content set; boosters are entered card by card. |
| What does "what did I receive" look like? | The **review column** shows copies, printings, before → after for both goals, and a **pulled-by-rarity** breakdown; the same breakdown appears on the History entry afterwards. |

## Information architecture

```
Collection tab
├── Header strip (always visible)
│     [Browse | Add cards | Plan purchases | History & backup (n)]
│     sync chip · staged pill · Playset meter · Artwork meter · Cards owned
├── Browse ............ filter rail | quick add + grid/list | card drawer
├── Add cards ......... session strip · whole products · add line · staged table | review & apply
├── Plan purchases .... decks · options · table | shopping list · collection goals
└── History & backup .. timeline | export · import · restore history · on disk
```

The four modes are rendered by one `CollectionView` that keeps all mode state
mounted and toggles visibility (the pattern App.tsx already uses for tabs), so
filters, a half-typed quick add and a draft session all survive switching modes.
The active mode is remembered in `sessionStorage` per tab (`ctcg:collectionMode:v1`);
the default is Browse.

### Header strip

- **Mode control:** a segmented control in the header nav style (`aria-pressed`
  buttons, cyan fill when active). History & backup shows the journal entry count
  as a mono suffix.
- **Sync chip:** the existing `sync-status` states and their colours, unchanged in
  meaning, rendered as a chip with a status dot. Retry / Download / Keep mine /
  Take disk / confirm-empty buttons appear beside it exactly as today when their
  state applies; nothing about `collectionSync.ts` changes.
- **Staged pill:** present only when the draft session has at least one line.
  Text "N staged · review →", clicking opens Add cards. Cyan outline normally;
  yellow (`--act`) when the draft was loaded from storage rather than typed in
  this page load (i.e. it survived a reload). Hidden when empty.
- **Meters:** Playset owned/target with percent and a 4px track; Artwork the same
  in yellow; Cards owned as a bare display-face figure. Numbers come from
  `completionStats` as today. When ownership is unavailable the three meters are
  replaced by the existing "not shown because the file could not be read" wording.
- The copy-goal-lists buttons and the unreviewed-printings warning move out of the
  header: the lists go to Plan purchases, the warning becomes a muted note under
  the Artwork meter.

## Browse

Three columns: rail (236px), main, drawer (340px when open, 0 when closed).
Below 860px the rail collapses into a single "Filters (n active)" tool-panel
header above the grid and the drawer becomes a full-width panel under the grid;
the existing mobile e2e (`collection-entry.spec.ts` at 390px) must still be able
to search, switch to List and edit a count.

### Filter rail

Groups in order, each with a small uppercase label; multi-select groups get a
"clear" link in the label row when anything is selected.

| Group | Control | Notes |
|---|---|---|
| Search | text input | matches name, subtitle, collector number, set, artist — the existing `matchesPrinting` behaviour, a leading `#` is ignored, so `#006` finds collector number 006 |
| Goal | 4-way segmented | All · Need copies · Need art · Complete (today's goal filter, renamed) |
| Color | 4 RAM chips | unchanged `filter-chip--ram` |
| Type | 4 chips | Legend Unit Program Gear |
| Rarity | chips in two rows | row 1: Common Uncommon Rare Epic Nova Rare Secret; row 2: Iconic Legend, Iconic Other, Iconic Secret |
| Set | list of rows | "All sets" first; each set row shows owned / total printings for that set and a 2px progress bar; single-select; the list scrolls past ~10 rows |

A one-line footnote replaces today's legend paragraph: "Goal and totals always
cover the whole collection. Set, rarity and search narrow which printings are
shown." The ✓/★ glyph explanation moves into the tile itself (see below), so it
no longer needs a legend.

### Toolbar

- **Quick add** (left, full width): one input, an "adds to [set]" select on its
  right edge, and a keyboard hint (Enter +1 · Shift+Enter −1). It is the shared
  `AddLine` component described under Add cards; in Browse it behaves identically
  and stages into the session. The match list and disambiguation chips are the
  ones QuickAddBar has today.
- **Count** ("72 cards · 214 printings · 341 owned") reflects the current filters.
  Owned shows "?" when ownership is unavailable.
- **View toggle:** Grid | List, remembered with the mode.

### Grid tiles

A tile is a zoom `CardFrame` as today, plus a footer row instead of the corner
badge:

- left: playset count `owned / target`, coloured green with ✓ when complete,
  muted when zero, plain otherwise; "Collection only" for target 0;
- right: `Art owned/total`, yellow with ★ when complete;
- a 3px ownership bar under the frame (owned/target, capped at 100%).

Clicking anywhere on the tile opens the drawer for that card (the separate
"printings" button goes). The open card gets a yellow outline. Collection-only
cards render at 55% opacity.

### List view

The compact list becomes a real table: thumbnail, card (name — subtitle),
printing (set · collector number, foil/finish tag), rarity, artwork index with
owned/missing, and a stepper (−, count input, +). Rows are the existing
`compact-printing` rows re-laid; the `printing-count-<key>` input and its
behaviour are unchanged. "Show 60 more" stays as a footer button.

### Card drawer

Header: card name, subtitle in the card's RAM colour, close button.
Body:

1. Two goal tiles: **Playset** `owned / target` (green when complete; for Legends
   "Legend · 1 copy"), **Artworks** `owned / total` (yellow when complete).
2. Printings **grouped by artwork**. Each group has a header "Artwork n · artist"
   with an owned/missing status; groups whose artwork identity is unreviewed are
   titled "Artwork identity awaiting review". Each printing row: image thumbnail
   (opens the source image in a new tab), set name, collector number, rarity,
   finish tag, printing key in mono, and the stepper. Collection-only printings
   are dimmed and tagged "Collection only".

Steppers in the drawer and list write immediately through `adjustCount` /
`setCount` exactly as today; they are the one direct-edit path that remains.

## Add cards

Two columns: the session (left, wider) and review & apply (right). Below 860px
they stack.

### Session draft — data

The draft moves from free text to structured lines while keeping the text
format as its interchange form:

```ts
interface SessionLine { key: string; delta?: number; exact?: number; group?: string }
interface SessionDraft {
  kind: 'Acquisition' | 'Trade' | 'Correction'
  date: string            // YYYY-MM-DD
  source: string
  cost: string
  mode: 'signed' | 'exact' // "Add / remove copies" | "Set exact counts"
  lines: SessionLine[]
  loadedFromStorage: boolean // not persisted; drives the pill colour
}
```

- Stored under the existing `ctcg:collectionSession:v1` key. A legacy draft with
  a `text` field is migrated on read by parsing it with today's session parser
  into `lines`; unparsable legacy text is kept in the paste box for the user to
  fix rather than dropped.
- `signed` lines carry `delta` and are applied with `sessionCounts`' arithmetic;
  `exact` lines carry `exact` and are applied with `parseBulkCounts`' replace
  semantics. The mode is fixed for the life of a draft: the toggle is disabled
  while any line is staged, with the tooltip "Apply or clear the draft to change
  mode", so a number typed as "+3" can never be silently re-read as "exactly 3".
  The staged table's column header reads "Change" in signed mode and "Set to" in
  exact mode.
- `group` is a display label ("Arasaka Demo Deck") set on lines added by a whole-
  product button. The table collapses lines sharing a group into one row with a
  disclosure; removing the group row removes all its lines.
- Adding a key that is already staged (same group or ungrouped) merges into the
  existing line in `signed` mode and replaces it in `exact` mode.

### Session strip

Kind as a 3-way segmented control, Date, Source, Cost as labelled fields on one
row. All edits autosave to the draft as today; the storage-failure message stays.

### Add a whole product

One ghost button per bundled deck list in `data/decks/` — today exactly two,
Arasaka Demo Deck and Merc Demo Deck, via `starterEntry` as now. The four
starter-deck buttons drawn in the mockup are placeholders for lists the repo does
not yet hold; the implementation must not invent their contents, and they appear
only if such lists are added later. A button that has been used shows as
disabled "✓ added" until its group is removed. The note "Bundled demo lists, not
a retail box manifest" becomes the buttons' shared `title` and a single short
hint line.

### Add line (shared `AddLine` component)

Replaces `QuickAddBar` and is used in both Browse and Add cards:

- text input; "adds to [set]" select (the session set, persisted as today under
  `ctcg:quickAddSet:v1`), keyboard hint;
- typing lists matching cards (name, subtitle) as today; Enter with one printing
  in the chosen set stages +1 (or −1 with Shift); zero or several printings in
  that set show the printing chips instead, exactly today's disambiguation, and
  clicking a chip stages that printing;
- after staging, the input clears and keeps focus; a two-second toast names what
  was staged ("+1 Militech Enforcer · β087 → 4 staged");
- with no draft open, the first staging creates one: Acquisition, today, empty
  source and cost, `signed` mode.

The existing `quickaddbar.test.tsx` behaviours (matching, session set persistence,
ambiguity refusal) carry over to `AddLine`; the assertion that a write reached
`adjustCount` becomes an assertion that a line reached the draft.

### Staged table

Columns: Card, Printing (set · number, finish tag), Change (or "Set to" in exact
mode; green for +, red for −), Now → after, remove (✕). Newest lines first.
Group rows show "▾ Product name · whole product · n printings" and the group's
total. Unknown or collection-only-in-a-playable-context keys are shown in red
with the parser's message and block Apply until removed.

### Paste box

A collapsed "Paste lines or set exact counts instead" disclosure holding the
mode toggle and the textarea. Pasting appends parsed lines to the table; the
textarea empties on success and shows the parser error inline on failure.

### Review & apply

- Summary line: net copies, printings changing, total owned before → after.
- Two tiles: Playset before → after / target; Artwork before → after / total.
- **Pulled by rarity:** for `signed` drafts with positive deltas, a table of
  rarity → copies with a proportional bar (accent colours for Rare and above,
  yellow for Nova Rare/Secret). Hidden for Trade/Correction kinds with no
  positive lines and for `exact` mode.
- Hint: one sentence about the single write and the single undoable History entry.
- **Apply session · +N** (primary) and **Clear draft** (ghost, confirms via a
  second click "Clear 71 lines?" rather than a modal). Apply uses today's
  optimistic check (collection unchanged since the preview was computed) and the
  same `replaceCollection` call with the session metadata; the journal `kind`
  stays `Acquisition`/`Trade`/`Correction` for signed drafts and `Bulk counts`
  for exact drafts so existing history stays readable. Apply also clears the
  draft and the pill.

## Plan purchases

Two columns: decks and results (left), lists (right).

- **Decks to build:** one chip per saved deck with its card count; a deck that
  fails `validateDeck` shows "n errors" in red on the chip and, when selected,
  the existing "this list does not make it legal" sentence as one hint line.
- **Options:** "Cards are [Shared between decks | Kept in every deck]" segmented
  control (today's `shared`/`assembled` mode) and a switch "Keep one of each
  artwork in the binder" (today's reserve toggle). One hint line explains both.
- **Figure:** "N copies to buy · M distinct cards".
- **Table:** Card, Need, Own, Binder, Buy (yellow), Also fills (playset gap and
  artwork options as one muted phrase; the nested artwork disclosure goes).
- **Shopping list:** the text list as today in a mono block, a primary "Copy list"
  button, and a "Copied hh:mm" status.
- **Collection goals:** three tiles — Playset gaps, Missing artworks, Both — each
  with its count and a "Copy list" ghost button. These are today's three header
  copy buttons, using `buildBuyList` unchanged.

## History & backup

Two columns: timeline (left), backup (right).

- **Timeline:** one row per journal entry, newest first: time (relative for
  today, dated otherwise), a kind tag (Acquisition green, Trade blue, Correction /
  Bulk counts / Import grey, Undo red), source, and a mono detail line
  "n printings · ±copies · cost". Entries that have been undone show struck
  through with "undone hh:mm" and offer Reapply; others offer Undo. "Details"
  expands the row in place to the change list and, for acquisitions, the
  pulled-by-rarity table computed from the changes. "Show all N" reveals past
  the first 20. Undo/Reapply use `restoreJournalChange` unchanged.
- **Backup** as four small cards:
  - *Export:* JSON, Text, JSON + history (today's three downloads).
  - *Import:* textarea, Replace | Merge segmented control, Preview; the preview
    result renders as the change list with an "Apply import" primary button
    (today's flow and guards).
  - *Restore history:* the history-metadata import, with its one-sentence
    caveat.
  - *On disk:* file path, last write time, git backup state, and Retry when
    applicable. This is the long form of the header sync chip.

## What is removed or renamed

| Today | After |
|---|---|
| `QuickAddBar` (immediate write) | `AddLine` (stages into the draft) |
| `BulkCollectionEntry` panel | "Set exact counts" mode of the session |
| `CollectionSessions` panel (form + history) | Add cards mode (form) and History & backup mode (timeline) |
| `AcquisitionPlanner` panel | Plan purchases mode |
| `CollectionHeader` (stats, copy lists, export/import) | Header strip (stats, sync) + Plan purchases (copy lists) + History & backup (export/import) |
| Inline `collection-view__printings` expansion | Card drawer |
| `collection-view__legend` paragraph | Tile footer + one-line rail footnote |
| Set `<select>` | Set list in the rail |

The pure modules (`collection.ts`, `collectionSync.ts`, `collectionJournal.ts`,
`sessionCounts.ts`, `collectionEntry.ts`, `acquisitionPlan.ts`, `artworks.ts`)
are untouched except for the draft schema in `CollectionSessions`' storage,
which moves to a new `src/ui/sessionDraft.ts` with the migration described above.

## Testing

- Unit: `sessionDraft.ts` (migration from legacy text, merge/replace rules per
  mode, group removal, apply payloads for both modes); `AddLine` (staging, auto-
  created draft, ambiguity chips); rarity breakdown computation.
- E2E: the existing collection specs are updated to the new navigation
  (`getByTestId('collection-mode-add')` etc.) and keep their assertions on
  counts, sync status and persistence. New e2e: the delivery scenario — add a
  demo deck as a whole product, stage three booster pulls via quick add in
  Browse, reload, confirm the yellow pill and the intact draft, apply, confirm
  one history entry with cost and the rarity table, undo it, confirm counts.
- The mobile spec keeps running at 390px against the collapsed rail.
- Test ids to preserve so unrelated specs keep working: `sync-status`,
  `collection-search`, `collection-compact` (now the List toggle), `set-filter`
  (now the set list container), `printing-count-<key>`, `printing-inc/dec-<key>`,
  `expand-<id>` (now the tile), `collection-scope`, `session-*`, `history-*`,
  `import-*`, `acquisition-*`, `benchmark-*` untouched.

## Out of scope

- Card image loading and the known zoom `CardFrame` re-render cost on every
  collection write (call sites pass inline `onClick` closures, so `React.memo`
  alone does not help).
- Any change to the file-storage protocol, the journal format, or printing keys.
- Booster-box templates (fixed slot counts per pack): boosters stay card-by-card.
- Deck Builder, Simulate and Play tabs.
