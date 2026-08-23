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
  (`el-sombrero-n-la-venganza-lenta`: "this Unit gains power equal to a
  friendly max Gig this turn"), read off the board at resolution time. An
  empty Gig area reads 0. **Citation corrected in the deferred slice
  (§141 ff.):** this bullet originally also named
  `sasha-yakovleva-won-t-let-you-down` as a `'friendlyMaxGig'` user, from a
  batch-1 guess at her text. Her printed line is "This Unit gains power equal
  to **that card's cost**" — the card her own {Attack} just revealed — which
  §139 encodes as a `scripted` node reading that specific card's printed
  cost, not a Gig-die reading at all. `el-sombrero-n-la-venganza-lenta` is
  the only `'friendlyMaxGig'` card in the pool.

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

**IMPLEMENTED (deferred slice, docs/rulings.md §141).** `GameState.floatingEffects`
exists, and every card on this list is encoded in full: `chrome-fang`,
`appetite-for-destruction`, `cyberpsychosis`, `safety-override`,
`reboot-optics` (§140) and `chrome-reverie`'s attack-denial clause (§132). The
two over-approximations this ruling also mentions (§43's `gunpoint-diplomacy`,
and the "next time" wording in `gorilla-arms` /
`jackie-welles-pour-one-out-for-me`) are deliberately left alone — see §141's
"out of scope" note.

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

**IMPLEMENTED (deferred slice, §144).** Clause 2 is now a
`stealInterceptByDiscard` static, answered at a real interception point in
`takeStolenGig` via the roll-back-and-replay seam §144 describes. The card is
encoded in full.

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

**IMPLEMENTED (deferred slice, §143).** All three pieces exist: the `onGigRoll`
watcher trigger, the `gigReroll` phase carrying the "you may ignore the result
and reroll it once" decision, and the
`rolledExtremeValue`/`rolledDieSizeAnyOf` conditions. The card is encoded in
full.

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

**IMPLEMENTED (deferred slice, §141).** `cyberpsychosis` is encoded in full:
the `buffPower` clause and the delayed `defeatIfActed` self-destruct share one
`sameTarget` slot, so "that Unit" is provably the Unit that was buffed. The
full-or-defer POLICY this ruling established stands unchanged — it simply has
no cards left to apply to.

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

**IMPLEMENTED (deferred slice, §141).** A one-shot `loseFightDefeatFoe` floating
entry, consumed by the first fight a friendly Unit loses. The card is encoded
in full, and its bookkeeping-only test is replaced by two real ones.

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

**IMPLEMENTED (deferred slice, §144).** The interception point exists — a
roll-back-and-replay seam in `defeatUnit` that every defeat path funnels
through — and the card is encoded in full as a single `defeatInterceptSelf`
static. This ruling's reading of the problem was exactly right; what it
assumed impossible (asking mid-mutation without capturing a continuation)
turned out to be reachable by discarding the draft and replaying the action
with the answer in hand.

# Task 8 batch 5 fix round 1

## 106 — `canAttackGigAreaDespiteLag` must respect `rivalCantAttackWhenPlayed` too, plus an audit of every other fresh-attack path

Batch review caught an interaction defect: §100's `attackGigAreaDespiteLag`
(`nadia-fighting-through-grief`) is a Lag EXCEPTION for a fresh attack —
structurally the same shape as {adrenaline} — but `canAttackGigAreaDespiteLag`
never consulted `rivalDeniesFreshAttacks` (§82's `maxtac-suppression-team`
denial), unlike `combat.ts`'s `canAttack`, which does for the {adrenaline}
branch. A freshly-played Nadia, behind on Gigs, could still attack the rival
Gig area against an opposing `maxtac-suppression-team` — the printed "Rival
Units can't attack the turn they're played" states no carve-out, so this was
a real fidelity bug, not a judgment call.

**Ruling (fix):** `canAttackGigAreaDespiteLag` (`src/engine/query.ts`) now
ends with `return !rivalDeniesFreshAttacks(db, state, uid)`, mirroring
`canAttack`'s own final line exactly. Proven with a failing-test-first cycle:
`tests/cards/green.test.ts`'s new case (fresh Nadia, behind on Gigs, an
opposing `maxtac-suppression-team` in play) was verified to fail against the
pre-fix code (reverting the query.ts patch and re-running reproduced exactly
the reported bug — an `attack`/`gigArea` action offered when it must not be)
before the fix landed it green; the two existing Nadia tests (gig-area
attack offered with no `maxtac-suppression-team` present; no attack at all
when not behind on Gigs) are unaffected, confirming the fix is additive.

**Audit: every other path that lets a card attack despite Lag.** Grepped
every site that ever sets `lag` to `false` outside the ordinary
start-of-turn ready step (`resetTurnState`, which clears Lag for the ACTIVE
player's own cards at their own turn start — not a "fresh attack" exception
at all, since Lag is simply gone by then) and every `hasKeyword`/static
check `combat.ts`'s `canAttack`/`attackTargets` consult:

