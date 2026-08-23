// A seeded, legal synthetic-deck generator for the fuzz harness
// (tests/fuzz/invariants.test.ts). Not a *.test.ts file, so vitest does not
// collect it as a suite (see vite.config.ts `include`), same convention as
// tests/engine/gameHelpers.ts.
//
// Builds a fresh 3-legend / 40+-card `DeckList` straight from the full card
// pool (data/cards.json via `loadCardDb`), using the engine's own mulberry32
// stream so a given seed always produces the same deck. The result is run
// through `validateDeck` before being handed back — if the generator ever
// drifts from a legal deck (e.g. a future card pool change removes enough
// RAM-eligible cards), the fuzz test fails loudly instead of silently feeding
// `newGame` garbage.

import { createRng, nextInt, shuffle, type RngState } from '../../src/engine/rng'
import { validateDeck, type DeckList } from '../../src/engine/deck'
import type { CardDb, CardDef } from '../../src/engine/types'

const MIN_CARDS = 40
const MAX_CARDS = 50
const MAX_COPIES = 3
// rebecca-having-a-moment is the one art-only legend promo (null ramLimit,
// empty text) — validateDeck rejects it outright (docs/rulings.md), so the
// generator never offers it a legend slot.
const ART_ONLY_LEGEND_ID = 'rebecca-having-a-moment'

/**
 * Picks 3 legends with pairwise-unique `name`s (a real character can print
 * more than one legend card; a deck may not run two of the same character) —
 * mirrors validateDeck's own "Legends must have unique names" rule so the
 * generator never has to retry because of a name collision.
 */
function pickLegends(db: CardDb, rng: RngState): [string[], RngState] {
  const legendDefs = Object.values(db).filter(
    (def) => def.type === 'legend' && def.id !== ART_ONLY_LEGEND_ID
  )
  const [shuffled, next] = shuffle(rng, legendDefs)
  const chosen: CardDef[] = []
  const usedNames = new Set<string>()
  for (const def of shuffled) {
    if (chosen.length >= 3) break
    if (usedNames.has(def.name)) continue
    usedNames.add(def.name)
    chosen.push(def)
  }
  return [chosen.map((def) => def.id), next]
}

/** Per-color RAM pool the chosen legends' `ramLimit`s contribute. */
function ramPool(db: CardDb, legendIds: string[]): Record<string, number> {
  const pool: Record<string, number> = {}
  for (const id of legendIds) {
    const limit = db[id].ramLimit
    if (limit) pool[limit.color] = (pool[limit.color] ?? 0) + limit.value
  }
  return pool
}

/**
 * Deterministically builds one legal `DeckList` from `db` for `seed`: 3
 * unique-name, non-art-only legends, then as many RAM-eligible non-legend
 * cards (up to `MAX_COPIES` copies each) as fit in `[MIN_CARDS, MAX_CARDS]`.
 *
 * Retries the legend pick (a fresh shuffle draw) up to `maxAttempts` times if
 * a particular trio's RAM pool can't reach `MIN_CARDS` eligible copies — in
 * practice every trio in the current 141-card pool clears this on the first
 * attempt (every non-legend card has a nonzero RAM cost of at most 6, and
 * every legend contributes a RAM limit of 2), but the retry keeps the
 * generator honest against a future, sparser card pool instead of silently
 * handing back an under-sized deck for `validateDeck` to reject.
 */
export function generateDeck(
  db: CardDb,
  seed: number,
  name: string,
  maxAttempts = 25
): DeckList {
  let rng: RngState = createRng(seed)

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const [legendIds, afterLegends] = pickLegends(db, rng)
    rng = afterLegends
    const pool = ramPool(db, legendIds)

    const eligible = Object.values(db).filter(
      (def) => def.type !== 'legend' && def.ram !== null && (pool[def.ram.color] ?? 0) >= def.ram.value
    )
    const capacity = eligible.length * MAX_COPIES
    if (capacity < MIN_CARDS) continue // this trio can't reach a legal deck; reshuffle and retry

    const [shuffledEligible, afterCards] = shuffle(rng, eligible)
    rng = afterCards

    const cards: Record<string, number> = {}
    let total = 0
    for (const def of shuffledEligible) {
      if (total >= MAX_CARDS) break
      const [roll, afterRoll] = nextInt(rng, MAX_COPIES)
      rng = afterRoll
      const copies = Math.min(roll + 1, MAX_CARDS - total)
      if (copies <= 0) continue
      cards[def.id] = copies
      total += copies
    }

    if (total < MIN_CARDS) continue // ran out of distinct eligible cards; reshuffle and retry

    const deck: DeckList = { name, legends: legendIds as [string, string, string], cards }
    const errors = validateDeck(db, deck)
    if (errors.length > 0) {
      throw new Error(
        `generateDeck(seed=${seed}) produced an illegal deck: ${errors.join('; ')}`
      )
    }
    return deck
  }

  throw new Error(`generateDeck(seed=${seed}): could not build a legal deck in ${maxAttempts} attempts`)
}
