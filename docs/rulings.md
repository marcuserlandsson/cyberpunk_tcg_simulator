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
organization-style tags to `faction` (first one wins if more than one); fold
every other classification tag into `keywords` (lowercase, kebab-cased for
multi-word tags). See the "Faction tags" section of `data/cards.schema.md`
for the exact partition and its rationale.

> **Pass-2 correction.** This ruling originally claimed two faction tags on
> one card were "never observed among the 141 cards". That is false — **8
> cards carry two**, and the original "first one wins" wording caused the
> second tag to be dropped from the data entirely. Superseded by §10.

## 4. Legend `cost`/`power` when there's no "Go Solo" option

19 of the 27 Legends have no Go Solo option; their printed **cost** box shows
"—" and the database returns `cost: null, power: null`. `CardDef.cost` is
typed `number` (non-nullable), so we encode "no Go Solo cost" as `cost: 0`.
`power` stays `null` (the field is nullable). This is a lossy encoding — a
`0`-cost Go Solo and a "no Go Solo option" both read as `cost: 0` — but there
is no other legal value given the current schema. Flagged for Task 3/7
reviewers: if it matters for the engine to distinguish "no Go Solo" from
"Go Solo costs 0", the schema needs a nullable cost or an explicit boolean.

> **Pass-2 correction.** The claim that the *power* box also shows "—" on
> these Legends is false: it prints `0`. See §11 — the value is kept as
> `null` anyway, but for a different (source-precedence) reason.

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

---

# Pass-2 rulings (independent verification)

The rulings below were made during pass-2 verification. Pass 2 re-fetched the
netdeck.gg API from scratch and, for every disputed field, read the card
image the API itself serves (`printings[].image_url`) and/or the
print-and-play sheets. **Where the API's structured text field contradicts
the API's own card art, pass 2 treats the art as authoritative** — the art is
a photograph of the physical card, whereas `rules_text` is a hand-entered
transcription and is demonstrably imperfect. This is a deliberate refinement
of pass 1's blanket "database wins" rule, which is retained for everything
the art cannot settle.

## 8. `kiroshi-optics` — API `rules_text` contradicts the printed equip line

**Fixed in `data/cards.json`.**

All 14 Gear cards with an equip reminder line have the *identical* string in
the API: `"(Equip to a friendly Unit or face-up Legend.)"`. Pass 2 pulled the
card art for all 14 and read each line. Thirteen match. `kiroshi-optics` does
not — it prints:

```
(Equip to a Unit or friendly face-up Legend.)
```

