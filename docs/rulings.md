# Rulings & judgment calls — Task 2 (card transcription)

This log records ambiguities encountered while transcribing the 141-card beta
set into `data/cards.json`, and the call made in each case. Pass 2
(independent verification) should re-check these rulings, not just the data.

## 1. Card count: 141, not 131

The task brief says "the official database lists all 131 beta cards." Live
querying of the actual API behind https://cyberpunktcg.com/cards
(`https://api.netdeck.gg/api/cards/cyberpunk`, discovered by reading the
site's JS bundle — see `data/transcription-report.md` for the endpoint
details) shows:

- `welcometonightcitybeta` / `welcometonightcityretail` (the core boosters):
  **130** unique cards.
- `PRM01` (Set 1 Promos): 2 cards, one of which (`rebecca-having-a-moment`) is
  brand new and one (`adam-smasher-ender-of-legends`) is a reprint already in
  the core 130. So **+1** new card.
- `embracingpowerretailstarterdeck` (the Arasaka starter deck, matching our
  `arasaka-embracing-power.json`): 20 cards, of which **5** are exclusive
  Legends/Units not in the core 130 (`yorinobu-arasaka-embracing-destruction`,
  `goro-takemura-hands-unclean`, `saburo-arasaka-stubborn-patriarch`,
  `minotaur`, `goro-takemura-losing-his-way`).
- `theheistretailstarterdeck` (the Mercs starter deck): 20 cards, **5**
  exclusive (`v-corporate-exile`, `viktor-vektor-sit-down-and-relax`,
  `jackie-welles-pour-one-out-for-me`, `dexter-deshawn-one-last-chance`,
  `mt0d12-flathead`).

130 + 1 + 5 + 5 = **141**. This isn't double-counting: for example the core
set already contains a *different* Goro Takemura Legend
(`goro-takemura-vengeful-bodyguard`) and a *different* Yorinobu Arasaka Legend
(`yorinobu-arasaka-steel-dragon`) — these are additional, distinct cards with
different subtitles and different rules text, not alternate printings of the
same card. Verified this is real by diffing classifications/rules text, not
just names.

**Ruling:** the two demo decks (Step 6 of the brief) are literally built from
these exclusive cards — the print-and-play PDFs show Goro/Yorinobu/Saburo/
Minotaur and Viktor/Dexter/V/Jackie/Flathead as the decks' legends and key
cards, matching the database's own `arasakademodeck` (14 cards) and
`mercdemodeck` (15 cards) sets card-for-card. Excluding them would make the
two starter decks impossible to build with real legends. So `data/cards.json`
contains all **141** reconciled unique cards, not 131, and the count in
`docs/superpowers/sdd/.../task-2-brief.md` should be read as approximate.
This is flagged prominently for the orchestrator/reviewer since it deviates
from an explicit instruction ("must total exactly 131") — the parent task
message also said "count what the database claims" if the true count
differs, which is what this ruling does.

## 2. "Rush" vs "Adrenaline"

The parent task's `CardDef` field comment example lists `"rush"` as an example
keyword. The gameplay guide's page 8 icon for "this Unit can attack the turn
it's played" is never named in the OCR'd text (the label is a graphical
icon). The online database's `rules_text` calls this keyword **`{Adrenaline}`**
verbatim (e.g. `riding-nomad`, `valentino-street-racer`, `adrenaline-converter`,
`modded-kusanagi`). Per the stated accuracy rule (database/Beta wins on
disagreement with guesses/Alpha material), `data/cards.json` uses
`"adrenaline"` as the keyword string, not `"rush"`. Documented here and in
`data/cards.schema.md` so Task 7/8 don't silently look for the wrong string.

## 3. Classification tags vs. `faction` vs. `keywords`

`CardDef` has a singular optional `faction: string` and a `keywords: string[]`,
but the database's `classifications` array can hold 0–3 tags per card, mixing
specific organization names (Arasaka, Militech, Maelstrom, ...) with generic
role tags (Merc, Corpo, Netrunner, Weapon, ...). Ruling: promote the
organization-style tags to `faction` (first one wins if more than one — never
observed among the 141 cards); fold every other classification tag into
`keywords` (lowercase, kebab-cased for multi-word tags). See the "Faction
tags" section of `data/cards.schema.md` for the exact partition and its
rationale.

## 4. Legend `cost`/`power` when there's no "Go Solo" option

19 of the 27 Legends have no Go Solo option; their printed cost/power boxes
show "—" and the database returns `cost: null, power: null`. `CardDef.cost` is
typed `number` (non-nullable), so we encode "no Go Solo cost" as `cost: 0`.
`power` stays `null` (the field is nullable). This is a lossy encoding — a
`0`-cost Go Solo and a "no Go Solo option" both read as `cost: 0` — but there
is no other legal value given the current schema. Flagged for Task 3/7
reviewers: if it matters for the engine to distinguish "no Go Solo" from
"Go Solo costs 0", the schema needs a nullable cost or an explicit boolean.

## 5. `rebecca-having-a-moment` — missing RAM value

The lone new promo card (`PRM01`, Nova Rare) has `rules_text: null` and
`ram: null` in the source database, unlike every other Legend. Encoded as
`text: ""`, `ramLimit: null`, and flagged `uncertain: ramLimit` in
`data/transcription-report.md`. Not padded with an invented number.

## 6. `{Spend}` is not a keyword

`{Spend}` appears in 16 cards' rules text (e.g. `dexter-deshawn-off-the-grid`:
`"{Spend}: Increase a Gig by up to 2."`). Per the gameplay guide glossary,
this is cost notation ("spend this card to activate the effect"), not a
keyword or a timing trigger. Not added to any card's `keywords`; left for
Task 7/8's effect-cost parsing.

## 7. Flavor text embedded in `rules_text` for some vanilla Gear

E.g. `mantis-blades`: `rules_text` is
`"(Equip to a friendly Unit or face-up Legend.)\n\"One cut, one kill.\""` —
the database puts the card's flavor quote directly in `rules_text` (its
separate `flavor_text` field is `null`) for vanilla Gear with no functional
effect. Verified against the print-and-play image — this matches the
physical card exactly. Kept verbatim in `text`; not stripped.
