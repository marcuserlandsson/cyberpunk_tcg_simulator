# `data/cards.json` schema

`data/cards.json` is a JSON array of `CardDef` objects (authoritative TypeScript
type lives in `src/engine/types.ts`, added in Task 3 — this document is the
prose reference used during transcription and by anyone reading the data).

## `CardDef` fields

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | kebab-case. We use the official database's `slug` field verbatim (e.g. `"v-streetkid"`, `"mantis-blades"`). Globally unique. |
| `name` | `string` | The card's base name, with any `— Subtitle` suffix stripped off (see `subtitle` below). E.g. `"V"`, `"Goro Takemura"`, `"Mantis Blades"` (no subtitle to strip). |
| `subtitle` | `string?` | The part of the printed name after the em dash (`—`), e.g. `"Streetkid"`, `"Embracing Destruction"`. Omitted when the card's name has no em dash. |
| `color` | `string` | One of `"Red"`, `"Blue"`, `"Green"`, `"Yellow"` — the card's RAM/border color, using the game's own capitalization. |
| `faction` | `string?` | Set only when one of the card's printed classification tags names a specific in-world organization (gang/corp/movement) — see **Faction tags** below. Omitted for cards whose only tags are generic roles (Merc, Corpo, Netrunner, etc.) or which have no tags. |
| `type` | `'legend' \| 'unit' \| 'program' \| 'gear'` | Lowercased from the database's `card_type`. |
| `cost` | `number` | Eddie cost, top-left corner. Non-legends always have a printed cost. **Legends without a "Go Solo" option print "—" for cost and have no cost value; we encode this as `0`** (see `docs/rulings.md`) rather than `null`, because this field is non-nullable in `CardDef`. |
| `power` | `number \| null` | Bottom-right corner. `null` when the database reports no power: most Programs (genuinely no power box printed) and the 19 Legends without a Go Solo option (**these do print a literal `0`; we keep `null` to match the primary source — see `docs/rulings.md` §11**). Note some Gear print a power-like bonus number (e.g. Mantis Blades' "+2", Mandibular Upgrade's "+0") — the bare number is stored here per the brief's instruction that Gear/Program power is "usually null unless printed". |
| `ram` | `{ color: string, value: number } \| null` | Non-legend cards only. `color` is always the card's own `color` field (this game has no separate "off-color RAM" concept in the data we found). `null` for legends. |
| `ramLimit` | `{ color: string, value: number } \| null` | Legends only — the RAM capacity a face-up Legend contributes. `null` for non-legends, and also `null` for the one legend (`rebecca-having-a-moment`) where the source database does not expose a RAM value at all (flagged `uncertain: ramLimit` in the transcription report). |
| `sellTag` | `boolean` | Whether the card shows the sell-for-1-Eddie icon (top-left, below cost). Mapped 1:1 from the database's `is_eddiable` field; visually confirmed against several print-and-play cards. |
| `keywords` | `string[]` | Lowercase, kebab-case for multi-word terms. See **Keyword vocabulary** below — this array mixes true rules keywords with classification/role tags, since `CardDef` has no separate tags field. |
| `text` | `string` | Verbatim rules text from the database's `rules_text` field (empty string `""` for vanilla cards, including the one card — `rebecca-having-a-moment` — whose `rules_text` is `null` in the source). Keyword/timing-trigger markup is preserved as `{Term}`, exactly as the database renders it (this is the plaintext stand-in for the card's colored highlight boxes). **4 cards deviate from `rules_text` because the database's own card art proves the field wrong: `kiroshi-optics` (equip line, rulings §8) and `psycho-squad` / `animals-wrecker` / `rockn-rockerboy` (stripped `[Flavour]` annotation, rulings §9). All other 137 are byte-exact.** |
| `effects` | `EffectDef[]` | Left as `[]` for every card in Task 2. Task 8 populates this from `text` using the vocabulary below. `[]` is also the *correct* value for a vanilla card (no rules text) and for `animals-wrecker`, whose printed line is flavour (`docs/rulings.md` §51). |
| `scripted` | `string?` | The `scriptedCards` key of a card whose text needs a hand-written implementation (`src/cards/scripted/index.ts`). Informational: the interpreter dispatches on the `{ kind: 'scripted', name }` node inside `effects`, not on this field. Set for `all-is-lost`, `arasaka-emergency-radioport`, `johnny-silverhand-rocking-renegade` (Task 8 batch 1); `shattered-memories`, `v-roamer-of-the-badlands`, `yorinobu-arasaka-steel-dragon` (Task 8 batch 2); `adam-smasher-metal-over-meat`, `dum-dum-maelstrom-triggerman`, `gilded-mato-n`, `hanako-arasaka-in-a-gilded-cage`, `heywood-ripperdoc`, `kiroshi-optics`, `live-with-the-aftermath` (Task 8 batch 3); `sketchy-ripper`, `t-bug-amateur-philosopher`, `the-heist`, `the-relic-experimental-biochip`, `viktor-vektor-sit-down-and-relax`, `river-ward-detective-on-the-hunt:free-gear`, `river-ward-detective-on-the-hunt:defeat-search`, `viktor-vektor-you-might-feel-a-little-pinch` (Task 8 batch 4); `don-t-fear-the-reaper`, `fool-on-the-hill`, `goro-takemura-vengeful-bodyguard`, `overwatch-panam-s-gift` (Task 8 batch 5). |

