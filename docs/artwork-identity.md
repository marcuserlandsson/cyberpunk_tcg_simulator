# Artwork identity and collection goals

The 8 September 2026 catalog contains **192 reviewed illustrations across 460
printings**, and **150 playable card definitions** with a default goal of **398
copies** (three per main-deck card, one per Legend). Inventory remains keyed by
physical printing; no collection migration or count replacement is needed.

`data/artworks.json` records stable artwork IDs, representative printing keys,
all matching keys and SHA-256 hashes of the reviewed images. The ID starts with
`art:` and the representative printing UUID; keep it when adding another reprint.
`data/printings.json` references those IDs. Foil, rarity, border, set or a changed
crop does not create another artwork if the illustration is unchanged.

The review compared illustration crops and then visually checked all 17 contact
sheets. Four Edgerunner Open printings were explicitly merged after checking
larger images: Industrial Assembly, Afterparty at Lizzie's, Peace Offering and
Trust No One. Their illustrations are enlarged/reframed versions of existing art.
Artist names were never used as identity evidence. The three PRM01 showcase
objects have no ordinary gameplay text/stat presentation and are collection-only
for this app's playable-copy totals; Rebecca's art-only definition has no playset
target. Exact inventory counts are retained for every printing.

## Refreshing and reviewing

1. Discover/import catalog changes using the catalog scripts.
2. Run `node scripts/download-printing-images.mjs` to fetch fresh public signed
   image links. The stored source URLs are unsigned provenance links and return
   403 when downloaded directly. Downloaded images live under ignored `data/images`.
3. Run `python scripts/audit-artwork.py` with Pillow and NumPy. This only writes
   proposals/contact sheets under `data/images/artwork-review`; it never approves
   groups or rewrites collection data.
4. Review proposed matches and split groups, then update the identity manifest
   and printing references. Preserve existing IDs. Changed source image URLs and
   unknown printings require review rather than inheriting a guessed identity.

The importers preserve reviewed metadata for unchanged source identities/images.
An unreviewed printing appears explicitly as awaiting artwork identification and
prevents a 100% artwork claim. Re-run identity coverage and goal tests after import.

Playset and artwork buy-lists are independent. An artwork line lists alternative
physical printings, so it asks for one illustration rather than every reprint.
The same purchased card can satisfy both goals. Missing-art filters, row labels
and progress use the same grouping helpers. Completion is never rounded to 100%
until the relevant reviewed goal is actually complete.
