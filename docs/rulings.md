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

## 20 — `lag` clears at the owner's next turn start; turn buffs clear at the end of the game turn

**Settled in Task 7** (this section supersedes the Task-4 simplification it
originally described).

The guide says lag and until-end-of-turn effects last "until the end of the
turn". Those two are cleared in two different places, on purpose:

- `lag` is cleared in the start-of-turn sequence (`game.ts`'s
  `resetTurnState`), on the starting player's own cards. This is exactly
  equivalent to clearing it at end of turn: lag only ever gates the owner's own
  attacks and self-spend costs, which can only happen on the owner's turn.
- `tempPower` (`buffPower` with `duration: 'turn'`) is cleared in `endTurn`
  (`game.ts`'s `clearTurnBuffs`), for **every card of both players**, before the
  next player's turn begins.

**Ruling:** "until end of turn" on card text means the ongoing *game* turn, not
"until the buffed card's controller starts their next turn". Task 4 deliberately
deferred this; Task 7 needed it settled because effects can now buff during a
react window. Clearing `tempPower` at the owner's own turn start would mean a
buff a *defender* grants itself while blocking survives that defender's entire
next turn — a full extra turn of value the card never promised. Clearing at the
end of the turn gives the natural reading: the buff wins the fight it was played
for and is gone when the turn ends.

`permPower` (`buffPower` with `duration: 'permanent'`) is deliberately untouched
by both clears. Both deltas are wiped when a card leaves the field (see §29),
so a bounced and replayed Unit is a fresh card.

Tested in `tests/engine/effects.test.ts` ("tempPower lifetime", plus the
react-window buff that wins the current fight and is gone next turn).

---

# Task 5 rulings (economy: sell, payments, playing cards, Call a Legend)

## 21 — A sold card enters the Eddies area *ready*, and may pay a cost that same turn

The guide's SELL step (p10/glossary) says only: "reveal it to your opponent,
then place it face-down in the Eddies area." Nothing in the guide's text
restricts a freshly-sold card's spend/ready status, unlike Units (which
explicitly enter the field with Lag) or Legends (whose spend status is set by
setup/ready rules elsewhere).

**Ruling:** a sold card's `CardInstance.ready` is left/set `true` — it enters
the Eddies area exactly like a card readied at the start of a turn, and can
immediately be spent (e.g. to pay for a `playCard` or `callLegend` later that
same main phase). This is the natural reading of "no explicit restriction
stated" given the guide is otherwise careful to call out exceptions (Lag) when
it means to impose one, and it keeps `sellCard` symmetric with the rest of
the Eddies-area bookkeeping (every other ready-by-default entry point —
`newGame`'s `makeInstance`, `readySpentCards` — defaults to ready). Flagged for
reviewers: if a future ruling or errata says otherwise, only `sellCard`'s
handler in `reduce.ts` needs to change (it sets `ready = true` explicitly,
rather than leaving the field untouched, specifically so this is a one-line
fix).

## 22 — Gear equips to a friendly Unit or a *face-up* Legend, not any Legend

Guide p7 (GEAR, the general rule): "pay its cost and equip it to a friendly
Unit or Legend" — no face-up qualifier. But every one of the 141 cards' own
gear reminder line (see §7/§8 above) reads "Equip to a friendly Unit or
face-up Legend," and the guide's own precedence rule (p6, "READING YOUR
CARDS"): "If there's a conflict between a card's text and this guide, follow
the text on the card."

**Ruling:** `legal.ts`'s `friendlyGearTargets` restricts the Legend side of
"friendly Unit or Legend" to face-up legends only. This is safe to hardcode
at the engine level, not just per-card text, because it is universal: all 14
gear cards agree on the Legend clause (§8's `kiroshi-optics` exception only
widens the *Unit* side, to "any Unit" instead of "friendly Unit" — its Legend
clause is unchanged, still face-up-only). A face-down Legend has no revealed
identity to equip anything to, which matches this being unanimous across the
whole pool rather than a per-card effect. `kiroshi-optics`'s wider Unit-side
exception was out of Task 5's "vanilla" scope and is **settled in Task 7**: it
is registered in `src/cards/targets.ts`'s `gearTargetOverrides` and may equip to
any Unit, friendly or rival (§34). The generic rule in this section is unchanged
for the other 16 gear cards.

## 23 — Call a Legend's random flip draws only from the acting player's own legends, uniformly

Guide p10/p11/glossary CALL A LEGEND: "Spend 1 €$ to flip a Legend face-up.
Don't peek beforehand, choom! The randomness of your choice is a part of the
game." There is no other Legend zone to flip from (each player only ever has
their own 3), so "a Legend" unambiguously means one of the acting player's own
face-down legends, chosen uniformly at random.

**Ruling:** `reduce.ts`'s `callLegend` handler collects the acting player's
face-down legend uids in `legends` zone order (index 0 = leftmost) and draws
one index via `nextInt(state.rng, faceDownUids.length)` — the same
seeded-RNG primitive every other random choice in the engine uses (die
rolls, shuffles), so the flip is fully deterministic from the game's seed and
replayable. `legalActions` only offers `callLegend` while at least one
face-down legend remains for that player (an empty list would make `nextInt`
undefined behaviour) and the player hasn't already called this turn.

---

# Task 6 rulings (combat & reactions)

## 24 — Attacking an empty rival Gig area is illegal

The guide (p10/p11) offers exactly two targets: "a spent rival Unit" or "the
rival Gig area". It never says the Gig area must be non-empty — the STEAL step
just says "Choose a rival Gig die and move it to your friendly Gig area".

**Ruling:** `combat.ts`'s `attackTargets` omits `'gigArea'` whenever the rival's
Gig area is empty, so `legalActions` never offers the attack and `applyAction`
rejects it.

**Rationale:** with no dice to take, such an attack has no effect whatsoever
except spending the attacker — it cannot steal, cannot fight, and cannot be
blocked into a fight either (a block would produce one, but the defender would
simply never block). Allowing it would put a strictly self-harming, no-op action
in the legal-action list, which every consumer of `legalActions` (the AI in
Task 9, the UI, random-play simulations) would then have to filter out again.
Forbidding it loses no strategic option. It *is* a deliberate narrowing of the
guide's silence rather than a rule the guide states, hence this entry.

Note the asymmetry with the 0-power case (§25): a 0-power Unit attacking a
*non-empty* Gig area is legal — the guide explicitly contemplates it ("and 0
Gigs at power 0") and the defender may still choose to block it, which makes it
a real, if strange, play.

## 25 — A steal of 0 dice resolves immediately and never enters `chooseGig`

Guide p11: a Unit steals "0 Gigs at power 0". The steal count is capped by the
victim's Gig area size, so it can also come out at 0 if an effect empties the
Gig area during the react window.

**Ruling:** when the computed steal count is 0, `resolveAttack` clears
`pendingAttack`, leaves `pendingSteal` null and returns the game straight to
`main`. The `chooseGig` phase is only ever entered with `remaining >= 1`, so
`legalActions` can never be empty in that phase (an empty legal-action list
would deadlock the game) and no consumer has to special-case a zero-die steal.
The attacker is still spent — see §28.

`stealCount` also returns 0 for *negative* effective power, which Task 7's
debuff effects can produce; `1 + floor(power/10)` would otherwise go
nonsensical there.

## 26 — Call a Legend: one shared gate per player, refreshed every game turn

Guide glossary CALL A LEGEND: "Each turn, you may spend 1 €$ to flip a Legend
face-up. You can do this during your main phase, **or as a reaction when a
rival Unit attacks**." Both the main-phase list (p10) and the reactions list
(p11) are headed "CALL A LEGEND (ONCE PER TURN)".

**Ruling, part 1 — one gate.** There is exactly one gate per player, the
existing `PlayerState.calledLegendThisTurn` flag, shared by the main-phase
action and the react-window reaction: calling in either place blocks the other
*for that turn*. Both routes run the same handler (`reduce.ts`'s `callLegend`,
parameterised by player) so the RNG flip and the payment rules cannot diverge,
and `legalActions` asks `economy.ts`'s `legendCallPayment` in both places so the
availability test cannot diverge either.

**Ruling, part 2 — "each turn" means each *game* turn, for each player.** Every
turn start refreshes **both** players' allowance (`resetTurnState` in
`game.ts`), not just the incoming active player's. So:

- a player who calls during their own main phase still gets their reaction call
  when a rival Unit attacks them on the rival's next turn;
- a player who calls as a reaction during the rival's turn still gets their
  main-phase call when their own next turn begins;
- but nobody gets two calls inside one and the same game turn — a defender who
  react-calls against the first attack of a turn cannot call again against the
  second.

The alternative reading — clearing the flag only at its owner's turn start, so
that a main-phase call consumed the reaction call owed during the rival's
following turn — was implemented first and **rejected**: it makes one call per
player per own-turn *cycle*, which contradicts the guide's plain "each turn"
and silently penalises using the main-phase call. Recorded here because the
engine's behaviour changed as a result (`resetTurnState` now clears both
players' flags), and because it is exactly the kind of asymmetry a reader of
that function will want explained.

**`soldThisTurn` is deliberately not symmetric.** It stays cleared for the
active player only. Selling is a main-phase action with no reaction form, so a
player can only ever sell on their own turn, and resetting at their own turn
start is exactly equivalent to resetting every turn. The asymmetry between the
two flags is therefore a real, documented distinction rather than an oversight
— see the comment on `resetTurnState`.

## 27 — A block closes the react window and resolves the attack at once, stealing nothing

Guide p11: "When a Unit redirects your attempt to attack your Rival directly, a
fight plays out as though your Unit attacked the blocking Unit instead. Even if
you defeat it, you don't steal any Gigs for that attack. In general, if an
effect redirects or stops a direct attack on your Rival, you don't get to steal
a Gig."

**Ruling:** `block` sets `pendingAttack.redirectedTo`, spends the blocker, and
then resolves the attack immediately as a fight against the blocker — the
react window does *not* stay open after a block, and no steal happens even
when the attacker wins the fight (and even if the original target was a spent
Unit rather than the Gig area, in which case the original target is left
untouched). Every other reaction (`callLegend` today; `quick` /
`quickAbility` from Task 7) leaves the window open, matching "The attacked
Rival may take **any number** of these reactions" — so a defender can call a
legend and *then* block, but nothing can follow a block.

**Rationale:** the fight the guide describes is the attack's step 04, i.e. the
resolution; once the attack has resolved there is nothing left to react to. A
second blocker cannot block an attack that has already been redirected and
fought.

## 28 — The attacker is spent up front, whatever the attack achieves

Guide p10/p11 step 01 is "SPEND THE ATTACKING UNIT", before the target is even
declared and long before the rival reacts.

**Ruling:** `declareAttack` spends the attacker as its first act, and nothing
in the resolution path ever readies it. A blocked attack, a lost fight, a
fizzled attack and a 0-die steal all leave the attacker spent — the tap is the
price of *declaring*, not of succeeding. Consequences worth naming:

