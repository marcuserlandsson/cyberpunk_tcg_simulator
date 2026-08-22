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