## Keyword vocabulary

The gameplay guide (`docs/rules/gameplay-guide-extracted.txt`, pages 8–9) describes two
kinds of highlighted rules-text markup, both rendered by the online database as
`{Term}` inside `rules_text`:

- **Timing triggers** ("when" conditions, convex highlight in print): `Play`,
  `Call`, `Attack`, `Defeated`. These are NOT included in `keywords` — they are
  part of the effect's trigger condition and are Task 7/8's concern (see the
  `EffectNode`/`Trigger` vocabulary once it lands).
- **Keywords proper** (concave highlight in print, a standard reusable rule):
  - `Rush`/attack-the-turn-it's-played — **the online (Beta) database calls this
    "Adrenaline"**, not "Rush". The printed gameplay guide never names this icon
    in the extracted text (OCR lost the label), and the parent task brief's own
    `CardDef` example comment guesses `"rush"`. Per the accuracy rule ("database
    wins on disagreement"), we transcribe it as `"adrenaline"`. **This is a
    judgment call — flagged in `docs/rulings.md`.**
  - `Quick` → `"quick"`
  - `Blocker` → `"blocker"`
  - `Go Solo` (Legends only) → `"go-solo"`
- One more brace term appears in the data but is neither a trigger nor a
  keyword: **`{Spend}`**, which is a cost notation (per the glossary: "This
  symbol indicates you must spend this card to activate the following
  effect"). It is not added to `keywords`; it belongs to the effect's cost
  structure (Task 7/8).

In addition, `keywords` also carries every **classification/role tag** printed
under the card's name (e.g. `Merc`, `Corpo`, `Cyberware`, `Netrunner`,
`Braindance`, `Weapon`, `Vehicle`, `Rocker`, `Samurai`, `Ganger`, `Fixer`,
`Ripperdoc`, `Techie`, `Medtech`, `Mystic`, `Doll`, `AI`, `Animal`, `Extreme`,
`Plan`, `Quickhack`, `Drone`), lowercased and kebab-cased. This matches the
parent task brief's own example (`["rush", "blocker", "quick", "merc"]`, where
`"merc"` is a role tag, not a mechanical keyword) — `CardDef` has no separate
`classifications`/`tags` field, so we fold these into `keywords`.

### Faction tags

The remaining classification tags name specific organizations rather than
generic roles, and are promoted to the singular `faction` field instead of
`keywords` (to avoid the field being empty for every gang/corp-affiliated
card): `6th Street`, `Arasaka`, `Maelstrom`, `Militech`, `NCPD`, `Netwatch`,
`Trauma Team`, `Tyger Claws`, `Valentino`, `Voodoo Boys`, `Zetatech`,
`Aldecado`, `Nomad`, `Raffen Shiv`, `Mox`, `Maine's Crew`, `Scavenger`. When a
card has more than one such tag, the first one (in the database's printed
order) is promoted to `faction` and **the remaining ones stay in `keywords`**
(kebab-cased), so no classification tag is ever lost. 8 of the 141 cards have
two faction tags — `emergency-atlus`, `minotaur`, `octant`,
`panam-palmer-nomad-cavalry`, `panam-palmer-strength-through-family`,
`saul-bright-stormrider`, `unlikely-bond`, `wraith-marauders`. (Pass 1
originally dropped the extra tag and wrongly claimed no card had two; pass 2
restored all 8 — see `docs/rulings.md` §10.) This partition of the 39
possible classification values is a judgment call — see `docs/rulings.md` §3.

