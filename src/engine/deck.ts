import type { CardDb, CardDef } from './types'

export interface DeckList {
  name: string
  legends: [string, string, string]
  cards: Record<string, number>
  demo?: boolean
}

/** Total number of non-legend cards in the deck (sum of all copy counts). */
export function deckSize(deck: DeckList): number {
  return Object.values(deck.cards).reduce((sum, count) => sum + count, 0)
}

const MIN_DECK_SIZE = 40
const MAX_DECK_SIZE = 50
const MAX_COPIES = 3

/**
 * Validates a DeckList against the official construction rules:
 *  - exactly 3 legends, each a known legend card, with unique names
 *  - no legend that is an "art-only" promo (null ramLimit + empty text)
 *  - 40-50 non-legend cards, unless `deck.demo` is true (size checks only)
 *  - at most 3 copies of any single card
 *  - every card id in the deck is known
 *  - each non-legend card's RAM value does not exceed the combined RAM
 *    limit of the deck's legends whose ramLimit color matches the card's
 *    ram color (a null legend ramLimit contributes 0)
 *
 * Returns an empty array when the deck is legal, otherwise a list of
 * human-readable error strings (one deck can accumulate multiple errors).
 */
export function validateDeck(db: CardDb, deck: DeckList): string[] {
  const errors: string[] = []

  if (deck.legends.length !== 3) {
    errors.push(`Deck must have exactly 3 legends; found ${deck.legends.length}.`)
  }

  const legendDefs: CardDef[] = []
  for (const id of deck.legends) {
    const def = db[id]
    if (!def) {
      errors.push(`Unknown card id: "${id}".`)
      continue
    }
    if (def.type !== 'legend') {
      errors.push(`Card "${id}" is not a legend but is listed in the deck's legends.`)
      continue
    }
    legendDefs.push(def)
  }

  const legendNames = legendDefs.map((l) => l.name)
  if (new Set(legendNames).size !== legendNames.length) {
    errors.push('Legends must have unique names.')
  }

  for (const legendDef of legendDefs) {
    if (legendDef.ramLimit === null && legendDef.text === '') {
      errors.push(
        `Legend "${legendDef.id}" is an art-only promo (no printed ramLimit or rules text) and cannot be included in a deck.`
      )
    }
  }

  // RAM limit pool contributed by the deck's legends, per color. A legend
  // with a null ramLimit (e.g. the art-only promo case above) contributes 0.
  const ramLimitByColor: Record<string, number> = {}
  for (const legendDef of legendDefs) {
    if (legendDef.ramLimit) {
      ramLimitByColor[legendDef.ramLimit.color] =
        (ramLimitByColor[legendDef.ramLimit.color] ?? 0) + legendDef.ramLimit.value
    }
  }

  for (const [id, count] of Object.entries(deck.cards)) {
    const def = db[id]
    if (!def) {
      errors.push(`Unknown card id: "${id}".`)
      continue
    }
    if (def.type === 'legend') {
      errors.push(`Card "${id}" is a legend and cannot appear in the main deck's card list.`)
      continue
    }
    if (count > MAX_COPIES) {
      errors.push(`Card "${id}" has ${count} copies; the maximum is ${MAX_COPIES}.`)
    }
    if (count < 1) {
      errors.push(`Card "${id}" has an invalid copy count of ${count}.`)
    }
    if (def.ram) {
      const limit = ramLimitByColor[def.ram.color] ?? 0
      if (def.ram.value > limit) {
        errors.push(
          `Card "${id}" requires ${def.ram.value} ${def.ram.color} RAM, but the deck's legends only provide ${limit}.`
        )
      }
    }
  }

  if (!deck.demo) {
    const size = deckSize(deck)
    if (size < MIN_DECK_SIZE) {
      errors.push(`Deck has ${size} non-legend cards; the minimum is ${MIN_DECK_SIZE}.`)
    }
    if (size > MAX_DECK_SIZE) {
      errors.push(`Deck has ${size} non-legend cards; the maximum is ${MAX_DECK_SIZE}.`)
    }
  }

  return errors
}