1. **{adrenaline} keyword** (printed, Gear-granted per §30, or
   `grantKeyword`-granted per §43, including the two scripts that grant it —
   `yorinobu-arasaka-steel-dragon`, `johnny-silverhand-rocking-renegade`, and
   the vocabulary card `johnny-silverhand-rocking-renegade`'s sibling grants)
   — already gated by `rivalDeniesFreshAttacks` inside `canAttack` itself,
   confirmed unaffected by this fix round;
2. **`attackGigAreaDespiteLag`** (§92 ff.) — the bug above, now fixed;
3. **{go-solo} Legends entering the field with `lag: false`** from the start
   (`effects.ts`'s `playCardOnDraft`, the Legend case) — "it can attack this
   turn" is the printed rule (§31), and this Unit never has Lag to except in
   the first place, so it skipped `canAttack`'s Lag branch entirely (`if
   (!card.lag) return true`) without ever reaching the {adrenaline}/denial
   check. Originally left open here, citing §82's acceptance of exactly this
   gap — **overturned in fix round 2 below**, on controller instruction: the
   gap is not acceptable, because `maxtac-suppression-team`'s own printed
   text is precisely the card that justifies closing it, and {go-solo}
   Legends are common, high-power "attack the turn played" threats
   (`adam-smasher-metal-over-meat`, `goro-takemura-hands-unclean`,
   `royce-*`, `v-streetkid`, `rogue-*`, `jackie-welles-mama-s-favorite`
   once its deferred clause lands) — not an edge case §79/§80's
   "under-delivering is safe" policy should shelter.

No other fresh-attack permission path exists in the codebase as of batch 5 —
`ATTACK_READY`/`attackableReadyKeyword` (§43/§58) widen the *target list* for
an already-attack-eligible Unit and are orthogonal to the Lag question
entirely, so they were not in scope for this audit.

## Fix round 2 (controller-directed) — {go-solo} must respect the fresh-attack denial too

The batch-5 §106 audit above found the {go-solo} gap and, following §82's
prior acceptance, left it open. **Overturned:** the controller ruled this
unacceptable — `maxtac-suppression-team` ("Rival Units can't attack the turn
they're played") denies ANY Unit played this turn, and a Legend played via
{go-solo} is, from that moment, a Unit on the field that was played this
turn; nothing in the printed text carves out Units that skip Lag to get
there. §82's "no card justifies building this" reasoning does not survive
contact with `maxtac-suppression-team` itself being exactly that card, and
{go-solo} Legends are a mainstream "fresh attacker" shape across the pool
(§105's list), not a rare interaction.

**Ruling:** `CardInstance` gains `playedThisTurn?: boolean` — the "entered
the field this turn" flag §82/§106 already identified as the missing
primitive, kept deliberately separate from `lag` because {go-solo}'s whole
point is skipping Lag ("it can attack this turn," §31), so Lag cannot double
as this signal. It is:

- **set** on every field entry that represents a card being played: the two
  branches of `effects.ts`'s `playCardOnDraft` (a Unit; a {go-solo} Legend)
  and the two scripts that place a card directly onto the field
  (`yorinobu-arasaka-steel-dragon`, `the-relic-experimental-biochip`) —
  matching exactly the four `p.field.push(...)` call sites in the codebase;
- **cleared** at precisely the same turn boundary Lag clears
  (`game.ts`'s `resetTurnState`, for the owner's own next turn), and on any
  field exit (`combat.ts`'s `leaveField`, alongside the other per-tenure
  resets) so a card that leaves and is later replayed gets a fresh flag;
- **never part of the card-data zod schema** — it is instance/runtime state
  (like `lag`, `ready`, `skipNextReady`), not something `data/cards.json`
  ever carries, so `cardDb.ts`'s schemas are untouched.

`combat.ts`'s `canAttack` is restructured so the fresh-attack denial is
consulted on BOTH paths that let an attack through despite normally-required
Lag, rather than special-casing "no Lag" as an unconditional pass:

```ts
if (card.lag) {
  if (!hasKeyword(db, state, uid, ADRENALINE)) return false
  return !rivalDeniesFreshAttacks(db, state, uid)
}
if (card.playedThisTurn === true) {
  return !rivalDeniesFreshAttacks(db, state, uid)
}
return true
```

A Unit with Lag and no exception is still blocked before either denial
check runs (unchanged); a Unit with no Lag that also was NOT played this
turn (the ordinary "already on the field, fully readied" case) hits the
final `return true` and is completely unaffected — the denial only ever
reaches a genuinely fresh attacker. `nadia-fighting-through-grief`'s own
`canAttackGigAreaDespiteLag` (§100/§106) is unchanged by this round: her
card is never {go-solo}, so `lag` and `playedThisTurn` are always in
lockstep for her, and the round-1 fix already covers her case correctly.

**TDD evidence:** extended `tests/cards/green.test.ts`'s
`goro-takemura-hands-unclean` block (already a {go-solo} card in this
batch) with a new case — flip the Legend face-up, field an opposing
`maxtac-suppression-team`, Go Solo it: asserts `playedThisTurn` is `true`
and NO `attack` action is offered this turn, then runs a full turn cycle
(`endBothTurnsOnce`) and asserts `playedThisTurn` is back to `false` and an
`attack` action IS now offered. The existing "vanilla Go Solo" test was
extended (not replaced) to also assert an `attack` action is offered the
turn it's played when no denial is in play, so both sides of §82's original
`without maxtac it attacks the turn played` intent stay covered. Verified
failing-first: reverse-applied this round's patch (`git apply -R`) and
re-ran just the new case — failed with `expected undefined to be true` on
the `playedThisTurn` assertion (the field did not exist yet), confirming
the test actually exercises the new code; re-applied and re-ran green.

**CardInstance exact-equality audit (controller-requested).** Grepped every
test file for a `toEqual`/`toStrictEqual` assertion against a *whole*
`CardInstance` object (as opposed to one of its properties, e.g.
`.attachedGear`/`.tempKeywords`/`.ready`, which are pervasive and
unaffected by adding an optional field). Found none — every
`CardInstance`-shaped object literal in the test suite (`tests/engine/
combat.test.ts`'s `putUnit`/`attachGear`, `tests/cards/fixtures.ts`'s
`instance`, etc.) is a *construction* fed into `state.cards[uid]`, never the
*expected* side of an equality assertion, so an optional field neither of
them sets is simply absent from both sides and `toEqual` never sees a
mismatch. No test needed updating; the full pre-existing suite (465 tests
going into this round, after §106's round-1 fix) stayed green throughout,
with zero snapshot changes.

**Verification:** `npx tsc --noEmit` clean, `npm test` 466/466 (the
existing suite plus the round-1 and round-2 additions), `npm run build`
clean, purity grep (`Math.random`/`Date.now`) clean on every touched file.

## Task 8 batch 6 (Green, 2/2) — docs/rulings.md §107 ff.

## 107 — `matchGig`: "set a Gig's value to the value of another Gig"

`padre-man-of-the-cross` ("{Spend} Set a player's Gig to the same value as
another player's Gig") and `peace-offering` ("You may set a Gig's value to
the value of another Gig...") both print a mechanic no earlier card needed:
copying one Gig die's rolled *value* onto another, rather than adjusting one
die by a signed amount (`changeGig`, §39) or exchanging two dice wholesale
(`swapGig`, §92). Both cards phrase it as bare "a Gig"/"another Gig" (no
"friendly"/"rival" qualifier), matching §39's bare-scope convention.

**Ruling:** a new node, `{ kind: 'matchGig' }`, with two fixed-order
`anyGigDie` slots — the die being overwritten, then the die being read from
— copying the second's `value` onto the first, clamped to `[1, size]`
exactly like `changeGig`'s "by up to N" (a die that cannot hold the copied
value takes the closest it can). Fires `onRivalAdjustFriendlyGig` on the
overwritten die's actual owner when that differs from the effect's
controller, mirroring `changeGig`/`swapGig`.

Both slots draw from the *same* `anyGigDie` index space, so nothing stops a
player from picking the same die for both ("another" not being mechanically
enforced) — a documented simplification: doing so is simply a no-op pick
among the enumerated options, never a way to see or force an otherwise
unreachable outcome, and no card in the pool ever needed a "distinct from
slot 1" constraint before. `peace-offering` chains a second `onPlay`
`EffectDef` gated on `condition.friendlyGigValuePair` (already existing,
§92 ff.) for its "then, if you control a value-pair, draw 1"; `padre`'s
`{Spend}` ability is the node on its own, with no chained condition.

## 108 — `panam-palmer-nomad-cavalry`: `selfGear`, `unequipped`, and a
mass-ready static

"2 €$, {Spend} Move a Gear from this Legend to an unequipped friendly Unit.
If you do, ready that Unit. At the end of your turn, if 5 or more friendly
Units and/or Legends are equipped, ready them."

Three new pieces:

- **`selfGear`** (`TargetSpec`): "a Gear from THIS Legend" — the Gear
  attached to the source card itself, never any other friendly Unit or
  Legend's Gear (unlike `friendlyGear`, §73, which gathers every friendly
  Gear regardless of host). `targetsFor`'s case is a one-liner:
  `state.cards[sourceUid]?.attachedGear`.
- **`TargetFilter.unequipped`**: "an UNEQUIPPED friendly Unit" — the mirror
  image of `sourceEquipped`/`defeatedWasEquipped` (both existing
  conditions), but as a target filter: `attachedGear.length === 0`.
- **`EffectCondition.friendlyEquippedCountAtLeast`**: "if 5 or more friendly
  Units and/or Legends are equipped" — counts the controller's own field
  Units plus face-up Legends with `attachedGear.length > 0`.

Both "which Gear" (`selfGear`) and "which Unit" (`friendlyUnit`, filtered
`unequipped`) are real, declared target slots on a `scripted` node
(docs/rulings.md §48) — this activated ability's action already carries a
committed `targets` array, so neither decision is left to the rng. "If you
do, ready that Unit" needs no separate gate: both slots are real decisions,
so the ability is either fully legal (both fillable, and the move — plus
the ready — happens) or not offered at all; there is no partial-move case
to condition on.

The second clause — "ready THEM" (every currently-equipped friendly Unit and
Legend, not a chosen one) — has no per-target decision at all once the
printed count gate is met, so it is a second, unconditional-once-gated
`scripted` node, the same "mass effect, no target slot" shape as
`adam-smasher-metal-over-meat`'s "Defeat all other Units" (§68 ff.), applied
to readying instead of defeating and to a filtered subset (equipped only)
instead of everything.

## 109 — `freeLegendCall`: a static that zeroes the Call-a-Legend cost

`panam-palmer-strength-through-family`: "During your turn, you may Call a
Legend for free." Unlike every earlier "free Call" card in the pool
(`t-bug-amateur-philosopher`, `arasaka-emergency-radioport`,
`dum-dum-maelstrom-triggerman`), which grant a ONE-SHOT free Call tied to a
specific trigger firing (§77-ish precedent, scripted), this is a STANDING
modifier to the ordinary Call-a-Legend action itself, live for the whole of
the controller's own turn, with no triggering event at all.

**Ruling:** a new static node, `{ kind: 'freeLegendCall' }`, gated by the
already-existing `duringOwnTurn` condition (§55 ff.) rather than any new
condition field. `query.ts` gains `friendlyLegendCallFree(db, state,
player)`, consulting the player's own active static nodes exactly like
`rivalDeniesFreshAttacks`'s sibling functions.

This required a genuine plumbing change, not just a new node: Call-a-Legend's
cost was a bare constant (`economy.ts`'s `CALL_A_LEGEND_COST = 1`) consulted
in four places (`legendCallPayment`, and three `canPayWith` call sites in
`reduce.ts`'s `isLegal` / `combat.ts`'s react window). A new
`legendCallCost(db, state, player)` in `economy.ts` (zero while
`friendlyLegendCallFree` holds, else the printed 1 €$) replaces the constant
everywhere it mattered for *validating* a payment; `legendCallPayment` itself
now takes `db` too, so both `legalActions`' enumeration and `isLegal`'s
independent re-derivation agree. `economy.ts` importing from `query.ts` is a
new one-directional edge (`query.ts` never imports `economy.ts`), so no
cycle.

The card's second clause — "{Attack} Discard 1. If you do, draw 1 for each
friendly face-up Legend" — is scripted for the same "if you do" dependency
§102/§103 already forced into a script: the bonus draw's size only makes
sense once the discard (a real, declared `friendlyHandCard` target) is known
to have actually happened.

## 110 — `goSoloTax`: a static that costs the OPPOSING side's {Go Solo}

`riot-shield`: "Rivals must pay +2 €$ to use {Go Solo}." The mirror image of
`rivalCantAttackWhenPlayed` (§82) — a restriction that lives on one card but
reads from the OPPOSING side of whoever controls it, rather than the
printing card's own side.

**Ruling:** `{ kind: 'goSoloTax'; amount: number }`, consulted by a new
`query.rivalGoSoloTax(db, state, player)` exactly like
`rivalDeniesFreshAttacks`'s shape (walk `player`'s rival's in-play cards,
sum any `goSoloTax` static's `amount`). Two call sites needed the tax added
on top of the ordinary printed/reduced cost:

- `effects.goSoloPayment` (the {Go Solo} play's own canonical-payment
  builder, consulted by `legalActions`);
- `reduce.ts`'s `isLegal` for `playCard`, which independently re-derives the
  cost of *any* supplied payment rather than trusting the canonical one —
  this is the one this batch's audit actually caught: without this fix, a
  Legend played Go Solo against an active `riot-shield` could be validated
  at the UN-taxed cost, letting a payment 2 €$ short of the real price
  through `isLegal`, even though `legalActions` itself would never have
  *offered* that underpaid tuple. Exactly the class of drift §106's audit
  was watching for, just on the cost side instead of the attack-legality
  side.

## 111 — `attackPowerBonus`: "... have +N power while attacking"

`saburo-arasaka-stubborn-patriarch` ("Friendly ARASAKA Units have +1 power
while attacking") and `saul-bright-stormrider` ("Other friendly Units have
+2 power while attacking") both print a power bonus that only exists for the
duration of the boosted Unit's OWN attack — never a permanent or even a
until-end-of-turn `effectivePower` change, and never keyed to the FOE's type
(unlike `powerVsCardType`/`fightPowerBonus`, §56, which is "+N while
fighting a [card type]"). Whether the boosted Unit is fighting or stealing
from an unblocked Gig-area attack, the bonus applies either way — "while
attacking" is broader than "while fighting."

**Ruling:** `{ kind: 'attackPowerBonus'; amount: number; keyword?: string;
excludeSelf?: boolean }`, a static read by a new `query.attackPowerBonus(db,
state, uid)` — walks `uid`'s OWN controller's in-play cards for active
`attackPowerBonus` statics, matching `keyword` against `cardTags` (not
`hasKeyword`/`TargetFilter.keyword`, which is role-tags-only against
`def.keywords` — §66 already flagged this gap: a card whose only ARASAKA tag
lives in `faction`, like `saburo` and every ARASAKA Unit with no second
faction tag, would silently never match a `hasKeyword`-based check) and
`excludeSelf` against the printing card's own uid (`saul-bright-stormrider`
excludes itself: "OTHER friendly Units").

Consulted only by `combat.ts`'s `fight()` (added to the ATTACKER's side only,
never the defender's — the bonus is never about defending) and
`resolveAttack()`'s Gig-steal power calculation, exactly the same
"fight-only, never general `effectivePower`" placement as `fightPowerBonus`
(§56) — there is no "currently attacking" fact outside an attack actually in
progress, so folding this into `effectivePower` would be observable (and
wrong) outside combat.

## 112 — `attackUnitDespiteLag`: the mirror image of `attackGigAreaDespiteLag`

`sandayu-oda-hanako-s-guardian`: "This Unit can attack rival Units the turn
it's played." §100 already built `attackGigAreaDespiteLag` for "can attack
their Gig area the turn it's played" (nadia-fighting-through-grief) — a Lag
exception narrower than {adrenaline} that unlocks ONLY the Gig area. This
card needs the exact opposite narrowing: unlocks ONLY a rival Unit target,
never the Gig area.

**Ruling:** `{ kind: 'attackUnitDespiteLag' }`, read by a new
`query.canAttackUnitDespiteLag`, byte-for-byte `canAttackGigAreaDespiteLag`'s
structure (ready + Lag + the static active + not vetoed by
`rivalDeniesFreshAttacks`) but gating on the new node kind.
`combat.ts`'s `attackTargets` gains a second boolean parameter (`unitOnly`,
alongside the existing `gigAreaOnly`) that short-circuits BEFORE the Gig-area
push rather than replacing the whole target list, so both "only Gig area"
and "only rival Units" share the same ready-Unit-filtering logic
`attackTargets` already had. `attackActions` tries `full`, then
`gigAreaOnly`, then `unitOnly`, in that order — at most one narrowing is ever
live for the same attacker on the same turn (a fresh Unit either has Lag or
it doesn't).

## 113 — `equipHostUid`: threading a Gear's own host through `fireWatcherTrigger`

`sandevistan`: "At the end of your turn, ready this Unit or Legend." Printed
on Gear, and — unlike every EARLIER Gear trigger in the pool — "this Unit"
means the HOST, not the Gear card itself. Every prior Gear ability either
needed no target at all (`satori-sword-of-saburo`'s "draw 1",
`gorilla-arms`'s self-referential steal condition) or read a fact rather
than acting on a card uid. `'self'` on a Gear's OWN `EffectDef` resolves to
the Gear's own uid (`ctx.sourceUid` is whatever `fireCardTrigger`/
`fireWatcherTrigger` was called with for THAT def) — readying the Gear card
itself would be a silent no-op, since nothing anywhere reads a Gear
instance's own `ready` flag.

**Ruling:** `TriggerContext.equipHostUid` (mirroring `defeatedHostUid`, §87)
— the uid of the Unit/Legend wearing the Gear, threaded through whenever
`fireWatcherTrigger` fires a trigger for an attached Gear rather than the
watching card itself:

```ts
const hostContext = host === uid ? context : { ...context, equipHostUid: uid }
fireCardTrigger(db, draft, trigger, host, [], player, hostContext)
```

`sandevistan` is a fully `scripted` node (no declared targets) reading
`ctx.context?.equipHostUid` directly, the same "read a context fact rather
than declare a target slot" shape as `wraith-marauders` (§117 below) and
`the-relic-experimental-biochip` (§87) — not a generic `TargetSpec`, because
the fact is specific to ONE trigger-firing seam
(`fireWatcherTrigger`), not a board zone any card could enumerate.
`fireTriggerOnDraft`'s OTHER propagation path (`GEAR_PROPAGATED_TRIGGERS` —
{Attack}/{Defeated}/{Block}/{onWinFight}/{onSpend}/{onLoseFight}) is left
untouched: no card in the pool needs "this Unit" on one of THOSE Gear
triggers to mean the host rather than a target the propagated trigger
already carries or auto-picks.

## 114 — `buffFightPower`: a temporary, fight-only power buff on a chosen target

`synapse-burnout`: "{Quick} A friendly Unit has +1 power for each friendly
face-up Legend while fighting rival Units this turn." Combines three things
no earlier card needed together: a chosen target (not the printing card
itself), a temporary ("this turn") duration, and a FIGHT-ONLY scope (never
folded into `effectivePower`, like `attackPowerBonus`/`fightPowerBonus`
above/§56) — "while fighting rival Units" is, for combat purposes, simply
"while fighting" (every fight is against a card on the opposing side of
whoever is fighting, so no extra "is the foe a rival" check is needed).

**Ruling:** a new `CardInstance` field, `fightPowerBonusThisTurn?: number`
— the fight-only sibling of `tempPower` (a general, always-counted delta)
— cleared to 0 alongside `tempPower`/`tempKeywords` in `clearTurnBuffs`
(same until-end-of-game-turn lifetime, §20). A new `EffectNode`,
`{ kind: 'buffFightPower'; amount: number | DynamicAmount; target:
TargetSpec; filter?: TargetFilter }`, resolves like `buffPower` but adds to
`fightPowerBonusThisTurn` instead of `tempPower`. `query.fightPowerBonus`
(§56) now reads `state.cards[uid].fightPowerBonusThisTurn` as its starting
value before adding any `powerVsCardType` static bonus, so `combat.ts`'s
`fight()` (the bonus's only consumer) picks up both sources uniformly.

A new `DynamicAmount`, `'friendlyFaceUpLegendCount'`, answers "+1 power for
each friendly face-up Legend" (also reused by
`panam-palmer-strength-through-family`'s "draw 1 for each friendly face-up
Legend" inside its script, §109) — a plain count of the amount's own
player's face-up Legends, resolved the same way `friendlyGigValuePairCount`
(§92 ff.) is.

## 115 — `stealReduction`: "steals 1 fewer Gig this turn"

`take-control`: "{Quick} A rival Unit steals 1 fewer Gig this turn. If that
Unit is an AI, DRONE, or VEHICLE, draw 1." No earlier card reduces a Unit's
OWN future steal count — every existing Gig-count effect either changes a
die's value (`changeGig`/`matchGig`/`swapGig`) or the number of dice an
ALREADY-RESOLVING steal takes (`stealGig.count`, an effect's own steal, not
a debuff on a future one).

**Ruling:** a new `CardInstance` field, `stealReduction?: number`, cleared
to 0 alongside `tempPower` in `clearTurnBuffs` (same turn lifetime). Read
only by `combat.ts`'s `resolveAttack()`, the attack-driven Gig-area steal:
`count = min(max(0, stealCount(power) - reduction), gigArea.length)`.
**Scope decision:** this reduction is NOT also applied to an
effect-driven `stealGig` node's count — "a rival Unit steals" most
naturally reads as the combat steal (the overwhelmingly common, and only
printed, way any card "steals a Gig" through an attack), and no card in the
pool combines a targeted `stealReduction` debuff with an effect-driven
`stealGig` from the SAME debuffed card in a way that would expose the gap;
documented here as a deliberate, narrower-than-literal reading rather than a
silent omission.

Both halves of the printed sentence act on the SAME chosen Unit — "if THAT
Unit is..." reads a property (its own `cardTags`) of whichever card the
first half's real, declared `rivalUnit` target turned out to be — the same
"read a property of what a prior step touched" shape §73 already forced
into a script for `heywood-ripperdoc`'s "its cost", so the whole card is one
`scripted` node with one declared target.

## 116 — `TargetFilter.spentOnly`: bare "a spent Unit"

`wild-in-the-streets`: "Defeat a spent Unit." Bare (no "friendly"/"rival"
qualifier, either side), and — unlike `don-t-fear-the-reaper`'s "defeat a
spent Unit" (§102), which only becomes meaningful mid-resolution after a
mass-spend the SAME card just performed — this card's candidates (whichever
Units are ALREADY spent, on either side) are fully known before the card
even resolves. A real, enumerable decision belongs on the ordinary
target-slot machinery, not the rng.

**Ruling:** `TargetFilter.spentOnly?: boolean` — narrows a candidate list to
`!ready`, applied to the existing bare `anyUnit` `TargetSpec`:
`{ kind: 'defeat', target: 'anyUnit', filter: { spentOnly: true } }`.

## 117 — `wraith-marauders`: reading `stolenDieValue` without a new `TargetFilter`

"When this Unit steals a Gig, ready another friendly Unit with power equal
to the Gig's value." `onFriendlyStealDie` already carries
`context.stolenDieValue` (§81 ff.) for its CONDITION vocabulary, but
`TargetFilter` has no way to compare a card's power against a *runtime*
context value — every existing `TargetFilter` field compares against either
a printed constant or a plain board read (`weakerThanAFriendlyUnit`,
`maxPowerVsFriendlyD20`), never something carried by the firing
`TriggerContext`. Threading `context` all the way through
`candidatesFor`/`fillableSlots`/`bindSlots` for the sake of one filter that
only one card needs — and which can NEVER be a real, action-carried decision
anyway, since `onFriendlyStealDie` (like every non-`onPlay` trigger) offers
no player-facing target slot at all (§32) — would be a disproportionate
plumbing change for zero behavioural gain over the alternative.

**Ruling:** fully `scripted`, no declared targets. The script reads
`ctx.context?.stolenDieValue` directly (already on `EffectCtx.context` for
every scripted node, no new threading needed) and searches
`state.players[ctx.player].field` for a power-matching candidate itself,
falling back to the rng exactly like every other trigger-context-only
target (`v-roamer-of-the-badlands`, §48). `excludeSelf`-equivalent filtering
("ANOTHER friendly Unit") is a plain `uid !== ctx.sourceUid` check inside the
script, mirroring the generic filter's own semantics without needing the
generic machinery.

## 118 — "Ready/spend up to N" with no printed tie-breaker: `pickN`'s rng convention

Three cards in this batch print "affect up to N of a zone" where N can be
smaller than the zone's size, and nothing on the card names *which* ones
when more than N qualify: `pepe-najarro-working-doubles` ("ready up to 2
MERC Legends"), `saul-bright-stormrider` ("ready up to 3 friendly Units"),
and `sandayu-oda-hanako-s-guardian` ("Spend a rival Unit for each friendly
value-pair of Gigs" — a *dynamic* count, but the same "which N of the
eligible pool" gap once the rival controls more Units than the count owes).
No earlier card in the pool combined "N might be less than the eligible
pool" with "no filter distinguishes them" for a *board* zone (as opposed to
a *mid-resolution reveal*, where `viktor-vektor-sit-down-and-relax`'s
"reveal up to 2 Gears... picked via rng" — §81 ff. — already set the "act on
all if ≤N, else N at random" precedent).

Building genuine "choose exactly N distinct, without replacement" target
slots would need the target-slot machinery to know, when enumerating slot
*i*'s candidates, which uids slots `1..i-1` of the SAME node already
consumed — a real feature, but one no card before this batch needed, and
adding it for three "no printed tie-breaker" cards would be scope
disproportionate to the actual decision it protects (none: every "up to N"
effect in this batch is purely beneficial to the caster or purely
detrimental to a rival's undifferentiated Units — readying/spending A vs. B
when both are otherwise interchangeable is not a choice any of these
printed texts asks the player to make).

**Ruling:** `scripted/index.ts` gains `pickN(state, items, n)`: returns
every item if the pool holds `n` or fewer, otherwise `n` of them chosen
uniformly at random (splice-based, exactly `viktor-vektor-sit-down-and-
relax`'s existing loop, extracted into a shared helper). All three cards'
scripts call it and ready/spend the returned set — deterministic (and
correct per the printed text) whenever the pool is small enough to make the
"up to N" cap vacuous, rng-resolved only in the genuinely oversubscribed
case, which the printed text itself never distinguishes.

## 119 — `CostReduction.per: 'friendlyFaceUpLegend'`: a third flat-count variant

`zetatech-berserk`: "Play this Gear for -1 €$ for each friendly face-up
Legend, to a minimum of 1 €$." §89 already added a second `CostReduction`
variant (`unitInTrash`) alongside the original `friendlyGigValueAtLeast`
because it had no `value` threshold, just a flat count. This card's count
(face-up Legends) is a different board fact from either existing variant,
so it is a third sibling: `{ per: 'friendlyFaceUpLegend'; amount: number;
minimum: number }`, handled by `reducedCost`'s existing `if/else if/else`
chain (now three-way) the same way the other two are.

## Task 8 batch 6 summary

**Cards:** `padre-man-of-the-cross`, `panam-palmer-nomad-cavalry`,
`panam-palmer-strength-through-family`, `peace-offering`,
`pepe-najarro-working-doubles`, `riding-nomad`, `riot-shield`,
`saburo-arasaka-stubborn-patriarch`, `sandayu-oda-hanako-s-guardian`,
`sandevistan`, `saul-bright-stormrider`, `synapse-burnout`, `take-control`,
`valentino-street-racer`, `wild-in-the-streets`, `wraith-marauders`,
`zetatech-berserk`. All 17 fully encoded — no deferrals.

**Vocabulary extensions:** `matchGig`, `freeLegendCall`, `goSoloTax`,
`attackPowerBonus`, `attackUnitDespiteLag`, `buffFightPower` (`EffectNode`);
`selfGear` (`TargetSpec`); `unequipped`, `spentOnly` (`TargetFilter`);
`friendlyEquippedCountAtLeast` (`EffectCondition`);
`friendlyFaceUpLegendCount` (`DynamicAmount`); `friendlyFaceUpLegend`
(`CostReduction.per`); `fightPowerBonusThisTurn`, `stealReduction`
(`CardInstance`); `equipHostUid` (`TriggerContext`).

**Engine-side fixes surfaced by this batch's audit (both riot-shield's
`goSoloTax` and panam-palmer-strength-through-family's `freeLegendCall`
needed cost-validation call sites updated, not just the enumeration side):**
`reduce.ts`'s `isLegal` for `playCard` (a {Go Solo} Legend play) now adds
`rivalGoSoloTax`; its two `callLegend`/`react callLegend` cost checks now
call `economy.legendCallCost` instead of the bare `CALL_A_LEGEND_COST`
constant. Same "the enumeration path and the independent validation path
must read the same effective cost" class of gap §106's audit flagged for
the attack-legality side.

**Verification:** `npx tsc --noEmit` clean, `npm test` 492/492 (466
pre-existing + 26 new), `npm run build` clean, purity grep
(`Math.random`/`Date.now`) clean on every touched file.

# Task 8 rulings, batch 7 (Blue, 17 cards)

The first Blue batch. Fifteen of the seventeen are encoded in full; two
(`chrome-reverie`, `evelyn-parker-beautiful-enigma`) are *partially* encoded
under the safe, Meredith-Stout-shaped exception §60/§72/§80 already
established (the omitted clause is a separate, independently-triggered piece
whose absence can only make the card weaker than printed, never stronger) —
see §132.

## 120 — `onFriendlyCardPlayed`: a watcher for "when you play a [color/type/
keyword] card"

`jackie-welles-pour-one-out-for-me` ("The first time you play a Blue Unit or
Blue Gear each turn, ...") and `judy-a-lvarez-braindance-maestro` ("When you
play a BRAINDANCE Program, ...") both watch *any* card the controller plays,
narrowed by a printed color/type/keyword — no earlier trigger reads a played
card's own color at all, and every earlier "watch a play" fact
(`firstMatchingPlayDiscount`) was a cost STATIC, not a trigger.

**Rulings:**

- `Trigger` gains `onFriendlyCardPlayed`, fired from `playCardOnDraft` via
  `fireWatcherTrigger` right after the played card's own `onPlay` resolves,
  broadcasting to every in-play card of the player who just played (the
  ordinary watcher shape, §42/§60/§72/§92 ff.) — including a Legend, a Gear,
  or a Program (which is never itself a "watcher" recipient, since it never
  sits in `field`/`legends`, but it is still the SUBJECT of the broadcast);
- the firing context carries the played card's own `CardDef.color`,
  `CardDef.type` and `cardTags` (role/faction tags), read once at the
  `playCardOnDraft` call site (which already has `db`/`def` in scope) rather
  than re-derived inside `conditionHolds`;
- `EffectCondition` gains three matching fields: `playedCardColor`,
  `playedCardType`, `playedCardKeyword` (checked against the new
  `ConditionContext.playedCardColor`/`playedCardType`/`playedCardTags`,
  mirroring `attackerKeyword`/`attackerTags`'s existing shape exactly);
- "Blue Unit **or** Blue Gear" is not a single OR-condition but two sibling
  `EffectDef`s (one per `playedCardType`) sharing one `oncePerTurn` +
  `onceKey` allowance (§67) — the established way to encode "the first
  time X or Y happens each turn" as one compound event without inventing a
  list-valued `playedCardType`. `jackie-welles-pour-one-out-for-me` uses
  exactly this two-variant/shared-`onceKey` shape, once per variant.

**Fix round 1 (docs/rulings.md §133): superseded in part.** The paragraph
below (as originally written) went on to describe
`jackie-welles-pour-one-out-for-me`'s "if it becomes a min Gig" clause as a
SECOND pair of `EffectDef`s reading a board-wide condition after the
decrease resolved. That shape is wrong — see §133 — and the card now
resolves both the decrease and the "did it become a min Gig" check inside
ONE scripted node per variant (still sharing the two-variant/`onceKey`
mechanism above, which is unaffected).

## 121 — "a min Gig" is `friendlyGigValueEquals: 1` — no new vocabulary

`chrome-reverie` ("If you control a min Gig, ...") and
`jackie-welles-pour-one-out-for-me` ("If it becomes a min Gig, ...") are the
first two cards to print "min Gig," alongside the already-landed "max Gig"
(§39's `'friendlyMaxGig'` `DynamicAmount`, reading the *highest currently
showing* value, not "a die literally at its printed maximum face").

**Ruling:** every Gig die's rolled value ranges `[1, size]` (`GigDie.value`,
`types.ts`) — there is no die-specific "minimum face" distinct from 1, since
every die type in the pool numbers its faces from 1. So "a min Gig" reads
as "a friendly Gig die currently showing 1," which is *exactly* the shape
`friendlyGigEvenAndOdd`'s neighbour `friendlyGigValueEquals` already covers
(§68 ff., "if [a fixed number] equals the value of a friendly Gig") for a
BARE "if you control a min Gig" check (`chrome-reverie`) — no new condition
field, just the literal value `1`. This part of the reading is unaffected
by §133's fix.

**Fix round 1 (docs/rulings.md §133): the paragraph originally here claimed
`jackie-welles-pour-one-out-for-me`'s ANAPHORIC "if **it** becomes a min
Gig" was confirmed by, and encoded as, the SAME board-wide
`friendlyGigValueEquals: 1` check — reading "any friendly Gig is at 1,"
not "the specific die THIS effect just touched is at 1." That is wrong: a
board with Gigs `[1, 5]`, decreasing the 5 to 3, would incorrectly draw
under a board-wide check, because the OTHER (untouched) die still sits at
1 — "it" in the printed text refers to the die the SAME sentence just
named, not the board in general. The threshold (`value === 1`) is still
right; only the SUBJECT being checked was wrong for the anaphoric case.
See §133 for the corrected encoding (a scripted node with its own
`friendlyGigDie` target slot, so the same die is decreased and checked).

## 122 — `readyEddies`: a fungible, no-target "ready N Eddie(s)" node

Four Blue cards print "ready N Eddie(s)": `delamain-cab`, `dying-night-v-s-
pistol`, `evelyn-parker-beautiful-enigma`, `misty-olszewski-mender-of-broken-
spirits`. No earlier card readied anything from the Eddies zone
specifically (only Gig dice, cards, or "1 €$" cost reductions).

**Ruling:** `EffectNode` gains `{ kind: 'readyEddies'; count: number }`. No
target slot: `economy.ts`'s own comment establishes every ready Eddie or
Legend is worth exactly 1 €$ regardless of which specific card it is, so
*which* spent Eddie becomes ready first is not a printed decision the way
*which* Gig die to touch is (§39) — `effects.readyFriendlyEddies` picks
deterministically in zone order (the first `count` not-yet-ready cards in
`player.eddies`), exported so the two scripted cards needing the identical
effect inside a larger script (`dying-night-v-s-pistol`'s "if named V,"
`misty-olszewski-...`'s three `chooseOne` modes) share it rather than
reimplementing the loop.

## 123 — `sourceStoleGigThisTurn`: a per-instance "stole a Gig this turn" flag

`delamain-cab`: "At the end of your turn, if this Unit stole a Gig this
turn, ready 1 Eddie." No existing state tracks *which specific card*
performed a steal this turn — `GameEvent.gigStolen` only carries the
victim's `PlayerId`, not the thief's uid, and `ConditionContext.stealerUid`
only exists inside an `onFriendlyStealDie` firing, not at an unrelated
later `onEndTurn`.

**Ruling:** `CardInstance` gains `stoleGigThisTurn?: boolean`, set in
`combat.ts`'s `takeStolenGig` for `steal.attacker` (the card that actually
did the stealing — attack- or effect-driven alike, since `stealGig`'s own
`pendingSteal` construction already names its controller as `attacker`, per
§32) the moment a die changes hands, and cleared alongside `tempPower` in
`clearTurnBuffs` — the same until-end-of-game-turn lifetime, read by the new
`EffectCondition.sourceStoleGigThisTurn` (checked against the SOURCE card's
own instance, mirroring `sourceEquipped`/`sourceSpent`'s existing pattern).
`reduce.ts`'s `endTurn` already fires the `onEndTurn` watcher *before*
`clearTurnBuffs` runs (§55 ff.), so the flag is still `true` when a card
that stole this turn checks it, and reset immediately after for the next
turn.

## 124 — `friendlyProgramNotPlayedThisTurn`: the first condition needing the
FALSE branch of a per-turn flag

`jacked-in-voodoo-boy`: "This Unit can't attack unless you played a Program
this turn." Every earlier boolean `EffectCondition` field gates on being
`true` (`sourceEquipped === true`, `allFriendlyLegendsFaceUp === true`,
etc.); this is the first "**unless**" — the static restriction is active
exactly when the fact is FALSE.

**Rulings:**

- `PlayerState` gains `playedProgramThisTurn?: boolean`, set in
  `effects.playCardOnDraft`'s existing `case 'program':` branch (true for
  both a main-phase play and a `{Quick}` reaction, since both route through
  the same function) and cleared in `game.ts`'s `resetTurnState` for the
  OWNER only — the identical own-turn-only scope as `soldThisTurn`, because
  "you played a Program this turn" is asked only during the controller's own
  turn (attacking never happens on the rival's turn), so any stray
  `{Quick}`-Program play during the rival's preceding turn is already wiped
  by the time the controller's own turn (and any attack) begins;
- rather than generalize every existing boolean field to a "match this
  declared value" comparison (touching fields no card needs inverted),
  `EffectCondition` gains a field NAMED for the negated fact —
  `friendlyProgramNotPlayedThisTurn?: boolean` — so the existing `=== true`
  check style stays uniform across the whole condition object;
- the static reads `{ trigger: 'static', condition: {
  friendlyProgramNotPlayedThisTurn: true }, effect: { kind: 'cantAttack' } }`
  — `cantAttack`'s existing consultation path (`query.cantAttack` ->
  `activeStaticNodes` -> per-def `conditionMet`) already gates a static node
  on its own `condition` for every other card, so no new consultation seam
  is needed, only the new field.

## 125 — `stealerKeywordAnyOf`: an OR of tags on the *stealing* card

`evelyn-parker-beautiful-enigma`: "When a friendly CORPO or GANGER Unit
steals 1 or more Gigs, ready 1 Eddie." `onFriendlyStealDie` already reads
`context.stealerUid` (§55 ff., `selfIsStealer`) but nothing yet reads the
STEALER's own tags — the closest sibling, `attackerKeyword`, checks a single
string against `onFriendlyAttack`'s `attackerTags`.

**Rulings:**

- `ConditionContext` gains `stealerTags?: string[]`, populated once in
  `combat.ts`'s `takeStolenGig` via the same `cardTags(def)` helper
  `onFriendlyAttack`'s firing already uses, passed alongside the existing
  `stealerUid`/`stealerIsLegend`/`stolenDieValue` facts on the same
  `fireWatcherTrigger('onFriendlyStealDie', ...)` call;
- `EffectCondition` gains `stealerKeywordAnyOf?: string[]` rather than a
  singular `stealerKeyword` — "CORPO **or** GANGER" is a genuine OR across
  two tags a single card could (if the pool ever prints one) carry BOTH of,
  and a single-string field would need two sibling `EffectDef`s (§120's
  Blue-Unit-or-Blue-Gear shape) that could double-fire — readying 2 Eddies
  instead of 1 — for a hypothetical CORPO-and-GANGER Unit's steal, which the
  printed "or" plainly does not intend. No card in the 141-card pool
  currently carries both tags (checked), but the array shape costs nothing
  extra and closes the gap outright rather than leaving it latent;
- ~~"steals 1 or more Gigs" fires the watcher **once per die stolen**...~~
  **Fix round 1 (docs/rulings.md §133): overturned.** The controller
  ruling is that this fires ONCE per completed steal EPISODE (however
  many dice it takes), not once per die — "steals 1 or more Gigs" names
  the whole steal action/effect resolving, not each die inside it. The
  original reasoning above (treating "1 or more" as evidence for per-die
  firing) does not survive scrutiny: it is equally consistent with "the
  episode counts as one event regardless of size," and a 2-die steal
  readying 2 Eddies is a real, visible over-count a player would notice.
  See §133 for the new `onFriendlyStealComplete` trigger this card now
  uses instead of `onFriendlyStealDie`.

## 126 — `lowestPower`: "a Rival's lowest-power Unit... choose 1"

`les-e-le-mens`: "Bottom-deck a Rival's lowest-power Unit. (If there are
multiple, choose 1.)" No existing `TargetFilter` narrows a zone to its own
extremal member — `weakerThanAFriendlyUnit` compares against a DIFFERENT
zone's best, and `maxPowerVsFriendlyD20`/`maxPowerIfAheadOnStreetCred` are
printed caps, not "the zone's own minimum."

**Ruling:** `TargetFilter` gains `lowestPower?: boolean`. `targets.ts`'s
`filterTargets` computes the minimum `effectivePower` over the RAW candidate
list (before this filter's own narrowing — there is nothing else on this
card's filter to interact with, but this is the same "read once per filter
call, not per candidate" discipline `weakerThanAFriendlyUnit`/
`maxPowerIfAheadOnStreetCred` already follow) and keeps only ties at that
minimum. The printed "(If there are multiple, choose 1)" is exactly what
this produces: `bottomDeck`'s ordinary target-slot machinery offers one
legal `playCard` entry per tied candidate, a real enumerated decision, never
an rng pick, matching every other explicit "choose 1" in the pool.

## 127 — `friendlyHandOrTrashProgram`: the Program sibling §63 already
anticipated

`lizzy-wizzy-delicate-weapon`: "{Play} You may play a Program with cost 3 or
less from your hand or trash for free. Bottom-deck it after you play it."
§63 built `friendlyHandOrTrashUnit` for `yorinobu-arasaka-steel-dragon` and
explicitly named this card as the "hand-or-trash Program" sibling it was
deferring to a later batch.

**Ruling:** `TargetSpec` gains `friendlyHandOrTrashProgram` — the identical
shape, type baked into the spec's own name (§63's reasoning: a mixed
hand+trash zone holds every card type, so a generic filter would not
promise "a Program" the way the spec's name does). The card is encoded with
the established `sameTarget` + scripted-child shape (§63/§53): the
`sameTarget`'s own slot is the real "which Program" decision (filtered
`maxCost: 3`), and the scripted child reads `ctx.chosen` to move it onto the
field for free — unlike `yorinobu`'s script, this one bottom-decks
afterward instead of granting {adrenaline}, since the printed text has no
"it can attack" clause. The trailing bare `{Blocker}` line needs no
`EffectDef` at all — it duplicates the printed `keywords` entry, the same
`meredith-stout-stone-cold-corpo` precedent the schema doc's Keyword
vocabulary section already establishes.

## 128 — `alt-cunningham-soulkiller-architect`: a NESTED, non-free "play from
trash" cost

"1 €$, {Spend} Play a Program from your trash. Bottom-deck it after you
play it. (You still pay its cost.)" Every earlier "play X for free" script
(`the-heist`, `yorinobu-arasaka-steel-dragon`, `river-ward-detective-on-the-
hunt:free-gear`, `lizzy-wizzy-delicate-weapon` above) explicitly waives the
played card's own cost. This card's parenthetical is the pool's only
explicit reminder that the SECOND cost still applies on top of the
ability's own.

**Ruling:** since `legal.ts`'s `canonicalPayment` already settles "which
cards actually pay a cost" deterministically for every ordinary play — no
card in this engine ever exposes "which Eddie/Legend pays" as a player
decision, because every one is fungibly worth 1 €$ (`economy.ts`'s own
comment) — the SAME function is reachable, and correct, from inside a
script: `alt-cunningham-soulkiller-architect`'s scripted node prices the
chosen trash Program with `effectiveCardCost`, settles it with
`canonicalPayment`, and only proceeds (firing the Program's own `onPlay`,
then bottom-decking instead of the ordinary post-play trash fate) if that
payment exists. `activateAbilityOnDraft` has already paid Alt's OWN 1 €$ +
self-spend before this script runs, so the two payments are genuinely
independent — if the trash Program turns out to be unaffordable once Alt's
own cost is already spent, the activation is simply wasted, no different in
kind from any other activated ability whose printed payoff depends on a
board state the player misjudged. "Which Program" is the one real,
declared target (`friendlyTrashCard`, filtered `cardType: 'program'`).

## 129 — Two more `onEndTurn`/`{Spend}` scripts on the established
"reveal-then-branch" and "named host" shapes

- `dying-night-v-s-pistol`'s second clause ("if this Unit is named 'V', ready
  2 Eddies") reuses `sandevistan`'s `equipHostUid` seam (§107 ff.) to read
  the WEARER's own `CardDef.name` directly — a static fact needing no new
  per-instance state, unlike the ready-2-Eddies half (§122);
- `judy-a-lvarez-nothing-to-doubt`'s "{Spend} Reveal the top card of your
  deck. You may play it for free. Otherwise, add it to your hand." mirrors
  `playCardOnDraft`'s own per-type entry sequence (Unit -> field with Lag,
  Gear -> equips to an rng-picked host with a hand fallback exactly like
  `the-heist`'s §48 precedent, Program -> resolves then trashes) rather than
  becoming vocabulary, since no other card needs this exact "the revealed
  card's own type decides the entry point" shape;
- `judy-a-lvarez-braindance-maestro`'s `{Spend}` ability ("Trash the top
  card of your deck. If it's a Program, you may add it to your hand.")
  needs "it" to name the SPECIFIC card just trashed, the same "read a
  property of what a prior step touched" shape §73 already forced into a
  script for `heywood-ripperdoc`'s "its cost."

## 130 — `maman-brigitte-spirit-of-death`: fully scripted to avoid a 3-slot,
unfillable-middle shape (superseded by §133 — see below)

**Fix round 1 (docs/rulings.md §133): this ruling is superseded.** The
original text (below, struck through in spirit) treated "you may discard 2
Programs" as an auto-take per §50, on the theory that it has "no cost or
drawback" the way a Gear/self-defeat "you may" does. The batch review
correctly rejected that: discarding 2 of the controller's OWN hand cards
*is* a cost, and §50's own dividing line says a costed option is a real
decision, not an auto-take — "Where an optional clause ever becomes a real
dilemma, it should become a `chooseOne` with a do-nothing mode." §133
re-encodes this as exactly that, keeping the part of the reasoning below
that remains true (the bottom-deck target still stays rng-picked, for the
"3+ slots, unfillable middle" reason described here).

~~"{Play} You may discard 2 Programs. If you do, bottom-deck a rival
unequipped Unit." Declaring "which 2 Programs" as two real target slots
plus "which rival Unit" as a third would put an inherently-sometimes-
unfillable pair of slots in the MIDDLE of the def's slot list whenever fewer
than 2 Programs are in hand — exactly the shape this batch's own brief
flags to avoid, since a later real slot (the bottom-deck target) would need
to still enumerate correctly whether or not the earlier pair bound.
Following §57's residual-risk note and §102/§103's "if you do" precedent,
this stays fully scripted: "which 2 Programs" and "which rival Unit" are
both picked through the rng (`pickN`/`pick`), since the printed text
distinguishes neither, and the discard step is auto-taken whenever ≥2
Programs are in hand (docs/rulings.md §50) — declined only when the hand
does not hold enough, never a real yes/no dilemma.~~

## 131 — `misty-olszewski-mender-of-broken-spirits`: a `chooseOne` mode
picked off the rng at a WATCHER trigger

"At the end of your turn, choose a card type. Then, reveal the top card of
your deck. If it's the chosen type, add it to your hand and ready 1 Eddie.
Otherwise, trash it." "Choose a card type" reads as a genuine 3-way
decision, and `chooseOne` is exactly the vocabulary for that — but
`onEndTurn` is a WATCHER trigger (§55 ff.), broadcast via
`fireWatcherTrigger` with an always-empty `targets` array, the same as every
other watcher. §45 already established that "a `chooseOne` reached from a
trigger that carries no player choice ({Call}) picks its mode off the rng";
the identical reasoning applies here for the identical reason — there is no
per-card action a player commits to when their turn ends that could carry a
pre-chosen mode for potentially several different watching cards at once.
**Misty's "choose a card type" is therefore rng-picked, not a real
decision**, an accepted, precedented outcome rather than a shortcut: the
`chooseOne`'s three modes (one scripted closure per card type, sharing a
`mistyReveal(cardType)` factory) are otherwise ordinary. The static "This
Unit can't attack" clause is unrelated and unconditional (`cantAttack`).

## 132 — Two safe partial encodings: `chrome-reverie`, `evelyn-parker-
beautiful-enigma`

Both cards print two independent clauses; one clause of each needs a
capability nothing in the pool has built, and — per §60/§72/§80's standing
test — omitting it can only ever make the encoded card WEAKER than printed,
never stronger, so both stay partially encoded rather than fully deferred:

- `chrome-reverie`: "**A rival Unit can't attack until your next turn.** If
  you control a min Gig, you may Call a Legend for free." The first clause
  is a targeted, LASTING restriction spanning a turn boundary beyond the
  controller's own current turn — exactly the shape §52 already scoped and
  declined to half-build for `chrome-fang` ("Until your next turn, rival
  Units can't steal friendly Gigs with value higher than their power") and
  named as the reason the `floatingEffects` zone is still worth building
  properly rather than three separate ad-hoc per-card flags. `chrome-
  reverie`'s first clause joins that deferral list (alongside `chrome-fang`,
  `appetite-for-destruction`, `cyberpsychosis`, `safety-override`); its
  second clause (the free Call) is unconditional on the first and is
  encoded in full;
- `evelyn-parker-beautiful-enigma`: "When a friendly CORPO or GANGER Unit
  steals 1 or more Gigs, ready 1 Eddie. **1 €$, {Spend} A rival Unit must
  attack next turn if it can.**" The second clause needs a genuinely new
  engine capability this pool has not needed before: forcing a FUTURE
  action (an attack, specifically, on the RIVAL's own next turn) rather than
  applying an immediate effect or a passive restriction — closer in shape
  to §105's deferred `jackie-welles-mama-s-favorite` (a new interception
  point) than to `floatingEffects`, since it is not merely a lasting
  restriction but an obligation the legal-action space would need to
  enforce (no `endTurn`/other action should be legal for the rival while an
  attack they COULD still make remains unmade). **New deferral, not
  previously named:** this "forced action" gap is recorded here rather
  than folded into `floatingEffects`, since the two are different engine
  primitives (a lasting restriction vs. a positive obligation on the legal-
  action list) even though both are "the printed effect outlives its own
  resolution." A later batch's `mox-inciters` ("A rival Unit must attack
  next turn if it can.") shares this exact gap and should defer the same
  clause when it lands. `evelyn-parker-beautiful-enigma`'s first clause
  (the watcher/ready-Eddie) is independent and encoded in full.

**IMPLEMENTED (deferred slice, §141/§142).** Both partial encodings are now
complete: `chrome-reverie`'s attack denial is a `unitCantAttack` floating entry
(§141), and `evelyn-parker-beautiful-enigma`'s {Spend} ability — plus the
`mox-inciters` clause this ruling anticipated by name — is a `mustAttack`
floating entry enforced by `legalActions` withholding `endTurn` (§142). This
ruling's call that the two capabilities are different PRIMITIVES holds: they
share the floating-entry storage but nothing else, one being a restriction
consulted by a mutation and the other an obligation consulted by the
legal-action list.

# Task 8 batch 7 fix round 1 (batch review)

The batch review found 2 Critical + 1 Important issue, all fixed in place
above (§120, §121, §125, §130 all carry pointers here) rather than
appended as untouched-original-plus-patch, matching how §67 and §80
documented their own fix rounds.

## 133 — Summary: jackie's anaphoric "min Gig," maman-brigitte's real
discard decision, evelyn's per-episode steal trigger

**1. `jackie-welles-pour-one-out-for-me` checks the SPECIFIC decreased die,
not the whole board (Critical).** "If **it** becomes a min Gig" is
anaphoric: "it" is the die the SAME sentence just decreased, not "any
friendly Gig happens to sit at 1." The original encoding (§120/§121) put
the "min Gig" check on a SEPARATE `EffectDef` reading
`condition.friendlyGigValueEquals: 1` against the whole board — correct
when the decrease and the check are the ONLY die on the board (as batch
7's original tests happened to set up), but wrong the instant a SECOND,
untouched friendly Gig already sits at 1: decreasing a 5-die to 3 would
still incorrectly draw, because the OTHER die satisfies the board-wide
check regardless of what the effect actually touched.

**Fix:** `jackie-welles-pour-one-out-for-me`'s two `EffectDef`s (one per
`playedCardType` variant, still sharing `onceKey: "pour-one-out-for-me"`)
now each resolve a single `scripted` node with its OWN declared
`friendlyGigDie` target slot, rather than a bare `changeGig` followed by a
separate board-read `draw`. The slot is bound exactly like any other
trigger target reached with no player-facing action to carry it —
rng-picked (§32), since `onFriendlyCardPlayed` is a watcher and always
fires with an empty `targets` array — but because the SAME bound index is
used for both the decrease and the "did it become 1" check, the script
reads and mutates the identical die. "A min Gig" is still `value === 1`
(§121's core reading — every die's rolled value ranges `[1, size]`, so
there is no die-specific floor distinct from 1 — stands unchanged); only
the SUBJECT of the check moved from "the whole board" to "the one die this
effect is touching." `chrome-reverie`'s BARE "if you control a min Gig" is
unaffected — that phrasing has no antecedent to be anaphoric about, so the
board-wide `friendlyGigValueEquals: 1` reading is still correct there.

**TDD evidence:** a new `tests/cards/blue.test.ts` case sets up Gigs `[1,
5]` (an untouched die already at the floor, plus one about to be
decreased) and asserts NO draw when the touched die lands at 3 — this is
exactly the scenario the pre-fix board-wide check gets wrong. Verified
failing-first: reverted the script to the old two-`EffectDef` board-check
shape and re-ran just this case — failed with the die correctly landing at
`[1, 3]` but a draw ALSO happening (deck length dropped by 1), confirming
the test exercises the bug; re-applied the fix and re-ran green. A second
new case (a single-die board, decreased to exactly 1) confirms the positive
path still draws. Both existing jackie tests (the single-die "becomes 1"
case and the once-per-turn dedup case) needed no changes and stayed green
throughout, since neither ever had a second, untouched Gig die on the
board to expose the bug.

**2. `maman-brigitte-spirit-of-death`'s "you may discard 2 Programs"
becomes a real decision (Critical).** §130's original reasoning classified
this as a cost-free "you may" (per §50's `gilded-mato-n`-style auto-take
precedent), which does not survive scrutiny: discarding 2 of the
controller's OWN hand cards is a resource cost, and §50 itself draws the
line there — "an optional clause that does cost something is a real
decision ... it should become a `chooseOne` with a do-nothing mode."

**Fix:** the card's `onPlay` effect is now a `chooseOne` (`chooser:
'controller'`) with two modes: `maman-brigitte-spirit-of-death:take-it`
(a scripted node with two declared `friendlyHandCard` slots, both filtered
`cardType: 'program'`) and a bare `{ kind: 'sequence', effects: [] }`
decline mode. "Which 2 Programs" is now a real, player-visible decision —
the controller's own hand, matching §73/§80's "a real decision, not rng,
when the action can carry one" — rather than an internal rng pick. The two
declared slots are DELIBERATELY left as the only two slots on the
"take it" mode (no third slot for "which rival Unit"): because both slots
share the identical spec and filter, their fillability is always
CORRELATED (either both empty or both non-empty, since they read the same
zone the same way), so there is no "an earlier slot in this pair went
missing while a later, independently-fillable slot in the SAME node
remained" case — the specific shape the task brief warns against. Adding
"which rival Unit" as a THIRD slot, after a pair that CAN be jointly
empty, would reintroduce exactly that risk (confirmed empirically while
prototyping this fix: a `scripted` node's own declared targets are bound
via `bound.filter((uid): uid is number => uid !== null)`, which silently
COLLAPSES null placeholders and destroys positional alignment for
whatever comes after — so a later, still-fillable slot would land at the
WRONG array index once an earlier one goes missing). "Which rival Unit"
therefore stays rng-picked inside the script, unchanged from before.

A degenerate case falls out of the correlated-slots design: with EXACTLY 1
qualifying Program in hand, both slots still show that 1 card as their
only candidate (a slot with ≥1 candidate is never treated as "empty" by
`fillableSlots`), so the "take it" mode is still technically offered, with
its only reachable tuple naming the SAME card for both slots. The script
treats `progA === progB` as no pick at all — the same tolerance
`matchGig` already extends to a harmless degenerate self-pick (docs/
rulings.md §107 ff.) — so selecting this duplicate-target action is
functionally identical to declining, never a real double-discard of one
physical card.

**TDD evidence:** `tests/cards/blue.test.ts` now has four
`maman-brigitte-spirit-of-death` cases: taking it with 2 real, chosen
Programs (discarded + rival bottom-decked); explicitly declining (hand and
rival field untouched, `targets[0] === 1`); the degenerate 1-Program
duplicate-pick (a no-op, not a real discard); and (unchanged from before)
nothing happens with fewer than 2 Programs entirely — now via the decline
path rather than an unconditionally-taken script. Verified failing-first
against the pre-fix single-scripted-node encoding by temporarily reverting
and re-running: the original code offered no "decline" action at all (a
single `playCard` entry that always attempted the discard), confirming the
old behaviour genuinely lacked the real decision.

**3. `evelyn-parker-beautiful-enigma` fires once per steal EPISODE, not
per die (Important).** §125's original reasoning ("even a single Gig
counts," reusing the per-die `onFriendlyStealDie` every other card in the
pool needs) is overturned by controller ruling: "When a friendly Unit
steals 1 or more Gigs, ready 1 Eddie" describes ONE triggering event — the
whole steal action or effect resolving — not each die inside a multi-die
steal. The old encoding readied 2 Eddies for a single power-10 attack that
steals 2 dice in one go, which is a visible, real over-count.

**Fix:** `Trigger` gains `onFriendlyStealComplete` — a new watcher,
distinct from `onFriendlyStealDie`, fired exactly once by `combat.ts`'s
`takeStolenGig` at the point the whole steal it is resolving finishes
(right before `finishSteal` is called — i.e. once `steal.remaining` has
reached 0 or the victim's Gig area has run out, whichever ends the
episode first), carrying the same `stealerUid`/`stealerIsLegend`/
`stealerTags` facts `onFriendlyStealDie` already exposes.
`onFriendlyStealDie` itself is completely unchanged — every existing
per-die card (`6th-street-recruits`, `gorilla-arms`, `v-roamer-of-the-
badlands`, `rogue-amendiares-preem-solo`, `wraith-marauders`, `take-
control`) keeps firing once per die, exactly as before.
`evelyn-parker-beautiful-enigma` moves from `onFriendlyStealDie` to
`onFriendlyStealComplete`; its `condition.stealerKeywordAnyOf` field and
the `readyEddies` effect are otherwise unchanged, since `conditionHolds`
reads the SAME context field names regardless of which trigger populated
them.

**TDD evidence:** a new `tests/cards/blue.test.ts` case fields a power-10
GANGER Unit (`animals-wrecker`, stealing 2 dice from a rival with exactly 2
Gigs in one attack) and asserts exactly 1 of 2 surgically-spent Eddies
readies, not both. Verified failing-first: temporarily reverted
`evelyn-parker-beautiful-enigma`'s trigger back to `onFriendlyStealDie` and
re-ran just this case — failed with BOTH Eddies readied, confirming the
test exercises the per-die-vs-per-episode distinction; re-applied the fix
and re-ran green. Every pre-existing `onFriendlyStealDie` card's test
(gorilla-arms, 6th-street-recruits, etc.) stayed green throughout, since
that trigger's own firing point and semantics are untouched.

**Verification (all three fixes together):** `npx tsc --noEmit` clean,
`npm test` 527/527 (492 pre-batch-7 + 35 in `tests/cards/blue.test.ts`,
up from batch 7's original 31 after replacing/adding cases in the three
affected `describe` blocks), `npm run build` clean.

## Task 8 batch 7 summary

**Cards:** `alt-cunningham-soulkiller-architect`, `chrome-reverie`,
`delamain-cab`, `delamain-rideshare-ai`, `dying-night-v-s-pistol`,
`evelyn-parker-beautiful-enigma`, `evelyn-parker-scheming-siren`,
`floor-it`, `hacked-corpo`, `jacked-in-voodoo-boy`,
`jackie-welles-pour-one-out-for-me`, `judy-a-lvarez-braindance-maestro`,
`judy-a-lvarez-nothing-to-doubt`, `les-e-le-mens`,
`lizzy-wizzy-delicate-weapon`, `maman-brigitte-spirit-of-death`,
`misty-olszewski-mender-of-broken-spirits`. Fifteen fully encoded; two
partially encoded (§132) — no card fully deferred this batch.

**Vocabulary extensions:** `onFriendlyCardPlayed`, `onFriendlyStealComplete`
(`Trigger`; the latter added in fix round 1, §133); `readyEddies`
(`EffectNode`); `friendlyHandOrTrashProgram` (`TargetSpec`); `lowestPower`
(`TargetFilter`); `sourceStoleGigThisTurn`,
`friendlyProgramNotPlayedThisTurn`, `playedCardColor`, `playedCardType`,
`playedCardKeyword`, `stealerKeywordAnyOf` (`EffectCondition`);
`playedCardColor`, `playedCardType`, `playedCardTags`, `stealerTags`
(`ConditionContext`); `stoleGigThisTurn` (`CardInstance`);
`playedProgramThisTurn` (`PlayerState`).

**Scripted cards (9, after fix round 1):** `alt-cunningham-soulkiller-
architect`, `chrome-reverie`, `dying-night-v-s-pistol`, `hacked-corpo`
(reusing the `all-is-lost` shape), `jackie-welles-pour-one-out-for-me`
(added in fix round 1, §133 — a single scripted node shared by both
`playedCardType` variants), `judy-a-lvarez-braindance-maestro`,
`judy-a-lvarez-nothing-to-doubt`, `lizzy-wizzy-delicate-weapon`,
`maman-brigitte-spirit-of-death` (registry key renamed to `:take-it` in
fix round 1, alongside a bare-`sequence` decline mode declared directly in
`data/cards.json`), `misty-olszewski-mender-of-broken-spirits` (three
registry entries — `:unit`/`:gear`/`:program` — for its `chooseOne`
modes). 12 registry entries across these 10 card ids.

**Partial encodings (§132, unaffected by fix round 1):** `chrome-reverie`
(first clause deferred, needs `floatingEffects`), `evelyn-parker-
beautiful-enigma` (its `{Spend}` ability deferred, needs a new "forced
action" capability).

**Fix round 1 (§133):** 2 Critical + 1 Important issue from the batch
review, all fixed — see §133 for the full write-up. Re-verified: `npx tsc
--noEmit` clean, `npm test` 527/527 (492 pre-batch-7 + 35 in
`tests/cards/blue.test.ts`), `npm run build` clean.

**Verification (original batch, superseded by fix round 1's numbers
above):** `npx tsc --noEmit` clean, `npm test` 523/523 (492 pre-existing +
31 new), `npm run build` clean.

# Task 8 batch 8 (Blue, last 16 cards) — the final batch of all 141

The last Blue batch, and the last card-content batch of Task 8. Sixteen
cards needed five vocabulary extensions, four scripted cards, and two full
deferrals (both already anticipated by earlier batches' own rulings) — no
new engine-level fix was required, unlike the last two batches.

## 134 — `streetCredBehindRival`: the mirror image of `streetCredAheadOfRival`

`modded-muramasa` ("At the end of your turn, if you have less ☆ than a
Rival, ready this Unit.") and `mt0d12-flathead` ("If you have less ☆ than a
Rival, this Unit can't be blocked.") both print "you have less ☆ than a
Rival" as a plain board condition. §55 already built `streetCredAheadOfRival`
("more ☆ than a Rival," strictly greater) for the identical comparison in the
opposite direction; nothing before this batch needed the "behind" half as a
reusable `EffectCondition` field — `effects.ts`'s local `behindOnStreetCred`
helper existed only to drive the `chooseOne` chooser mechanism (§45/§54), not
as something a card's own `condition` could name.

**Ruling:** `EffectCondition` gains `streetCredBehindRival?: boolean`,
checked in `query.ts`'s `conditionHolds` as `streetCred(state, player) <
streetCred(state, opponentOf(player))` — the exact mirror of the existing
`streetCredAheadOfRival` check, one comparison operator flipped. Both cards
use it directly: `modded-muramasa` as `{ trigger: 'onEndTurn', condition: {
streetCredBehindRival: true }, effect: { kind: 'readyCard', target: 'self'
} }`, and `mt0d12-flathead` as the new `cantBeBlocked` static below, gated by
the same condition. `effects.ts`'s own `behindOnStreetCred` helper is
untouched (it still drives `chooseOne`'s rival-choice/`allUnlessBehindStreetCred`
machinery, a different consumer of the identical board fact).

## 135 — `cantBeBlocked`: a static consulted by `reactActions`, the mirror image of `cantAttack`

`mt0d12-flathead`: "If you have less ☆ (Street Cred) than a Rival, this Unit
can't be blocked." No earlier card restricts *being blocked* — every static
restriction so far (`cantAttack`, `cantAttackGigArea`, `rivalCantAttackWhenPlayed`)
is about attacking, not defending.

**Rulings:**

- `EffectNode` gains `{ kind: 'cantBeBlocked' }`, a `static`-trigger-only
  node consulted by a new `query.cantBeBlocked(db, state, uid)` — exactly
  `cantAttack`'s own one-line shape (`activeStaticNodes(...).some((node) =>
  node.kind === 'cantBeBlocked')`);
- `combat.ts`'s `reactActions` reads `state.pendingAttack?.attacker` and
  skips the entire `{Blocker}` reaction loop when that attacker carries the
  static — no `block` reaction is offered *at all* for that attack, for any
  candidate blocker, rather than filtering candidates one at a time. This
  mirrors how `canAttack` gates a static restriction on the ATTACKING side:
  a single early check rather than narrowing the per-candidate loop;
- the condition is evaluated from the ATTACKER's controller's own point of
  view (`mt0d12-flathead`'s own owner), exactly like every other
  `EffectCondition` on a `static` def — `staticNodes` (`query.ts`) already
  judges every static from the printing card's OWN owner's perspective, so
  no new plumbing was needed beyond the new node kind and the new condition
  field (§134).

## 136 — `chooseOne.allIf`: "choose both instead", and `friendlyGigSizeAtMin`

`pyramid-song`: "Choose one effect. If a friendly d4 is a min Gig, choose
both instead. Give a rival Unit -5 power this turn. // Bottom-deck a rival
Unit with power 0." This is the mirror image of `gunpoint-diplomacy`'s
`allUnlessBehindStreetCred` (§45/§54): there, the DEFAULT is "both," and
being behind on ☆ is the penalty that narrows to "one." Here the DEFAULT is
"one" (the ordinary `chooseOne`), and a specific board condition — unrelated
to Street Cred — is the exception that widens to "both."

**Rulings:**

- rather than add a second, narrowly-named chooser value (which would not
  generalize to the next card that needs "normally one, but both under
  condition X" for some OTHER condition), `chooseOne` gains an independent
  `allIf?: EffectCondition` field, checked AHEAD of `chooser`: when
  `allIf`'s condition holds, every mode resolves and `chooser` is not
  consulted at all; otherwise resolution proceeds exactly as before
  (`chooser` defaulting to `'controller'`). `effects.ts`'s `SlotSpec`'s
  `'mode'` variant carries the same field through to `candidatesFor` (which
  returns no candidates for the mode slot while `allIf` holds — the "nothing
  to choose" shape `allUnlessBehindStreetCred`'s own "not behind" branch
  already uses) and to `applyNode`'s `chooseOne` case (which resolves every
  mode in printed order, exactly like the `allUnlessBehindStreetCred`
  branch, just gated on a different fact);
- unlike `gunpoint-diplomacy` (wrapped in a `sameTarget`, §53, so both modes
  land on ONE chosen Unit), `pyramid-song`'s two modes are NOT tied to a
  single target — the card names "a rival Unit" and, separately, "a rival
  Unit with power 0," which need not be the same Unit. Each mode keeps its
  own real target slot; when `allIf` holds, BOTH slots are enumerated
  (verified empirically: with two rival Units, one power 10 and one power 0,
  the resulting `playCard` actions offer every combination of {either Unit
  for the debuff} × {the power-0 Unit for the bottom-deck}), and when it does
  not hold, only the CHOSEN mode's own target ends up mattering (the other
  mode's slot is still reserved per §45's "reserve every mode's slots
  regardless of which is chosen" rule, but is dropped from the flat array
  automatically whenever its own candidate list happens to be empty — no new
  mechanism, the existing `fillableSlots`/`effectTargetChoices` behavior);
- "a friendly d4 is a min Gig" needed one more condition field:
  `EffectCondition.friendlyGigSizeAtMin?: DieSize` — a friendly Gig die of
  EXACTLY that printed size currently showing 1. This is deliberately
  size-specific, unlike `chrome-reverie`'s bare "a min Gig" (§121's
  `friendlyGigValueEquals: 1`, size-agnostic) — `pyramid-song` names a d4
  specifically, and a d6/d8/... die at 1 does not qualify. `query.ts`'s
  `conditionHolds` checks `state.players[player].gigArea.some((die) =>
  die.size === condition.friendlyGigSizeAtMin && die.value === 1)`. Like
  `chrome-reverie`'s bare phrasing, this has no antecedent to be anaphoric
  about (§133's jackie fix does not apply here) — it is a plain board read,
  unconditioned on which die (if any) an earlier clause touched, since this
  card's own text has no earlier "decrease/increase a Gig" clause to be
  anaphoric ABOUT in the first place.

## 137 — `readyOnly` filter, and two "if you do" scripts needing correlated-but-different-zone target slots

`unlikely-bond` ("Bottom-deck a ready friendly Unit. If you do, bottom-deck a
spent rival Unit.") and `placide-voodoo-sentinel` ("{Play} {Attack} You may
discard 1 Program. If you do, bottom-deck a rival Unit.") both tie a SECOND
real decision to whether a FIRST one actually resolved — the "if you do"
shape `maman-brigitte-spirit-of-death` established a scripted precedent for
(§133), but neither of these two cards shares Maman Brigitte's "both slots
read the identical zone+filter" correlation that made her two slots always
jointly fillable or jointly empty. Here the two slots are DIFFERENT zones
(a friendly Unit, then a rival Unit), so they can be independently fillable
— exactly the risk profile the task brief's "no 3+-slot node with an
unfillable middle slot" warning is about, one slot short of that count.

**Rulings:**

- `TargetFilter` gains `readyOnly?: boolean` — "a **ready** friendly Unit,"
  the mirror image of the existing `spentOnly` (§107 ff.). `targets.ts`'s
  `filterTargets` gains the matching one-line check
  (`!state.cards[uid].ready` excludes a candidate). `unlikely-bond`'s first
  slot is `{ spec: 'friendlyUnit', filter: { readyOnly: true } }`; its
  second slot reuses the ALREADY-EXISTING `rivalSpentUnit` `TargetSpec`
  (Task 7 vocabulary — bare "a spent Unit" restricted to the rival side, no
  new spec needed) for "a spent rival Unit";
- both cards stay SCRIPTED (rather than becoming a new "chained bottom-deck"
  node, since no other card in the pool shares this exact two-different-
  zone shape) with two DECLARED target slots, so both halves stay real,
  enumerated decisions per §73/§80 — never an rng pick for either "which
  friendly Unit" or "which rival Unit." The scripts classify a bound uid by
  ZONE MEMBERSHIP (is it in the controller's own field? the rival's field?)
  rather than by ARRAY POSITION, because an unfillable EARLIER slot
  collapses out of `ctx.targets` entirely (§133's `bound.filter` note) and
  would otherwise silently shift a LATER, still-fillable slot's value into
  the wrong logical role — confirmed by `unlikely-bond`'s own second test
  (no ready friendly Unit; only the rival-Unit slot is fillable; the single
  bound uid is still correctly read as "the rival," never mistaken for "the
  friendly," because the script checks which player's field actually
  contains it rather than trusting its position);
- the FIRST slot's success gates the second: `unlikely-bond`'s script
  bottom-decks the friendly Unit first and returns early (leaving the rival
  Unit on the field) if that slot did not bind; `placide-voodoo-sentinel`'s
  discards the chosen Program first and returns early if it is not actually
  in hand. Neither card lets the SECOND effect fire without the first
  actually having happened, matching "if you do" exactly — unlike a naive
  two-independent-`EffectDef` encoding, which would let the rival-side effect
  fire even when the friendly-side one had nothing to act on;
- `placide-voodoo-sentinel`'s discard is a COSTED option (discarding the
  controller's own hand card), so — the `maman-brigitte-spirit-of-death`
  shape (§133) — it is a `chooseOne` (two identical copies, one on the
  `{Play}` `EffectDef` and one on the `{Attack}` `EffectDef`, since "{Play}
  {Attack} X" is two separate `EffectDef`s sharing one printed clause, the
  established `dexter-deshawn-one-last-chance` shape, §39) with a
  do-nothing decline mode, rather than an auto-take. "Which Program" is the
  `chooseOne`'s `friendlyHandCard` (filtered `program`) slot; "which rival
  Unit" stays rng-picked inside the script (the printed text draws no
  distinction among rival Units, matching Maman Brigitte's own precedent for
  the identical "which rival Unit" gap);
- the `{Attack}`-triggered copy of `placide-voodoo-sentinel`'s ability
  cannot carry a pre-declared mode or target at all — `combat.ts`'s
  `attack` action has no generic slot for a triggered effect's own targets
  (only `payOptionalCosts`, §49's narrower mechanism), so `fireTriggerOnDraft`
  always fires `onAttack` with an empty `targets` array. Both the
  `chooseOne`'s mode AND (when "take it" is picked) the script's own
  `friendlyHandCard` slot therefore fall back to the rng, exactly like a
  `{Call}`-triggered `chooseOne` (§45) — an existing, accepted consequence of
  `bindSlots`'s generic "no supplied value, pick uniformly" rule (§32),
  not a new gap this card introduces.

## 138 — `tetratronic-rippler`: a genuine binary "keep or trash" decision, with no channel to carry it, falls to the rng

"(Equip to a friendly Unit or face-up Legend.) When this Unit or Legend is
spent, search the top card of your deck. You may trash it. (Otherwise, keep
it on the top of your deck.)" This card is itself the sibling §88 already
cited, pool-wide, as the evidence for what an unstated "search the top N"
default means (a searched-but-not-acted-on card returns to the top, in the
order encountered) — but its OWN encoding was still outstanding until this
batch.

**Ruling:** unlike `judy-a-lvarez-braindance-maestro`'s "you may add it to
hand" (§120 ff.) — a cost-free, drawback-free upside auto-taken per §50 —
`tetratronic-rippler`'s "you may trash it" is a genuine dilemma with no
stated default winner: keeping the card guarantees drawing that exact card
next; trashing it removes it from the deck forever. Neither branch is
strictly better than the other (it depends entirely on what the revealed
card is), so §50's auto-take reasoning does not apply here. However, the
revealed card only exists once this `onSpend` script actually runs, and the
firing action (an attack, a block, an ability `{Spend}` cost, ...) has no
channel to carry a pre-declared "trash y/n" answer for a card nobody has
seen yet — the identical "no enumerable decision left" shape `sketchy-
ripper`'s "which Gear" rng pick already covers (§48), extended here from a
multi-way pick to a binary one. The script flips a fair coin through
`state.rng` (`nextInt(state.rng, 2)`) to decide trash vs. keep, fully
encoding both branches (never silently favoring one), so this is a complete,
faithful encoding rather than a partial one — the missing piece is *which
branch a real player would have picked*, not *what either branch does*,
exactly the distinction §79/§80 draws between a forbidden gameplay-affecting
partial and an accepted "no decision channel, so rng" resolution.

## 139 — `sasha-yakovleva-won-t-let-you-down`: "that card's cost" (the `heywood-ripperdoc` shape), and a defeated {Go Solo} Legend is removed, not trashed

"{Go Solo} {Attack} Reveal the top card of your deck and add it to your
hand. This Unit gains power equal to that card's cost this turn. {Defeated}
A Rival discards 1." "That card's cost" needs the specific card THIS SAME
step just revealed — the identical "read a property of what a prior step
touched" shape §73/§129 already forced into a script for `heywood-
ripperdoc`'s "its cost" and `judy-a-lvarez-braindance-maestro`'s "it."

**Rulings:**

- scripted: reveal the top card (an unconditional move to hand — no "you
  may," unlike `tetratronic-rippler`), then buff the source's own
  `tempPower` by that specific card's printed cost, this turn. An empty deck
  simply reveals nothing (no card, no buff) — the established "reveal" (not
  `draw`) convention (§36 only ever applies to an explicit `draw` node,
  confirmed by `judy-a-lvarez-nothing-to-doubt`'s identical "reveal the top
  card" script never checking for a deck-out);
  - the `{Defeated}` clause needs no script: `discardRandomRival` (Task 7
    vocabulary) already covers "A Rival discards 1" verbatim;
  - `{Go Solo}` is the printed reminder only, already covered by the
    `keywords` array (the established `meredith-stout-stone-cold-corpo`
    precedent for a bare keyword line);
- **incidental confirmation, not a new ruling:** a defeated `{Go Solo}`
  Legend goes to `owner.removed` (`combat.ts`'s `leaveField`), not
  `owner.trash` — §31's "when it leaves the field, remove it from the game"
  applies to EVERY exit route uniformly, including a fight defeat, not just
  a voluntary bounce/bottom-deck. `onDefeat` still fires normally either
  way (confirmed by this card's own test: the Rival's hand still loses a
  card even though Sasha herself lands in `removed`, not `trash`).

## 140 — Two more full deferrals, both already anticipated by earlier batches

- `mox-inciters`: "{Play} A rival Unit must attack next turn if it can.
  {Blocker}" — §132 already named this EXACT card, by id, as sharing
  `evelyn-parker-beautiful-enigma`'s deferred `{Spend}` ability's gap: a
  positive obligation on the RIVAL's own future legal-action list ("no
  `endTurn` should be legal for the rival while an attack they COULD still
  make remains unmade"), which nothing in the pool has built. Since this
  forced-attack clause is `mox-inciters`' ONLY non-reminder clause (its
  `{Blocker}` line needs no `EffectDef` at all, per the established bare-
  keyword-reminder precedent), the card is left with `effects: []` in full
  — not a partial encoding of a single-clause card, simply the deferred
  clause plus a reminder line that was never going to need an `EffectDef`;
- `reboot-optics`: "{Quick} The next time a rival Unit fights this turn, it
  doesn't defeat the opposing friendly Unit." — precisely the shape §91
  already scoped for `safety-override` ("{Quick} The next time a friendly
  Unit loses a fight this turn, defeat the opposing rival Unit."): a
  delayed, conditional, one-shot effect tied to a FUTURE fight (whichever
  one happens to qualify first, involving whichever two cards happen to be
  fighting), not to a chosen card or a turn boundary alone — the
  `floatingEffects` gap §52 scoped and §79/§80 made standing policy never to
  half-solve. `reboot-optics` joins `chrome-fang`, `appetite-for-
  destruction`, `cyberpsychosis` and `safety-override` on that deferral
  list, `effects: []` in full.

Both cards' tests in `tests/cards/blue.test.ts` are the same bookkeeping-only
assertion (`expect(db['<id>'].effects).toEqual([])`) the existing deferred
cards already use, plus (for `mox-inciters`) a confirmation that its
`{Blocker}` keyword still functions normally despite the deferred clause.

**IMPLEMENTED (deferred slice, §141/§142).** `mox-inciters` is a `mustAttack`
floating entry (§142) and `reboot-optics` a one-shot `rivalFightNoDefeat` one
(§141); both cards are encoded in full and both bookkeeping-only tests are
replaced by real ones.

## Task 8 batch 8 summary

**Cards:** `modded-kusanagi`, `modded-muramasa`, `mox-inciters`,
`mt0d12-flathead`, `netwatch-netdriver`, `placide-voodoo-sentinel`,
`psycho-squad`, `pyramid-song`, `reboot-optics`,
`rita-wheeler-no-stupid-questions`, `sasha-yakovleva-won-t-let-you-down`,
`tetratronic-rippler`, `trust-no-one`, `unlikely-bond`, `v-corporate-exile`,
`wakako-okada-peace-and-harmony`. Fourteen fully encoded (two of them,
`psycho-squad` and `v-corporate-exile`, vanilla — a flavour-only line and a
bare `{Go Solo}` reminder respectively); two (`mox-inciters`,
`reboot-optics`) fully deferred (§140) — no partial encodings this batch.

**Vocabulary extensions:** `cantBeBlocked` (`EffectNode`, static);
`streetCredBehindRival`, `friendlyGigSizeAtMin` (`EffectCondition`);
`allIf` (`EffectNode`'s `chooseOne`); `readyOnly` (`TargetFilter`). No new
`Trigger` or `TargetSpec` was needed this batch — `rivalSpentUnit` (Task 7)
and every trigger `unlikely-bond`/`placide-voodoo-sentinel`/others needed
already existed.

**Engine changes (non-vocabulary):** `combat.ts`'s `reactActions` now
consults `query.cantBeBlocked` against the current `pendingAttack`'s
attacker before offering any `{Blocker}` reaction.

**Scripted cards (4):** `placide-voodoo-sentinel:take-it`,
`sasha-yakovleva-won-t-let-you-down`, `tetratronic-rippler`,
`unlikely-bond`.

**Deferred (2, §140):** `mox-inciters` (forced-future-attack gap, joining
`evelyn-parker-beautiful-enigma`'s clause per §132's own anticipation),
`reboot-optics` (`floatingEffects` gap, joining `chrome-fang`,
`appetite-for-destruction`, `cyberpsychosis`, `safety-override`).

**TDD evidence:** every vocabulary extension was exercised by a failing-
first real-card test before its engine change landed — verified by
temporarily neutralizing each in turn and re-running the corresponding new
test, confirming a failure, then restoring and re-running green:
`combat.ts`'s `cantBeBlocked` gate (`mt0d12-flathead`'s "can't be blocked"
case), `effects.ts`'s `chooseOne.allIf` branch (`pyramid-song`'s "resolves
BOTH modes" case), `query.ts`'s `streetCredBehindRival` and
`friendlyGigSizeAtMin` checks (`modded-muramasa`'s "stays spent" case and
`pyramid-song`'s "chooses one effect normally" case respectively — disabling
either check flips the condition to always-true, breaking the case that
depends on it being FALSE), and `targets.ts`'s `readyOnly` filter
(`unlikely-bond`'s dedicated "never offers a SPENT friendly Unit" case,
added specifically because the first two `unlikely-bond` cases turned out
not to exercise the filter at all — both happened to use boards where the
filter's exclusion never mattered, a gap only surfaced by attempting this
verification pass). `tests/cards/blue.test.ts` gained 27 new cases (35 ->
62) covering all sixteen cards, including both branches of every
conditional static/trigger and both outcomes of every `chooseOne`/rng-
fallback shape (`pyramid-song`'s one-mode vs. both-modes,
`wakako-okada-peace-and-harmony`'s two {Call} modes, `mt0d12-flathead`'s
blockable/unblockable, `modded-muramasa`'s readies/stays-spent,
`tetratronic-rippler`'s either/or search outcome, `unlikely-bond`'s
"if you do" gate firing, not firing, and correctly excluding a spent
friendly Unit).

**Verification:** `npx tsc --noEmit` clean, `npm test` 554/554 (527
pre-batch-8 + 27 new in `tests/cards/blue.test.ts`), `npm run build` clean,
purity grep (`Math.random`/`Date.now`) clean on every touched file
(`src/engine/types.ts`, `src/engine/query.ts`, `src/engine/combat.ts`,
`src/engine/cardDb.ts`, `src/cards/effects.ts`, `src/cards/targets.ts`,
`src/cards/scripted/index.ts`, `data/cards.json`).

# Task 8, deferred slice — the four engine capabilities eight batches deferred

Batches 1-8 encoded 130 of the 141 cards and left a standing deferral list,
every entry of which named one of four engine capabilities nobody had built:
a floating-effect zone (§52, as extended by §79, §91, §132, §140), a
forced-action mechanism (§132/§140), a trigger seam on the Gig-die roll (§78),
and a would-be-mutation interception point (§72/§105). This slice builds all
four and finishes every card that needed them. **No card in `data/cards.json`
is deferred any more** — see `tests/cards/completeness.test.ts`.

## 141 — `GameState.floatingEffects`: effects that outlive their own resolution

Six clauses across five cards print an effect that is attached to nothing on
the board and outlives the resolution that created it:

| Card | Printed clause | Entry kind | Expiry |
|---|---|---|---|
| `chrome-fang` | "Until your next turn, rival Units can't steal friendly Gigs with value higher than their power." | `rivalStealCappedByPower` | `ownerNextTurnStart` |
| `appetite-for-destruction` | "The next time a friendly Unit wins a fight by 3+ power this turn, it also steals a Gig." | `winFightMarginSteal` | `endOfTurn` |
| `safety-override` | "{Quick} The next time a friendly Unit loses a fight this turn, defeat the opposing rival Unit." | `loseFightDefeatFoe` | `endOfTurn` |
| `reboot-optics` | "{Quick} The next time a rival Unit fights this turn, it doesn't defeat the opposing friendly Unit." | `rivalFightNoDefeat` | `endOfTurn` |
| `cyberpsychosis` | "... If that Unit steals or fights, defeat it at the end of this turn." | `defeatIfActed` | `endOfTurn` |
| `chrome-reverie` | "A rival Unit can't attack until your next turn." | `unitCantAttack` | `ownerNextTurnStart` |

**Rulings:**

- **the zone.** `GameState.floatingEffects: FloatingEffect[]` — a flat list on
  the state, not per player, because several entries are about the *rival's*
  cards and every consumer already knows which player it is asking about. Each
  entry carries its `kind`, its `controller`, the `sourceDefId` that created it
  (provenance for the event log; the source card itself is routinely gone by
  the time the entry fires — `cyberpsychosis` is a Program that trashes itself
  on resolution), its printed `expiry`, and the extra facts its own kind needs
  (`unitUid`, `margin`/`count`, the mutable `acted` bit). `draftState`
  deep-copies every entry, so a reducer marking `acted` cannot reach back into
  the caller's state (asserted directly by a test);
- **the card-data node** is `{ kind: 'floatingEffect', floating: FloatingSpec }`,
  where `FloatingSpec` is a strict discriminated union — one variant per
  printed clause shape, with its own `expiry` and, for the three
  instance-scoped variants, a `target`/`filter` pair. The spec carrying the
  target is what makes `cyberpsychosis`'s "**that** Unit" work: the node goes
  through the ordinary `takeTarget` path, so `target: 'chosen'` inside a
  `sameTarget` (§53) resolves to the same Unit the buff landed on and consumes
  no slot of its own, while `chrome-reverie`'s `target: 'rivalUnit'` is a real,
  enumerated `playCard` decision;
- **expiry is printed, never inferred.** `endOfTurn` ("this turn", "at the end
  of this turn") lapses in `clearTurnBuffs`, alongside `tempPower` — the same
  end-of-GAME-turn boundary §20 fixed for buffs, which is what makes a
  {Quick} entry created during the rival's turn (`safety-override`,
  `reboot-optics`) die at the end of *that* turn rather than surviving into its
  controller's own. `ownerNextTurnStart` ("until your next turn", "next turn")
  lapses in `beginTurn`, for its controller only, so it spans exactly the
  rival's intervening turn;
- **a one-shot needs no flag.** "The next time ..." entries are removed by
  whoever consumes them, which is the same thing as a spent flag with less
  state to copy and no chance of a stale entry lingering;
- **the consumers are the specific seams each clause names**, never a generic
  dispatcher: `combat.ts`'s `stealableDieIndexes` (chrome-fang),
  `fight()` (the three fight clauses, plus `defeatIfActed`'s "or fights"),
  `takeStolenGig` (`defeatIfActed`'s "steals"), `query.cantAttack`
  (chrome-reverie) and `reduce.ts`'s `endTurn` (cyberpsychosis's actual
  defeat). This keeps every clause's timing reviewable against its own printed
  text instead of hidden behind an abstraction.

**Sub-rulings the individual clauses forced:**

- **chrome-fang caps a *Unit's* steal, and is a hard prohibition.** The
  printed subject is "rival **Units**", so the cap applies only while the
  stealing card is a Unit on the field — or a {Go Solo} Legend, which is played
  "as a ready Unit" (§31) — and never to a Program/Gear whose own effect
  steals (`query.isUnitStealer`). Unlike `distinctValueOnly`'s preference
  semantics (§68 ff., which falls back to the whole list rather than deadlock),
  a value above the thief's power is simply not stealable even if that leaves
  *nothing* stealable: `stealableDieIndexes` is the single authority, and
  `resolveAttack`/`stealGig` cap their counts by it while `takeStolenGig` ends
  an episode early when it runs empty — so `chooseGig` is never reached with a
  pending steal and no legal choice;
  **"their power" is the power the Unit is ATTACKING with** (fix round 1,
  §145): `stealValueCap` reads `effectivePower` **plus** `attackPowerBonus`,
  the same sum `resolveAttack` derives the steal COUNT from and `fight()` uses
  for the attacker's side. A Unit's power during its own attack is ONE number,
  whichever rule reads it;
- **"wins a fight by 3+ power" is the raw power margin**, `winnerPower -
  loserPower`, computed from the same two numbers `fight()` already compares
  (buffs, Gear and attack bonuses included). A win that came from
  `winsFightVsKeyword` (§41) rather than power can therefore have a margin of
  0 or less and does not qualify — the card asks for a 3+ power win, not for
  "won convincingly";
- **the delayed fight consequences resolve after the fight is settled** (the
  defeats, then `onWinFight`), because both printed texts speak of a fight
  already won or lost. `appetite-for-destruction`'s bonus steal reuses the
  ordinary `stealGig` node through a new `resolveNodeOnDraft` helper, so it
  merges into a pending attack steal exactly like an on-defeat steal (§32);
- **reboot-optics reuses `fight-immune`'s seam** (§83): the protected
  combatant is filtered out of the would-be-defeated set before any defeat is
  applied, so a loser who was never defeated leaves nobody to have "won"
  (§46's `defeatShield` reading). It is consumed by the first fight its
  controller has a combatant in, whether or not a defeat would actually have
  happened — the printed trigger is "the next time a rival Unit fights", not
  "the next time it would defeat something";
- **cyberpsychosis marks, then acts.** "If that Unit steals or fights" is
  watched from the moment the entry lands (a steal earlier in the same turn
  does not count), by setting `acted` in `fight()` — for BOTH combatants, win
  or lose — and in `takeStolenGig` for the card that actually stole. The
  defeat itself runs from `reduce.ts`'s `endTurn`, after the `onEndTurn`
  watcher (a card's own end-of-turn ability is still its own turn's business)
  and before `clearTurnBuffs` drops the entry. `TargetFilter.equipped` ("an
  equipped Unit") is the mirror image of §107's `unequipped`, and the target is
  bare `anyUnit` — either side's, per §107's `spentOnly` precedent for a bare
  "a spent Unit";
- **chrome-reverie's denial goes in `query.cantAttack`**, not in
  `combat.canAttack`: that one function is what every attack path already
  funnels through (`canAttack` plus both `...DespiteLag` Lag exceptions), so a
  turn-spanning denial cannot leak past one of them — the same "one gate, every
  path" lesson §106 learned the hard way. Its second clause (the free Call) is
  unchanged and stays on its own conditioned `EffectDef`, since only the first
  clause is unconditional.

**Out of scope, deliberately.** §52 also suggested this zone would subsume
§43's `gunpoint-diplomacy` over-approximation and the "next time" wording in
`gorilla-arms` / `jackie-welles-pour-one-out-for-me`. Those three cards are
already encoded and green; re-encoding them is a behaviour change to working
cards rather than a gap being closed, so they are left exactly as they are and
flagged here for whoever revisits them.

## 142 — Forced actions: `mustAttack` and a withheld `endTurn`

`mox-inciters` ("{Play} A rival Unit must attack next turn if it can.") and
`evelyn-parker-beautiful-enigma`'s "1 €$, {Spend} A rival Unit must attack
next turn if it can." print the pool's only positive OBLIGATION — §132 named
it as a different engine primitive from a floating restriction, and it is, but
it is not a different *storage* problem: it is one more floating entry
(`mustAttack`, with the chosen Unit's uid and an `ownerNextTurnStart` expiry)
whose consumer happens to be `legalActions` rather than a mutation.

**Rulings:**

- **the obligation is enforced by withholding `endTurn`**, and by nothing
  else. While a `mustAttack` entry names a Unit that (a) belongs to the player
  whose turn it currently is and (b) appears as the attacker of at least one
  entry in the attack list `mainPhaseActions` just enumerated, `endTurn` is not
  offered. Everything else that player could do stays legal: the card says the
  Unit must attack, not that nothing else may happen first;
- **deriving it from the enumerated attacks is what makes it safe.** The
  legality question "does this Unit still have an attack available" is answered
  by the very list being built, so there is no second implementation of
  readiness/Lag/`cantAttack`/target-availability to drift out of sync, and a
  vacuous obligation (nothing to attack, the Unit spent, defeated, bounced, or
  under a `cantAttack`) silently returns `endTurn` instead of deadlocking the
  turn. "If it can" is therefore not a separate check at all — it is the
  absence of any legal attack;
- **"next turn" is the target's own controller's next turn**, which
  `ownerNextTurnStart` gives for free: the entry is created by the OPPOSING
  player during their own turn, is inert while `activePlayer` is not the
  target's owner (`query.forcedAttackers` returns nothing then), covers exactly
  the intervening rival turn, and lapses at its creator's next turn start;
- **attacking discharges it immediately** (`declareAttack` drops the entry), so
  a Unit readied again mid-turn by some other effect is not forced to attack
  twice for one printed sentence.

## 143 — `onGigRoll` and the `gigReroll` decision

`kerry-eurodyne-axe-attitude-audience` — "When you roll in a Gig from your
fixer area, you may ignore the result and reroll it once. When you roll a min
or max value on a Gig, draw 1. If it's a d20, draw 3 instead." — was deferred
by §78 for needing two things nothing exposed: a trigger fired *during* the
roll, and a player decision layered on top of it.

**Rulings:**

- **clause 2 is a watcher trigger, `onGigRoll`**, carrying the die's `size` and
  the `value` it landed on, fired on the ROLLER's own in-play cards. It fires
  wherever a Gig die's value is actually rolled: the start-of-turn fixer roll,
  the reroll decision below, and the `rerollGig` EffectNode. `rerollGig` can
  reroll a *rival's* die, and the trigger still fires for the effect's
  controller there, because the printed subject is "when **you** roll" — the
  roller, not the die's owner;
- **"a min or max value" is `condition.rolledExtremeValue`**: the rolled value
  equals 1 or equals the die's own size. Both facts come from the trigger
  context, so the condition is unsatisfiable outside a roll, exactly like
  §42's `stolenDieSize`;
- **"If it's a d20, draw 3 instead" is two defs, not a negation primitive.**
  `condition.rolledDieSizeAnyOf` takes a SET of die sizes: one def names
  `[20]` and draws 3, its sibling names `[4, 6, 8, 10, 12]` and draws 1. The
  six die sizes are a closed set, so enumerating the complement is exact and
  reads like the card; the alternative ("draw 1, and 2 more if it's a d20")
  would be arithmetically equivalent but would not say what the card says, and
  a `not` operator for one card's sake is a worse trade than one extra field;
- **clause 1 is a real decision, not a policy.** "You may ignore the result and
  reroll it once" is exactly the kind of costless-but-consequential option §50
  refuses to auto-take on the player's behalf when it genuinely cuts both ways
  (rerolling a 6 on a d6 is a disaster; rerolling a 1 is free). It is
  implemented as a static permission node (`gigRerollOption`, read by
  `query.friendlyGigRerollOption`) plus a new `Phase` `'gigReroll'` and a new
  two-option `Action` (`chooseGigReroll`), reached only when the roller
  actually has that static live — so every other player's gig-gain step still
  ends in `main` exactly as before. `pendingGigRoll` remembers which die the
  decision is about, and the phase ends after one answer, whichever it was:
  "once" is once. This is the seam §78 asked for, built once rather than
  half-solved for one card.

## 144 — Would-be-mutation interceptions: roll back, ask, replay

Two cards answer a mutation that is *about to* happen with an optional, costed
decision by the player it would hurt: `jackie-welles-mama-s-favorite` ("If a
friendly Unit would be defeated, you may spend 1 €$ to defeat this Legend
instead.", deferred by §105) and `alt-cunningham-mother-of-daemons`'s second
clause ("When a rival Unit would steal a Gig, you may discard 1 with cost equal
to that Gig's value. If you do, the Gig isn't stolen.", deferred by §72).

Both interception points sit deep inside a synchronous mutation — `defeatUnit`
is reached from fights, effect nodes and mass-defeat scripts, and every caller
goes on to fire triggers that depend on the answer — so neither can simply
return to the reducer to ask a question. §105 called that the whole problem,
and it is: capturing a continuation for "the rest of this fight" is not
something this engine's design supports.

**Ruling: roll back and replay, rather than capture a continuation.**

- the mutation calls `askIntercept`, which consumes the next pre-supplied
  answer for the action currently being applied. When there is none it throws
  `InterceptRequired` (`src/engine/intercept.ts`), which `reduce.ts`'s
  `runAction` catches: the half-finished draft is discarded **wholesale** and
  the ORIGINAL pre-action state comes back with the question attached
  (`phase: 'intercept'`, `pendingIntercept`). Nothing the aborted run touched
  — the rng included — can leak out, which a test asserts directly by checking
  the board is untouched while the question is pending;
- answering re-applies the identical action from that same original state with
  one more answer appended. This is deterministic **because** the rng lives in
  the state being replayed, so the replay retraces the original run exactly up
  to the interception. An action containing several interceptions simply asks
  several times, each round trip adding one answer, which terminates;
- `interceptAnswers` is a transient `GameState` field, always `[]` in any state
  a caller ever sees: `applyAction` fills it for the duration of one replay and
  empties it again before returning. It lives on the state rather than in a
  module-level variable so the engine keeps its "no hidden mutable globals"
  property;
- **`-1` declines**, and any other answer accepts and names what the card asks
  for: the protector's own uid for jackie (self-documenting — "defeat *this
  Legend*"), the discarded hand card's uid for alt. `legalActions` enumerates
  the options with the decline first, and `query.actingPlayer` reports the
  intercepting card's controller for the duration, so the pending decision
  belongs to the right player even in the middle of the *other* player's
  action.

**Sub-rulings:**

- **the seam is `defeatUnit` itself**, after the `defeatShield` check (§46's
  substitution is unconditional and costless, so it settles the question before
  any decision is offered — a shielded Unit is never "would be defeated") and
  before anything else. Every defeat path in the engine therefore passes
  through it, fights and effects and scripts alike, which a dedicated
  `bonnie-and-clyde` test pins down;
- **an unaffordable option is never offered.** `defeatInterceptorFor` returns
  nothing unless the would-be-defeated card is a friendly Unit on the field,
  the interceptor is some OTHER card (defeating jackie to save jackie is not a
  choice), and the controller can actually pay — with the interceptor itself
  barred from paying, the same rule §31 gives a {Go Solo} Legend's own play;
- **"defeat this Legend instead. (Remove it from the game.)"** reaches a
  face-up Legend sitting in the legends zone, not just a {Go Solo}'d one on the
  field, so `leaveField` now filters the `legends` array as well as `field`.
  §31's "remove it from the game" already routes every Legend exit to
  `removed`, and §139 already confirmed that includes a defeat; the substitute
  defeat runs with the interception disabled, which is what guarantees a chain
  of interceptors cannot recurse;
- **alt-cunningham's clause asks the die's owner, before the die moves.** The
  candidates are the victim's hand cards whose printed cost equals the die's
  value exactly, and the clause applies only while the stealing card is a rival
  **Unit** (`isUnitStealer` again, §141). A prevented die stays where it is and
  still consumes one of the steal's `remaining` attempts: "the Gig isn't
  stolen" negates that attempt, and nothing on the card offers the thief
  another pick in its place;
- **an episode can now steal nothing**, which `PendingSteal.taken` records:
  `onFriendlyStealComplete` ("When a friendly Unit steals 1 or more Gigs",
  §133) does not fire for an episode whose every die was intercepted, while the
  per-die `onFriendlyStealDie` simply never fires for a die that never moved.

**Not deferred, and why it matters.** §105 concluded that this card's "entire
functional text IS the gap", so a §79 full-or-defer meant deferring it whole.
That is now moot: the gap is closed, and `jackie-welles-mama-s-favorite` is
encoded in full (one static node) rather than by an rng'd stand-in. The
alternative considered and rejected was §32/§138's "a genuine decision with no
channel to carry it falls to the rng" — legitimate for a card-data-level
choice, but wrong here: spending €$ and removing your own power-8 Legend at
random is a materially different card from the printed one, and unlike
`tetratronic-rippler`'s keep-or-trash there IS a channel available once the
replay seam exists.

## Deferred slice summary

**Cards completed (11 clauses across 11 cards):** `appetite-for-destruction`,
`chrome-fang`, `cyberpsychosis`, `safety-override`, `reboot-optics` (§141);
`chrome-reverie`'s attack-denial clause (§141);
`evelyn-parker-beautiful-enigma`'s {Spend} ability and `mox-inciters` (§142);
`kerry-eurodyne-axe-attitude-audience` (§143);
`jackie-welles-mama-s-favorite` and
`alt-cunningham-mother-of-daemons`'s steal-interception clause (§144).

**Vocabulary extensions:** `floatingEffect`, `gigRerollOption`,
`defeatInterceptSelf`, `stealInterceptByDiscard` (`EffectNode`);
`FloatingSpec`/`FloatingExpiry` (a new strict union carried by
`floatingEffect`); `onGigRoll` (`Trigger`); `rolledExtremeValue`,
`rolledDieSizeAnyOf` (`EffectCondition`); `equipped` (`TargetFilter`).

**Engine (non-vocabulary):** `GameState.floatingEffects`, `pendingGigRoll`,
`pendingIntercept`, `interceptAnswers`; `PendingSteal.taken`; `Phase`
`'gigReroll'`/`'intercept'`; `Action` `chooseGigReroll`/`answerIntercept`;
`src/engine/intercept.ts` (the ask/abort primitive); `reduce.ts`'s
`runAction`/`dispatch` split with the replay loop;
`combat.ts`'s `stealableDieIndexes` (the single authority on what a steal may
take), the fight-consequence hooks, and the `defeatUnit`/`takeStolenGig`
interception seams; `effects.ts`'s `resolveNodeOnDraft` and
`fireGigRollTrigger`.

**Deferral rulings closed:** §52 (with §79/§91/§132/§140's additions), §72's
clause 2, §78, §105, §132's two partial encodings, §140's two cards. Each now
carries an "implemented" pointer to the ruling above that closed it.

**Completeness:** `tests/cards/completeness.test.ts` asserts 141/141 — every
card either carries an `EffectDef` or appears in an explicit, per-card
`NO_RULES_TEXT` list (11 cards whose whole printed text is flavour, an
equip/keyword reminder, or empty). There are **no deferral allowances**. The
same file checks that every `scripted` node name resolves in `scriptedCards`,
that no script is dead, and that every card's informational `scripted` field
matches a node it actually uses.

# Task 8 deferred slice — fix round 1 (review)

The slice review returned two Important findings, both fixed in place above
(§141 carries a pointer to the first) rather than appended as
untouched-original-plus-patch, matching how §67, §80 and §133 documented their
own fix rounds.

## 145 — Attack power is one number, and a trigger seam may not clobber the
phase it opened

**1. The steal cap and the steal count read the same power (Important).**
`stealValueCap` (§141, chrome-fang) capped at bare `effectivePower` while
`resolveAttack` derives the steal COUNT from `effectivePower +
attackPowerBonus` (§111). A Unit attacking under
`saburo-arasaka-stubborn-patriarch` ("Friendly ARASAKA Units have +1 power
while attacking") or `saul-bright-stormrider` ("Other friendly Units have +2
power while attacking") therefore stole as if power+N but was capped as if
power+0 — reachable with real cards, and visibly wrong: the same attack was
being priced with two different powers.

**Ruling (controller):** an attacking Unit's power is a single number, and
every rule that reads "its power" during that attack reads the same one. This
is the general form of the reading §141 already applied to
`appetite-for-destruction`'s fight margin ("the same two numbers `fight()`
already compares", attack bonuses included) and of §111's own scope note
(`attackPowerBonus` covers "fight power and Gig-steal power alike").
`stealValueCap` now returns `effectivePower + attackPowerBonus`.

**TDD evidence:** a new synthetic case fields a power-3 thief alongside a
friendly `attackPowerBonus: 2` static against a capped victim holding dice of
value 2, 5 and 6, and asserts the value-5 die is now in reach while the
value-6 one is not. Verified failing-first by reverting `stealValueCap` to bare
`effectivePower` and re-running: that one case fails (the value-5 die is not
offered), and it is the only failure, so nothing else in the suite depended on
the old reading.

**2. `chooseGigDie`/`chooseGigReroll` clobbered the phase after firing
`onGigRoll` (Important).** Both handlers fired the roll trigger and then
assigned `draft.phase` unconditionally. An `onGigRoll` effect that opens a
decision of its own — a `stealGig` node setting `phase: 'chooseGig'` plus a
`pendingSteal` — had that decision silently overwritten, stranding the pending
steal. No card in the pool reaches it today (kerry's clauses only draw), but
the seam is public API that the fuzz harness, the AI and the UI all drive.

**Ruling:** the gig-gain step hands control back through one helper,
`settleAfterGigRoll(draft, resume)`, which follows the shape `declareAttack`
already established for the identical situation on the attack seam (§32's
"an on-attack effect can owe the attacker a Gig-die choice; they take it
first"): if the trigger left a pending steal, the steal keeps the phase and
`resume` becomes its `resumePhase`; otherwise `resume` is assigned directly.
`resume` is `'gigReroll'` when the roller has a live `gigRerollOption` static
(§143) and `'main'` otherwise, so the reroll decision is now *deferred* behind
the steal rather than lost to it. `pendingIntercept` deliberately needs no
equivalent guard: an interception never sets a phase from inside a mutation —
it throws, and `runAction` discards the whole draft and asks from the
pre-action state (§144).

**TDD evidence:** a new synthetic case gives a Legend an unconditional
`onGigRoll` → `stealGig`, and drives both landing phases: without the reroll
static the steal owns `chooseGig` and hands back to `main`; with it, the steal
is taken first and hands back to `gigReroll`, and the *reroll's* own trigger
firing then does the same again, ending in `main` with all three dice
(one rolled, two stolen) in the roller's Gig area. Verified failing-first by
deleting the guard and re-running: that one case fails, nothing else.

**Deferred minors, ledgered here, not fixed (they touch lines this round does
not):** `defeatUnit` accepts any answer other than `-1` as an acceptance
without checking it equals the offered protector uid, where the steal seam does
validate against its candidate list (asymmetric, but every value reaching it
came from `legalActions`' own option list); a declined interception writes no
`effectResolved` event, so the log shows only the accepted ones; an
`appetite-for-destruction` steal interleaved with a `safety-override` defeat
can leave `pendingSteal.attacker` pointing at a trashed card, which silently
turns chrome-fang's cap off for the remainder of that episode
(`isUnitStealer` fails the field check); `rivalFightNoDefeat`'s controller
predicate is vacuous in a two-player game and its comment does not say so; and
`forcedAttackers` (query.ts) carries a second `as number` cast the slice report
did not disclose — the slice report claimed one cast, there are two.

# Task 9 — fuzz harness, fix round 1

`tests/fuzz/invariants.test.ts` plays thousands of random-vs-random games
(both curated demo decks and freshly-generated legal synthetic decks,
`tests/fuzz/deckGenerator.ts`) and checks a battery of structural invariants
after every applied action. At default scale (300 seeds) nothing broke; at
6,000–20,000 seeds it found five bugs, four of them the same missing
convention repeated at four different call sites: once `endGame` commits
`winner`/`phase: 'gameOver'`, nothing downstream may still run as though the
game were live. §145's item 2 above (`chooseGigDie`/`chooseGigReroll`
clobbering a phase an `onGigRoll` trigger opened) is the same family, found
one round earlier by hand-review instead of by fuzzing.

## 146 — Once the game ends mid-resolution, nothing else may still run

**1. `callLegend`'s own flip can be outrun by a nested free Call it just paid
for (Important).** `callLegend` (`reduce.ts`) spends its payment, THEN picks
a uniformly random face-down Legend to flip. `arasaka-emergency-radioport`'s
own text — "When this Unit or Legend is spent, you may ... Call it for
free" — is a Gear, `onSpend`-triggered, propagated (`GEAR_PROPAGATED_TRIGGERS`)
from whichever Legend wears it. Paying for an explicit Call a Legend by
spending a Legend that happens to wear this Gear fires that Gear's own nested
free Call BEFORE the outer call's flip runs — and when only one face-down
Legend exists on the board, the nested call already flips it (and marks
`calledLegendThisTurn`), so the outer call's own `p.legends.filter(!faceUp)`
comes back empty. `nextInt(rng, 0)` then hands back index 0 of an empty
array, and `draft.cards[undefined].faceUp = true` throws.

**Ruling:** "You may only Call a Legend once per turn" is a hard cap of one
flip per player per turn, full stop — including when a nested Gear-driven
free Call gets there first while paying for an entirely separate,
explicit Call a Legend. The outer call fizzles — the same "a vanished
target simply fizzles the resolution, cost already spent" shape
`resolveAttack` already uses when a quick effect defeats or bounces a
combatant mid-react (that one is a code comment there, not its own numbered
entry in this log — corrected here after review; an earlier draft of this
entry mis-cited it as §27, which is actually about blocking closing the
react window, a different rule): the €$ (or spent-Legend) cost already paid
stands, but the call itself does nothing further. Fixed by checking
`p.calledLegendThisTurn` (set the moment ANY flip lands, nested or not) and
`faceDown.length === 0` before touching the rng, both as early returns ahead
of the flip.

**TDD evidence:** `tests/cards/red.test.ts`'s `arasaka-emergency-radioport`
suite gains a case that equips the Gear onto a face-up Legend, leaves exactly
one OTHER Legend face-down, and pays for an explicit `callLegend` with the
Gear's host — asserting the face-down Legend still flips (the nested call did
it), `calledLegendThisTurn` is true, and exactly one `legendCalled` event
exists (the outer call fizzled, it did not also try for a second Legend).
Verified failing-first: reverting the two-line guard reproduces the exact
`Cannot set properties of undefined (setting 'faceUp')` crash the fuzz
harness printed (seed 500142, synthetic decks).

**2. A Program sat in no zone at all while its own `onPlay` resolved
(Minor).** `playCardOnDraft` fired a Program's `onPlay` effects, THEN moved it
to the trash — deliberately, per its own comment, "so a `self` reference
still works while it resolves." Between leaving hand and landing in trash, a
Program's uid is in `state.cards` but in none of the seven zone arrays. A
Program whose OWN `onPlay` (or the `onFriendlyCardPlayed` watcher it can
chain into) ends the game outright — a forced draw off an empty deck,
deckout — leaves the game over with that Program permanently unzoned, and the
"move it to trash" bookkeeping that ran anyway afterward appended a
`cardTrashed` event AFTER the terminal `gameEnded` one.

**Ruling:** no printed Program effect in the 141-card pool targets a
trash-zone card of its own (checked exhaustively — none use
`friendlyTrashCard`/`friendlyHandOrTrashUnit`/`friendlyHandOrTrashProgram`),
so the "self reference" the original comment guarded against cannot actually
observe the zone change. A Program now moves to the trash immediately — in
the same `switch` arm that pushes a Unit onto the field or a Legend's
`faceUp`/`lag` flip, ahead of `onPlay` — exactly mirroring how a Unit/Legend
is placed in its own zone before its own `onPlay` fires. It is *never* in no
zone at all, whatever its own effects do.

**TDD evidence:** `tests/engine/economy.test.ts` gains a case playing
`industrial-assembly` ("Increase a Gig by up to 4. If it now has 8+ value,
draw 1.") with the sole friendly Gig die swapped to a d10 showing 4 (so the
+4 reaches exactly 8 without a d4's own face capping it) and the deck
emptied, asserting `gameOver`/`winner`/a `gameEnded`-terminal event log AND
that the Program landed in the trash. Verified failing-first: reverting
`effects.ts` reproduces the trailing `cardTrashed` event past `gameEnded`.

**3. `endAttack` clobbered a fight-ended game back to `main` (Important).**
`resolveAttack` calls `fight()` (which can chain into an `onDefeat`/
`onUnitDefeated`-triggered draw and a deckout), then unconditionally calls
`endAttack`, which unconditionally sets `draft.phase = 'main'` (or
`'chooseGig'`) — overwriting the `'gameOver'` `endGame` had just committed.
`winner` stayed correctly set, so `legalActions` still correctly returned
`[]` (it checks `winner` first), but `phase` lied about it, and
`pendingAttack` was left dangling.

**Ruling:** `endAttack` is bookkeeping for a LIVE game; once `winner` is set
there is nothing left to hand back to. Fixed with a one-line guard at the top
of `endAttack`, matching the "stop touching anything once the game is over"
convention every other phase-setting seam in `game.ts`/`reduce.ts` already
followed (`beginTurn`, `declareAttack`, `settleAfterGigRoll`'s callers) —
this one function had simply been missed.

**TDD evidence:** `tests/engine/combat.test.ts`'s `fights` suite gains a case
equipping `satori-sword-of-saburo` (`{onWinFight}` draw 1) onto an attacker
that wins its fight, with the deck emptied first — asserting `phase ===
'gameOver'` survives the win. Verified failing-first: reverting the guard
reproduces `phase === 'main'` with `winner` still set (seed 6198, starter
decks).

**4. `finishSteal` clobbered a steal-ended game back to `chooseGig`/`main`
(Important).** The mirror image of #3, one level down: `takeStolenGig` fires
`onFriendlyStealDie`/`onFriendlyStealComplete` (either of which can chain into
a deckout-causing draw — `rogue-amendiares-preem-solo`'s "if its value is
even, draw 1"), then unconditionally calls `finishSteal`, which unconditionally
resumes into `chooseGig` or the interrupted phase.

**Ruling:** same as #3 — `finishSteal` gets the same one-line guard.

**TDD evidence:** `tests/engine/combat.test.ts`'s `gig-area attacks` suite
gains a case fielding `rogue-amendiares-preem-solo` (a `{Go Solo}` Legend,
so `stealerIsLegend` reads true) stealing a single even-valued die with the
deck emptied, asserting `gameOver` survives the completed steal. Verified
failing-first the same way as #3.

**5. The `'scripted'` EffectNode wrapper logged a trailing note after
`gameEnded` (Minor).** Every scripted card function that can deckout
(`jackie-welles-pour-one-out-for-me` and half a dozen siblings in
`scripted/index.ts`) already returns immediately after calling `endGame`
itself — but the generic `'scripted'` case in `applyNode` (`effects.ts`) then
logged its OWN `effectResolved` "scripted:..." note unconditionally
afterward, regardless of what the script just did.

**Ruling:** the wrapper's bookkeeping is subject to the same rule as
everything else in this round — once `winner` is set, stop. Guarded with the
same one-line check before the `note()` call.

**TDD evidence:** `tests/cards/blue.test.ts`'s
`jackie-welles-pour-one-out-for-me` suite gains a case decreasing the sole
friendly Gig die to a min Gig with the deck emptied, asserting the last event
is `gameEnded`, not a trailing `effectResolved`. Verified failing-first
(seed 4511, starter decks).

**Hardening beyond the five reproduced failures:** `fireCardTrigger`'s
per-effect loop, `fireWatcherTrigger`'s per-watcher loop, and
`fireTriggerOnDraft`'s Gear-propagation loop now all stop the instant
`draft.winner !== null`, not just after the specific calls #1/#5 above
needed. No card in the current 141-card pool reaches the wider gap this
closes (a multi-effect card, or a multi-watcher broadcast, where an EARLIER
entry ends the game and a LATER one would otherwise still run) — ledgered
here as hardening without its own isolated repro, the same status §145 gave
its `onGigRoll` finding before this round's fuzzing happened to reach it a
different way.

**Scale note:** the fuzz harness's default 300 seeds passed clean before any
of the above were found — all five needed thousands of seeds to surface.
Two consecutive clean runs at 6,000, then at 20,000, then a single clean run
at 60,000 seeds (0% action-cap hit rate throughout; `sevenGigs`/
`overtimeMajority`/`deckout` all naturally represented) close this round.

# Task 9 — fuzz harness, fix round 2 (review)

A task review of fix round 1 above returned one Critical and two Important
findings. This round fixes the Critical, centralizes the "once the game
ends, nothing else may run" guard instead of hand-copying it call site by
call site (the Important the Critical's own root cause was traced to), and
restates the brief's turn-bound invariant — silently dropped in round 1 in
favor of the action cap alone — as a real, computed ceiling. It also
corrects a mis-citation in §146.1 above (fixed in place there, not repeated
here): that entry attributed the "a vanished target simply fizzles" shape to
§27, which is actually about a block closing the react window — a different
rule. No numbered entry documents the fizzle shape itself; it is a code
comment in `resolveAttack`, not a rulings.md ruling, and §146.1's citation
now says so.

## 147 — `endGame` becomes the one idempotent choke point; the trigger
wrappers guard their own entry; a real turn-number ceiling

**1. CRITICAL — `blockAttack` fell through into a full fight/steal on a
game that had just ended.** `blockAttack` fires `onBlock` then
`onFriendlyBlock` (a watcher broadcast to every friendly in-play card) and
then unconditionally calls `resolveAttack`, which unconditionally proceeds
into `fight()` for a redirected attack. Neither `onBlock`/`onFriendlyBlock`
firing, `resolveAttack`, nor `fight` itself checked `draft.winner` first.
`goro-takemura-vengeful-bodyguard` (`{onFriendlyBlock}`: discard 1, draw 1)
blocking with the controller's deck empty and hand non-empty is reachable
today: the discard/draw ends the game via deckout mid-`{Blocker}`, and the
engine then ran a complete fight (or steal) to conclusion on top of a
finished game — defeating units, moving Gigs, logging events, all after
`gameEnded`.

**2. IMPORTANT — round 1's fix was seven-plus hand-copied
`if (draft.winner !== null) return` checks with no shared idiom, which is
exactly what let the Critical above slip through.** Round 1 guarded the
specific call sites a reproduced failure pointed at
(`endAttack`, `finishSteal`, the `'scripted'` node wrapper, three
per-iteration loop checks) but never asked "what's the SMALLEST set of
functions that, if guarded at their own entry, protect every caller —
present and future — by construction?" `blockAttack`'s fall-through is
what that gap costs: a sixth call site of the identical bug class, sitting
one function away from three that were already fixed.

**Ruling (architecture):** guard the choke points themselves, not their
callers:
- `endGame` (`game.ts`) is now idempotent — `if (draft.winner !== null) return`
  as its first line. It is the ONE function every ending
  (`sevenGigs`/`overtimeMajority`/`deckout`/`concede`) funnels through, so
  this single change makes a duplicate/conflicting second call harmless
  everywhere, not just at the sites this round happened to look at.
- `fireCardTrigger`, `fireTriggerOnDraft`, `fireWatcherTrigger`
  (`effects.ts`) — the three "trigger-firing wrappers" — now all guard their
  own entry, on top of the per-iteration checks round 1 already added
  inside them. A caller that fires a SECOND trigger after an earlier one
  already ended the game (`spendOnDraft`'s payment loop, `playCardOnDraft`'s
  `onPlay` → `onFriendlyCardPlayed`, `takeStolenGig`'s
  `onFriendlyStealDie` → `onFriendlyStealComplete`) is now safe without
  ANY of those call sites needing their own check — this is what "by
  construction" means in practice: six previously-fragile call sites closed
  by two functions gaining one line each.
- `resolveAttack`, `fight`, `defeatUnit`, `defeatGear`, `resolveNodeOnDraft`
  (the non-trigger "resolution choke points" a fight/defeat/steal actually
  runs through) each gain the same one-line entry guard.
  `resolveAttack`'s is what fixes the Critical: `blockAttack`'s fall-through
  now hits it and no-ops immediately, whichever watcher ended the game.
  `defeatUnit`'s protects a SECOND simultaneously-defeated Unit in a tied
  fight (a real ruling, not just a safety net: once the game has ended
  mid-fight, the other casualty of the SAME tie simply stays wherever it
  currently sits — the game is over, full stop, the same "freeze
  everything" reading round 1 already gave `endAttack`/`finishSteal`).
- `fight` itself additionally gains one guard mid-body, right after its own
  defeat loop and before computing the winner/floating-effects tail
  (`winFightMarginSteal`'s `resolveNodeOnDraft` call, `loseFightDefeatFoe`'s
  `defeatUnit` call): those two are reached via a plain function call, not
  a trigger wrapper, so nothing else automatically protects them.
- `blockAttack` and `playCardOnDraft` each also needed one LOCAL guard,
  because they spend a cost (the blocker; the payment) whose OWN
  `{Spend}` trigger can end the game before the rest of the function's
  bookkeeping runs — `blockAttack` right after `spendOnDraft([blocker])`,
  before the `attackBlocked` event. `playCardOnDraft` needed a small
  reorder instead of a bare guard: its zone assignment (the field/trash/
  Gear-equip push) now happens BEFORE `spendOnDraft(payment)`, not after,
  so the just-played card is ALWAYS correctly zoned even if the payment's
  own `{Spend}` trigger (e.g. §146.1's nested free Call) ends the game
  before `spendOnDraft` returns — the guard sits right after `spendOnDraft`,
  ahead of the `cardPlayed` event and everything past it.

**Sweep results:** every `fireCardTrigger`/`fireTriggerOnDraft`/
`fireWatcherTrigger` call site in `src/` was re-examined for what runs
immediately after it, with the entry guards above already in place:

| Site | Verdict |
|---|---|
| `effects.ts` `changeGig`/`swapGig`/`matchGig` → `onRivalAdjustFriendlyGig` | Safe — each `case` `return`s immediately after; the enclosing `sequence`/`sameTarget`/`chooseOne` iterators already checked `winner` between sibling nodes (pre-existing, not this round's work) |
| `effects.ts` `fireTriggerOnDraft`'s own Gear-propagation loop | Safe — per-iteration guard (round 1) + this round's entry guard |
| `effects.ts` `spendOnDraft`'s per-uid loop (`onSpend`, `onFriendlyEquippedSpend`) | Fixed by construction — a later uid's fire call now no-ops the instant an earlier uid's trigger ends the game |
| `effects.ts` `fireWatcherTrigger`'s own per-watcher loop | Safe — per-iteration guard (round 1) + this round's entry guard |
| `effects.ts` `fireGigRollTrigger` (wraps one `fireWatcherTrigger` call) | Safe — last statement in its own function; all 3 callers (`reduce.ts` ×2, the `rerollGig` node) already `return`/check right after |
| `effects.ts` `playCardOnDraft`'s `onPlay` → `onFriendlyCardPlayed` | Fixed by construction (the watcher wrapper's entry guard) — no local change needed beyond the reorder in #2 above |
| `combat.ts` `declareAttack`'s `onAttack`/`onFriendlyAttack` | Safe — pre-existing explicit checks after each (round 0, before this task) |
| `combat.ts` `defeatUnit`'s `onUnitDefeated` (both players) | Safe — pre-existing explicit check right after (round 0) |
| `combat.ts` `defeatUnit`'s `onDefeat` (uid + its Gear, in a loop) | Safe — last statements in the function; a second Gear's fire now also guarded by construction |
| `combat.ts` `defeatGear`'s `onDefeat` | Safe — last statement in the function |
| `combat.ts` `fight`'s `onLoseFight` (looped over up to 2 defeated uids) | Fixed by construction for a second casualty; the loop's OWN first casualty is what can end the game, and nothing runs between iterations besides the now-guarded fire call |
| `combat.ts` `fight`'s `onWinFight` | Fixed — the new post-defeat-loop guard returns before this is even reached |
| `combat.ts` `blockAttack`'s `onBlock`/`onFriendlyBlock` → `resolveAttack` | **Fixed — the Critical.** `resolveAttack`'s new entry guard |
| `combat.ts` `takeStolenGig`'s `onFriendlyStealDie` → (bookkeeping) → `onFriendlyStealComplete` → `finishSteal` | Fixed by construction — `onFriendlyStealComplete`'s own call now no-ops if `onFriendlyStealDie` already ended it; `finishSteal` was already guarded (round 1) |
| `reduce.ts` `startTurn`'s `onStartTurn` | Safe — last statement, reached only past `beginTurn`'s own check (round 0) |
| `reduce.ts` `callLegend`'s `onCall` | Safe — last statement in the function |
| `reduce.ts` `endTurn`'s `onEndTurn` | Safe — pre-existing explicit checks after it and after `resolveEndOfTurnFloating` (round 0), and `resolveEndOfTurnFloating`'s own `defeatUnit` loop already re-checks per iteration |

Net: one Critical fixed directly (`resolveAttack`'s entry guard), five more
call sites fixed AS A SIDE EFFECT of the three trigger-wrapper entry guards
alone (no per-site code), and everything else in the sweep was already
correctly guarded before this round — mostly by the codebase's own
pre-existing convention (round 0, predating this task) rather than round 1's
patches.

**3. IMPORTANT — the brief's "turn 30" invariant was replaced with an
action cap alone, never re-derived as its own check.** Round 1 substituted
the brief's turn-bound guess with `ACTION_CAP = 400` (measured) and reported
the substitution, but never added a turn-NUMBER assertion at all — a
distinct invariant from "how many actions did this take."

**Ruling:** compute the real ceiling instead of re-guessing one.
`deck.ts`'s `MAX_DECK_SIZE` is 50; `OPENING_HAND_SIZE` is 6; every turn's
`beginTurn` forces exactly one more draw per player, unconditionally
(the same rule the opening-hand/mulligan draw already uses to end the game
on failure). With zero extra-draw effects and zero cards ever returned to a
deck — the worst case for how LONG a deck can last — a 50-card deck's owner
decks out on their 45th own turn (`50 - 6 = 44` further draws exhausts it;
the 45th is the one that fails). Since `turnNumber` advances once per
ROUND, that is `turnNumber === 45`; extra draws only shorten this, and no
printed effect returns cards to a deck fast enough, or often enough, to
plausibly race a uniform-random agent past it turn after turn.
`MAX_TURN_NUMBER = 50` (`tests/fuzz/invariants.test.ts`) is that computed 45
plus a flat margin — a real, provable-for-normal-play ceiling, not the
brief's blind 30 and not an arbitrarily large number either. It is checked
every action (via `checkInvariants`), not only at game end, so a genuinely
unbounded game fails on `turnNumber` growing past it, independent of
whether it would also eventually trip `ACTION_CAP`.

**Measured:** an instrumented 24,000-seed sample (4,000 then 20,000,
starter- and synthetic-deck matchups mixed) found a maximum observed
`turnNumber` of **14** — nowhere near either the brief's 30 or the computed
45, because `checkOvertimeWin` (turn 8+) ends most games within a few turns
of overtime starting, well before any deck gets close to running out. The
brief's 30 was not wrong in spirit, just unexamined; 14 observed vs. 50
enforced leaves both a real margin and a real ceiling.

**Verification for this round:** `npx vitest run` (full suite) and
`npm run build` green; a ≥20,000-seed fuzz confirmation run clean at the
final committed state (see task-9-report.md for the exact count and
timing).

# Task 9 — fuzz harness, fix round 3 (review)

A re-review of fix round 2 confirmed its Critical and one Important finding
addressed, but returned the second Important as still open: §147's sweep of
`fireCardTrigger`/`fireTriggerOnDraft`/`fireWatcherTrigger` call sites
covered `src/engine/combat.ts`, `src/cards/effects.ts` and `src/engine/
reduce.ts` — every FILE with a call site EXCEPT `src/cards/scripted/
index.ts`, which has 11 of its own `fireTriggerOnDraft` calls and was never
looked at. Four of those 11 have the identical bug shape. This round closes
that gap and analyzes (rather than silently accepting) one Minor behavioral
side effect §147's `playCardOnDraft` reorder introduced.

## 148 — The scripted-card escape hatch needed its own sweep; a script's own
body can't be guarded from the outside

**Why `scripted/index.ts` needed a DIFFERENT fix shape than §147's.** Every
choke point §147 guarded (`resolveAttack`, `fight`, `defeatUnit`, the three
trigger wrappers) is a shared function many callers reach through, so one
entry guard protects all of them "by construction." A scripted card's body
is the opposite: each one is a bespoke, one-off sequence no other code
calls into, so nothing outside the script can know what — if anything —
still needs to run after its own nested `fireTriggerOnDraft` call. The fix
here is a NAMED helper (`stillLive(state)`, `game.ts`) scripts check
explicitly, plus a permanent static sweep (`tests/engine/
scriptedGameEndGuards.test.ts`) that re-derives the same "is anything
unguarded after this fire" answer from the source text on every run, so a
future script that adds an unsafe `fireTriggerOnDraft` call fails CI instead
of waiting for a fuzz seed to find it.

**The four bugs**, all "fires a revived/revealed card's own `onPlay`, then
unconditionally logs a trailing zone-change event afterward":

1. **`the-relic-experimental-biochip`** — revives a Unit from trash, fires
   its `onPlay`, then unconditionally bottom-decks the Gear's defeated host.
2. **`alt-cunningham-soulkiller-architect`** — plays a Program from trash
   (paying its cost separately), fires its `onPlay`, then unconditionally
   bottom-decks it.
3. **`judy-a-lvarez-nothing-to-doubt`** — reveals the top card; for a
   Program, fires its `onPlay`, then unconditionally trashes it.
4. **`lizzy-wizzy-delicate-weapon`** — plays a Program for free, fires its
   `onPlay`, then unconditionally bottom-decks it.

**Ruling, and why the fix is NOT uniform across all four:** the naive fix —
"just add `if (!stillLive(state)) return state` right after the fire" —
is wrong for three of the four, because it would leave the played/revived
card in NO zone at all if the game ends right there (the same zone-
consistency bug §147.2 already fixed for `playCardOnDraft`'s Programs).
Which fix actually applies split three ways:

- **#1 (`the-relic-experimental-biochip`) needed only the guard, no
  reorder.** The revived Unit is already placed on the field BEFORE its
  `onPlay` fires (unaffected by this bug). The thing bottom-decked
  afterward is a DIFFERENT card — the Gear's already-defeated host, which
  was already sitting validly in `p.trash` before this script ran. Skipping
  that bottom-deck on a finished game just leaves it exactly where it
  already validly was — no zone violation, so a bare `stillLive` guard
  after the fire is sufficient and correct.
- **#3 (`judy-a-lvarez-nothing-to-doubt`) needed a reorder, not a guard.**
  For its Program branch, the revealed card sat in NO zone until the
  trailing `p.trash.push`, exactly `playCardOnDraft`'s original bug shape.
  Fixed the same way §147.2 fixed it: the Program now enters `p.trash`
  BEFORE `onPlay` fires, so it's always zoned; `onPlay` is now this
  script's last act and needs no guard at all (no printed Program effect
  targets a trash-zone card of its own, so this can't let it see itself as
  already-trashed, the same reasoning §147.2 already verified).
- **#2 and #4 (`alt-cunningham-soulkiller-architect`,
  `lizzy-wizzy-delicate-weapon`) needed a guard AFTER a reorder that stops
  short of the naive one.** Both bottom-deck the Program into `p.deck` —
  and unlike moving a Program into `p.trash` early (safe: nothing reads
  trash mid-`onPlay`), moving it into the DECK before `onPlay` fires is
  actively wrong: `onPlay` can itself be a draw effect (`floor-it`'s
  unconditional "draw 1"), which would then immediately re-draw the very
  card that was just bottom-decked, contradicting "bottom-deck it AFTER you
  play it." So the bottom-deck stays exactly where it was — after
  `onPlay` — and the fix is a `stillLive` guard placed AFTER that
  bottom-deck (which always completes: the Program must land somewhere
  regardless of what `onPlay` just did) but BEFORE the trailing
  `cardBottomDecked` event. `alt-cunningham-soulkiller-architect` also
  separately pays a cost inside its own script (`spendOnDraft`, the
  Program's own play cost, on top of the activated ability's own already-
  paid cost); that payment's own `{Spend}` trigger gets the same guard
  BEFORE the Program is even removed from `p.trash`, so it simply stays put
  if paying for it already ended the game — never reaching a state with
  nowhere to be either.

**TDD evidence:** a lint-style test
(`tests/engine/scriptedGameEndGuards.test.ts`) statically re-derives the
whole sweep from the source text — for every `fireTriggerOnDraft(` call
site, it scans forward and requires a `stillLive(state)` check, a bare
`return state`, or a chained `fireTriggerOnDraft(` before any
`state.events.push(`; a zone-only mutation (a `p.deck.push`/`p.trash.push`
finishing a bottom-deck/trash placed deliberately AFTER the fire, per the
reasoning above) does not by itself fail the scan, since it isn't the
mechanically-observable symptom (an event surviving past `gameEnded`) this
sweep exists to catch. It also pins the exact list of the 11 sites in file
order, so a new one changes a length assertion on purpose, not silently.
Verified failing-first by reverting `scripted/index.ts` and `game.ts`
together: the lint test reports exactly the four buggy sites by name, and a
staged regression (`tests/cards/blue.test.ts`, `alt-cunningham-soulkiller-
architect` reviving `floor-it` from trash against an empty deck) reproduces
the real symptom — first a trailing `cardBottomDecked` event past
`gameEnded` (against the very first, over-eager reorder attempt this round
made and then corrected once the `floor-it` self-redraw problem above was
found), then, against the true pre-fix code, the same trailing event again.
Both fixed states pass; both reverted states fail.

**The full sweep, `scripted/index.ts` call sites appended to §147's table:**

| Site | Verdict |
|---|---|
| `arasaka-emergency-radioport` (`onCall`) | Safe — last statement before `return state` |
| `yorinobu-arasaka-steel-dragon` (`onPlay`) | Safe — the played Unit already entered `p.field` before the fire; last statement before `return state` |
| `t-bug-amateur-philosopher` (`onCall`) | Safe — last statement before `return state` |
| `the-heist` (`onPlay`) | Safe — the Gear already attached before the fire; `return state` immediately follows |
| `the-relic-experimental-biochip` (`onPlay`) | **Fixed — guard.** See #1 above |
| `river-ward-detective-on-the-hunt:free-gear` (`onPlay`) | Safe — the Gear already attached before the fire; last statement before `return state` |
| `viktor-vektor-you-might-feel-a-little-pinch` (`onPlay`) | Safe — the Gear already attached before the fire; last statement before `return state` |
| `alt-cunningham-soulkiller-architect` (`onPlay`) | **Fixed — reorder (bottom-deck stays after) + guard.** See #2 above |
| `chrome-reverie` (`onCall`) | Safe — last statement before `return state` |
| `judy-a-lvarez-nothing-to-doubt` (`onPlay`) | **Fixed — reorder (Program zoned into trash before the fire); now terminal, no guard needed.** See #3 above |
| `lizzy-wizzy-delicate-weapon` (`onPlay`) | **Fixed — reorder (bottom-deck stays after) + guard.** See #4 above |

Net for this round: 4 of 11 scripted sites fixed, none of them by the same
mechanical patch — each needed its own zone-safety analysis, which is
exactly why a shared choke-point guard (§147's approach) doesn't reach this
file and a per-site, tool-checked sweep does.

## 149 — Analyzed, not silent: a face-up Legend that is both a new Gear's
host and part of its own payment now reads as "equipped" the moment it's
spent

§147's `playCardOnDraft` reorder (moving a Gear's own equip onto its host
BEFORE `spendOnDraft(payment)` runs, to fix the zone-consistency bug that
review round found) has a side effect nobody had traced through: if the
SAME face-up Legend is both the newly-played Gear's host and one of the
cards spent to pay for it, `spendOnDraft` now sees `attachedGear.length > 0`
on her at the moment it spends her — because the equip already happened —
so `alt-cunningham-mother-of-daemons`'s "When a friendly equipped Unit or
Legend is spent, draw 1" now fires for a combination it did not fire for
before this task's round 2. No card in the 141-card pool breaks from this
today.

**Ruling (intended, not a bug):** the pre-round-2 ordering asked "is this
card equipped" before the very equip its own play was causing had actually
happened — an accident of implementation sequencing, not a reasoned rule
distinction, since nothing about "Legends pay whether face-up or face-down"
(economy.ts) or the printed Gear text ("Equip to a friendly Unit or face-up
Legend") forbids a Legend paying for the Gear that's about to sit on her.
By the time she is actually spent, she genuinely does carry that Gear on
the board — the new reading is the more accurate one, not merely the
incidental one, and it is kept rather than special-cased away (e.g. by
excluding a Gear's own host from `canonicalPayment`, which would add a
restriction the printed rules never state).

**TDD evidence (pinning, not failing-first — this is a kept behavior, not a
bug fix):** `tests/cards/yellow.test.ts`'s `alt-cunningham-mother-of-
daemons` suite gains a case fielding her as the watcher, with a separate
face-up Legend serving as both `mantis-blades`' equip host and its sole
payment card (a `{ eddies: 0 }` fixture forces the canonical payment to
reach for the Legend, since no eddie exists to prefer instead) — asserting
the Legend ends up both equipped and spent, and that Alt's own draw
actually fired (`cardDrawn` in the event log).

## 150 — What the heuristic AI is allowed to look at (Task 10)

`legalActions` hands an agent a list; nothing in the engine stops that
agent from reading the whole `GameState` it is given, rival hand included.
The brief's constraint is that the AI must not — so this entry is the
information policy the Task 10 agent holds itself to, and the seam where it
cannot hold itself to it completely.

**Ruling (the clean part):** `src/ai/evaluate.ts` is the AI's *only*
scoring read of the state, and it reads exclusively public facts: both Gig
areas (sizes and top faces), both fields' `effectivePower` (Units are
played face-up, and `query.inPlay` already withholds a face-down Legend's
statics, so no face-down identity can leak into a power number), face-up
Legend counts, ZONE SIZES only for hand/deck/eddies (a face-down €$ is
worth exactly 1 €$ whichever card it is, so its identity is never
material), the ready/spent split of the eddies and legends zones, and
`winner`. It never reads the rival's hand contents, either deck's contents
or order, or any face-down Legend's `defId`. Ignoring its OWN hand's
contents too is not required by the brief but is what lets the invariance
test shuffle *both* decks in a clone and still demand a bit-identical
score.

**Ruling (the seam):** `applyAction` is the simulator, and simulating an
action necessarily rolls the dice and draws the cards that action causes —
so a candidate's resulting state can contain facts the AI could not have
known when it chose. That is the engine simulating rather than the AI
peeking, and it cannot steer the choice through `evaluate` (which scores
zone sizes, not contents). It *can* steer it wherever the rng outcome is
the whole point of the decision, so the three decisions of that shape are
answered by policy BEFORE any simulation runs, rather than by argmax over
simulated outcomes:

  * `chooseGigDie` — take the largest die still in the fixer. Every die is
    rolled in eventually (turns 1-6), so the order only decides how much
    Street Cred arrives early; simulating instead would pick whichever die
    happened to roll well against the current rng state.
  * `chooseGigReroll` (§143) — reroll exactly when the face *already
    showing* is below the die's own average. Decided from the face it has,
    never from the face it would land on.
  * `mulligan` — judged from the hand the AI already holds (its own hand is
    legitimately visible), never from the hand it would draw.

`choosePlayOrder` is likewise a fixed answer, since simulating it deals
both opening hands.

**Residual, documented compromise:** a simulated `playCard`/`activateAbility`/
`attack` whose effect draws, mills, `discardRandomRival`s, or flips a random
face-down Legend (`callLegend`) still resolves that randomness inside the
candidate's state. The AI cannot read *what* it got (only counts), but it
does see the *consequences* — e.g. which of its own Legends turned face-up,
and therefore that Legend's statics. Removing this would mean expectimax
over the rng rather than a one-ply greedy search, which is out of scope
here; it is called out so a later search-based agent knows the seam is
there. Note the quiescence layer removes one such hole rather than adding
it: because a would-be-stolen interception (§144) is played forward with a
"decline" default, whether the rival *had* an intercept available (a read of
their hand as a set) does not change the score the AI computes.

**Fix round 1 — the seam, measured rather than assumed.** The review asked
the obvious follow-up question: `discardRandomRival` picks the discarded card
by rng INDEX into the rival's hand (`effects.ts`), so does permuting that hand
change what the AI decides? **Empirically, no** — and the reason is a property
of `evaluate` worth stating outright rather than leaving implicit: *the trash
is never scored, in contents or in size, and hand/deck are scored by size
only.* So a candidate the AI is merely scoring can genuinely move a different
hidden card in each clone (the position after the action really does differ)
and still score identically, which is precisely the invariance the AI needs.
The same argument covers a differently-ordered deck yielding a different drawn
card. The claim in `evaluate.ts`'s header is now written to say exactly this,
no more.

The one place this reasoning would break is a future `evaluate` term that read
the trash (a plausible one: `costReduction { per: 'unitInTrash' }` makes a
rival's trash composition genuinely relevant to what they can afford). Adding
such a term would silently re-open the seam, which is why the tests below
assert the divergence *happens* — a future term that broke invariance would
fail on a case the suite has already proven is live, rather than on nothing.

**TDD evidence:** `tests/ai/heuristic.test.ts`'s hidden-information suite
harvests mid-game states out of real seeded games and, for each, clones it
with the rival's hand order, the rival's deck order, the rival's face-down
Legend `defId`s and the AI's own deck order all permuted — asserting that
`legalActions` is unchanged (so the two clones pose the same question), that
`evaluate` agrees on the two clones, that applying *every* candidate to both
clones scores identically, and that `chooseAction` answers identically. It
runs twice: once on the starter decks (87 states; 127 candidate outcomes
materially diverged across 58 states) and once on synthetic decks
(`generateDeck`'s new `require` parameter) forced to carry
`augmented-negotiators`, `caliber-totentanz-s-top-dog` and `maelstrom-goons`
(102 states; 124 divergent candidate outcomes) — with a hard
`divergentCandidates > 0` assertion so the test cannot pass vacuously. A third
case pins the mechanism deterministically instead of sampling it:
`augmented-negotiators` prints "When this Unit uses {Blocker}, a Rival discards
1", so the AI's own `block` candidate fires the discard; with the rival's
four-card hand reversed (a 4-cycle reversal has no fixed point) the two clones
provably discard *different* cards, and the assertions are that they do, and
that the score and the chosen action are nonetheless identical.

## 151 — What the Play view decides for the player, and what it doesn't (Task 13)

The playmat is driven entirely by `legalActions`: every glow, every clickable
target and every button is a *view* of an entry in that list, so the UI cannot
offer a move the engine would reject and cannot hide one it would allow. Three
places where that mapping is not one-to-one need recording.

**Payment selection is not offered — a UI simplification, not an engine
limitation.** `legalActions` fills each `playCard`/`callLegend`/`quick`/
`react callLegend` entry with the *canonical* payment (economy.ts's
`canonicalPayment`), and `reduce.ts`'s `isLegal` deliberately accepts **any**
combination of ready Eddies and Legends that satisfies `canPayWith` for the
same cost — the engine has always supported paying "with those two Eddies
rather than that Legend". The Play view simply never asks: it passes the
canonical payment straight back. This matters in exactly one situation — a
player who would rather keep a specific face-down Legend ready (to spend it as
a reaction, §26) than an interchangeable Eddie — and a payment picker is a
plausible later refinement. Nothing in the engine needs to change for it; the
affordance layer would gain a second disambiguation step, alongside the target
one described next.

**Target disambiguation is progressive, and asks only about real decisions.**
Clicking a card whose `legal` entries differ produces the first slot on which
those entries disagree (`firstDivergentSlot`), highlights that slot's distinct
values on the board, and narrows the surviving variants with each answer —
ending the moment the survivors bind identical targets. So a slot whose value
was already forced by an earlier answer is never asked about, and a
`chooseOne` mode that binds fewer slots than its sibling stays reachable (the
missing slot is its own option, `NO_TARGET`). The order the player is asked in
is the engine's own slot order (docs/rulings.md §34: a Gear's equip host
first, then one uid per fillable `onPlay` slot), not a re-ordering the UI
invents.

**A target slot's value is a uid *or* a Gig-die index, and the action does not
say which.** `TargetSpec` (engine/types.ts) mixes card slots with Gig-die
slots, and both arrive as bare numbers in `Action.targets` (§39). The view
labels an option by card name when the number resolves to a live
`CardInstance` and as "Gig die #N" otherwise, which means a Gig index that
collides with a live uid reads as a card name. This is **cosmetic only** — the
action applied is the engine's own entry, unmodified — and it is confined to
the option *labels*; a fix would mean threading the per-slot `TargetSpec` out
of `effects.ts`'s `effectTargetChoices` alongside the tuples, which is a
larger change than the labelling defect warrants today.

**The AI's seed is derived from the record, not stored in it.** A `GameRecord`
(engine/replay.ts) is the new-game config plus the action list and nothing
else. The opponent agent is re-created for every decision from
`agentSeedFor(config.seed, actions.length)`, which makes the AI a pure
function of the record: resuming a saved game reproduces the same opponent,
and undoing back into a turn and repeating an action gets the same answer
again. A single long-lived agent instance could offer neither guarantee — its
rng position would depend on how many decisions it happened to have made,
including ones that were later undone — and storing that position in the
record would have made the record's meaning depend on when it was written.

**Undo attributes actions by `actingPlayer`, never `activePlayer`.** Both
players act inside a single game turn (a defender's `react` window, an
effect-driven `chooseGig` whose thief is the rival, a would-be-defeated
`answerIntercept`), so "whose action was this" is `actingPlayer` evaluated on
the state *before* the action. `undoToLastDecisionOf` derives that by
replaying rather than storing it, so a record produced by any writer (UI, sim,
fuzz harness) is undoable, and the attribution can never disagree with the
actions themselves.

## 152 — Deck Builder: invalid decks are shown, never refused; editing a bundled deck forks a local copy (Task 14)

**Adding a card never refuses.** `DeckBuilderView`/`CardBrowser`/`DeckPanel`
let the deck under construction go invalid in every way `validateDeck`
checks — a 4th copy of a card, a card costing more RAM than the chosen
legends currently provide, an unfilled legend slot, a short or long deck —
and every resulting error string is listed live, in red
(`data-testid="deck-errors"`), rather than disabling the click that would
cause it. **Saving an invalid deck is also allowed**: `storage.saveDeck`
takes whatever `DeckList` it is given, and the Deck Builder does not gate
Save on `validateDeck(db, deck).length === 0`. This was a deliberate choice
between two options the brief left open ("BLOCKED" vs "ALLOWED-but-flagged"):
blocking would mean a player mid-build (e.g. adding a card before picking
the legend that would license its RAM cost, or building past 3 copies while
deciding which two to keep) hits a wall for a violation that is often about
to be fixed by the very next click. The engine-level guarantee is untouched —
nothing about `validateDeck` changed — and the errors are the same list a
saved deck would show if reloaded.

The corollary, **left for the controller of a later task**: `listDecks()`
still returns every saved deck, valid or not, exactly as before. The Deck
Builder is the only place that computes and displays `validateDeck` per
deck; the Play view's and Simulate view's deck pickers do not yet filter to
valid decks. Task 15 (or whichever task wires those pickers) should call
`validateDeck(db, deck).length === 0` itself before offering a deck as a
seat, the same way `DeckPanel` already computes it for display.

**Editing a bundled starter deck and hitting Save forks a local copy, using
storage.ts's existing shadow-by-name behavior — no new persistence
mechanism.** `storage.ts` gains one function. `isReadOnlyDeck(name)` is true
exactly when `name` is a bundled starter with no localStorage override yet —
the same check `deleteDeck` already made internally, now exposed so the UI
can show a badge (`data-testid="readonly-badge"`) before the player edits
away. Loading a bundled deck and clicking Save calls the ordinary
`saveDeck({ ...deck, name })`: if `name` is the same as the bundled deck's,
this writes a localStorage entry that *shadows* the bundled deck by name
(the exact mechanism `tests/ui/storage.test.ts`'s "reverts to the bundled
deck after deleting a localStorage save that shadowed it by name" already
covers) — the bundled JSON under `data/decks/` is never touched, and deleting
the shadow later reveals the original bundled deck again, unchanged.
`isReadOnlyDeck(name)` becomes false the instant that shadow exists, so the
badge disappears immediately after Save. Typing a different name before
Save is the ordinary "Save As": it creates an independent deck and leaves
the bundled deck (and any of its own shadow) alone.

**The demo flag and the read-only flag are independent facts, shown as two
separate badges.** `deck.demo` relaxes `validateDeck`'s 40–50 card-count
check (`src/engine/deck.ts`, unchanged by this task) and is shown via
`data-testid="demo-badge"` whenever the deck being edited carries it —
including after it has been forked into a local copy, since forking copies
the whole `DeckList` verbatim. `isReadOnlyDeck` is about *where the deck
lives* (bundled vs. local), not about its size rules, so a deck can be demo
without being read-only (any saved demo deck) or read-only without being
demo (neither bundled starter deck actually needs this today, but the
mechanism doesn't assume otherwise).

**The art-only promo (`rebecca-having-a-moment`) is disabled generically, not
by id.** `CardBrowser.isArtOnlyPromo(def)` is exactly `validateDeck`'s own
promo test (`type === 'legend' && ramLimit === null && text === ''`) — the
browser cell gets a `disabled` class, a `title` tooltip explaining why, and
both the card's own click and its `+` button are no-ops, so the one card in
the current 141-card pool meeting that description can never be added as a
legend. Nothing hardcodes the id; a future promo with the same printed shape
would be caught the same way.

## 153 — Play and Simulate deck pickers disable invalid non-demo decks (Task 15)

§152 deliberately lets the Deck Builder show and even save an invalid deck
under construction — refusing an edit mid-build would block violations that
are often about to be fixed by the very next click. *Choosing a deck to
actually play a game or run a simulation with* is a different moment: an
invalid deck cannot legally take the field (a card may cost more RAM than
its legends license, a legend slot may be empty, and so on), so both the
Play view's new-game setup screen (`src/ui/PlayView.tsx`) and the Simulate
view (`src/ui/SimulateView.tsx`) now disable it there instead of letting a
game or sim run against a deck the engine was never validated to allow.

**One shared rule, `src/ui/deckPicker.ts`'s `isDeckPickable(db, deck)`,
drives both pickers** so they can never drift apart: a deck is pickable when
`deck.demo` is true, or when `validateDeck(db, deck)` reports zero errors.
Demo decks are the deliberate exception — `deck.demo` exists to relax
`validateDeck`'s 40-50 card-count check for decks that are intentionally
undersized (both bundled starter decks are demo decks for exactly this
reason), and per the brief's own UI spec a demo deck is simply always
selectable, independent of whatever `validateDeck` still reports for it.
`deckPickerLabel(db, deck)` appends "⚠ invalid" to a non-pickable deck's
name; each `<option>` for it is additionally given `disabled`, so a browser
will not let it be selected at all (the label alone would only be a visual
hint). Both views also re-check `isDeckPickable` defensively where a deck
is actually committed to (`PlayView.startGame`, `SimulateView.handleRun`),
in case a caller ever constructs one of these views with a non-`<select>`
UI in front of it.

**Defaulting.** Both pickers seed their initial selection from the first
(and, for a second seat, second) *pickable* deck rather than `decks[0]`/
`decks[1]` — so the setup screen and the Simulate form never open with an
already-disabled option selected by default. Since both bundled starter
decks are demo decks (and therefore always pickable), this is invisible in
the common case and only matters once a player has saved an invalid deck of
their own.

**What did not change:** `storage.listDecks()` still returns every saved
deck, valid or not (§152's own corollary) — filtering happens only in the
two pickers that render it, not in storage. The Deck Builder is untouched:
it still shows every deck's `validateDeck` errors live rather than hiding
or disabling anything, exactly as §152 specifies.