## `EffectNode` vocabulary

The authoritative types are in `src/engine/types.ts` and the authoritative
(strict) schema in `src/engine/cardDb.ts` — every node/field below is validated
at load time, and an unknown key is a load error. The judgment calls behind each
are in `docs/rulings.md` (§29–§38 from Task 7, §39–§52 from Task 8 batch 1,
§55–§67 from Task 8 batch 2, §67 from its fix round, §68 ff. from Task 8 batch 3,
§81 ff. from Task 8 batch 4, §92 ff. from Task 8 batch 5).

### `EffectDef`

| Field | Notes |
|---|---|
| `trigger` | `onPlay` \| `onCall` \| `onAttack` \| `onDefeat` \| `onBlock` \| `onWinFight` \| `onSpend` \| `onFriendlyStealDie` \| `onFriendlyAttack` \| `onUnitDefeated` \| `onRivalAdjustFriendlyGig` \| `onEndTurn` \| `onFriendlyEquippedSpend` \| `onLoseFight` \| `onStartTurn` \| `onFriendlyBlock` \| `activated` \| `static`. `onFriendlyStealDie` was added in Task 8 batch 1 (§42); the next four in batch 2 (§60); `onFriendlyEquippedSpend` in batch 3 (§68 ff.) — "When a friendly EQUIPPED Unit or Legend is spent, ..." (alt-cunningham-mother-of-daemons), fired from the same `spendOnDraft` seam as the self-referential `onSpend`. Batch 5 (§92 ff.) adds three more: `onLoseFight` — the mirror image of `onWinFight`, self-referential ("when THIS Unit loses a fight"), not a watcher; `onStartTurn` — the mirror image of `onEndTurn`, fired from a new `reduce.ts` helper wrapping `game.ts`'s `beginTurn` (kept out of `game.ts` itself to avoid a new import-cycle direction); `onFriendlyBlock` — a watcher version of `onBlock` ("when A FRIENDLY Unit uses {Blocker}", not just this card). All watcher triggers fire on every in-play card of whichever side the printed text names (or, for bare wording, both sides) rather than on the card that acted. |
| `cost` | `{ selfSpend?, eddies?, reduction? }`. On an `activated` def this is the printed, mandatory `{Spend}` / €$ cost; on a *triggered* def it is an optional "You may pay N €$", answered by the action that fires the trigger (`attack`'s `payOptionalCosts`) and **declined** by default (§49). |
| `condition` | `{ streetCredAtLeast?, friendlyGigValueAtLeast?, rivalGigLeadAtLeast?, stolenDieSize?, streetCredAheadOfRival?, streetCredBelow?, duringOwnTurn?, sourcePowerAtLeast?, selfIsStealer?, attackerKeyword?, defeatedKeyword?, friendlyGigsAtLeastValueCount?, friendlyGigDistinctValuesAtLeast?, friendlyGigEvenAndOdd?, friendlyGigValueEquals?, streetCredDiffAtLeast?, sourceEquipped?, stealerIsLegend?, stolenDieValueParity?, defeatedIsFriendly?, defeatedWasEquipped?, streetCredParity?, allFriendlyLegendsFaceUp?, sourceSpent?, friendlyGigValuePair? }` (this shape also lives on its own as `EffectCondition`, so `conditionalEffect` — see below — can carry one without an enclosing `EffectDef`) — "☆ N or more", "if you control a Gig with 8+ value", "if a Rival controls at least 2 Gigs more than you", the watcher-only die-size gate (§42, §50), "if you have more/less ☆ than a Rival" and "less than N ☆" (§55), "during your turn" (§59), the attacking Unit's own power (§61), "when THIS Unit steals" (§61), the attacking/defeated Unit's own faction-or-keyword tag (§60/§66), "2 or more Gigs with 8+ value" (§62), "2 or more Gigs with different values" (§68 ff.), "a Gig with an even value and a Gig with an odd value" (§68 ff.), "[a fixed number] equals the value of a friendly Gig" (§68 ff.), "☆ differs from a Rival's by N+" (§68 ff.), "if it's equipped" — does the SOURCE card itself carry attached Gear (§68 ff.), "a friendly LEGEND steals" and "if its value is even/odd" (§81 ff.), "a friendly EQUIPPED Unit is defeated" (§81 ff.), "☆ is an even/odd number", "all friendly Legends are face-up", "if THIS Unit is spent", and "if you control a value-pair of Gigs" — two Gig dice sharing a value (§92 ff.). |
| `quick` | `{Quick}` — usable in the rival's react window. |
| `oncePerTurn` | "The first time … each turn" (§40). Tracked per card instance + effect index in `GameState.oncePerTurnUsed`, cleared at the end of the game turn. |
| `onceKey` | Groups several `oncePerTurn` defs on the same card into ONE shared allowance, for a single compound printed sentence spanning multiple defs (§67) — e.g. "The first time X, draw 1. Then, if Y, discard 1." is one event, not two independently-gated ones. Any not-yet-spent member's condition holding marks the whole group spent, whether or not every member's own (possibly narrower) condition also held. |
| `effect` | The `EffectNode` tree. |

### `TargetSpec`

`self`, `friendlyUnit`, `rivalUnit`, `rivalSpentUnit`, `anyUnit`,
`friendlyUnitOrLegend`, and (Task 8 batch 1) `friendlyGigDie` / `rivalGigDie` /
`anyGigDie` plus `chosen`. The Gig-die specs bind an **index into a `gigArea`**,
not a card uid (§39): `friendlyGigDie` for printed "a friendly Gig",
`rivalGigDie` for "a rival Gig", and `anyGigDie` for bare "a Gig" / "Adjust a
Gig" (either player's die — the controller's area indexed first, then the
rival's). `chosen` is not a decision: it reads the uid bound by the enclosing
`sameTarget` (§53), the way `self` reads the source card. Task 8 batch 2 adds
three more zones no earlier card needed to reach (§57, §63):
`friendlyTrashCard` (every card in the controller's own trash),
`friendlyHandCard` (every card in the controller's own hand), and
`friendlyHandOrTrashUnit` (every **Unit** in the controller's own hand *and*
trash combined — the "Unit" restriction is baked into the spec's own name,
since a mixed hand+trash zone otherwise holds every card type). Task 8 batch
3 fix round 1 adds two more (§73/§80): `friendlyGear` (every Gear card
attached anywhere on the controller's own side) and `anyGear` (the same,
plus the rival's, controller's own listed first — §39's bare-scope
convention, for bare "a Gear"). Both are real, enumerated decisions — no
card's "which Gear" is ever left to the rng when the firing action can
carry a target. Task 8 batch 5 adds two more (§92 ff.): `fightFoe` — never
enumerated (like `chosen`); reads the specific card a fight-loser just fought
via `TriggerContext.fightFoeUid` — and `friendlyFaceUpLegend` — the legends
zone alone (unlike `friendlyUnitOrLegend`, which also includes the field).

Card specs may be narrowed by a `filter`:
`{ maxPower?, minPower?, keyword?, excludeSelf?, weakerThanAFriendlyUnit?,
cardType?, maxCost?, maxPowerIfAheadOnStreetCred?, maxPowerVsFriendlyD20? }`,
covering "with power 4 or less", "a CORPO Unit", "*another* friendly Unit",
"with less power than a friendly Unit", "a **Program**" (`cardType`, §57),
"with cost 4 or less" (`maxCost`, §63), "power 2 or less … power 3 or less
**instead**" (`maxPowerIfAheadOnStreetCred` **replaces** `maxPower` rather
than adding to it — §64), and "power ≤ the value of a friendly d20"
(`maxPowerVsFriendlyD20`, §64).

### Nodes

| Kind | Printed text it encodes |
|---|---|
| `draw` | "Draw N." `count` accepts the same `number \| DynamicAmount` as `buffPower`/`staticPower` (§68 ff.), e.g. "Draw 1 for each friendly Gig with an odd value", or (§92 ff.) the bare string `'friendlyGigValuePairCount'` for "Draw 1 for each friendly value-pair of Gigs". |
| `discardRandomRival` | "A Rival discards N at random." |
| `buffPower` | "Give a … +N power this turn / permanently". `amount` may be the string `'friendlyMaxGig'` for "power equal to a friendly max Gig" (§39), `{ perEquippedGear: N }` for "+N power for each of its equipped Gear" (§59), or `{ perFriendlyGigParity: { parity, amount } }` for "+N power for each friendly Gig with an even/odd value" (§68 ff.). |
| `staticPower` | An ongoing power bonus (a Gear card's printed power box is *not* restated — §29). `amount` accepts the same dynamic amounts as `buffPower` (§59, §68 ff.), e.g. "this Legend has +2 power for each of its equipped Gear". |
| `defeat` / `bounce` / `bottomDeck` | Defeat a Unit / return it to hand / put it under its deck. |
| `readyCard` / `spendCard` | Ready or spend a card ("{Spend} it", "ready it"). |
| `stealGig` / `returnGig` / `rerollGig` | Steal a rival Gig (§32's `chooseGig` flow), send a friendly Gig back to the fixer, reroll a Gig. `stealGig`'s `distinctValueOnly?: boolean` narrows the offered dice to ones whose value the thief does not already hold, falling back to every die if none qualifies (§68 ff. — "steal a rival Gig with a value not shared by a friendly Gig", gorilla-arms). |
| `changeGig` | "Increase/decrease a Gig by up to N" — the full amount, clamped to `[1, die size]`, on a chosen die. With `adjust: true` ("Adjust a Gig by up to N") the sign *and* magnitude become a second slot offering `-N..-1, 1..N` (§39). Also fires `onRivalAdjustFriendlyGig` on the die's actual owner when that differs from the effect's controller (§60). |
| `retrieveFromTrash` | "Add a card / another Unit / a BRAINDANCE Program from your trash to your hand" (§57) — trash → hand. |
| `discardCard` | "… discard 1" (the controller's own hand, a real choice of card, not the forced-random `discardRandomRival` — §57) — hand → trash. |
| `sameTarget` | "Give a friendly Unit these effects" — one target slot, shared by every child that names `target: 'chosen'` (§53). |
| `trashFromDeck` / `gainEddieFromTopDeck` | Mill from a deck / bank the top card as €$. |
| `grantKeyword` | "… can attack the turn it's played" ({adrenaline}), "it may attack ready Units" (the granted-only `attack-ready` keyword) — until end of turn (§43). Batch 4 (§81 ff.) adds the internal keyword `fight-immune` — "A friendly Unit can't be defeated in a fight this turn" (`muamar-reyes-el-capitán`) — consulted only by `combat.ts`'s `fight()`, which filters it out of the would-be-defeated set before applying any defeat; the fight still happens normally for the OTHER combatant. |
| `chooseOne` | "Choose one effect. A // B". `chooser`: `'controller'` (default), `'rivalIfBehindStreetCred'` ("If you have less ☆ than a Rival, they instead choose one for you"), or `'allUnlessBehindStreetCred'` (every mode resolves unless you are behind, then the rival picks one — `gunpoint-diplomacy`, §45/§54). |
| `defeatShield` | *static, on Gear*: "If this Unit would be defeated, defeat its `<gear>` instead" (§46). |
| `winsFightVsKeyword` | *static*: "This Unit wins all fights against CORPO Units" (§41). |
| `powerVsCardType` | *static, fight-only*: "This Unit has +2 power while fighting a Legend" — added to `effectivePower` only inside `fight()`, never generally (§56). |
| `costReduction` | *static*: "Play this for -1 €$ for each friendly Gig with 8+ value, to a minimum of 1 €$" (§44), or (§81 ff.) "-1 €$ for each Unit in your trash" — a second `CostReduction.per` variant (`'unitInTrash'`) with no `value` threshold, just a flat count (`trauma-team-operatives`). Both variants apply only to the card's OWN play cost. |
| `cantAttack` | *static*: "This Unit can't attack" (§35). |
| `cantAttackGigArea` | *static*: "This Unit can only attack rival Units. (It can't attack Gig areas.)" (§58). |
| `attackReadyWithKeyword` | *static*: "This Unit can attack ready Units with {Blocker}" — narrower than the granted-only `attack-ready` keyword, which permits *any* ready Unit (§43 vs §58). |
| `sequence` | Several nodes in printed order, sharing one target slot list. **Only safe when no later node's targets depend on an earlier node's zone mutation within the same `EffectDef`** — split into separate same-trigger `EffectDef`s instead when they do (§57's `v-streetkid` write-up). |
| `scripted` | A hand-written implementation, optionally with its own `targets` slots (§48) and, since batch 4 (§81 ff.), a parallel `filters?: TargetFilter[]` narrowing `targets[i]` exactly like any other node's `filter` — e.g. "a Gear with cost 2 or less" from a hand zone. |
| `grantKeywordWhile` | *static*: "If a Rival controls at least 2 more Gigs than you, this Unit has {Adrenaline}." — a CONDITIONAL keyword grant, live only while the owning `EffectDef`'s `condition` holds, unlike a card's always-on printed `keywords` and unlike the one-shot, until-end-of-turn `grantKeyword` (§68 ff., adrenaline-converter). Masks the matching entry out of the card's/Gear's own printed `keywords` so the gate is the sole authority. |
| `rivalCantAttackWhenPlayed` | *static*: "Rival Units can't attack the turn they're played" (`maxtac-suppression-team`, §81 ff.) — denies the {adrenaline} exception to Lag for every Unit on the OPPOSING side of whoever prints this, consulted by `combat.ts`'s `canAttack` via `query.rivalDeniesFreshAttacks`. |
| `firstMatchingPlayDiscount` | *static*: "Play your first CYBERWARE Gear each turn for -3 €$, to a minimum of 1 €$" (`viktor-vektor-drop-your-illusions`, §81 ff.) — unlike `costReduction` (which discounts the printing card's OWN play), this discounts a DIFFERENT card being played whenever it matches `cardType`+`keyword`, once per game turn. `query.effectiveCardCost` consults every friendly in-play card's active nodes of this kind when pricing any card; `effects.playCardOnDraft` marks the allowance used (reusing the `oncePerTurn`/`oncePerTurnUsed` convention by key, not by an `oncePerTurn` flag on this def) the moment a matching card is actually played. |
| `swapGig` | "Swap a friendly Gig with a rival Gig" (§92 ff.) — two fixed-role slots (`friendlyGigDie` then `rivalGigDie`), exchanging the whole `GigDie` (size and value) between the two areas. Fires `onRivalAdjustFriendlyGig` on the rival side, exactly like `changeGig`. |
| `skipNextReady` | "A rival Unit can't ready until your next turn" (`pacifica-netrunner`, §92 ff.) — sets `CardInstance.skipNextReady`, consumed (and cleared) the next time `game.ts`'s `readySpentCards` would otherwise ready that card; a one-shot per-instance generalization of the first player's hardcoded opening-Legend penalty (§18). |
| `attackGigAreaDespiteLag` | *static*: "This Unit can attack their Gig area the turn it's played" while a `condition` holds (`nadia-fighting-through-grief`, §92 ff.) — narrower than {adrenaline}: never unlocks a rival Unit, only ever the Gig area, and only while the condition is live. |
| `conditionalEffect` | Wraps one child node so it only resolves while its own `condition` holds, WITHOUT gating the rest of the enclosing `EffectDef` (`goro-takemura-vengeful-bodyguard`'s "also give it +1 power" alongside an unconditional {Blocker} grant on the same chosen Unit, §92 ff.). Still consumes the child's slots when the condition fails, so later siblings stay aligned. |

A card whose text has two independent clauses ("Increase a Gig by up to 4. If
you control a Gig with 8+ value, draw 1.") is encoded as **two EffectDefs on the
same trigger**, so the second can carry its own `condition`; they fire in
printed order, each binding its own targets after the previous one resolved.

This document's **Keyword vocabulary** section above records the trigger/keyword
words the transcription preserves in `text`.

## Deck list format

`data/decks/*.json` files (two starter decks in this task) are:

```jsonc
{
  "name": "string",
  "legends": ["cardId", "cardId", "cardId"],  // exactly 3, all type: "legend"
  "cards": { "cardId": count, ... }           // non-legend cards, by id -> copy count
}
```