- attacking is exactly what makes a Unit attackable next turn ("ready Units
  can't be attacked", p11), which is the risk the guide talks about;
- a blocker must be **ready** to block and is spent by blocking (p11: "Spend a
  Unit with the {blocker} keyword"), so it cannot block twice in one turn;
- only field **Units** with the {blocker} keyword can block. Of the 13 cards in
  the pool carrying `blocker`, four are not Units: the Gear cards
  `mandibular-upgrade` and `riot-shield`, and the Legends
  `goro-takemura-hands-unclean` and `goro-takemura-vengeful-bodyguard`. The
  engine only ever scans the defender's `field`, so none of the four can block
  on its own today: Gear sits in `attachedGear`, and a Legend sits in the
  `legends` zone. **Updated by Task 7:** a Go-Solo Legend played as a Unit *is*
  on the field and blocks like any other Unit (§31), and equipped Gear now
  *grants* {blocker} (and its other keywords) to its host (§30), so a Unit
  wearing `riot-shield` or `mandibular-upgrade` can block — the Gear card itself
  still never can.

A related consequence of the phase machine, and of "Each Unit attacks
individually, and completes all the attacking steps before another Unit can
attack" (p10): no second attack, and no other main-phase action, is legal until
the current attack has fully resolved, because `legalActions` returns only
reactions in `react` and only `chooseGig` entries in `chooseGig`.

---

# Task 7 rulings (effect system, triggers, keywords, activated abilities)

## 29 — A Gear card's printed power is the bonus it hands its host, and buffs die with a field exit

Gear cards print a power box (0-4) but never fight on their own — they sit in
`CardInstance.attachedGear`. Every gear card's power line only makes sense as
the bonus it grants: `mandibular-upgrade` prints power **0** and grants only
{blocker}, while `gorilla-arms` prints **3**.

**Ruling:** `query.ts`'s `effectivePower` adds each attached Gear card's
*printed* power to its host, on top of the host's own printed power,
`tempPower`, `permPower` and every active `staticPower` node (the host's own
static defs while it is in play, plus its Gear's). Task 8 therefore does **not**
have to restate a gear card's power box as a `staticPower` effect; it adds
`staticPower` nodes only for *conditional* or non-printed bonuses (e.g. "+2
power for each equipped Gear").

Two corollaries:

- a card's own `static` defs apply only while it is "in play" — on the field, or
  a **face-up** Legend in the legends zone. A face-down Legend has no revealed
  identity, so none of its statics are live;
- when a card leaves the field by any route (defeat, bounce, bottom-deck) both
  `tempPower` and `permPower` are reset and its Gear falls off, to the Gear's
  *own* owner's trash (§8). `combat.ts`'s `leaveField` is the single
  implementation of that exit, so the three routes cannot drift apart.

Static defs may carry a `condition`, evaluated live: a gated `staticPower`
contributes only while the condition holds (a Gear card's condition is judged
from *its own* owner's street cred, which matters for the one card that can
equip to a rival Unit).

## 30 — A Unit or Legend gains the keywords of its attached Gear — except {go-solo}

Four of the pool's {blocker} cards are not Units (§28): the Gear cards
`mandibular-upgrade` and `riot-shield`, and two Legends. Gear cannot act by
itself, so a printed keyword on Gear can only mean one thing.

**Ruling:** the wearer gains its Gear's keywords. `query.ts`'s
`effectiveKeywords(db, state, uid)` unions the card's printed keywords with
those of every attached Gear card, and every engine keyword test now goes
through it (`combat.ts`'s `canAttack` for {adrenaline}, `reactActions` for
{blocker}) instead of reading `def.keywords` directly. So a Unit wearing
`riot-shield` can block, and a lagged Unit wearing `adrenaline-converter` can
attack.

**Exception — {go-solo} is never granted.** It is a property of a Legend card
itself ("pay *this Legend's* cost to play it as a ready Unit"), and the pool
contains a data trap: `riot-shield`'s keyword list includes `go-solo` because
its rules text *mentions* the keyword ("Rivals must pay +2 €$ to use {Go
Solo}"). Granting it would let a Legend in the legends zone be played as a Unit
just for wearing a shield. `goSoloPayment` therefore tests the *printed*
keyword list of the Legend def.

Two known over-approximations, both left for Task 8 to narrow with real card
data, and neither reachable today because every card in `data/cards.json` still
has `effects: []`:

- `adrenaline-converter` grants {adrenaline} unconditionally here, though its
  text gates it on "a Rival controls at least 2 more Gigs than you";
- `overwatch-panam-s-gift` grants {quick} to its host, which is inert — {quick}
  is only ever read off a Program in hand or off an activated ability.

## 31 — {go-solo}: a play from the legends zone, face-up and ready, removed from the game on any field exit

Printed reminder: "{Go Solo} (Pay this Legend's cost to play it as a ready Unit.
It can attack this turn. If it leaves the field, remove it from the game.)" —
8 of the 141 cards.

**Rulings:**

- **Where from.** A {go-solo} Legend gains a `playCard` entry in `legalActions`
  from the **legends zone** (never from hand — Legends are never in hand), at
  its printed cost. On resolution it moves `legends -> field`, `ready = true`,
  `lag = false`, so it can attack the same turn.
- **Face-up only.** The Legend must already be face-up. A face-down Legend's
  identity is unknown even to its controller (guide p10: "Don't peek
  beforehand, choom!"), so there is no legal way to *choose* to Go Solo one, and
  no cost the player could know they were paying.
- **Ready only.** A spent Legend cannot Go Solo. "A spent card can't be spent
  again until it readies" (glossary SPEND), and this closes an obvious exploit:
  spend the Legend for 1 €$, then play it as a ready Unit for free value.
- **It cannot pay for itself.** Legends are worth 1 €$ each when spent, and the
  Legend being played is (until it moves) a ready Legend in the payment pool.
  `canonicalPayment`/`canPayWith` take an `exclude` uid for exactly this.
- **Removed from the game.** A Legend that leaves the field goes to a new
  per-player zone, `PlayerState.removed`, and emits `cardRemoved` — never the
  trash, never back to the legends zone. This holds for **every** exit, not just
  defeat: a bounce or a bottom-deck of a fielded Legend also removes it, because
  the card says "if it leaves the field". A dedicated zone (rather than a flag,
  or dropping the uid from every zone) keeps the invariant that every card
  instance is in exactly one zone, which the UI and state dumps rely on.
- **Still a Legend for RAM.** RAM/RAM-limit is a deck-construction constraint
  only (`deck.ts`), so a fielded Legend needs no runtime bookkeeping: it fights
  as a Unit while on the field and stays a Legend card everywhere else. It is
  no longer in the legends zone, so while fielded it can neither be flipped by
  Call a Legend nor spent for €$.

## 32 — Triggered effects auto-target uniformly at random; only *chosen* actions carry targets

`playCard` and `activateAbility` carry a `targets` array that `legalActions`
enumerates, so a player picks those. The other three triggers fire from actions
that carry no target field at all: `onCall` (the flip is random), `onAttack`
(the `attack` action names only attacker and target) and `onDefeat` (nobody
takes an action at all).

**Ruling:** when an effect needs a target and none was supplied, the interpreter
draws one **uniformly at random from the legal candidates through `state.rng`**,
exactly like Call a Legend's random flip (§23). Fizzling instead would silently
drop half of a card's printed text; a fixed "first candidate" choice would bias
play in a way replays could not justify. Determinism and replayability are
preserved because the choice comes off the seeded rng.

**Exception — an effect's Gig-die steal is a real decision, never rng.**
`stealGig` does *not* pick dice; it hands the choice to the effect's controller
through the same machinery an attack steal uses: `pendingSteal` +
`phase = 'chooseGig'` + one `chooseGig` action per die in the victim's Gig area.
Which die you take moves street cred and the seven-Gig win condition, so it
cannot be a coin flip. Consequences, all in `combat.ts`:

- `pendingSteal` gained two optional fields: `thief` (the effect's controller —
  an attack steal leaves it undefined, meaning "the active player") and
  `resumePhase` (the phase to return to when the last die is taken). An attack
  steal leaves both undefined and behaves exactly as it did in Task 6;
- `actingPlayer` returns `pendingSteal.thief` during an effect steal, so the
  **defender** can be the deciding player mid-attack (a {quick} Program that
  steals) while `activePlayer` still belongs to the attacker;
- an effect steal fired during a react window resumes into `react` with the
  attack still pending; one fired by an on-attack effect is taken *before* the
  react window opens; one fired by an on-defeat effect inside a fight outlives
  the attack that caused it (`endAttack` keeps it and resumes into `main`);
- a steal with an empty victim Gig area never enters `chooseGig` at all;
- **steals for different thieves queue, they never overwrite.** `PendingSteal`
  gained an optional `queue` holding the steals waiting behind the head, oldest
  first, and `combat.ts`'s `finishSteal` promotes the next one when the head is
  done (inheriting the head's `resumePhase`, because the interrupted phase only
  resumes after the *last* steal). A tied fight that defeats two "{Defeated}
  steal a Gig" Units owes each controller a choice, in the order the triggers
  fired — the defender's casualty first, per the fight loop — and neither may be
  dropped. Two steals for the *same* thief with nothing queued between them
  merge into one longer choice sequence instead. `draftState` deep-copies the
  queue, so a reducer's `shift()` can never reach into the caller's state.

The rest of the effect resolves immediately, before the dice are picked — the
same deferral the attack steal has always had (guide step 04 is the last step of
the attack).

**`rerollGig` still picks its die by rng.** Which die to reroll is a choice too,
but no card in the pool pins the wording down yet, so the die selection stays
uniform-random pending a real card in Task 8; when one lands it should take the
die through the ordinary target-slot mechanism (which needs a die-targeting
TargetSpec) rather than growing a second bespoke pending-decision. The same
applies to `discardRandomRival`, which the card text explicitly makes random.

Related target rules, all in `src/cards/effects.ts`:

- target slots are bound **once**, before the def's first node runs, so a node
  that empties the field cannot shift the targets of the nodes after it;
- a slot with no legal candidate is *skipped*, and only the node that wanted it
  fizzles — "defeat a rival Unit, then draw 1" still draws against an empty
  rival field;
- a supplied target that is no longer legal when the effect resolves fizzles
  that node rather than throwing;
- an **activated** ability whose target slot has no candidate is not offered at
  all — paying a cost for nothing is never a decision worth enumerating;
- an unknown `scripted` name throws. That is a card-data bug, and card data
  cannot be schema-checked against the script registry.

This is the one place where a real decision is taken away from the player.
Nothing is lost today (no card in `data/cards.json` has effects yet), and
promoting on-attack/on-defeat targets to explicit choices later means adding a
targets field to those actions, not reworking the interpreter.

## 33 — An ability printed on Gear is activated by the Gear but spends its *host*

`overwatch-panam-s-gift` reads "{Quick} 1 €$, {Spend} Discard 1. ...". The
`{Spend}` in a Gear card's cost cannot mean the Gear: Gear sits in
`attachedGear`, is never readied by the start-of-turn sequence, and has no
meaningful spent state.

**Ruling:** activated abilities are enumerated for the player's field cards,
their face-up Legends, **and the Gear attached to either**. The action names the
Gear (`activateAbility.card` = the gear uid) but a `selfSpend` cost tests and
spends the Gear's **host** — which also means the host's Lag blocks the ability,
and a host Legend being self-spent cannot also be spent for the €$ half of the
same cost (`abilityHost` + `canonicalPayment`'s `exclude`).

**An attached Gear's abilities and triggers belong to the HOST's controller, not
the Gear's owner.** This matters for `kiroshi-optics`, the one card that can
equip to a rival Unit (§8): its owner has handed the Gear over, so the Unit's
controller is the one who may activate it, pays for it, has their street cred
checked by any `condition`, and whose side counts as "friendly" for the effect's
targets. `effectController(state, uid)` (the owner of `abilityHost(state, uid)`)
is the single helper every path uses — enumeration, payment, gating and
resolution — so they cannot disagree. The Gear card is still the effect's
*source* (`ctx.sourceUid`), so `self` targeting and event attribution point at
the Gear. This covers a Gear card's *ongoing* text only — its own **onPlay**
effect belongs to whoever played it, see §38.

`abilityIndex` indexes the card def's **`effects` array**, not a filtered list of
activated abilities, so an index is stable no matter what else the card does.
A `quick: true` activated ability is offered in *both* the main phase and the
react window: {quick} adds the react-window timing, it never removes the normal
one.

## 34 — A `playCard` action's targets are: equip target first, then effect targets

`playCard` needs both kinds of target for a Gear card with an on-play effect.

**Ruling:** `targets[0]` is the Gear equip target (Gear only), and the remaining
entries are the on-play effect's target slots in resolution order. Units and
Programs have no equip target, so their `targets` are purely effect targets.
Gear with no legal host is still unplayable (no entries at all), but a card
whose *effect* has no legal target stays playable — the effect just fizzles.

**On-play target slots are enumerated against the state the effect will see —
i.e. *after* the card has entered its zone.** A Unit's onPlay resolves once the
Unit is on the field, so `legalActions` must enumerate against that same board.
Two things break otherwise, both of them real cards:

- a Unit could never target **itself**. `japantown-jonin`'s "Give a friendly Unit
  +2 power this turn" must be able to buff the Unit that just arrived, and the
  pool proves the distinction is deliberate: `valentino-street-racer` says
  "*another* friendly Unit" when it means to exclude itself;
- a slot that is empty before the play but fillable after it would be *skipped*
  during enumeration and *filled* during resolution (§32's skip rule), shifting
  every later slot by one — the player's chosen rival target would be rejected as
  illegal and the real target drawn at random instead.

`playCardTargetChoices` therefore enumerates through a cheap projected state
(`stateAfterEntry`: out of hand/legends, on the field for a Unit or {go-solo}
Legend) and `playCardOnDraft` binds the slots after performing the same move, so
enumeration and binding always see one board. Gear equip targets are still
enumerated against the pre-play state, which is identical for that purpose — a
Gear card is not a Unit, so moving it changes no target set.

Gear equip targets come from `src/cards/targets.ts`'s `gearEquipTargets`, which
applies the pool-wide rule (§22) unless the card id has an entry in the
`gearTargetOverrides` registry. `kiroshi-optics` is the sole entry, per §8: its
printed line scopes "friendly" to the Legend only, so it may equip to **any**
Unit including a rival's, plus friendly face-up Legends. A per-card registry
keyed by id was chosen over a new `TargetSpec` or a def-level flag because this
is one card's printed-text exception, not a vocabulary the data needs.
(Gear on a rival Unit still goes to its *own* owner's trash when that Unit is
defeated — §8, §29, and covered by a test.)

## 35 — "This Unit can't attack" is a static `cantAttack` EffectNode

Two cards print it: `corpo-security` and
`misty-olszewski-mender-of-broken-spirits`. Task 6 could not enforce it (its
combat legality read only readiness, Lag and {adrenaline}).

**Ruling:** the effect vocabulary gains `{ kind: 'cantAttack' }`, used with
`trigger: 'static'` (zod schema updated in `cardDb.ts` to match). `combat.ts`'s
`canAttack` consults `query.ts`'s `cantAttack(db, state, uid)`, which reads the
same static layer as `staticPower` — so the restriction can also arrive from
attached Gear, and it can be gated by a `condition`. It vetoes the attack
outright: {adrenaline} does not override it.

The card data still carries `effects: []` for both cards; Task 8 adds the node,
and this task's synthetic-card test proves the mechanism.

## 36 — An effect that draws from an empty deck loses the game, like the start-of-turn draw

§17 made the start-of-turn draw an immediate, unconditional deck-out loss.

**Ruling:** an effect's `draw` follows the same rule — a card that tells you to
draw is a required draw, so failing it loses the game (`gameEnded`, reason
`deckout`). Once the game has ended, the interpreter stops: the remaining nodes
of a `sequence`, and any later EffectDef of the same trigger, do not resolve.

`trashFromDeck` and `gainEddieFromTopDeck` are deliberately *not* required
draws: they take "up to" what the deck holds and stop early on an empty deck,
because neither is the guide's draw step and neither has a printed failure
clause.

## 37 — Attached Gear propagates the host's {Attack} and {Defeated} triggers, and nothing else

Gear cards print triggered text about their *host*: "{Attack} Look at a friendly
face-down Legend" (`kiroshi-optics`), "{Attack} Decrease a Gig by up to 2"
(`dying-night-v-s-pistol`), "{Defeated} Play another Unit ... from your trash"
(`the-relic-experimental-biochip`). Statics, keywords and activated abilities
already aggregated a card's Gear (§29, §30, §33), but triggers did not fire at
all, which would have silently dropped every one of those lines.

**Ruling:** when a card's trigger fires, the matching triggers of its attached
Gear fire too — for `onAttack` and `onDefeat` only. Those are the triggers about
the host acting; `onPlay` and `onCall` are deliberately **not** propagated,
because a Gear card's own onPlay already fired when the Gear itself was played
and re-firing it when its host enters the field (a {go-solo} Legend wearing Gear)
would double it up.

Details:

- Gear effects resolve with the **Gear** as the source (`ctx.sourceUid`) but for
  the **host's controller** (§33), so a rival-owned `kiroshi-optics` works for
  the Unit wearing it;
- only the host's own defs consume the `targets` the action supplied; Gear defs
  auto-target per §32, because `legalActions` enumerates the acting card's slots,
  not its Gear's;
- on defeat, the Gear list is captured **before** the field exit detaches it
  (`combat.ts`'s `defeatUnit`), so a "{Defeated}" Gear trigger still fires even
  though the Gear is already in the trash when it resolves;
- `fireCardTrigger` (own defs only) and `fireTriggerOnDraft` (own + propagated
  Gear) are separate entry points, so a caller that must not double-fire — the
  defeat path, which fires the Gear explicitly — can say so.

## 38 — A Gear card's own onPlay belongs to the player who played it, not the host's controller

§33 hands an attached Gear card's abilities and triggers to the Unit's
controller. Its **onPlay** effect is the exception, and the distinction is not a
detail: `kiroshi-optics` may be equipped to a rival Unit (§8), so the two
readings differ every time that happens.

**Ruling:** a Gear card's own onPlay effect resolves for the player who played
and paid for the card — its owner — whatever it ends up attached to. What
transfers to the host's controller is only the Gear's *ongoing* contribution:
statics and keywords (§29, §30), propagated triggers (§37) and activated
abilities (§33). "When you play this, do X" is an act by the player taking the
action; "while this is equipped" is a property of the equipped card.

Mechanically, `playCardOnDraft` fires the onPlay through
`fireCardTrigger(..., player)` with the playing player as an explicit
controller, rather than letting `effectController` derive it from the (already
attached) host — and `playCardTargetChoices` enumerates with the same explicit
controller. Both sides of the enumerate/resolve pair name the player, so they
cannot drift the way §34 describes.

# Task 8 rulings (card implementation)

Batch 1 (Red, 19 cards) needed twelve vocabulary extensions and one data call.
Each is listed with the printed text that forced it and how many of the 141
cards share it, because the ratio is what decided *vocabulary* vs *scripted*
(§48).

## 39 — "Increase/decrease a Gig by up to N" is a `changeGig` node whose die is a real target

Seven cards move a Gig die's face: `6th-street-recruits`,
`dexter-deshawn-off-the-grid`, `industrial-assembly`,
`la-llorona-ghost-of-the-past` ("increase … by up to N") and
`dying-night-v-s-pistol`, `trust-no-one`, `wakako-okada-peace-and-harmony`
("decrease"). §32 deferred the die-targeting question until a real card demanded
it; these do.

**Rulings:**

- the vocabulary gains `{ kind: 'changeGig', amount, target, adjust? }` with
  `amount > 0` increasing and `amount < 0` decreasing, and `TargetSpec` gains
  `friendlyGigDie` / `rivalGigDie` / `anyGigDie`;
- **the three scopes are printed distinctions, not engine policy** (fix round 1).
  The pool says "a **friendly** Gig" when it means your own
  (`jackie-welles-pour-one-out-for-me`) and bare "a Gig" / "Adjust a Gig"
  otherwise (`6th-street-recruits`, `dexter-deshawn-off-the-grid`,
  `dexter-deshawn-one-last-chance`, `industrial-assembly`,
  `la-llorona-ghost-of-the-past`, `trust-no-one`, `dying-night-v-s-pistol`,
  `wakako-okada-peace-and-harmony`, `afterparty-at-lizzie-s`,
  `zetatech-faceplate`, `muamar-reyes-el-capita-n`). **Bare means either
  player's die, chosen by the effect's controller** — nothing in the text
  narrows it, and `meredith-stout-stone-cold-corpo` ("When a Rival adjusts …
  1 or more friendly Gigs") only makes sense if a Rival's adjust effect can
  reach your dice. So bare text encodes as `anyGigDie`; all four batch-1 uses
  are bare and were corrected to it. `anyGigDie` indexes the **controller's**
  area first, then the rival's, as one list, and `targets.gigDieAt` is the one
  place that mapping lives;
- **a Gig-die spec binds an index into that player's `gigArea`, not a card
  uid.** A die is not a card and has no uid, but *which* die you raise is as
  real a decision as which Unit you buff — it moves street cred, the "8+ value"
  conditions and (via `stealCount`) the win condition. Reusing the ordinary slot
  machinery means `legalActions` offers one `playCard`/`activateAbility` entry
  per die for free, and triggered uses (a `{Blocker}` or watcher trigger) fall
  back to §32's uniform-random pick like every other trigger target. The
  alternative — a second bespoke pending-decision phase alongside `chooseGig` —
  was rejected for exactly the reason §32 gives;
- **a fixed-sign "increase/decrease by up to N" takes the full N**, clamped to
  the faces the die actually has: `[1, die.size]`. A d6 showing 5 "increased by
  up to 4" shows 6, not 9, and a decrease never goes below 1, because a die's
  top face is a physical face. The direction is printed, so the extreme is the
  best available result *for the die the player picked* — and the player picks
  the die, which is where the decision actually lives;
- **"Adjust a Gig by up to N" makes the sign AND the magnitude a decision**
  (fix round 1). `adjust: true` gives the node a second slot whose candidates
  are `-N..-1, 1..N` — never 0, which is not one of the printed options — so
  `legalActions` enumerates one entry per (die, amount) pair.
  `afterparty-at-lizzie-s`, `dexter-deshawn-one-last-chance` and
  `zetatech-faceplate` ("adjust … by up to 1"), plus
  `muamar-reyes-el-capita-n` ("Adjust a Gig by 1", i.e. ±1), all need this: the
  right answer there depends on whether you are chasing a value-pair, a min
  Gig or a max Gig, so no fixed rule can stand in for the player. An amount
  slot dies with its die slot (no die, no "how much"), and a trigger that
  supplies no amount falls back to the rng like any other slot (§32);
- `buffPower.amount` may also be the string `'friendlyMaxGig'`
  (`el-sombrero-n-la-venganza-lenta`, `sasha-yakovleva-won-t-let-you-down`:
  "gains power equal to a friendly max Gig this turn"), read off the board at
  resolution time. An empty Gig area reads 0.

## 40 — "The first time … each turn" is `oncePerTurn` on the EffectDef

Six cards say it (`gorilla-arms`, `jackie-welles-pour-one-out-for-me`,
`johnny-silverhand-never-stop-fighting`, `rita-wheeler-no-stupid-questions`, both
`yorinobu-arasaka` Legends).

**Ruling:** `EffectDef` gains `oncePerTurn?: boolean`, and `GameState` gains
`oncePerTurnUsed: string[]` holding `"<uid>:<effectIndex>"` keys. The allowance
is per **card instance and per printed effect**, and it is cleared by
`clearTurnBuffs` — i.e. at the end of the *game* turn, the same lifetime as an
until-end-of-turn buff (§20). A def whose condition is not met does not consume
the allowance; an activated ability that has consumed it is not offered at all.

Keying on the effect index (rather than the card id) keeps two copies of the
same card independent, which is what "this Unit" means.

## 41 — {Blocker} and winning a fight are triggers; "wins all fights against X" is a static

Three cards trigger off their own block (`augmented-negotiators`,
`goro-takemura-vengeful-bodyguard`, `la-llorona-ghost-of-the-past`) and three off
winning a fight (`appetite-for-destruction`, `satori-sword-of-saburo`,
`johnny-silverhand-never-stop-fighting`).

**Rulings:**

- `onBlock` fires for the blocking Unit inside `blockAttack`, **after** it is
  spent and **before** the redirected fight resolves, so a buff or Gig gain it
  produces is live for that fight. (An `onBlock` effect that *steals* would
  collide with the steal `resolveAttack` sets up moments later; no card in the
  pool does, and the two that could are covered by this note.)
- `onWinFight` fires for the survivor of a fight that defeated the other side.
  A tie has no winner (both are defeated), and a Unit that won but has since
  left the field does not trigger. It fires after the loser's `onDefeat`, since
  the loser is defeated first. **A fight whose loser was saved by a
  `defeatShield` (§46) has no winner either** (fix round 1): the shield means
  the Unit was never defeated, so `fight()` checks that the loser actually left
  the field before firing.
- "This Unit wins all fights against CORPO Units" becomes the static node
  `{ kind: 'winsFightVsKeyword', keyword }`, consulted by `fight()` *instead of*
  the power comparison in that Unit's favour — it wins and survives whatever the
  numbers say. Only one card prints it, but a static cannot be scripted (scripts
  only run at resolution time), so it must be a node; it is as narrow as §35's
  `cantAttack`.
- Both new triggers are propagated by attached Gear (§37), because both are
  about the host acting.

## 42 — `onFriendlyStealDie` is the one *watcher* trigger

`6th-street-recruits`: "When a friendly Unit steals a d6, increase a Gig by up
to 6." Every other trigger in the pool is about the card it is printed on; this
one watches what *another* card did.

**Rulings:**

- the trigger fires from `takeStolenGig`, on every in-play card of the **thief**
  (their field and face-up Legends, plus the Gear on either), in field order —
  so the stealing Unit's own copy fires too ("a friendly Unit" includes itself);
- it fires **once per die taken**, after that die has joined the thief's Gig
  area. So the just-stolen die is itself a candidate for the increase, which is
  correct: it is a friendly Gig by then;
- the die's *size* is not readable from the state after the fact, so
  `EffectDef.condition` gains `stolenDieSize`, supplied through a new
  `ConditionContext` argument that only the watcher seam passes. An effect gated
  on `stolenDieSize` can therefore never fire outside a steal — the condition is
  unsatisfiable without the context.

## 43 — `grantKeyword` gives a keyword until end of turn; `attack-ready` is the granted-only one

`johnny-silverhand-rocking-renegade` ("A friendly Unit can attack spent rival
Units the turn it's played"), `gunpoint-diplomacy` and `valentino-guerrera`
("it may attack ready Units").

**Rulings:**

- `CardInstance` gains `tempKeywords`, cleared exactly when `tempPower` is
  (`clearTurnBuffs`, and on any field exit), and `effectiveKeywords` unions it
  in — so a granted {adrenaline} or {blocker} works everywhere the printed one
  does. The node is `{ kind: 'grantKeyword', keyword, target, duration: 'turn' }`;
- "can attack … the turn it's played" **is** {adrenaline} — that is the printed
  keyword's own rule — so `johnny-silverhand-rocking-renegade` grants
  `adrenaline`. "Spent rival Units" in that text is the normal targeting
  restriction (guide p11), not an extra permission;
- "it may attack ready Units" is a *new* permission with no printed keyword, so
  it gets the internal keyword `attack-ready` (`query.ATTACK_READY`), which
  widens `attackTargets` for that one attacker only. It is never printed on a
  card, so it can never be granted by Gear by accident;
- **known over-approximation:** `gunpoint-diplomacy` says "the **next time** this
  Unit attacks this turn", and the grant lasts the whole turn. Narrowing it
  needs the same one-shot floating-effect machinery the two deferred cards need
  (§52); a Unit attacking twice in one turn is rare (it must be readied first).

## 44 — Cost reduction: a static node for card costs, a `cost.reduction` for ability costs

Five cards print "for -1 €$ for each friendly Gig with 8+ value"
(`carnage-at-the-colosseum`, `octant`, `trauma-team-operatives`,
`viktor-vektor-drop-your-illusions`, `zetatech-berserk`) and
`johnny-silverhand-rocking-renegade` prints the same clause on an *ability*.

**Rulings:**

- one shape, `CostReduction { per: 'friendlyGigValueAtLeast', value, amount,
  minimum }`, used two ways: as a `static` `costReduction` node (the card's own
  play cost) and as `EffectDef.cost.reduction` (an ability's €$ cost);
- `query.effectiveCardCost(def, state, player)` is the single authority on what
  a play costs, and every payer path goes through it: `legalActions`'s
  `playCard`, `reduce`'s legality check for `playCard` and for the `quick`
  reaction, and `quickReactionActions`. A card in **hand** is not "in play", so
  this reads the card definition's static defs directly instead of
  `activeStaticNodes` (§29);
- the printed minimum is data, not policy: `carnage-at-the-colosseum` says "to a
  minimum of 1 €$" so its `minimum` is 1, while
  `johnny-silverhand-rocking-renegade` states no floor, so its `minimum` is 0
  (a free activation is possible with two 8+ Gigs).

## 45 — "Choose one effect" is a `chooseOne` node whose mode is a slot

Six cards are modal: `dexter-deshawn-off-the-grid`, `gunpoint-diplomacy`,
`muamar-reyes-el-capita-n`, `padre-man-of-the-cross`, `pyramid-song`,
`wakako-okada-peace-and-harmony`.

**Rulings:**

- `{ kind: 'chooseOne', modes, chooser? }` contributes a **mode slot** (its
  candidates are the mode indices) followed by the slots of *every* mode, in
  printed order. Only the chosen mode's slots are consumed at resolution: the
  cursor jumps to that mode's slice and then past all of them, so the nodes
  after the `chooseOne` still line up. Reserving all the modes' slots keeps the
  slot list independent of the choice, which is what lets enumeration and
  binding agree (§34). The cost is a slightly redundant action list — a
  two-mode card with a target in each mode offers a target for both — never a
  wrong one;
- a `chooseOne` reached from a trigger that carries no player choice
  (`dexter-deshawn-off-the-grid`'s `{Call}`) picks its mode off the rng, exactly
  like any other unsupplied slot (§32);
- **a rival's private choice is never enumerated.** While the rival is the
  chooser, the mode slot offers **no** candidates and resolution falls back to
  the rng — the rival is modelled as an unpredictable agent, and the action list
  stays honest about who decides. Two choosers use this:
  `'rivalIfBehindStreetCred'` (the rival picks the one mode while you are
  behind, otherwise you do) and `'allUnlessBehindStreetCred'` — see §54 for the
  card that forced the second.

**Known limitation:** an *activated* ability whose `chooseOne` has any
unfillable slot is not offered at all (§32's "never charge for nothing" rule
reads the whole def, not the chosen mode). No card in the pool is both activated
and modal with per-mode targets; if one lands, `hasUnfillableSlot` needs to
become mode-aware.

## 46 — A `defeatShield` Gear is destroyed in its host's place

`deadman-transmitter` ("If this Unit would be defeated, defeat its DEADMAN
TRANSMITTER instead") and `jackie-welles-mama-s-favorite`.

**Ruling:** the static node `{ kind: 'defeatShield' }` on an attached Gear makes
`defeatUnit` trash **that Gear** and return, leaving the host on the field with
no `unitDefeated` event and no `onDefeat` triggers — the Unit was never
defeated. Consequences:

- it replaces *every* defeat, from a fight or an effect alike ("would be
  defeated" names no source);
- the first shield in attach order takes the hit, and one shield soaks one
  defeat: the Gear is gone afterwards;
- the host keeps its buffs and its other Gear, because it never left the field
  (§29's reset only happens on a field exit).

## 47 — `onSpend` fires wherever a card in play becomes spent

Seven cards trigger off being spent (`alt-cunningham-mother-of-daemons`,
`arasaka-emergency-radioport`, `maxtac-squadron`, `netwatch-netdriver`,
`rita-wheeler-no-stupid-questions`, `tetratronic-rippler`, `zetatech-faceplate`).

**Ruling:** every route that spends a card goes through one helper,
`effects.spendOnDraft(db, draft, uids)` — declaring an attack, blocking, a
`{Spend}` ability cost, a `spendCard` effect, and paying €$ with eddies or
Legends — and that helper fires `onSpend` for each uid. Two limits:

- **only a card *in play* triggers**: on the field, or a **face-up** Legend in
  the legends zone. A face-down card in the Eddies area has no revealed identity
  and no live abilities, so paying with eddies never triggers anything;
- the whole cost is paid before the trigger's effect resolves (self-spend and
  €$ together), so an `onSpend` effect can never see a half-paid cost.

`economy.pay` stays the dumb primitive (it has no card-layer dependency); the
trigger lives in the card layer, which every caller of `pay` already imports.
This keeps the engine's import graph unchanged.

## 48 — A `scripted` node may declare target slots

Three batch-1 cards are scripted: `all-is-lost` (trash 3, take a Unit from among
*those three* — a search over cards that were not in a targetable zone when the
action was enumerated), `arasaka-emergency-radioport` (look at a face-down
Legend, then maybe Call it for free) and
`johnny-silverhand-rocking-renegade` (two clauses that must land on the *same*
chosen Unit, the second gated on that Unit's tags).

**Rulings:**

- `{ kind: 'scripted', name, targets? }` may declare `TargetSpec`s. They are
  enumerated and bound exactly like any node's targets, so a scripted card can
  still take a real player decision (`johnny-silverhand-rocking-renegade`'s
  Unit), and the script reads them off `ctx.targets`. Unfillable slots are
  dropped rather than passed as null, so a script must tolerate a short array;
- the choices a script makes *internally* (which Unit `all-is-lost` retrieves,
  which face-down Legend the radioport looks at) go through `state.rng` per §32.
  They are real decisions the action space cannot express, because the
  candidates only come into existence while the effect resolves;
- vocabulary beats scripting whenever ≥2 cards share a shape — that is why
  `changeGig`, `chooseOne`, `grantKeyword`, `defeatShield`, cost reduction and
  the four new triggers are nodes, and why only these three cards are scripts.

## 49 — An optional cost on a *triggered* effect is a decision on the triggering action

`el-sombrero-n-la-venganza-lenta`: "{Attack} You may pay 2 €$. If you do, this
Unit gains power equal to a friendly max Gig this turn."

**Ruling (revised in fix round 1 — the first version paid it automatically
whenever it was affordable, which quietly burned 2 €$ on every attack).**
Spending €$ is a resource decision, and €$ is the game's scarcest resource: the
same 2 €$ could play a card, Call a Legend, or pay for this. Nothing about being
mid-attack makes the trade automatically correct — a 4-power attacker hitting an
empty Gig area gains nothing from +9 power.

- an `EffectDef` with a `cost` and a trigger other than `activated` resolves
  **only** when the firing carries `payOptionalCosts: true`; otherwise it is
  skipped and nothing is spent;
- the answer rides on the action that fires the trigger. `attack` gained an
  optional `payOptionalCosts` field, and `attackActions` offers **both**
  variants — `{attacker, target}` (decline) and
  `{attacker, target, payOptionalCosts: true}` (pay) — but only when the
  attacker (or its propagated Gear, §37) actually has such a def and can afford
  it, so no other card grows the action list. The plain variant stays exactly
  the action every existing caller already builds, so declining is the default
  and no existing legality changes;
- a costed trigger fired from a path that *cannot* carry the answer (an
  `onDefeat`, `onSpend` or watcher trigger with a cost) counts as declined. No
  card in the pool is in that position; when one lands, that trigger's action
  grows the same field, or — for a genuinely action-less trigger — it wants a
  pending two-option decision phase in the shape of `chooseGig`.

An activated ability's cost is untouched: it is mandatory, and choosing to
activate *is* the decision.

## 50 — "You may …" is taken whenever it can be

Beyond §49's costed option, three batch-1 cards print a bare "you may":
`bonnie-and-clyde` ("You may defeat 2 instead if …") and
`arasaka-emergency-radioport` (twice: "you may look", "you may Call it for
free").

**Ruling:** an optional clause with no cost and no drawback resolves as taken.
(An optional clause that *does* cost something is a real decision — see §49 for
"you may pay N €$"; the same will apply to "you may discard/defeat X" when a
batch reaches those cards.)
`bonnie-and-clyde` therefore encodes as two `onPlay` defeats, the second gated
on `condition.rivalGigLeadAtLeast: 2` — one defeat normally, two when the Gig
deficit is there ("defeat 2 **instead**" = the first one plus one more, both
still bound by the "power 4 or less" filter). Where an optional clause ever
becomes a real dilemma, it should become a `chooseOne` with a do-nothing mode
rather than a new kind of prompt.

`EffectDef.condition` also gained `friendlyGigValueAtLeast` ("If you control a
Gig with 8+ value" — 6 cards) and `rivalGigLeadAtLeast` ("if a Rival controls at
least 2 Gigs more than you" — `bonnie-and-clyde`, `adrenaline-converter`), both
plain reads over the Gig areas.

## 51 — `animals-wrecker`'s printed line is flavour, not rules

"Takes a lot of juice to break bones like they do." The transcription already
stripped a `[Flavour]` annotation from this card's `rules_text` (schema doc,
`docs/rulings.md` §9), and the sentence names no game object.

**Ruling:** `animals-wrecker` is a **vanilla** card — `effects: []` on purpose.
Task 8's completeness test must treat it as a fourth allowed case alongside
"has effects", "is scripted" and "has empty text": a card whose text is flavour
only. It is the only such card in the Red pool; later batches should extend the
list rather than invent effects for a flavour line.

## 52 — Deferred: floating "until later" effects (`chrome-fang`, `appetite-for-destruction`)

Two batch-1 cards create an effect that outlives its own resolution and is
attached to *nothing on the board*:

- `chrome-fang` — "{Play} Until your next turn, rival Units can't steal friendly
  Gigs with value higher than their power." A lasting restriction on the rival's
  `chooseGig` options, expiring at a specific future turn boundary;
- `appetite-for-destruction` — "The next time a friendly Unit wins a fight by 3+
  power this turn, it also steals a Gig." A one-shot delayed trigger, plus the
  fight *margin*, which `fight()` does not currently expose.

**Ruling (scope):** both are left with `effects: []` for now. They need a
`GameState.floatingEffects` zone (an EffectDef plus a controller, an expiry and a
one-shot flag) that `draftState` copies, `beginTurn`/`endTurn` expire, and the
`chooseGig` enumeration and `fight()` consult — a genuine engine feature rather
than a vocabulary extension, and one that wants its own test pass. Pool-wide it
would also subsume §43's `gunpoint-diplomacy` over-approximation and the
"next time" clauses in `gorilla-arms` / `jackie-welles-pour-one-out-for-me`, so
it is worth doing once, properly, rather than three ad-hoc times.

**Batch 3 addition (fix round 1, docs/rulings.md §79):** `cyberpsychosis`
("If that Unit steals or fights, defeat it at the end of this turn") needs the
exact same `floatingEffects` zone — a delayed, conditional, one-shot effect
tied to a specific card instance rather than to a turn boundary alone. Batch 3
first shipped only this card's *other* clause (the immediate power buff) and
deferred the delayed defeat, but a follow-up review overturned that: a
gameplay-affecting partial encoding that keeps a card's upside while dropping
its printed downside makes the card strictly better than as printed, with no
visible marking that anything is missing — now a standing policy across all
batches (§79). `cyberpsychosis` is deferred in full, `effects: []`, joining
this list rather than shipping half-implemented.

# Task 8 fix-round-1 rulings

## 53 — "Give a friendly Unit these effects" needs one shared target slot

`slotSpecs` gives every node its own slot, so a sequence of two nodes asks for
two targets — which is wrong for every card that hands *one* Unit several
things: `gunpoint-diplomacy` ("Give a friendly Unit these effects … The next
time **this Unit** attacks … // Give **this Unit** +3 power"),
`goro-takemura-vengeful-bodyguard` ("Give a friendly Unit with cost 4 or less
{Blocker} this turn. If you control a value-pair of Gigs, also give **it** +1
power"), `johnny-silverhand-rocking-renegade`,
`yorinobu-arasaka-steel-dragon` ("play a Unit … **It** can attack rival Units
this turn"), `dum-dum-maelstrom-triggerman`. Before this, the only way to say it
was a script.

**Ruling:** the vocabulary gains
`{ kind: 'sameTarget', target, filter?, effects }` and `TargetSpec` gains
`'chosen'`.

- `sameTarget` contributes **one** target slot, then the slots of its children;
- a child that names `target: 'chosen'` consumes **no** slot and reads the uid
  the enclosing `sameTarget` bound (`EffectCtx.chosen`), exactly the way `'self'`
  reads the source. So "buff it and grant it a keyword" is one decision, and
  `legalActions` offers one entry per candidate Unit rather than the cartesian
  product of two independent picks;
- if the shared slot cannot be filled the whole construct fizzles (the children
  are all *about* that target), but the children's slots are still stepped over
  so any node after the `sameTarget` reads the right ones — the §34 alignment
  rule;
- `'chosen'` outside a `sameTarget` resolves to nothing rather than throwing, and
  is never enumerated as a candidate.

This is what let `gunpoint-diplomacy` (§54) be encoded faithfully, and it
retires the shared-target half of `johnny-silverhand-rocking-renegade`'s script
rationale (the script stays for the ROCKER tag check, which is a condition on
the chosen target that the vocabulary still cannot express).

## 54 — `gunpoint-diplomacy` gives BOTH effects; being behind on ☆ is the penalty

Printed text: "Give a friendly Unit these effects. If you have less ☆ (Street
Cred) than a Rival, they instead choose one effect for you. / The next time this
Unit attacks this turn, it may attack ready Units. // Give this Unit +3 power
this turn."

Batch 1 first encoded this as a plain "choose one", which is **half the card**:
the `//` separates the two effects the Unit is given, and the modal reading only
applies while you are behind on Street Cred. The first version also let the
controller pick a mode in the default case, i.e. it turned an upside into a
choice and the penalty clause into the normal rule.

**Ruling:** `chooseOne` gains a third chooser,
`'allUnlessBehindStreetCred'`: **every** mode resolves, unless the controller's
Street Cred is strictly less than the rival's, in which case the rival picks
exactly one (not enumerated, per §45). Wrapped in a `sameTarget` (§53) so both
effects land on the one chosen friendly Unit, the whole card is:

```jsonc
{ "trigger": "onPlay", "effect": {
    "kind": "sameTarget", "target": "friendlyUnit",
    "effects": [{ "kind": "chooseOne", "chooser": "allUnlessBehindStreetCred",
      "modes": [
        { "kind": "grantKeyword", "keyword": "attack-ready", "target": "chosen", "duration": "turn" },
        { "kind": "buffPower", "amount": 3, "target": "chosen", "duration": "turn" }
      ] }] } }
```

so the play offers exactly one decision — which friendly Unit — and the Street
Cred comparison decides how much that Unit gets. The `attack-ready` grant is
still turn-long rather than one-attack-long (§43's recorded
over-approximation, waiting on §52's floating effects).

# Task 8 rulings, batch 2 (Red, 17 more cards)

Batch 2 needed roughly as much new vocabulary as batch 1, spread thinner
across more cards (the 17 assigned here, plus several forward-looking
generalizations the pool's other "more ☆", "end of your turn" and "for each
of its equipped Gear" cards will reuse later). Each entry names the printed
text that forced it and, where relevant, how many other pool cards share the
shape (checked by grepping `data/cards.json`'s `text` field pool-wide, not
just this batch).

## 55 — "More/less ☆ than a Rival" and "less than N ☆" join the condition object

Four cards use "If you have more ☆ (Street Cred) than a Rival" as a plain
gate (`minotaur`, `royce-don-t-call-me-simon`, `valentino-guerrera`, and
`evelyn-parker-scheming-siren` outside this batch) — a strict comparison, not
an absolute threshold, so the existing `streetCredAtLeast` field cannot
express it. `yorinobu-arasaka-embracing-destruction` also needs the mirror
image at a fixed threshold: "if you have less than 20 ☆".

**Ruling:** `EffectDef.condition` gains `streetCredAheadOfRival?: boolean`
(strictly greater than the rival's Street Cred) and `streetCredBelow?: number`
(strictly less than the threshold). Both are plain reads of `streetCred` on
both sides, mirroring `effects.ts`'s pre-existing (unexported) local
`behindOnStreetCred` helper that `chooseOne`'s `rivalIfBehindStreetCred`
chooser already used — this just promotes the same comparison to a
data-driven condition so a plain (non-modal) effect can gate on it too.

## 56 — "+N power while fighting a [card type]" is a fight-only static, never folded into `effectivePower`

`meredith-stout-stone-cold-corpo`: "This Unit has +2 power while fighting a
Legend." No other pool card shares this exact shape, but it is not a `chooseOne`
or a `buffPower` — the bonus exists only for the duration of one specific fight,
against one specific kind of foe, and disappears completely outside that fight
(it must not, for instance, make the Unit look stronger when computing an
attack's Gig-steal count, which the guide bases on power *before* any foe is
known).

**Ruling:** the vocabulary gains the static node
`{ kind: 'powerVsCardType', cardType: CardType, amount: number }`, read by a
new `query.ts` helper `fightPowerBonus(db, state, uid, foe)` that
`combat.ts`'s `fight()` adds on **both** sides on top of `effectivePower`,
matching each side's own foe. It is deliberately **not** added inside
`effectivePower` itself (unlike a Gear's printed power or an unconditional
`staticPower`): `effectivePower` has no "current foe" parameter, and every
other reader of it (Gig-steal count, target filters, UI display) would
otherwise see a bonus that only makes sense mid-fight.

## 57 — Trash-zone and hand-zone targeting: `friendlyTrashCard`, `friendlyHandCard`, `retrieveFromTrash`, `discardCard`

Three cards move a specific card between the trash and the hand, and the
card chosen is a real decision, not an "at random" forced pick (contrast
`discardRandomRival`, whose text is explicit about randomness because the
*rival's* hand is not the acting player's to see):

- `meredith-stout-stone-cold-corpo`: "you may add **a card** from your trash
  to your hand" — no restriction at all;
- `screw-lovelorn-fool`: "Add **another Unit** from your trash to your hand"
  — restricted to card type Unit, excluding the source itself;
- `v-streetkid`: "add **1 BRAINDANCE Program** from your trash to your hand"
  — restricted to card type Program with the `braindance` keyword.

**Ruling:** `TargetSpec` gains `friendlyTrashCard` (every card in the
controller's own trash) and `friendlyHandCard` (every card in the
controller's own hand); `TargetFilter` gains `cardType?: CardType`, checked
against the candidate's own `CardDef.type`. Two new nodes consume them:
`retrieveFromTrash` (trash → hand) and `discardCard` (hand → trash, the
controller's own choice of card — see §65 for why this differs from
`discardRandomRival`). Because these route through the ordinary target-slot
machinery, a triggered use (as all three cards' printed triggers are)
auto-targets via rng when nothing can supply a real choice (§32), and an
on-play/activated use would get a real enumerated decision for free if a
future card needs one.

**A same-EffectDef ordering trap, and why `v-streetkid` is two `EffectDef`s
sharing one trigger, not a `sequence`.** `v-streetkid`'s printed text is
"Trash 3. Then, add 1 BRAINDANCE Program from your trash to your hand" — no
"from *among them*" qualifier (contrast `all-is-lost`, which has exactly that
qualifier and is scripted for exactly this reason, §48). So the retrieval
must be able to reach the newly-trashed cards, which only exist *after* the
`trashFromDeck` node has run. But §32 binds every slot of one `EffectDef`
**once, before its first node runs** — a `sequence` wrapping both nodes would
enumerate `retrieveFromTrash`'s candidates against the trash as it was
*before* the trash-3 even happened, so a BRAINDANCE Program trashed by this
same effect could never be chosen (verified failing before this fix: with an
otherwise-empty trash, the slot had zero candidates and the retrieval always
fizzled). The fix costs nothing structurally: `fireCardTrigger` already
resolves a card's matching `EffectDef`s **in printed order, each with its own
fresh `bindSlots` call** (this is how `yorinobu-arasaka-embracing-destruction`'s
two `onFriendlyAttack` defs and `johnny-silverhand-never-stop-fighting`-style
cards already work). So `v-streetkid` is encoded as two `onCall` defs — trash
3, then retrieve — and the second one's candidates are correctly computed
*after* the first has resolved. **Any future card with this "fill a zone,
then target what you just put there" shape must split into separate
same-trigger `EffectDef`s the same way**, not a `sequence`; a `sequence` is
only safe when no later node's target set depends on an earlier node's
zone mutation within the same `EffectDef`.

**Residual note (flagged during batch-2 review, not yet a real bug).** The
same split-into-two-defs fix works for `v-streetkid` because `onCall` carries
no player-supplied `targets` at all — every slot falls back to the rng
(§32), so there is no *enumeration* to keep in sync with *resolution*, only
the resolution-time candidate list needs to see the right zone contents.
That is not true of `onPlay` or `activated`, whose `targets` array is a
flat, positional list the calling action commits to *before* any node runs
(§34's `playCardTargetChoices` / `effectTargetChoices` enumerate against one
snapshot of the board, and the action's `targets` are bound against the
*same* snapshot at resolution — see `bindSlots`). Two same-trigger `onPlay`/
`activated` defs where the **second** def's candidate *count* depends on
what the **first** def's node did to a zone (not just *which* cards qualify,
but *how many* slots exist) would desync `legalActions`' enumerated tuple
shape from what `bindSlots` sees when the action actually resolves — the
same class of bug §34 already solved for a card targeting itself via
`stateAfterEntry`, but for a *second* def watching the *first* def's
zone-mutation rather than the play itself entering a zone. No card in the
pool (through batch 2) has this shape — every real "split into two defs"
case found so far is either `onCall`/watcher-triggered (no enumeration to
keep in sync, as here) or a fixed-shape node (`sameTarget`, §53) where the
child's `chosen` reference needs no independent candidate list at all.
Whichever batch first needs this exact shape must either avoid it (fold the
first def's effect into a `scripted` node instead, per §48) or extend
`effectTargetChoices`/`bindSlots` to recompute a later def's candidate count
against the *post-first-def* board rather than the pre-firing snapshot.

## 58 — Attack-permission statics: `attackReadyWithKeyword`, `cantAttackGigArea`

- `valentino-guerrera`: "If you have more ☆ than a Rival, this Unit can
  attack ready Units **with {Blocker}**" — narrower than §43's granted-only
  `attack-ready` keyword (which permits attacking *any* ready Unit): this is a
  standing, condition-gated static, not a temporary grant from resolving an
  effect, and it only ever widens the target list to ready Units carrying one
  specific keyword.
- `ruthless-lowlife`: "This Unit can only attack rival Units. (It can't
  attack Gig areas.)" — the mirror image of §24's *engine-wide* omission of an
  empty Gig area from the attack-target list, but printed on one card as a
  blanket restriction regardless of whether the Gig area is empty.

**Ruling:** two static nodes, `{ kind: 'attackReadyWithKeyword', keyword }`
and `{ kind: 'cantAttackGigArea' }`, read by new `query.ts` helpers
(`attackableReadyKeyword`, `cantAttackGigArea`) that `combat.ts`'s
`attackTargets` consults alongside the existing `ATTACK_READY` keyword check
and the rival-Gig-area-non-empty check. Both are gated by the owning
`EffectDef`'s ordinary `condition` (`streetCredAheadOfRival` for Valentino),
so nothing new is needed for the "only while ahead" half.

## 59 — "+N power for each of its equipped Gear" as a static, and "during your turn"

`royce-psycho-on-the-edge`: "During your turn, this Legend has +2 power for
each of its equipped Gear." The pool has two more cards with the "for each of
its equipped Gear" shape (`cyberpsychosis`, `dum-dum-maelstrom-triggerman`,
both outside this batch) but as a one-shot `buffPower`, not an ongoing static
— all three want the same *amount*, read off the board instead of printed.

**Ruling:**

- `DynamicAmount` (already `'friendlyMaxGig'` from §39) gains a second
  variant, `{ perEquippedGear: number }` — N times the *subject* card's own
  `attachedGear.length`. A new `query.ts` helper, `resolvePowerAmount(state,
  amount, subjectUid, player)`, is the one place both variants are resolved,
  used by `buffPower`'s node handler (unchanged behaviour for the
  `'friendlyMaxGig'` case) and now also by `effectivePower`'s `staticPower`
  loop — `staticPower.amount` widens from a bare `number` to `number |
  DynamicAmount` for exactly this;
- `EffectDef.condition` gains `duringOwnTurn?: boolean` — true only while
  `state.activePlayer` is the effect's own controller. This is a plain board
  read, not a new trigger: Royce's bonus is a **static**, live continuously
  while the condition holds, not something that fires and then persists.

## 60 — Four more watcher-shaped triggers: `onFriendlyAttack`, `onUnitDefeated`, `onRivalAdjustFriendlyGig`, `onEndTurn`

Following §42's `onFriendlyStealDie` template (a trigger about *another*
card's action, broadcast to every in-play card that might care), four more
printed shapes need the same treatment:

- `onFriendlyAttack` — "The first time a friendly ARASAKA Unit attacks each
  turn, ..." (`yorinobu-arasaka-embracing-destruction`). Broadcast, from
  `combat.ts`'s `declareAttack`, to every in-play card of the **attacker's own
  controller** (single-sided, like `onFriendlyStealDie`), carrying
  `context.attackerTags` (see §61) for the keyword gate;
- `onUnitDefeated` — "The first time an ARASAKA Unit is defeated each turn,
  ..." (`yorinobu-arasaka-steel-dragon`). Bare — no "friendly" qualifier — so,
  per §39's convention for bare wording, it watches **globally**: broadcast
  from `combat.ts`'s `defeatUnit` to every in-play card of **both** players,
  whichever side the defeated Unit belonged to. Fired after the field exit
  (so the Unit is genuinely gone, and a `defeatShield`-saved Unit never
  triggers it — same non-event as §41's "no winner" case) but the tags are
  captured from the card's own definition **before** `leaveField` detaches its
  Gear, since a Unit's own faction membership never depended on its Gear;
- `onRivalAdjustFriendlyGig` — "When a Rival adjusts or swaps 1 or more
  friendly Gigs, ..." (`meredith-stout-stone-cold-corpo`). Fired from
  `effects.ts`'s `changeGig` node handler itself, on the die's **actual
  owner** (via a new `targets.ts` helper `gigDieOwner`, the mirror image of
  `gigDieAt`), whenever that owner differs from the effect's controller —
  i.e. whenever someone else's `changeGig` reaches into your Gig area.
  **Known gap:** the printed text also says "or swaps", but no card in the
  pool implements a Gig-swap node yet (`hanako-arasaka-daughter-of-the-emperor`
  and `maxtac-av` print "Swap a friendly Gig with a rival Gig" — both future
  batches). Meredith's ability only actually fires off `changeGig` today;
  whichever batch adds the swap node must fire this same trigger from it too,
  or this half of her text silently under-delivers;
- `onEndTurn` — "At the end of your turn, ..." (`v-roamer-of-the-badlands`;
  11 cards pool-wide print this). Broadcast, from `reduce.ts`'s `endTurn`,
  to every in-play card of the player whose turn is ending, **before**
  `clearTurnBuffs` wipes the turn's `tempPower`/`tempKeywords` — so a card
  whose end-of-turn condition reads "this turn" state (e.g. a future card
  checking a turn-scoped flag) sees it intact. `endTurn` gained a `db:
  CardDb` parameter for this (previously it needed none), and checks
  `draft.winner !== null` immediately after, the same guard `declareAttack`
  and `defeatUnit` already use, so an end-of-turn effect that decks a player
  out stops the turn hand-off dead rather than starting the next turn over a
  finished game.

All four reuse the existing `fireWatcherTrigger` helper (§42) unchanged —
"global" is simply calling it once per player instead of once.

## 61 — Two more one-trigger-only condition contexts: `sourcePowerAtLeast`, `selfIsStealer`

Following §42's `stolenDieSize` pattern (a fact only the firing trigger can
supply, so the condition is unsatisfiable anywhere else):

- `swordwise-huscle`: "{Attack} If this Unit has power 5+, draw 1." —
  `condition.sourcePowerAtLeast`, answered by `context.sourcePower`, which
  `combat.ts`'s `declareAttack` now also computes (alongside the existing
  `payOptionalCosts`) and passes into the `onAttack` firing;
- `v-roamer-of-the-badlands`: "When **this Unit** steals a Gig, increase it
  by up to 5." Every other `onFriendlyStealDie` card in the pool (just
  `6th-street-recruits` so far) means "any friendly Unit"; this one means
  specifically itself. `condition.selfIsStealer`, answered by
  `context.stealerUid` (the attacking/stealing card's own uid, which
  `PendingSteal.attacker` already tracks) compared against the *checking*
  card's own uid — which is why `conditionMet` grew an optional `sourceUid`
  parameter (every call site that has one to give now passes it; the ones
  that don't, e.g. a card's own static cost-reduction check, simply never
  match a `selfIsStealer` condition, which is correct since that condition
  can only ever appear on a triggered def).

  **Also scripted, not a `changeGig` node:** "increase **it** by up to 5"
  names the specific die just stolen (always the last one pushed onto the
  thief's own Gig area, per §42) with a fixed, non-adjustable amount (§39's
  "by up to N" rule: always the full clamped N). Neither the target nor the
  amount is a real decision here, so there is nothing for the slot machinery
  to enumerate — `changeGig`'s `anyGigDie`/`friendlyGigDie` specs would
  incorrectly offer *every* friendly die as a choice. The card is scripted
  (`v-roamer-of-the-badlands`) purely to reach "the last-pushed die" directly;
  it is not the §48 kind of script (no player decision is being replaced).

## 62 — "2 or more Gigs with 8+ value" needs a count, not just a max

`v-roamer-of-the-badlands`: "At the end of your turn, if you control 2 or more
Gigs with 8+ value, draw 1." The existing `friendlyGigValueAtLeast` (§39/§50)
only checks the *best* die ("if you control **a** Gig with 8+ value" — one is
enough); this needs a count of qualifying dice, which is a different
predicate entirely.

**Ruling:** `EffectDef.condition` gains `friendlyGigsAtLeastValueCount?: {
value: number; count: number }` — the number of the controller's Gig dice at
or above `value` must be at least `count`. Named and shaped differently from
`friendlyGigValueAtLeast` on purpose, rather than overloading one field with
two meanings depending on whether a `count` is present.

## 63 — Free-playing a Unit from hand *or* trash: `friendlyHandOrTrashUnit`, `maxCost`, and a scripted play

`yorinobu-arasaka-steel-dragon`: "{Play} You may play a Unit with cost 4 or
less from your hand or trash for free. It can attack rival Units this turn."
Two more pool cards print the same "play ... for free" shape from a mixed
zone (`lizzy-wizzy-delicate-weapon`: hand-or-trash Program; `river-ward-
detective-on-the-hunt`: hand-only Gear), so the *targeting* half is built as
reusable vocabulary even though only this card is in scope this batch.

**Rulings:**

- `TargetSpec` gains `friendlyHandOrTrashUnit` — every card in the
  controller's own hand *and* trash whose `CardDef.type` is `'unit'`. The
  type restriction is baked into the spec itself (a mixed hand+trash zone
  holds every card type, unlike any existing spec), rather than left to a
  generic filter, because the spec's own name already promises "a Unit" the
  way `friendlyUnit` does;
- `TargetFilter` gains `maxCost?: number` for the printed cost cap ("cost 4 or
  less"), checked against the candidate's own `CardDef.cost`;
- this is wrapped in a `sameTarget` (§53) whose two children are a `scripted`
  node (the actual "move it onto the field and play it" mechanics: it is
  simply too much machinery — skip payment, skip the normal hand-only
  entry point, still fire the moved card's own onPlay — to fit an
  `EffectNode`, matching §48's script-vs-vocabulary line exactly) and a
  `grantKeyword` for `adrenaline` on `'chosen'` (so it can attack despite the
  Lag every freshly-entered Unit still gets — see below). The script reads
  `ctx.chosen`, the uid the `sameTarget` bound, rather than declaring its own
  `targets`, since the enclosing `sameTarget` already claimed the one real
  decision;
- the freed Unit's own **onPlay** still fires ("play" means the whole thing),
  auto-targeted per §32 (a script-driven play carries no player decision of
  its own for the freed card's effects) — mirroring §38's rule that a card's
  own onPlay is a first-class play, not folded into whoever caused it;
- the freed Unit enters with the **ordinary** Lag every Unit gets (matching
  every other entry point, rather than special-casing this one script to
  skip it), and the `grantKeyword adrenaline` child is what actually lets it
  attack "this turn" — so "It can attack rival Units this turn" reads exactly
  like §43's `johnny-silverhand-rocking-renegade` clause: {adrenaline} is the
  keyword that means "can attack the turn it's played", and "rival Units" is
  the ordinary attack-target restriction (guide p11), not an extra
  permission needing its own node.

## 64 — Two more dynamic `maxPower` filters: an alternate cap, and a friendly-die reading

- `royce-don-t-call-me-simon`: "Defeat a rival Unit with power 2 or less. If
  you have more ☆ than a Rival, defeat a rival Unit with power 3 or less
  **instead**." "Instead" is the operative word: this is **one** defeat with
  a threshold that depends on the board, not two additive defeats (contrast
  §50's `bonnie-and-clyde`, whose "instead" genuinely means "one more, on top
  of the first"). `TargetFilter` gains `maxPowerIfAheadOnStreetCred?: number`,
  which **replaces** `maxPower` (never adds to it) when the controller has
  more Street Cred than the rival, decided once per `filterTargets` call
  rather than per candidate (so it cannot flicker mid-evaluation);
- `over-the-edge`: "Defeat a Unit with power equal to or less than the value
  of a friendly d20." Bare "a Unit" is `anyUnit` (§39's bare convention,
  applied to card targets rather than Gig dice) — verified against the
  card's own effects, which can and do reach the controller's own side.
  `TargetFilter` gains `maxPowerVsFriendlyD20?: boolean`, resolved through a
  new `targets.ts` helper `friendlyD20Value` (the highest face among the
  controller's own d20 dice, or **-1** with none, so "no d20" rejects every
  candidate rather than needing a special case).

## 65 — `shattered-memories`: a one-off "discard hands, may redraw, conditional bonus" script

"Each player discards their hand and may draw 5. If the total number of
discarded cards equals the value of a friendly Gig, draw 2." No other pool
card shares this shape (both-players-discard, a per-player optional
redraw, and a board-dependent bonus keyed off a value nothing else tracks —
the running discard total), so per §48 it is fully scripted rather than grown
into vocabulary.

**Ruling — "may draw 5" is "draw up to 5", never a deck-out risk.** Unlike a
mandatory `draw` node (§17/§36, which loses the game on an empty deck), an
optional redraw that could accidentally lose the game for choosing the
*beneficial* option would be a trap no rational player would ever spring —
and nothing in the text suggests "you may" here means "an all-or-nothing
gamble with your own life". This reuses `trashFromDeck`'s already-settled
"take up to what the deck holds, stop early" reading (§36) rather than
`draw`'s. The bonus "draw 2", by contrast, carries no "may" and is a genuine
mandatory draw — it can end the game exactly like any other `draw` node, and
the script calls the same `endGame`/`drawCards` primitives `effects.ts` uses
for that case.

## 66 — `cardTags`: a card's own faction *and* keyword tags, for bare organization checks

`yorinobu-arasaka-embracing-destruction` ("a friendly ARASAKA Unit") and
`yorinobu-arasaka-steel-dragon` ("an ARASAKA Unit") both gate on organization
membership. Per the schema doc's "Faction tags" section (and docs/rulings.md
§10), a card with only **one** organization tag stores it in `faction`, not
`keywords` — so `hasKeyword(uid, 'arasaka')` is **false** for most
single-faction ARASAKA cards (e.g. `satori-sword-of-saburo`: `faction:
"Arasaka"`, `keywords: ["weapon"]`), and would silently never match.

**Ruling:** a new `query.ts` helper, `cardTags(def)`, returns the union of a
card's own `keywords` and its kebab-cased `faction` (if any) — the same
partition the transcription task already promises callers can reconstruct.
`combat.ts` computes this once per firing (`context.attackerTags` in
`declareAttack`, `context.defeatedTags` in `defeatUnit`) from the card's own
`CardDef`, deliberately **not** `effectiveKeywords` — a Unit's faction is not
something its equipped Gear can change, unlike the keywords Gear grants
(§30). `EffectDef.condition.attackerKeyword`/`defeatedKeyword` (named to match
the existing `filter.keyword` convention, even though the check is really
"keyword-or-faction") match against these lists.

# Task 8 fix-round-1 rulings (batch 2 review)

## 67 — A compound printed sentence spanning several `EffectDef`s needs ONE shared once-per-turn allowance, not one each

`yorinobu-arasaka-embracing-destruction`: "The first time a friendly ARASAKA
Unit attacks each turn, draw 1. Then, if you have less than 20 ☆ (Street
Cred), discard 1." §66 encoded this as two independent `onFriendlyAttack`
defs, each its own `oncePerTurn` — which desyncs from the printed text: §40
says a def whose `condition` is not met does not consume its allowance, so
if Street Cred is 20+ at the first ARASAKA attack (the draw def fires and is
marked used; the discard def's *own* condition fails, so *its* allowance is
untouched) and then drops below 20 before a **second** ARASAKA attack the
same turn, the discard def's condition now holds and it incorrectly fires —
even though the text describes **one** event, evaluated **once**, at the
first qualifying attack.

**Ruling:** `EffectDef` gains `onceKey?: string`. Defs on the same card
sharing an identical `onceKey` (and `oncePerTurn: true`) form one allowance
group. `fireCardTrigger` pre-scans, before any def in the firing resolves,
which not-yet-spent groups this firing "evaluates" — a group is evaluated
the moment **any** not-yet-spent member's own `condition` holds, even a
narrower sibling's (using the board state as it stood before any group
member ran, so the check cannot see a sibling's own side effects). Every
member of an evaluated group is marked spent from that point on, whether or
not each member's own condition individually held — so the draw def (whose
condition is just "attacker is ARASAKA") is what actually evaluates
Yorinobu's group, and the discard def is marked spent alongside it even on
a turn where its own Street-Cred check happened to fail. A later qualifying
attack the same turn cannot re-open either clause, matching "the first
time … draw 1. Then, if …, discard 1." as the single compound event the
text describes. Ungrouped `oncePerTurn` defs (no `onceKey`) are completely
unaffected — the fix is additive, verified by the full pre-existing suite
staying green.

`yorinobu-arasaka-embracing-destruction`'s two defs now share
`onceKey: "embracing-destruction"`. Proven with a synthetic two-def card
(`tests/engine/effects.test.ts`, "EffectDef.onceKey") before the re-encode,
plus a real-card regression test (`tests/cards/red.test.ts`) driving the
exact desync scenario the review flagged: Street Cred 20+ at the first
ARASAKA attack (draw only), Street Cred dropped below 20, a second ARASAKA
attack the same turn (nothing fires) — confirmed to fail without the fix by
temporarily reverting `fireCardTrigger` and re-running.

**Residual note, ledgered rather than fixed (out of scope for this round):**
§57 already flagged the general risk of a later same-trigger def's
*candidate count* depending on an earlier def's zone mutation, for
`onPlay`/`activated` triggers whose `targets` are positional and bound
against one pre-firing snapshot; `onceKey` does not touch that — it only
shares an allowance flag, never a target list. No card needs both shapes at
once yet.

# Task 8 rulings, batch 3 (Yellow, 19 cards)

Batch 3 needed six vocabulary extensions, one propagation fix and two
engine-level fixes surfaced while writing the real-card tests, plus seven
scripted cards (more than either Red batch, because Yellow's "you may defeat
a Gear" family recurs three times with no clean shared shape — see §73).

## 68 — `grantKeywordWhile`: a conditional keyword grant, masking the printed one

`adrenaline-converter`: "(Equip to a friendly Unit or face-up Legend.) If a
Rival controls at least 2 more Gigs than you, this Unit has {Adrenaline}."
§30 already flagged this as a known over-approximation: `effectiveKeywords`
unions in *every* printed keyword of an attached Gear unconditionally,
including `adrenaline` here, though the card's own text gates the grant on
the Gig-count comparison.

**Ruling:** the vocabulary gains a static node, `{ kind: 'grantKeywordWhile',
keyword }`, used with an ordinary `condition` (here `rivalGigLeadAtLeast: 2`,
already existing from §50). `query.ts` gains `gatedKeywordNames(def)` —
every keyword name any of `def`'s own `static` EffectDefs gates this way —
and `effectiveKeywords` now:

- unions in a card's (or its Gear's) printed `keywords`, **except** any name
  `gatedKeywordNames` returns for that same def;
- separately unions in `grantKeywordWhile`'s keyword from
  `activeStaticNodes` — which already only returns nodes whose `condition`
  currently holds, so the gate is live only while the printed clause is true.

Every other card's printed keywords are completely unaffected: masking only
ever removes a keyword a card *also* gates with its own static def, and no
other card in the pool does that yet. The pre-existing synthetic test that
documented the old over-approximation (`tests/engine/effects.test.ts`, "gear
keyword grants (real cards)") is updated in place to assert the *fixed*
conditional behaviour, per the batch-3 task brief's "check existing
dynamic/conditional machinery before extending" steer.

## 69 — Five new plain board-read conditions

Five cards each need one board fact `EffectDef.condition` cannot yet read:

- `afterparty-at-lizzie-s`: "If you control 2 or more Gigs with different
  values" → `friendlyGigDistinctValuesAtLeast?: number` — the size of the
  `Set` of the controller's own Gig-die values must be at least this;
- `bootleg-black-sapphire-show`: "If you control a Gig with an even value
  and a Gig with an odd value" → `friendlyGigEvenAndOdd?: boolean` — at
  least one die of each parity, which (unlike the distinct-values count
  above) is a *shape* check, not a threshold;
- `caliber-totentanz-s-top-dog`: "{Defeated} ... If **the card's** cost
  equals the value of a friendly Gig, ..." — "the card" is Caliber itself, a
  fixed number known at data-encoding time (its own printed cost, 5), so
  this is `friendlyGigValueEquals?: number` rather than a new "read the
  source's own cost" indirection — the literal `5` is baked into the card's
  data the same way every other printed threshold already is;
- `dexter-deshawn-one-last-chance`: "If your ☆ (Street Cred) differs from a
  Rival's by 10+" → `streetCredDiffAtLeast?: number`, the absolute
  difference — distinct from §55's `streetCredAheadOfRival` (a strict `>`,
  no threshold) and `streetCredBelow` (compares to a fixed number, not the
  rival's);
- `maelstrom-goons`: "When this Unit steals a Gig, **if it's equipped**, a
  Rival discards 1" → `sourceEquipped?: boolean`, reading
  `state.cards[sourceUid].attachedGear.length > 0`. Combined with the
  already-existing `selfIsStealer` (§61), the def reads:
  `condition: { selfIsStealer: true, sourceEquipped: true }`.

All five are plain, pure reads over `state` (plus, for the last, the
existing `sourceUid` parameter `conditionMet` already threads through for
`selfIsStealer`), following the exact shape of every condition field before
them.

## 70 — `DynamicAmount.perFriendlyGigParity`, and `draw` becomes dynamic too

`jackie-welles-ride-or-die-choom`: "{Attack} Give this Unit +2 power this
turn for each friendly Gig with an even value. {Defeated} Draw 1 for each
friendly Gig with an odd value." The power half fits the existing
`DynamicAmount` slot on `buffPower`; the draw half needs a count that reads
the board too, which `draw` never supported (`count: number` only).

**Ruling:**

- `DynamicAmount` gains a third variant, `{ perFriendlyGigParity: { parity:
  'even' | 'odd', amount: number } }` — `amount` times the count of the
  controller's own Gig dice matching `parity`, resolved by the existing
  `resolvePowerAmount` (which now discriminates its three variants by shape
  — `'perEquippedGear' in amount` — since a bare `typeof amount === 'object'`
  check is no longer enough with two object-shaped variants);
- `EffectNode`'s `draw` widens from `{ count: number }` to `{ count: number
  | DynamicAmount }`, and `effects.ts`'s `draw` handler resolves a
  non-numeric count through the same `resolvePowerAmount` `buffPower`
  already uses. This is additive: every existing `draw` node in the pool
  still carries a plain `number`, so no card's behaviour changes.

## 71 — `stealGig.distinctValueOnly`, and two merge-logic fixes it exposed

`gorilla-arms`: "The first time this Unit steals 1 or more Gigs each turn,
steal a rival Gig with a value not shared by a friendly Gig." Per the batch
brief's own steer, this reuses §32's `stealGig` node/`pendingSteal` +
`chooseGig` machinery rather than growing a new Gig-die `TargetFilter` (no
other card in the pool restricts *which* die an effect may steal, and Gig
dice are deliberately never filtered by `filterTargets`).

**Ruling:** `stealGig` gains `distinctValueOnly?: boolean`, mirrored onto
`PendingSteal.distinctValueOnly`. `combat.ts`'s `chooseGigActions` narrows
the offered dice to those whose value the thief does not already hold
whenever it is set, falling back to every die if none qualifies — never
deadlocking `chooseGig` (mirroring §25's "a steal of 0 dice never enters
`chooseGig`" principle, extended to "a filter with zero survivors is not
really a filter"). A filtered bonus steal that merges into an
already-pending, unfiltered one (the common case here: the attack's base
steal is still open when the watcher fires) applies the filter to the
**whole** remaining choice, not just the bonus die — a documented
simplification; the alternative (per-die filters inside one `PendingSteal`)
would need every remaining slot to carry its own provenance, which no card
in the pool needs yet.

Writing this card's real-game test (attack → steal → watcher fires →
bonus die) surfaced two bugs in machinery §32/§42 had already built, neither
specific to the new field:

- **`selfIsStealer` compared the wrong uid for a Gear-printed effect.**
  §61's `condition.selfIsStealer` checks `context.stealerUid !== sourceUid`,
  which is correct when the effect is printed on the stealing Unit itself
  (`v-roamer-of-the-badlands`) but wrong when it is printed on that Unit's
  *Gear* (`gorilla-arms`): a watcher firing for an attached Gear card passes
  the **Gear's own uid** as `sourceUid` (§42's watcher loop treats a Unit
  and each of its Gear as separate watcher "cards"), while
  `context.stealerUid` is always the **attacking card's** uid — the host,
  never its Gear. `query.ts` gains a small local helper, `actingCardFor`
  (the Gear's host if `uid` is attached Gear, otherwise `uid` itself — the
  same resolution `effects.ts`'s `abilityHost` already does, reimplemented
  locally so this pure-read module does not need to import the card layer),
  and `selfIsStealer` now compares `context.stealerUid` against
  `actingCardFor(state, sourceUid)`. `v-roamer-of-the-badlands` is
  unaffected: `actingCardFor` on a plain field Unit (nothing has it in
  `attachedGear`) returns the uid unchanged.
- **`stealGig`'s merge check could not recognize an attack-driven steal as
  "the same thief."** An attack-driven `PendingSteal` leaves `thief`
  `undefined`, meaning "the active player" (§32); the merge branch compared
  `head.thief === ctx.player` literally, so `undefined === 0` was always
  false and a bonus steal from the *same* controller was wrongly treated as
  a **different** thief's steal and pushed onto `queue` instead of
  extending `head.remaining`. Fixed by comparing against the *effective*
  thief, `head.thief ?? draft.activePlayer`, matching how `combat.ts`
  already resolves the same field everywhere else. No batch-1/2 card
  exercised this path: their `onFriendlyStealDie` effects use `changeGig`,
  never a *second* `stealGig` layered on top of an attack's own steal.

Both fixes are covered by the synthetic `EffectNode: stealGig with
distinctValueOnly` and the real `gorilla-arms` tests; the full pre-existing
suite stayed green throughout, confirming neither is a behaviour change for
any already-encoded card.

## 72 — `onFriendlyEquippedSpend`: one more watcher, plus a genuinely blocked half-card

`alt-cunningham-mother-of-daemons`: "When a friendly equipped Unit or
Legend is spent, draw 1. When a rival Unit would steal a Gig, you may
discard 1 with cost equal to that Gig's value. If you do, the Gig isn't
stolen."

**Ruling, clause 1.** A new watcher trigger, `onFriendlyEquippedSpend`,
following §42/§60's template exactly: fired from `effects.ts`'s
`spendOnDraft`, on the just-spent card's own controller, whenever that card
is in play, is a Unit or Legend, and carries at least one attached Gear —
right alongside the existing self-referential `onSpend` fire in the same
loop. "A friendly ... Unit" includes the watching card itself, mirroring
§42's convention for `onFriendlyStealDie`.

**Deferred, clause 2.** "When a rival Unit would steal a Gig, you may
discard 1 [with a cost restriction], ... the Gig isn't stolen" needs a
*true interception point* before a steal's die actually moves — nothing
today lets the non-acting player answer an optional, costed decision in the
middle of `takeStolenGig`, the way `payOptionalCosts` lets the *attacker*
answer one on their own trigger (§49). Building that decision phase (who
answers, what it costs, and how declining it differs from a `defeatShield`'s
unconditional interception, §46) is a genuine engine feature, not a
vocabulary extension — left with only clause 1 encoded, `effects: []` for
the rest, exactly like §52's floating-effects deferral.

**Re-verified this partial encoding against §79's new policy (fix round
1).** §79 forbids a partial encoding whenever the missing clause changes
how the *encoded* clause should be played around. Here the two clauses are
independent triggers with no shared state: clause 1 (`onFriendlyEquippedSpend`
→ `draw 1`) is a pure, unconditional upside that fires exactly as printed
whenever it should; clause 2, whether present or not, can only ever make
the card weaker (a missing defensive option), never make clause 1 read
differently or make the card better than printed. This is the same shape as
§60's `meredith-stout-stone-cold-corpo` precedent, not `cyberpsychosis`'s —
the card under-delivers by being weaker than printed, which is safe, rather
than over-delivering by being stronger, which is not. Clause 1 stays
encoded; clause 2 stays deferred.

## 73 — Three "you may defeat a Gear" scripts, and a new `defeatGear` combat helper

Three cards print "you may defeat a [friendly] Gear," each with a different
follow-up: `dum-dum-maelstrom-triggerman` ("If you do, draw 2. Otherwise,
draw 1."), `gilded-mato-n` ("If you do, defeat a rival Unit with cost 3 or
less."), `heywood-ripperdoc` ("If its cost equals the value of a friendly
Gig, draw 1."). Despite the shared "optional Gear defeat" shell, none of the
three follow-ups is expressible with the same vocabulary shape:

- `dum-dum`'s and `gilded-mato-n`'s "if you do, X" makes a LATER node's
  resolution depend on whether an EARLIER node's target slot was actually
  filled — a dependency no existing node expresses. A `sequence`'s second
  node has no way to see whether the first one found a target (§32/§57); a
  `chooseOne` mode containing both nodes does not help either, because the
  mode's own slot is chosen unconditionally and each child node's slot is
  independently filled — picking "the defeat-and-follow-up mode" with no
  Gear available would still let the follow-up fire, which is exactly wrong;
- `heywood-ripperdoc`'s "**its** cost" needs the specific Gear that was
  defeated, carried into a later check — the same "read a property of what
  a prior step touched" problem `sameTarget`'s `'chosen'` solves for a
  *target reference*, but not for "check a numeric property of it," which no
  node reads.

**Ruling:** all three are scripted — the "if you do, X" / "its cost"
dependencies above are still not vocabulary-expressible. "You may [defeat
your own Gear, no €$ cost]" is auto-taken whenever a Gear exists, per §50's
established convention for every other cost-free "you may" in the pool
(extended here from "defeat 2 instead of 1" and "look at/Call a Legend for
free" to "defeat your own card") — declining a free, no-drawback-stated
option was never modelled as a real choice anywhere else in the pool.

A new `combat.ts` export, `defeatGear(draft, db, gearUid)`, detaches the
Gear from its host and trashes it to its own owner, firing the Gear's own
`{Defeated}` triggers if it has any (§37) — but **no** `unitDefeated` event
and no `onUnitDefeated` watcher fire, because a Gear card is not a Unit. All
three scripts call this one plain combat-layer helper.

**Fix round 1 (batch 3 review): *which* Gear must be a real decision where
the firing action can carry one.** The original version of this ruling
picked the Gear (and, for `gilded-mato-n`, the rival Unit) through the rng
for all three cards, reasoning that "no card needs 'defeat a Gear' as a real
decision yet." That reasoning does not survive contact with the actual
`onPlay` trigger both `gilded-mato-n` and `heywood-ripperdoc` fire from: an
`onPlay` action already carries a real `targets` array the player commits to
when playing the card (§34), and the candidate Gears all exist on the board
*before* the effect resolves — nothing about them is only knowable
mid-resolution the way, say, `all-is-lost`'s freshly-trashed cards are (§48).
Leaving "which Gear" to the rng was simply wrong for these two, not a
justified simplification.

- `TargetSpec` gains `friendlyGear` (every Gear attached to the controller's
  own field Units or face-up Legends) and `anyGear` (the same, plus the
  rival's, controller's own listed first — §39's bare-scope convention,
  since `heywood-ripperdoc` prints bare "a Gear");
- `gilded-mato-n`'s scripted node now declares `targets: ['friendlyGear']`,
  and its script reads `ctx.targets[0]` instead of `pick`ing from
  `friendlyGearUids`. Which rival Unit to defeat afterward is **still**
  picked through the rng: the review flagged only the Gear choice, and
  exposing "a rival Unit with cost 3 or less" as a second real decision
  would need a scripted target slot with `TargetFilter` support, which
  `{ kind: 'scripted', targets?: TargetSpec[] }` does not have today (no
  card needs a *filtered* scripted target yet, so this is left for whichever
  batch first does);
- `heywood-ripperdoc`'s scripted node now declares `targets: ['anyGear']`,
  spanning both sides, and its script reads `ctx.targets[0]`;
- `dum-dum-maelstrom-triggerman` is the one card of the three that
  **cannot** get this fix: its Gear-defeat clause fires on `{Call}`, and
  `onCall` fundamentally carries no target-bearing action — *which* Legend
  flips is itself decided by the rng inside `callLegend` (docs/rulings.md
  §23), so there is no action the player takes *before* the flip that could
  carry a pre-committed Gear choice for *this* Legend specifically. This is
  not a new gap: §45 already established that a `chooseOne` reached from
  `{Call}` picks its mode off the rng for exactly this reason, and batch 1's
  `dexter-deshawn-off-the-grid` already ships that way. `dum-dum` keeps its
  rng-based Gear pick, now documented as consistent with §45 rather than as
  an oversight matching the other two.

Both `friendlyGear`/`anyGear`-driven choices are covered by real-card tests
asserting `legalActions` actually enumerates one entry per candidate Gear
(both the controller's own and, for `heywood-ripperdoc`, the rival's), not
just that the effect works once a Gear is picked.

## 74 — `adam-smasher-metal-over-meat`: a scripted mass defeat

"{Play} Defeat all other Units." The only "defeat **all**" shape in the
141-card pool with no target choice at all (`don-t-fear-the-reaper`'s "Spend
all rival Units" is the pool's other mass effect, but a different verb and
scope, outside this batch) — scripted rather than grown into a one-card
`defeatAll` node. Both fields are snapshotted before defeating anything,
since `defeatUnit` mutates the very zone arrays being iterated; a field card
counts as a "Unit" here whether it got there as a printed Unit or a
{go-solo} Legend, matching §31/§39's existing convention.

## 75 — `hanako-arasaka-in-a-gilded-cage`: a scripted search with no rng at all

"{Play} Search the top 4 cards of your deck. Reveal any number of cards
with cost equal to any friendly Gig values and add them to your hand.
Bottom-deck the rest." A pure search over a *look-then-decide* zone
(the searched 4, which exist only once the effect resolves) — the same
"candidates only come into existence mid-resolution" reasoning that makes
`all-is-lost` a script (§48). Unlike that card, though, "any number" here
has an unambiguous best answer: every qualifying card is strictly worth
taking (no card in the pool ever benefits from *leaving* a cost-matching
card in the deck to keep searching), so §50's "you may" convention resolves
it deterministically — no rng needed anywhere in this script, the only one
in the pool so far that can say that.

## 76 — `live-with-the-aftermath`: one real decision, one rng'd one, in the same effect

"Each player defeats one of their Units." The controller's own casualty is
a genuine decision (which friendly Unit to lose), enumerable exactly like
any other `defeat` node's target; the RIVAL's casualty is not a decision
*this* action's single acting player can make on the rival's behalf — there
is no second "whose turn is it to decide" slot in `playCard`. Scripted with
one declared target (`friendlyUnit`, docs/rulings.md §48) for the real half,
and the rival's own Unit picked through the rng for the other half, exactly
mirroring how `discardRandomRival` already treats "the rival" as an
unpredictable agent whose hand/board is not the controller's to optimize
(§32).

## 77 — `kiroshi-optics`'s {Attack} effect is a scripted no-op, by design

"{Attack} Look at a friendly face-down Legend. (Don't reveal it.)" This
engine represents `GameState` with full visibility — every `CardInstance`
carries its real `defId` regardless of `faceUp` — because nothing downstream
(AI search, simulation, replay) needs a separate "what does player X
currently know" layer; `faceUp` only ever gates *game rules* (equip
legality, static effects, Call a Legend's random flip), never information
flow. A "look, don't reveal" effect has literally nothing to change under
that model: the looking player already has full read access to
`state.cards[uid].defId` regardless of this effect.

**Ruling:** encoded as `{ trigger: 'onAttack', effect: { kind: 'scripted',
name: 'kiroshi-optics' } }` whose script is the identity function
(`(_db, state, _ctx) => state`). This still exercises real machinery worth
proving: Kiroshi Optics is attached Gear, and `{Attack}` is one of the two
triggers Gear propagates from its host (§37) — the EffectDef's presence, and
the `effectResolved` event the interpreter logs after any scripted node
regardless of what it does, are what the real-card test asserts through the
host's attack, per the batch brief's explicit instruction for this card. A
bare `{ kind: 'sequence', effects: [] }` would satisfy "has effects" just as
emptily but would not name what the printed text is actually about, so the
named no-op script was chosen for legibility over a generic empty node.

## 78 — Deferred: `kerry-eurodyne-axe-attitude-audience` (needs a new trigger seam)

"When you roll in a Gig from your fixer area, you may ignore the result and
reroll it once. When you roll a min or max value on a Gig, draw 1. If it's
a d20, draw 3 instead." Both clauses hook into the **die roll itself** —
the start-of-turn `chooseGigDie` action's roll, and (for the first clause) a
brand-new "reroll it once" decision layered on top of that roll — not
anything the existing `rerollGig` node or any trigger seam exposes today.
Every existing trigger fires from a *resolved* action (a play, a call, an
attack, a defeat, a spend); nothing fires *during* the roll that produces a
Gig die's value, and there is no "may reroll the die you just rolled, once"
decision anywhere in the engine (`rerollGig` rerolls an *already-placed* Gig
Die chosen at random, per §32's still-open note, not the fixer roll that
seeds one).

**Ruling (scope):** left with `effects: []`, the only fully-deferred card in
this batch. Encoding it needs: (1) a new trigger fired from `game.ts`'s
gig-gain step, carrying the rolled value and die size; (2) a genuine player
decision ("ignore and reroll once") threaded through that same seam, which
is a new phase or action shape, not a vocabulary node; (3) a "min or max
face" condition reading the roll's own value against its die's size. None
of these piggyback on `stealGig`/`changeGig`/any existing condition the way
every other batch-3 card's text did — this is an engine gap in the same
family as §52's floating effects, and should be scoped and built once
rather than half-solved for one card.

## 79 — `cyberpsychosis`: fully deferred — a gameplay-affecting partial encoding is forbidden

"{Quick} Give an equipped Unit +3 power this turn for each of its equipped
Gears. If that Unit steals or fights, defeat it at the end of this turn."
The first sentence is an ordinary `buffPower` with the `perEquippedGear`
`DynamicAmount` (§59), targeting an equipped Unit. The second sentence is a
**delayed, conditional, one-shot effect**: it must remember, for the rest of
the current turn, that *this specific card instance* is now rigged to blow
up if it steals or fights *at any point before end of turn*, then act on
that memory at a turn boundary. Nothing in `GameState` tracks per-card
"something will happen to you later, conditionally" — this is exactly the
`floatingEffects` gap §52 already scoped and declined to half-solve for
`chrome-fang`/`appetite-for-destruction`.

**Original ruling (superseded below):** encode the `buffPower` clause on its
own `EffectDef` and leave the delayed self-destruct clause off, reasoning
that this was the same kind of partial encoding §60 already accepted for
`meredith-stout-stone-cold-corpo`'s "or swaps" gap.

**Fix round 1 (batch 3 review) — overturned, now standing policy for every
batch.** That reasoning does not hold here, and the distinction from
Meredith Stout matters: her missing "or swaps" half is a coverage gap in
*what triggers* an already-symmetric, purely upside ability (a rival
adjusting your Gig might also let you swap one, and today it can't — the
ability is never worse than printed, only sometimes silent when it could
have fired). `cyberpsychosis`'s printed design, by contrast, is a
**trade-off**: the +3-power-per-Gear buff is deliberately paired with "this
Unit dies at end of turn if it does anything with that power." Shipping
only the buff half makes the card a strictly-better, no-downside version of
its printed self — not a silent narrowing of *when* it helps, but an
actual rules change in the card's favour, with nothing in the data or the
UI marking that anything is missing.

**Ruling:** a card is either encoded faithfully **in full**, or **fully
deferred** (`effects: []`, reported, and given its own ruling) — never
partially encoded when the missing clause changes how the *encoded* clause
should be weighed by a player or an AI. This generalizes past this one card:
`cyberpsychosis` moves to `effects: []` in full, joins the `floatingEffects`
deferral list alongside `chrome-fang`/`appetite-for-destruction` (§52
updated to name it), and its test in `tests/cards/yellow.test.ts` becomes a
bookkeeping assertion (`effects` is empty) rather than a real-card test of
half a card. §60's `meredith-stout-stone-cold-corpo` precedent is **not**
overturned — a partial encoding is still acceptable when the missing half
is a separate, independently-triggered clause whose absence can only make
the card *less* good than printed, never more (§72 re-confirms this for
`alt-cunningham-mother-of-daemons`'s two independent clauses this same
review round). The dividing line is not "how much of the card is encoded"
but "does the gap change how the encoded part should be played around."

Building `floatingEffects` once would let this card's clause,
`chrome-fang`, `appetite-for-destruction` and §43's `gunpoint-diplomacy`
over-approximation all be finished together, per §52's own recommendation.

# Task 8 fix-round-1 rulings (batch 3 review)

The batch-3 review found two Important issues, both fixed above in place
(§52, §72, §73, §79) rather than appended as untouched-original-plus-patch —
this section is the single pointer to what changed and why, matching how
§67 documented the batch-2 review's fix.

## 80 — Summary: no gameplay-affecting partial encodings; "which Gear" is a real decision, not rng, when the action can carry one

1. **`cyberpsychosis` reverted from a partial to a full deferral (§79).**
   Batch 3 originally shipped only the card's power-buff clause and left the
   "if that Unit steals or fights, defeat it at end of turn" downside
   unencoded, reasoning by analogy to `meredith-stout-stone-cold-corpo`'s
   accepted "or swaps" gap (§60). The review rejected the analogy: Meredith's
   gap can only make her ability fire *less* than printed; cyberpsychosis's
   gap makes the card strictly *better* than printed (all upside, no
   downside), invisibly. **New standing policy, not scoped to this card:** a
   card is either encoded faithfully in full, or fully deferred
   (`effects: []`) — never partially encoded when the missing clause changes
   how the encoded clause should be weighed. `cyberpsychosis` now joins
   `chrome-fang`/`appetite-for-destruction` on the `floatingEffects`
   deferral list (§52). `alt-cunningham-mother-of-daemons`'s partial
   encoding (§72) was re-checked against this policy and found to be the
   safe, Meredith-shaped kind (its unencoded clause can only ever make the
   card weaker, never stronger, than printed) — it stays partially encoded.
2. **`heywood-ripperdoc` and `gilded-mato-n`'s "which Gear" became a real,
   enumerated target instead of an rng pick (§73).** Both fire from
   `onPlay`, whose action already carries a real `targets` array, and every
   candidate Gear exists on the board before the effect resolves — there
   was no technical reason for the original version to fall back to the rng
   here, unlike a genuine "the candidates only exist mid-resolution" case
   (`all-is-lost`, §48). `TargetSpec` gains `friendlyGear`/`anyGear` for
   this. `dum-dum-maelstrom-triggerman`'s Gear choice is the one of the
   three that stays rng-based, on a real distinction rather than
   inconsistency: it fires from `{Call}`, whose action cannot carry a
   pre-committed target because *which Legend flips* is itself decided by
   the rng inside the same action (§23) — there is no seam to attach a
   choice to before the outcome the choice would apply to is even known.
   This mirrors §45's already-accepted rule that a `{Call}`-triggered
   `chooseOne` picks its mode off the rng for the identical reason.

Both fixes are covered by updated tests in `tests/cards/yellow.test.ts`
(`cyberpsychosis` moved to the deferred-cards bookkeeping block;
`heywood-ripperdoc`/`gilded-mato-n` gained `legalActions`-enumeration
assertions plus both a pick-own and a pick-rival case for
`heywood-ripperdoc`) and by the full pre-existing suite staying green
throughout (`npm test`, `npx tsc --noEmit`, `npm run build`).

# Task 8 rulings, batch 4 (Yellow, 18 cards)

The last Yellow batch. Two of the eighteen are pure reminder/flavour text
(§81), one is fully deferred (§91, joining §52's `floatingEffects` list), and
the other fifteen needed nine vocabulary/engine extensions between them —
more engine surface than any earlier batch, because this batch's texts
repeatedly reach for shapes no earlier card needed: a static that restricts
the RIVAL's side rather than the printing card's own, a cost reduction that
discounts a DIFFERENT card being played, and a Gear's own printed text
needing to know which specific card its host *was* after the host has
already left the field.

## 81 — Two more vanilla/reminder-only cards, both with a direct precedent

- `mandibular-upgrade`: `"(Equip to a friendly Unit or face-up Legend.)\n{Blocker} (You may spend this Unit to redirect a rival Unit's attack to it instead.)"`.
  Byte-for-byte the same shape as `riot-shield` (already encoded, `effects: []`)
  — an equip reminder plus the {Blocker} keyword reminder, and nothing else.
  {Blocker} is already granted to the wearer by the existing
  `effectiveKeywords`/Gear machinery (§30), so there is no functional text
  left to encode.
- `secondhand-bombus`: `"{Blocker} (...)\n(Units with power 0 don't steal Gigs.)"`.
  The second line is a reminder of a rule the engine already implements:
  `combat.ts`'s `stealCount(power)` returns 0 for any non-positive power
  (docs/rulings.md §25), so a 0-power Unit already steals nothing — there is
  no card-specific behaviour to add.

Both stay `effects: []`, and `rockn-rockerboy` (`"Scream your throat raw for
something. Anything."`) joins `animals-wrecker`/`psycho-squad` as the third of
the schema doc's three `[Flavour]`-marker cards (§9) that is genuinely
vanilla — confirmed by checking `psycho-squad` (a Blue card not yet reached by
any batch) already sits at `effects: []` from Task 2's default, which happens
to also be its correct final value.

## 82 — `rivalCantAttackWhenPlayed`: a static that restricts the OPPOSING side

`maxtac-suppression-team`: "Rival Units can't attack the turn they're
played." Every static node before this batch (`cantAttack`,
`cantAttackGigArea`, `costReduction`, `winsFightVsKeyword`, ...) is read for
the card printing it (or a Gear's host, §29/§30) — never for the printing
card's RIVAL. This is the pool's first "shuts down something for the
OPPOSING side" static.

**Ruling:** a new static node, `{ kind: 'rivalCantAttackWhenPlayed' }`, read
by a new `query.ts` helper `rivalDeniesFreshAttacks(db, state, uid)` that
checks whether `uid`'s owner's OPPONENT has any in-play card carrying this
static. `combat.ts`'s `canAttack` consults it only in the branch that would
otherwise let {adrenaline} override Lag: a Unit with Lag and {adrenaline}
still cannot attack if the rival controls a `rivalCantAttackWhenPlayed`
source. This reads as "the {adrenaline} exception is switched off for the
rival," which is exactly what "can't attack the turn they're played" means —
a Unit with no Lag at all (already readied) is unaffected, matching every
other Unit's ordinary attack eligibility.

**Known, deliberately accepted gap.** A {go-solo} Legend enters the field
with `lag: false` from the start (its own printed rule, "it can attack this
turn," §31) rather than relying on the {adrenaline} exception to an existing
Lag — so `maxtac-suppression-team` does not, and cannot without tracking a
separate "entered the field this turn" flag on every card instance, stop a
rival's freshly-played Go Solo Legend from attacking. This under-delivers
(the card is weaker than a fully faithful reading, never stronger), which is
the safe direction under §79/§80's policy — the same shape as
`meredith-stout-stone-cold-corpo`'s accepted "or swaps" gap (§60), not
`cyberpsychosis`'s forbidden one. Building a general "played this turn"
per-instance flag, distinct from Lag, would close this gap but is not
justified for the one card in the pool that needs it.

## 83 — `fight-immune`: a granted-only keyword consulted inside `fight()`

`muamar-reyes-el-capitán`: "{Call} Choose one effect. A friendly Unit can't
be defeated in a fight this turn. // Draw 1." The "can't be defeated in a
fight" clause needs an until-end-of-turn immunity on a chosen Unit — the
grant itself is exactly what `grantKeyword` already does (§43), so no new
`EffectNode` is needed; only `fight()` needs to *honour* a new keyword.

**Ruling:** `combat.ts` gains an internal, never-printed keyword constant
`FIGHT_IMMUNE = 'fight-immune'`, mirroring `ATTACK_READY`'s precedent (§43) —
a real card's `grantKeyword` targets it, no card's printed `keywords` array
ever contains it. `fight()` computes the same would-be-defeated set as
before, then filters out any uid carrying `fight-immune` (via
`hasKeyword`/`effectiveKeywords`, so a granted keyword works exactly like a
printed one) before calling `defeatUnit` on what remains, and the
loser/`onWinFight` computation now reads the FILTERED set. Consequences:

- the fight still happens normally for the OTHER combatant — immunity saves
  only the specific Unit(s) carrying the keyword, never both sides of a tie
  automatically;
- a fight where the only "loser" was saved has no `onWinFight` firing at all,
  the same non-event §41's fix round already established for a
  `defeatShield`-saved loser — the Unit was never defeated, so nobody "won".

The card's `{Spend} Adjust a Gig by 1` half needs no new vocabulary at all:
`adjustOptions(1)` already produces exactly `[-1, 1]` (§39), the correct
sign-only decision for a fixed magnitude of 1, whether the text says "by 1"
or "by up to 1" — the two read identically when the magnitude can only ever
be 1.

## 84 — `stealerIsLegend` / `stolenDieValueParity`: two more `onFriendlyStealDie`-only facts

`rogue-amendiares-preem-solo`: "When a friendly Legend steals a Gig, if its
value is even, draw 1. If its value is odd, a Rival discards 1." Every
`onFriendlyStealDie` card before this one means "a friendly UNIT steals" —
this is the first that narrows the watched *stealer* by card type rather
than by "was it this specific card" (`selfIsStealer`, §61), and the first to
key off the stolen die's rolled *value* rather than its `size`
(`stolenDieSize`, §42).

**Ruling:** `ConditionContext` (and `EffectDef.condition`) gain
`stealerIsLegend?: boolean` and `stolenDieValueParity?: 'even' | 'odd'`, both
answered only by `combat.ts`'s `takeStolenGig` (the sole `onFriendlyStealDie`
firing site) — `stealerIsLegend` reads `db[cards[steal.attacker].defId].type
=== 'legend'`, and `stolenDieValue` (a new context field alongside the
existing `stolenDieSize`) is the die's own `.value` at the moment of the
steal, before it joins the thief's Gig area. Both are, like every other
watcher-only fact before them, unsatisfiable outside the steal that supplies
them — a def gated on either can never misfire from an unrelated context.

## 85 — `defeatedIsFriendly` / `defeatedWasEquipped`: narrowing the GLOBAL `onUnitDefeated` watcher to one side, plus an equip check

`river-ward-detective-on-the-hunt`: "When a friendly equipped Unit is
defeated, search the top 2 cards of your deck and trash 1." The pool's only
existing `onUnitDefeated` card (`yorinobu-arasaka-steel-dragon`) is bare —
"an ARASAKA Unit is defeated" — and per §60's bare-scope convention that
trigger broadcasts GLOBALLY, to both players. River Ward's text explicitly
says "a FRIENDLY equipped Unit," which the existing global broadcast cannot
express on its own: nothing told a watching card whose side the defeated
Unit belonged to, or whether it was carrying Gear.

**Ruling (reusing the global trigger, not adding a new one):**
`ConditionContext` gains `defeatedOwner?: PlayerId` and
`defeatedWasEquipped?: boolean`, both computed once in `combat.ts`'s
`defeatUnit` (`defeatedOwner` from the `controller` it already captures;
`defeatedWasEquipped` from the captured Gear list's length, both *before*
`leaveField` detaches anything) and passed into BOTH of the existing
`fireWatcherTrigger(..., 'onUnitDefeated', 0/1, ...)` calls — every watcher on
both sides now sees the same two facts, and decides for itself whether the
defeated Unit was "friendly" or "equipped". `EffectDef.condition` gains the
matching `defeatedIsFriendly?: boolean` (`context.defeatedOwner === player`)
and `defeatedWasEquipped?: boolean`. A brand-new single-sided trigger was
considered and rejected: it would duplicate `onUnitDefeated`'s entire firing
site for a distinction (friendly vs. global) that a plain condition already
expresses cleanly, and it would leave two near-identical triggers for future
batches to choose between.

## 86 — `scripted.filters`: a scripted node's declared targets can be narrowed too

Two batch-4 cards need a scripted node to reach a *specific kind* of card
inside a mixed zone, as a real, enumerated decision (not an rng pick, because
both fire from an action — `activated`/`onPlay` — that already carries a
committed `targets` array, docs/rulings.md §73's "which Gear is a real
decision when the firing action can carry one" precedent):

- `river-ward-detective-on-the-hunt`: "Play a Gear with cost 2 or less from
  your hand for free" — needs `friendlyHandCard` narrowed to `cardType:
  'gear', maxCost: 2`, plus a second, unfiltered slot for the equip host;
- `viktor-vektor-you-might-feel-a-little-pinch`: "Play a CYBERWARE Gear with
  cost 2 or less from your trash for free. Equip it only to another friendly
  Unit" — needs `friendlyTrashCard` narrowed to `cardType: 'gear', keyword:
  'cyberware', maxCost: 2`, plus `friendlyUnit` narrowed to `excludeSelf:
  true` for the host.

Before this batch, `{ kind: 'scripted', targets?: TargetSpec[] }` bound each
declared slot to its RAW `TargetSpec` candidate list with no way to narrow
it — §73 already flagged this as a known gap ("no card needs a *filtered*
scripted target yet"). Two cards in this one batch now do.

**Ruling:** `scripted` gains `filters?: TargetFilter[]`, positionally
parallel to `targets` — `filters[i]` narrows `targets[i]` through the exact
same `filterTargets` machinery every other node's `filter` already uses. A
shorter (or omitted) `filters` array leaves the corresponding slot(s)
unfiltered, matching every other node's optional `filter`. `effects.ts`'s
`slotSpecs`' `'scripted'` case now maps `node.filters?.[index]` alongside each
`spec`; no other machinery changes, because a `SlotSpec`'s `filter` field
already existed and `candidatesFor`/`filterTargets` already consult it — this
was purely a matter of a scripted node actually supplying one.

## 87 — `EffectCtx.context`: threading the firing `TriggerContext` into scripts, and `defeatedHostUid`

`the-relic-experimental-biochip`: "{Defeated} Play another Unit with cost 9
or less from your trash for free. Then, bottom-deck this Unit." Printed on a
**Gear** card. Per §37, a Gear's own `{Defeated}` text propagates from its
HOST being defeated — so "this Unit" here means the host, not the Gear
itself (a Gear is never a Unit). But by the time this fires, `leaveField` has
already moved the host to the trash and detached the Gear (§29) — the
Gear's own `ctx.sourceUid` is (correctly, per §33/§37) the Gear's own uid,
which carries no back-reference to whichever card it used to be attached to.
Nothing before this batch needed a Gear's own effect to name "the specific
card that was just defeated" as a target; every `self`/`chosen` reference in
the pool so far reads `ctx.sourceUid`/`ctx.chosen`, neither of which can
supply this.

**Ruling:** `TriggerContext` (`src/cards/effects.ts`) gains
`defeatedHostUid?: number`, populated only where `combat.ts`'s `defeatUnit`
fires a Gear's own `onDefeat` (`fireCardTrigger(db, draft, 'onDefeat',
gearUid, [], controller, { defeatedHostUid: uid })`, `uid` being the
just-defeated host, already in the trash by this point). More generally,
`EffectCtx` gains `context?: TriggerContext` — `applyEffectDefOnDraft` now
threads the `context` it already receives (previously consulted only by
`conditionMet` and then discarded) into the `ctx` it hands to `applyNode`, so
ANY `scripted` node can read a fact the firing trigger carried beyond
player/sourceUid/targets/chosen, not just this one card's `defeatedHostUid`.
This is additive and inert for every other card: no existing script reads
`ctx.context`, and `resolveEffect` (which calls with no `TriggerContext` at
all) simply leaves it `undefined`.

The script itself (`the-relic-experimental-biochip`) reads
`ctx.context?.defeatedHostUid`, no-ops if it is absent (a Gear defeated
directly rather than via a host — e.g. by `defeatGear`, §73 — has no
sensible "this Unit" and the printed text does not contemplate that path),
picks the retrieved Unit through the rng exactly like every other
onDefeat-triggered retrieval (no action-level target exists for `onDefeat`,
§32), and finally bottom-decks the host uid it was handed.

## 88 — "Search the top N ... act on some of them; the rest go back on top" — a pool-wide reading, from a sibling card's own clarification

Three more batch-4 cards "search" the top of the deck
(`river-ward-detective-on-the-hunt`'s second ability, `sketchy-ripper`,
`viktor-vektor-sit-down-and-relax`), joining `the-heist` (which mills without
looking first) and batch 3's `hanako-arasaka-in-a-gilded-cage`/scripted
precedent. Two of the three explicitly print "bottom-deck the rest"
(`sketchy-ripper`, `viktor-vektor-sit-down-and-relax`, the latter further
specifying "in a random order" — see below); `river-ward-detective-on-the-hunt`
prints only "search the top 2 cards of your deck and trash 1," with no
stated fate for the un-trashed card.

**Ruling:** absent an explicit "bottom-deck the rest," a searched-but-not-
acted-on card returns to the TOP of the deck, in the order encountered. This
is not invented: it is the plain reading of the sibling card
`tetratronic-rippler` (Blue, not yet reached by any batch but transcribed and
sitting in `data/cards.json` since Task 2), whose printed text for the
identical one-card shape spells out the alternative explicitly — "search the
top card of your deck. You may trash it. **(Otherwise, keep it on the top of
your deck.)**". Since the game's "search the top N" phrasing is otherwise
undocumented in the gameplay guide (grepped; no hits), a sibling card that
states its own default is the best evidence for what an unstated one means
for the same shape. `river-ward-detective-on-the-hunt`'s script therefore
returns its un-trashed card to the front of the deck array (`unshift`, the
`shift()`-based "top" convention every deck read in this codebase already
uses); `sketchy-ripper` and `viktor-vektor-sit-down-and-relax` push their
leftovers to the back (bottom) exactly as their own text says.

`viktor-vektor-sit-down-and-relax`'s "in a random order" is the one place
this batch needs an explicit shuffle rather than "as encountered" — its
script draws its leftover cards through `rng.ts`'s existing `shuffle` before
pushing them to the deck's bottom, the same primitive `reduce.ts`'s
`mulligan` already uses.

## 89 — `CostReduction.per: 'unitInTrash'`: a second, threshold-free cost-reduction shape

`trauma-team-operatives`: "Play this Unit for -1 €$ for each Unit in your
trash, to a minimum of 1 €$." Every `costReduction` before this counts Gig
dice at or above a printed threshold (`friendlyGigValueAtLeast`, §44); this
one counts a *card type* in a zone, with no threshold at all.

**Ruling:** `CostReduction` widens from a single shape to a discriminated
union on `per`: the original `{ per: 'friendlyGigValueAtLeast', value,
amount, minimum }` and a new `{ per: 'unitInTrash', amount, minimum }` (no
`value` — there is nothing to threshold). `query.ts`'s `reducedCost` gains a
mandatory `db: CardDb` parameter (needed only for the new branch, to tell a
Unit from any other card type in the trash) and branches on `reduction.per`;
`query.effectiveCardCost` and `effects.abilityEddieCost`/`canPayAbility` all
thread `db` through to it, since every one of their own call sites already
has `db` in scope (mechanical, not risky — confirmed by `npx tsc --noEmit`
and the full suite staying green before any card data changed).

## 90 — `firstMatchingPlayDiscount`: a cost reduction on a DIFFERENT card, from another card in play, once per turn

`viktor-vektor-drop-your-illusions`: "Play your first CYBERWARE Gear each
turn for -3 €$, to a minimum of 1 €$." Grepped pool-wide (`"your first"`) —
this is the ONLY card among the 141 with this shape: a discount that (a)
applies to a card OTHER than the one printing it, (b) is gated on a printed
*category* (card type + keyword) rather than the printing card's own
identity, and (c) is limited to the first qualifying play each game turn,
where "qualifying" depends on which card gets played, not on activating an
ability. §44's existing `costReduction`/`effectiveCardCost` design is
explicitly self-referential ("a card in hand is not 'in play', so this reads
the card definition's static defs directly instead of `activeStaticNodes`")
— it has no path for a card's OWN discount to come from a DIFFERENT,
already-in-play card's static.

**Ruling:** a new static node, `{ kind: 'firstMatchingPlayDiscount',
cardType, keyword, amount, minimum }`. `query.ts` gains
`firstMatchingPlayDiscountSources(db, state, player)`, enumerating every
such node currently active on `player`'s own field/face-up-Legends, WITH
provenance (`hostUid`, the node's own `index` in that host's `effects`
array) — deliberately not folded into the provenance-discarding
`activeStaticNodes`, because the once-per-turn bookkeeping below needs the
provenance back. `effectiveCardCost`'s signature changes from `(def, state,
player)` to `(db, state, player, uid)` (deriving `def` internally) so it can
also receive `db`, needed both for the new trash-counting `unitInTrash`
reduction (§89) and to look up `def.type`/`def.keywords` for THIS discount's
category match — every one of its six call sites (`legal.ts`,
`reduce.ts` ×2, `effects.ts` ×2, plus its own recursive self-discount loop)
already had a live `uid` in scope, so the signature change is mechanical.
For each matching source, `effectiveCardCost` discounts the price being
computed by `node.amount` (floored at `node.minimum`) UNLESS
`state.oncePerTurnUsed` already contains `` `${hostUid}:${index}` `` — the
exact key format `effects.ts`'s existing (now-exported-in-spirit-if-not-
in-name) `oncePerTurn` bookkeeping already uses for triggered/activated defs,
reused here for a STATIC def that never itself "fires."

**Marking the allowance used.** Since the discount is unconditional
whenever it is available (no "you may" — it is baked into the price), the
allowance is marked spent the moment a matching card is actually played,
in `effects.ts`'s `playCardOnDraft`, by calling the same (now more widely
reachable) `markOncePerTurn(draft, hostUid, index)` the ordinary
`oncePerTurn` path already uses — idempotent, so scanning every
`firstMatchingPlayDiscountSources` entry on every play and marking any
category match is always safe even when the allowance was already spent.
Because `effectiveCardCost` is a pure read consulted identically at
enumeration time (`legalActions`) and at validation time (`isLegal`), and
the mark only ever happens inside the one mutating path that actually plays
a card, the two can never disagree about what a given play costs.

**Scope check against the batch brief's deferral list.** This shape does not
match any of the three explicitly pre-scoped gaps (floating until-later
effects, a gig-roll trigger, a post-{Call} pending choice) — it is a plain,
continuously-active static, fully expressible by extending
`effectiveCardCost`'s inputs and reusing the existing once-per-turn
bookkeeping by key rather than by an `EffectDef.oncePerTurn` flag. Building
it cost six mechanical signature updates and one new node/helper, all
covered by the full pre-existing suite staying green (`npx tsc --noEmit`,
`npm test`, `npm run build`) before and after the card's own data/tests
landed — judged worth doing rather than deferring, unlike the batch's other
gap (§91), which needs a genuine new state/lifecycle feature no small
extension can supply.

## 91 — Deferred: `safety-override` (needs the `floatingEffects` gap, §52)

"{Quick} The next time a friendly Unit loses a fight this turn, defeat the
opposing rival Unit." This is precisely the shape §52 already scoped and
declined to half-solve for `chrome-fang`/`appetite-for-destruction`, and
which §79/§80 later made standing policy for: a delayed, conditional,
one-shot effect that must be remembered across an arbitrary number of future
actions until either it fires (the next qualifying fight, whichever friendly
Unit is involved and whichever rival Unit it happens to be fighting) or the
turn ends unused. Nothing in `GameState` tracks "something will happen later
this turn, conditionally, to whichever card triggers it" outside a specific
card instance the way `tempPower`/`tempKeywords`/`oncePerTurnUsed` track
per-instance or per-turn state — this needs the `floatingEffects` zone (an
`EffectDef` + controller + expiry + one-shot flag that `draftState` copies
and `fight()`/turn-boundary code consults) §52 already identified as a
genuine engine feature, not a vocabulary extension.

**Ruling (scope):** left with `effects: []`, `safety-override` joins
`chrome-fang`, `appetite-for-destruction` and `cyberpsychosis` on the
`floatingEffects` deferral list (§52, as updated by §79/§80). Its test in
`tests/cards/yellow.test.ts` is the same bookkeeping-only assertion those
three already use.

# Task 8 rulings, batch 5 (Green, 17 cards)

The first Green batch. Two cards print "Swap a friendly Gig with a rival
Gig" — the shape §60 flagged as a still-open gap in
`meredith-stout-stone-cold-corpo`'s "or swaps" wording, now closed. One card
(`jackie-welles-mama-s-favorite`) is fully deferred; the other sixteen needed
eleven vocabulary/engine extensions and three scripts.

## 92 — `swapGig`: two fixed-role die slots, closing §60's "or swaps" gap

`maxtac-av` ("{Play} You may swap a friendly Gig with a rival Gig.") and
`hanako-arasaka-daughter-of-the-emperor` ("{Spend} Swap a friendly Gig with a
rival Gig.") are the two cards §60 named as pending when it scoped
`onRivalAdjustFriendlyGig` to `changeGig` only.

**Ruling:** a new node, `{ kind: 'swapGig' }`, contributes two fixed-role
target slots (`friendlyGigDie` then `rivalGigDie`, reusing the existing
Gig-die `TargetSpec`s verbatim — no new spec needed since the two roles are
always "give up one of my own, take one of a Rival's", never a bare/either
choice). Resolution exchanges the two `GigDie` objects between the two
players' `gigArea` arrays in place (the whole die — size *and* value — moves,
unlike `changeGig`'s in-place value mutation), then fires
`onRivalAdjustFriendlyGig` on the RIVAL side (the die reached into), exactly
mirroring `changeGig`'s wiring — closing §60's gap for real, not just for the
one card that already existed then. `maxtac-av`'s "you may" is free and
auto-taken per §50; a missing die on either side (e.g. an empty Gig area)
simply drops that slot, so the whole swap fizzles (both `takeSlot` calls
still run to keep the cursor aligned, per the standing "consume the slot
either way" rule).

## 93 — "Value-pair of Gigs": a boolean condition and a dynamic amount, both counting pairs

`goro-takemura-vengeful-bodyguard` ("If you control a value-pair of Gigs,
also give it +1 power") and `hanako-arasaka-daughter-of-the-emperor` ("draw 1
for each friendly value-pair of Gigs") both need "two Gig dice sharing a
value" — a shape distinct from every existing Gig condition (`friendlyGigEvenAndOdd`
is a parity shape, `friendlyGigDistinctValuesAtLeast` counts *unique* values,
neither counts *duplicates*). Grepping the pool-wide `text` field for
"value-pair" turns up five more future cards (`meredith-stout-stone-cold-corpo`,
`peace-offering`, `pepe-najarro-working-doubles`, `sandayu-oda-hanako-s-guardian`),
confirming this is shared vocabulary, not a two-card one-off.

**Ruling:** a shared helper, `query.ts`'s `valuePairCount(state, player)`,
counts `⌊count/2⌋` for every distinct Gig value in `player`'s own Gig area
(three dice of the same value is one pair, not three) — feeding both:

- `EffectDef.condition.friendlyGigValuePair?: boolean` — true when the count
  is ≥1 (goro-takemura-vengeful-bodyguard);
- `DynamicAmount`'s new bare-string variant, `'friendlyGigValuePairCount'`,
  resolved by the existing `resolvePowerAmount` (hanako's `draw` count).

## 94 — `onStartTurn`: the mirror-image watcher of `onEndTurn`

`hanako-arasaka-daughter-of-the-emperor`: "At the start of your turn, draw 1
for each friendly value-pair of Gigs." §60 built `onEndTurn` from
`reduce.ts`'s `endTurn`; nothing yet fires an equivalent trigger from the
start-of-turn sequence.

**Ruling:** a new watcher trigger, `onStartTurn`, fired the same way
(`fireWatcherTrigger`) from a new `reduce.ts` helper, `startTurn(draft, db,
player, turnNumber)`, which wraps `game.ts`'s `beginTurn` and fires the
trigger immediately after — **in `reduce.ts`, not `game.ts`**, specifically
to avoid adding a new `game.ts -> cards/effects.ts` import-cycle direction;
`reduce.ts` already imports both modules for exactly this reason (`effects.ts`'s
own header already documents the existing `combat.ts`/`reduce.ts` ->
`effects.ts` cycle, and `game.ts` is deliberately kept out of it). `startTurn`
replaces the two existing `beginTurn(...)` call sites (`keepHand`'s first-turn
kickoff and `endTurn`'s hand-off) and skips firing if `beginTurn` itself
already ended the game (the 7-Gigs win check, or a start-of-turn deckout) —
the same `draft.winner !== null` guard every other trigger seam uses. It
fires before the Gig-gain decision (`chooseGigDie`), matching the guide's
"ready → draw → gain a gig" ordering read as "the turn's automatic part,
then the player's own actions."

## 95 — `onFriendlyBlock` (a watcher) and `conditionalEffect` (a gated child node)

`goro-takemura-vengeful-bodyguard`: "{Quick} 1 €$, {Spend} Give a friendly
Unit with cost 4 or less {Blocker} this turn. If you control a value-pair of
Gigs, also give it +1 power this turn. When a friendly Unit uses {Blocker},
you may discard 1. If you do, draw 1." Two new needs in one card:

- the second sentence is "when A FRIENDLY Unit blocks", a watcher — unlike
  the existing self-referential `onBlock` (fired only for the specific
  blocking card's own `EffectDef`s, per §41). **Ruling:** a new watcher
  trigger, `onFriendlyBlock`, fired from `combat.ts`'s `blockAttack` right
  alongside the existing `onBlock` self-fire, broadcast to every in-play card
  of the blocker's own controller (§42's template). "You may discard 1. If
  you do, draw 1." is the same target-slot-dependency shape §73 already
  forced into a script (no vocabulary node reads "did an earlier node's slot
  get filled") — scripted, with the card to discard picked through the rng
  (a watcher carries no player-supplied target, §32) and the draw following
  automatically from whether that pick found anything;
- the first sentence's "also give it +1 power" is conditional on a board fact
  (a value-pair), but must land on the **same** chosen Unit as the
  unconditional {Blocker} grant, ruling out splitting into two `EffectDef`s
  (§53's whole point for this exact card, cited there as motivation but not
  yet actually encoded). No existing node lets ONE child of a `sameTarget`
  resolve conditionally while a SIBLING child stays unconditional — an
  `EffectDef`-level `condition` would gate the {Blocker} grant too, which is
  wrong. **Ruling:** a new node, `{ kind: 'conditionalEffect', condition,
  effect }`, wraps a single child and only applies it while `condition` holds
  (checked via a new `query.ts` export, `conditionHolds`, factored out of
  `conditionMet`'s body so a bare `EffectCondition` — the type extracted from
  `EffectDef.condition` for exactly this reuse — can be checked without an
  enclosing `EffectDef`). It still consumes its child's slots whether or not
  the condition holds, the same "step over a fizzled construct's slots" rule
  `sameTarget` already established, so a sibling after it is never misaligned.

## 96 — `streetCredParity`: even/odd Street Cred as a condition

`field-operator` ("If your ☆ is an even number, draw 1") and
`pacifica-netrunner` ("If your ☆ is an even number, a rival Unit can't ready
until your next turn") both gate on the *parity* of Street Cred — a shape
none of §55's/§69's existing comparisons (`streetCredAtLeast`,
`streetCredAheadOfRival`, `streetCredBelow`, `streetCredDiffAtLeast`) can
express, and two cards in this one batch need it.

**Ruling:** `EffectDef.condition` gains `streetCredParity?: 'even' | 'odd'`,
a plain `streetCred(state, player) % 2 === 0` read.

## 97 — `allFriendlyLegendsFaceUp`: a plain board-read condition

`goro-takemura-losing-his-way`: "{Attack} If all friendly Legends are
face-up, this Unit has +5 power this turn." A one-card shape (no other pool
card checks "all", only "an ARASAKA Legend" style membership), but a plain
read over `state.players[player].legends`, following the exact shape of
every other condition field before it — no reason to script a single boolean
board fact.

**Ruling:** `EffectDef.condition` gains `allFriendlyLegendsFaceUp?: boolean`,
true when every uid in the controller's `legends` zone is face-up (vacuously
true with an empty zone — nothing left to be face-down).

## 98 — `sourceSpent` condition and `friendlyFaceUpLegend` target spec

`maxtac-squadron`: "At the end of your turn, if this Unit is spent, ready a
friendly face-up Legend." Two small gaps:

- "if **this Unit** is spent" reads the firing card's own readiness — no
  existing condition inspects `sourceUid` this way (`sourceEquipped`,
  §69, is the nearest precedent: same shape, different fact). **Ruling:**
  `EffectDef.condition` gains `sourceSpent?: boolean`, reading
  `!state.cards[sourceUid].ready`;
- "a friendly **face-up Legend**" as the ready target is not quite
  `friendlyUnitOrLegend` (which also includes the field) — this needs the
  legends zone alone. **Ruling:** `TargetSpec` gains `friendlyFaceUpLegend`,
  returning exactly the controller's face-up legends-zone uids (the same list
  `targets.ts`'s existing internal `faceUpLegendsOf` helper already computes
  for `friendlyUnitOrLegend`/`friendlyGear`, now exposed as its own spec).

## 99 — `skipNextReady`: a one-shot per-instance flag, generalizing §18's hardcoded penalty

`pacifica-netrunner`: "{Play} If your ☆ is an even number, a rival Unit can't
ready until your next turn." Read literally this spans an arbitrary number of
future actions (a `floatingEffects`-shaped gap, §52) — but unpacked against
the actual turn order it reduces to exactly ONE concrete event: the target's
own very next ready step (at the start of ITS owner's next turn, since ready
happens only on the owner's own turn and no other ready step falls inside the
"until your next turn" window). §18 already implements precisely this shape,
just hardcoded to two specific uids (the first player's opening two spent
Legends) rather than a general per-card flag.

**Ruling:** `CardInstance` gains `skipNextReady?: boolean`, and a new node,
`{ kind: 'skipNextReady'; target; filter? }`, sets it. `game.ts`'s
`readySpentCards` checks it right alongside the existing `penalised` set: a
flagged card's ready step is skipped once and the flag is cleared (never
re-armed) the moment it is consulted, so the very next skip is also the last.
This is deliberately NOT built on the `floatingEffects` machinery §52/§79/§91
reserved for *conditional, multi-action-window* delayed effects (the pending
list for those: `chrome-fang`, `appetite-for-destruction`, `cyberpsychosis`,
`safety-override`) — `skipNextReady` has no condition to re-check later and
no "whichever action triggers it" ambiguity, just one guaranteed future
event, so the one-shot flag already used for the opening-Legend penalty
suffices and is reused rather than duplicated.

## 100 — `attackGigAreaDespiteLag`: a narrower Lag exception than {adrenaline}

`nadia-fighting-through-grief`: "If a Rival controls more Gigs than you, this
Unit can attack their Gig area the turn it's played." Superficially close to
{adrenaline} ("can attack the turn it's played") but two ways narrower: (1)
conditional, live only while the printed comparison holds, and (2) scoped to
the Gig area alone — it must never unlock an attack on a rival Unit, which
{adrenaline} always would. Neither `grantKeywordWhile` (§68 ff., which only
ever widens {adrenaline}/{blocker}-shaped *keywords*, and {adrenaline} itself
grants full attack permission) nor any existing static fits.

**Ruling:** a new static node, `{ kind: 'attackGigAreaDespiteLag' }`, read by
a new `query.ts` helper, `canAttackGigAreaDespiteLag`, consulted by
`combat.ts`'s `attackActions` ONLY once the general `canAttack` has already
failed on Lag — never as an alternative to it, so a Unit with no Lag at all
is completely unaffected. `attackTargets` gained a `gigAreaOnly` parameter
that, when set, returns `['gigArea']` (or `[]` with an empty/forbidden Gig
area) instead of computing the ordinary Unit-inclusive target list, so this
exception can never leak into a rival-Unit attack. The printed "if a Rival
controls more Gigs than you" reuses the existing `rivalGigLeadAtLeast: 1`
condition verbatim (already the exact ">" comparison needed).

## 101 — `onLoseFight` and `fightFoe`: the mirror image of `onWinFight`, with a foe reference

`maelstrom-zealots`: "When this Unit loses a fight, defeat the opposing rival
Unit." §41 built `onWinFight` for the survivor of a fight; nothing fires for
the loser, and even if something did, "the opposing rival Unit" names a
specific card no existing `TargetSpec` can reach (it is not `self`, not
`chosen` — no enclosing `sameTarget` — and not a candidate list, since it is
a single, already-known card the instant the trigger fires).

**Rulings:**

- a new trigger, `onLoseFight`, fired from `combat.ts`'s `fight()` for every
  uid in the (fight-immune-filtered) `defeated` list, **before** either
  combatant is actually moved to the trash — so a retaliation this trigger
  causes (defeating the foe) safely pre-empts the main defeat loop's own
  `onField` guard for that same uid, exactly like an `onDefeat` effect from
  one casualty already removing the other (the existing comment right above
  the loop). It propagates from attached Gear alongside `onWinFight`
  (§37's "about the host acting" test);
- a new `TargetSpec`, `'fightFoe'`, is never enumerated (like `'chosen'`) —
  it reads a new `TriggerContext.fightFoeUid` field, threaded through
  `EffectCtx.context` exactly the way `defeatedHostUid` already is (§87),
  populated with "whichever of the two combatants isn't this uid." A tied
  fight (both sides in `defeated`) fires this for both, each naming the OTHER
  as its foe, which correctly resolves to a no-op defeat for whichever side
  a retaliation reaches after the other has already gone.

## 102 — `don-t-fear-the-reaper`: scripted mass-spend, then a real "which spent Unit" fizzle-to-rng

"Spend all rival Units. Then, defeat a spent Unit." The mass, unconditional
"spend all" half has no per-target decision, the same shape §74 already
scripted for `adam-smasher-metal-over-meat`'s mass defeat (different verb and
scope, but the same "no vocabulary node for an unconditional 'all'" reasoning
— and the exact card §74 named as the pool's other mass effect, now reached).
"A spent Unit" (bare, either side) is a real decision in principle, but
§57's residual note applies precisely here: splitting this into two
same-trigger `EffectDef`s (spend-all, then defeat-a-spent-Unit) would let a
freshly-spent rival Unit exist only *after* the first def resolves, while
`legalActions`' `onPlay` enumeration commits to a target tuple **before**
either def runs — exactly the "later def's candidate count depends on an
earlier def's zone mutation" gap §57 flagged as unresolved for `onPlay`/
`activated` triggers. Per that note's own recommended escape ("fold the
first def's effect into a scripted node instead"), the whole card is
scripted: the mass spend runs first, then a spent Unit (either side,
candidates that only stabilize once the mass spend has happened) is picked
through the rng, mirroring `all-is-lost`'s "candidates only exist
mid-resolution" precedent (§48).

## 103 — `overwatch-panam-s-gift`: a real discard target, an rng'd defeat gated on its cost

"{Quick} 1 €$, {Spend} Discard 1. Defeat a spent rival Unit with cost equal
to or less than the discarded card's cost." "The discarded card's cost" is a
numeric property of whatever the first clause chose, feeding a *filter* on
the second — the same "read a property of what a prior step touched" problem
§73 already forced into a script for `heywood-ripperdoc`'s "its cost" (no
vocabulary node carries a target's own field into a later filter).

**Ruling:** scripted, with `targets: ['friendlyHandCard']` declared for the
discard — a real, enumerated decision, since this activated ability's action
already commits to a `targets` array (§73/§80's "a real decision when the
firing action can carry one"). Which rival Unit to defeat afterward has no
filtered *scripted*-target support yet (§73 already flagged this exact gap,
still unclosed — no card needs it enough to justify extending `{ kind:
'scripted' }`'s `targets`/`filters` with a *cross-slot* dependency), so it is
picked through the rng among the candidates that satisfy the cost bound once
the discard's cost is actually known.

## 104 — `fool-on-the-hill`: scripted, the rival's choice resolved off the rng

"Reveal the top 2 cards of your deck. A Rival chooses whether you add them to
your hand or trash them. If you trash them, draw 2." No other pool card
reveals a specific top-N zone and then hands an UNCONDITIONAL choice to the
Rival over what happens to it (contrast `chooseOne`'s `'rivalIfBehindStreetCred'`
and `'allUnlessBehindStreetCred'` choosers, both of which are conditional on
Street Cred) — a one-card shape, and the two revealed cards only exist once
the deck has actually been looked at (mid-resolution), so per §48 this is
scripted rather than grown into a `chooseOne` chooser variant nobody else
needs. The Rival's decision is never the controller's to enumerate (§45's
standing rule for a private rival choice), so it resolves off the rng exactly
like every other unenumerable rival decision in the pool. "If you trash them,
draw 2" carries no "may", so that branch's draw is a genuine required draw
that can end the game on an empty deck (§17/§36), unlike `shattered-memories`'s
optional "may draw 5" (§65).

## 105 — Deferred: `jackie-welles-mama-s-favorite` (needs a "would be defeated" interception point)

"{Go Solo} ... If a friendly Unit would be defeated, you may spend 1 €$ to
defeat this Legend instead. (Remove it from the game.)" This is the direct
structural mirror of §72's deferred second clause on
`alt-cunningham-mother-of-daemons` ("When a rival Unit would steal a Gig, you
may discard 1 ... the Gig isn't stolen"): both need a genuine interception
decision point BEFORE a mutation (there, a steal; here, a defeat) actually
happens, where the answering player may pay an optional cost to redirect or
cancel it. `defeatUnit` is called synchronously from many unrelated sites
(fights, on-play/on-defeat effect nodes, mass-defeat scripts) with no
existing seam for "pause here, offer the controller a pay-to-redirect
choice, then continue" — unlike `defeatShield` (§46), which is unconditional
and costless and so needs no *decision* at all, only a static substitution.
Building that seam generically (who answers, what it costs, how declining it
differs from an unconditional shield) is a genuine engine feature, not a
vocabulary extension, and — unlike `alt-cunningham-mother-of-daemons`, whose
FIRST clause (`onFriendlyEquippedSpend` → draw 1) is an independent,
unconditionally-encodable upside — this card's entire functional text IS the
gap: there is no other clause to keep. §79/§80's "full or defer" policy
therefore applies with nothing left on the "full" side.

**Ruling (scope):** left with `effects: []`. Its {Go Solo} keyword is still
fully live (handled entirely by the existing keyword/legends-zone machinery,
no card data required — the same "vanilla except for the reminder" shape as
`goro-takemura-hands-unclean`). Its test in `tests/cards/green.test.ts` is
the same bookkeeping-only assertion the `floatingEffects` deferrals use,
though this gap is a different engine feature (a would-be-mutation
interception point, not a delayed/floating effect) and is not added to the
§52 list, which is specifically about effects that outlive their own
resolution across a turn boundary — this one is a same-instant redirect
missing only its decision seam.
