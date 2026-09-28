# Selling surplus

Collection → **Sell** lists every card you own more copies of than you keep,
and builds a list to put up on Cardmarket.

## What is kept

For each card (all printings of the same name and subtitle together):

keep = the larger of (copies the ticked decks need + one binder copy per
artwork you hold) and (a playset, if ticked) — never more than you own.

- **Shared between decks** keeps the most any one deck needs; **Kept in every
  deck** adds them up — the same choice as Plan purchases.
- Deck copies count toward the playset, so ticking both does not double up.
- Surplus = owned − keep.

## Which printings are suggested

One binder copy per artwork is never suggested, preferring a collection-only
printing (promos) for that copy. Copies are then suggested from the printing
you hold the most of, retail before beta on a tie, and collection-only
printings last. A deck's last playable copies are never suggested.
You can change any line on the sell list.

## Exporting

- **Copy for bulk listing**: text grouped by Cardmarket expansion, in
  collector-number order, to follow on each expansion's bulk listing page.
- **CSV · <expansion>**: one file per expansion for the
  [Cardmarket Bulk Import](https://github.com/PedroPerpetua/cardmarket-bulk-import/)
  extension (columns `name,quantity,condition,language`). Open that
  expansion's bulk listing page, import the file, check the rows, set prices.

Nothing changes in the collection until you tick the sold lines and confirm
**Mark sold**, which removes those copies in one save and records a *Sale*
in History (undo it there if needed).

## The expansion map

`data/cardmarket-expansions.json` maps our set codes to Cardmarket expansion
names:

- `expansions`: `setCode → { expansion, variant? }`. A set without an entry
  exports under its own name with a "⚠ check expansion" marker, and its CSV
  filename contains `CHECK`.
- `subtitle` (`always` | `when-shared`) and `separator` control how names are
  written.
- `names`: `printingKey → exact Cardmarket name` for the exceptions, such as
  Cardmarket's own version suffixes.

After Cardmarket adds a set, add its entry and run
`npx vitest run tests/ui/cardmarket-export.test.ts`.
