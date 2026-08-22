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
| `power` | `number \| null` | Bottom-right corner. `null` when not printed (most Programs; Legends without a Go Solo option). Note some Gear print a power-like bonus number (e.g. Mantis Blades' "+2") — that value is stored here per the brief's instruction that Gear/Program power is "usually null unless printed". |
| `ram` | `{ color: string, value: number } \| null` | Non-legend cards only. `color` is always the card's own `color` field (this game has no separate "off-color RAM" concept in the data we found). `null` for legends. |
| `ramLimit` | `{ color: string, value: number } \| null` | Legends only — the RAM capacity a face-up Legend contributes. `null` for non-legends, and also `null` for the one legend (`rebecca-having-a-moment`) where the source database does not expose a RAM value at all (flagged `uncertain: ramLimit` in the transcription report). |
| `sellTag` | `boolean` | Whether the card shows the sell-for-1-Eddie icon (top-left, below cost). Mapped 1:1 from the database's `is_eddiable` field; visually confirmed against several print-and-play cards. |
| `keywords` | `string[]` | Lowercase, kebab-case for multi-word terms. See **Keyword vocabulary** below — this array mixes true rules keywords with classification/role tags, since `CardDef` has no separate tags field. |
| `text` | `string` | Verbatim rules text from the database's `rules_text` field (empty string `""` for vanilla cards, including the one card — `rebecca-having-a-moment` — whose `rules_text` is `null` in the source). Keyword/timing-trigger markup is preserved as `{Term}`, exactly as the database renders it (this is the plaintext stand-in for the card's colored highlight boxes). |
| `effects` | `EffectDef[]` | Left as `[]` for every card in Task 2. Task 8 populates this from `text` using the vocabulary Task 7 defines. |
| `scripted` | `string?` | Not used in Task 2 (omitted for all cards). Reserved for cards whose text doesn't fit the effect vocabulary at all. |

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
order) wins and the others are dropped (rare in practice — checked, no card
in the 141-card set has two faction tags). This partition of the 38 possible
classification values is a judgment call — see `docs/rulings.md`.

## `EffectNode` vocabulary (starting point for Task 7/8)

Not defined in Task 2 — `effects` is `[]` for all 141 cards. Task 7 introduces
`EffectNode`/`TargetSpec`/`Trigger` types; Task 8 fills `effects` in using that
vocabulary. This document's **Keyword vocabulary** section above records the
trigger/keyword words Task 7 will need to recognize when parsing `text`.

## Deck list format

`data/decks/*.json` files (two starter decks in this task) are:

```jsonc
{
  "name": "string",
  "legends": ["cardId", "cardId", "cardId"],  // exactly 3, all type: "legend"
  "cards": { "cardId": count, ... }           // non-legend cards, by id -> copy count
}
```