The two readings are not cosmetic: the printed version scopes "friendly" to
the *Legend* only, so Kiroshi Optics may be equipped to **any** Unit
(including a rival's), whereas the API's wording restricts it to friendly
Units. Evidence, all agreeing on the printed wording:

- all **five** printing images the API serves for this slug
  (`welcometonightcitybeta`, `welcometonightcityretail`,
  `theheistretailstarterdeck`, `theheistbetastarterdeck`, `mercdemodeck`);
- `docs/rules/print-and-play-mercs.pdf` pages 1 and 2 (3 copies), where
  Kiroshi Optics sits on the *same sheet, in the same font*, next to
  `mandibular-upgrade` printing the standard "a friendly Unit" wording — so
  this is not a rendering or reading artifact.

Ruling: `text` corrected to the printed wording. This is the only card in the
141 where the API's `rules_text` was found to disagree with its own art;
every other card's text is byte-exact against the API.

## 9. `[Flavour]` / `[Flavour Text]` / `[Flavor]` are database artifacts

**Fixed in `data/cards.json` (3 cards).**

Three cards' `rules_text` begins with a bracketed editorial marker:

| card | API `rules_text` |
|---|---|
| `psycho-squad` | `[Flavour] Their protocol stops at “shoot first.”` |
| `animals-wrecker` | `[Flavour Text] Takes a lot of juice to break bones like they do.` |
| `rockn-rockerboy` | `[Flavor] Scream your throat raw for something. Anything.` |

None of these markers is printed on the card — verified on the card art for
all three (and on `print-and-play-mercs.pdf` p3 for `psycho-squad`, which
shows only the italic flavour line). The three different spellings, and the
fact that most flavour-only cards (e.g. `emergency-atlus`, `mantis-blades` —
see §7) carry no marker at all, confirm these are inconsistent upstream
data-entry annotations rather than card content.

Ruling: strip the leading marker, keep the flavour line. This matters beyond
tidiness: `text` is the input Task 8 parses into `effects`, and a stray
`[Flavour]` token is garbage to that parser. §7 (flavour text belongs in
`text`) is unchanged — only the bracketed marker is removed.

## 10. Cards with two faction tags must not lose the second one

**Fixed in `data/cards.json` (8 cards).**

Pass 1's rule (§3) promoted the first organization-style classification tag to
`faction` and asserted no card had two. Eight do, and for each the second tag
vanished from the data entirely — it was neither in `faction` nor in
`keywords`, so 8 of the 241 classification-tag instances were unrecoverable:

| card | API `classifications` | `faction` | tag that was lost |
|---|---|---|---|
| `emergency-atlus` | Trauma Team, Vehicle, Zetatech | Trauma Team | Zetatech |
| `minotaur` | Arasaka, Drone, Militech | Arasaka | Militech |
| `octant` | Drone, Militech, Zetatech | Militech | Zetatech |
| `panam-palmer-nomad-cavalry` | Aldecado, Merc, Nomad | Aldecado | Nomad |
| `panam-palmer-strength-through-family` | Aldecado, Merc, Nomad | Aldecado | Nomad |
| `saul-bright-stormrider` | Aldecado, Nomad | Aldecado | Nomad |
| `unlikely-bond` | Maelstrom, Mox | Maelstrom | Mox |
| `wraith-marauders` | Ganger, Nomad, Raffen Shiv | Nomad | Raffen Shiv |

Ruling: `faction` still holds the first organization tag (unchanged, so no
schema or shape change), and **every remaining classification tag — including
extra organization tags — goes into `keywords`**, kebab-cased, in the
database's printed tag order. This is exactly what `data/cards.schema.md`
already says `keywords` is for ("keywords also carries every
classification/role tag printed under the card's name"); the faction
promotion was only ever meant to *add* a lookup field, not to delete tags.

This matters for gameplay: several cards key off these tags (e.g.
`arasaka-emergency-radioport` checks "if that Legend is ARASAKA"), so a card
that is mechanically Militech or Nomad has to be findable as such.

## 11. Non-Go-Solo Legends print power `0`; we keep `null` (source precedence)

**Not changed — documented discrepancy.**

The 19 Legends without a Go Solo option print a literal `0` in the
bottom-right power box, while the API reports `power: null`. Verified on the
card art for `yorinobu-arasaka-embracing-destruction` and, on the
print-and-play sheets, for `saburo-arasaka-stubborn-patriarch`,
`viktor-vektor-sit-down-and-relax` and `jackie-welles-pour-one-out-for-me`.
The glyph is unambiguous: it sits in the same power box, in the same style, as
`emergency-atlus`'s `04` and `minotaur`'s `09`, and is identical to the `0`
printed by `secondhand-bombus` — a card the API *does* report as `power: 0`.
The reminder text on the rules card ("0 Gigs at power 0") confirms `0` is a
real, meaningful power value in this game.

Ruling: leave `power: null`. Reasons:

1. It is **mechanically inert**. A Legend with no Go Solo option can never
   become a Unit, so it can never attack or fight, and its power is never
   consulted. Nothing in the 141-card pool reads a non-Go-Solo Legend's power.
2. The API is the designated primary source for scalar fields, and unlike §8
   this is not a case of the database contradicting its own art on a
   *meaning-bearing* string — it is the database consistently modelling
   "this Legend has no power characteristic" as `null` across all 19 cards.
3. Changing 19 cards on a purely presentational difference would diverge the
   data from its stated primary source for no behavioural gain.

Flagged for Task 3/7 reviewers: if the engine ever needs a numeric power for
a face-up Legend (e.g. if a future card lets a non-Go-Solo Legend fight, or if
Gear power bonuses are summed onto Legends), treat `null` here as `0` rather
than re-transcribing the data.

## 12. `rebecca-having-a-moment` is an art-only promo — all-null is correct

**Not changed — uncertainty resolved.**

Pass 1 flagged this card `uncertain: ramLimit` because the API returned
`ram: null`, `cost: null`, `power: null`, `rules_text: null` and
`classifications: []`, and pass 1 never rendered an image. Pass 2 fetched the
detail endpoint, which exposes **two** printings (`005` by Narupiti
Harunsong, `007` by Pandart Studio), and read both CDN renders.

Both are full-art *borderless* "Nova Rare" showcase promos. They print the
LEGEND banner, the name `REBECCA`, the subtitle `HAVING A MOMENT`, the artist
credit and the collector footer — and **no gameplay furniture whatsoever**:
no cost box, no power box, no RAM badge, no classification tags, no
rules-text box. The API's all-null record is therefore an accurate
description of the physical card, not a scraping gap.

Ruling: `ramLimit: null` and `text: ""` stand, and the card is no longer
"uncertain" — it is confirmed to have no printed stats. Caveat for the engine:
this makes the card **unplayable as data** while every other Legend in the
pool has RAM 2 (26/26, no exceptions). If a playable value is ever needed,
`2` is the near-certain intent, but pass 2 declined to invent it. Task 4+
should either exclude this card from legal decks or special-case it.

## 13 — Demo decks and the 40–50 deck-size rule

The two bundled demo decks (`data/decks/arasaka-embracing-power.json` and
`data/decks/mercs-the-heist.json`) are the official print-and-play demo
decks, each containing exactly 27 non-legend cards plus 3 legend cards (30
total). The constructed deck-building rule requires 40–50 non-legend cards
minimum for all decks.

**Ruling:** Deck lists carry an optional `demo: true` flag. Demo decks are
exempt from the 40–50 size minimum ONLY — all other deck rules (exactly 3
unique-name legends, max 3 copies per card, per-color RAM limits) still apply
to them. The engine's `validateDeck` (Task 3) will skip the size check when
`demo` is true.

**Rationale:** Demo games deck out faster than constructed games, which is
authentic to the physical demo product (the PDFs are explicitly designed for
quick learning and introductory play).

---

# Task 4 rulings (game setup & turn skeleton)

## 14 — `turnNumber` counts *each player's own* turns

`GameState.turnNumber` is the **per-player** turn count, shared by both
players: it is set to 1 when the first player begins their first turn and
increments only when the **first player** begins a turn.

```
turnNumber 1: first player's 1st turn, then second player's 1st turn
turnNumber 2: first player's 2nd turn, then second player's 2nd turn
...
```

**Rationale:** every rule in the guide that mentions a turn count is
*per-player* ("the player going first ... doesn't ready them on their first
turn", "after the last player's 7th turn", "the d20 is always last" — a
consequence of one die per turn from a 6-die fixer). Counting half-turns
instead would force `Math.ceil`-style arithmetic into every rule. Under this
representation:

- "a player's Nth turn" is exactly `turnNumber === N`;
- the first-player legend penalty is `player === firstPlayer && turnNumber === 1`;
- when the active player is the first player on turn N, **both** players have
  completed N-1 turns; when it is the second player on turn N, the first player
  has completed N and the second N-1. So both players have completed 7 turns
  exactly when `turnNumber >= 8` — that single comparison is the overtime
  trigger (`isOvertime` in `src/engine/game.ts`).

## 15 — Overtime "majority" = strictly more gig dice, checked after every action

The guide (p3) says: *"OVERTIME starts after the last player's 7th TURN.
Overtime is sudden death; as soon as a player has a majority of Gig dice in
their Gig area, they win."*

**Ruling:**

1. *"After the last player's 7th turn"* means once **both** players have
   completed 7 turns — i.e. from `turnNumber >= 8` onwards (see §14). The
   first player finishing *their* 7th turn is not enough; the second player
   must finish theirs too.
2. *"Majority"* means **strictly more gig dice than the rival** — a plain
   `>` on the two gig-area counts, not "more than half of all 12 dice". With
   an even total, "more than half" would be unreachable at 6-6, whereas the
   guide's own framing ("controlling two dice is always closer to winning than
   controlling one die", p3) is comparative. Dice *values* are irrelevant here;
   only the count of discrete dice matters.
3. *"As soon as"* means the check runs **after every applied action** (in
   `applyAction`, after the action's handler and any chained start-of-turn
   sequence), not only at a phase boundary. The instant the counts diverge in
   overtime, the game ends with `gameEnded(overtimeMajority)`.
4. A tie in overtime ends nothing; play continues (and, in the skeleton game,
   ends in a deckout).

## 16 — Start-of-turn ordering: the 7-gig win check precedes ready/draw/gain

The guide's start phase is *ready → draw 1 → gain a gig* (p9), while the win
condition says a player wins "if they start their turn with 7 Gig dice ...
**before taking one from the fixer area**" (p4).

**Ruling:** the win check is step 0 of the start-of-turn sequence, before
readying, before the draw, and before the gig gain. Practical consequence: a
player sitting on 7 gigs wins even if their deck is empty — they never reach
the draw that would deck them out. The engine emits `turnStarted` first (so the
event log shows whose turn the win happened on), then `gameEnded(sevenGigs)`.

## 17 — Deck-out is immediate and unconditional on a required draw

Guide p3: *"if you are required to draw a card but have no cards left in your
deck, your Rival immediately wins."* Implemented in `drawCards`: any required
draw that cannot be satisfied ends the game at once with
`gameEnded(deckout)`, winner = the rival of the player who had to draw. The
game ends before the rest of the turn (the gig gain, the main phase) happens;
any cards drawn before the deck ran dry stay in hand, which is moot once the
game is over. (With the bundled 27-card demo decks this makes turn 22 the
natural end of a game with no other win condition met.)

## 18 — The first player's 2 spent legends are skipped by the ready step *once*

Guide p9: *"The player going first spends their 2 leftmost Legends and doesn't
ready them on their first turn."*

**Ruling:** `choosePlayOrder` sets `ready: false` on `legends[0]` and
`legends[1]` of whoever goes first (index 0 = leftmost, the order fixed by the
face-down legend shuffle in `newGame`). The ready step skips exactly those two
uids when `player === firstPlayer && turnNumber === 1`, so they stay spent for
the whole of that first turn and ready normally on the first player's second
turn. Because an already-spent card cannot be spent again (glossary, p11),
this costs the first player 2 €$ of legend-payment capacity on turn 1 — that
loss *is* the handicap for going first.

## 19 — The gig-die choice is an explicit action; the d20 is offered only alone

Guide p4/p12: *"You can choose any die you want, except for the twenty-sided
die (d20), which is always last."*

**Ruling:** `legalActions` emits one `chooseGigDie` per **distinct die size**
in the acting player's fixer, ascending, with the d20 filtered out whenever any
other die remains; when the d20 is the only die left it is the only choice.
Because gaining a gig requires a decision, the start-of-turn sequence stops in
phase `start` and the die is not rolled until the action is applied. Once the
fixer is empty (from each player's 7th turn onward, six dice having been taken
on turns 1-6) the sequence skips straight to `main` and no die is gained. The
engine keys this off `fixer.length === 0`, not off a turn number, so future
effects that return dice to a fixer behave sensibly.

## 20 — Known simplification: `lag` and `tempPower` clear at the *owner's* next turn start

The guide says lag and until-end-of-turn effects last "until the end of the
turn". The engine clears `lag` and `tempPower` on a player's own cards during
that player's start-of-turn sequence instead.

For `lag` this is exactly equivalent: lag only ever gates the owner's own
attacks and self-spend costs, which can only happen on the owner's turn.

For `tempPower` it is a **real, deliberate deviation**: a +X/turn buff granted
on your turn currently persists through your rival's turn (so it applies while
your unit defends) and is only cleared when your next turn begins. The task-4
brief specifies this ordering explicitly, and no card in the skeleton can grant
`tempPower` yet. Flagged for Task 7 (effects): if buff timing matters there,
move the `tempPower` clear into `endTurn` (clearing *all* cards) and keep the
`lag` clear where it is.
