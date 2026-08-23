// Shared "is this deck offerable as a seat" rule for the Play view's and
// Simulate view's deck pickers (docs/rulings.md §153).
//
// The Deck Builder (Task 14, §152) deliberately never refuses an invalid
// deck — it shows the deck under construction with its live `validateDeck`
// errors instead of blocking edits. Choosing a deck to actually PLAY or
// SIMULATE is a different moment: an invalid deck cannot legally take the
// field (its RAM costs may exceed what its legends license, it may be short
// a legend, etc.), so both pickers disable it rather than let a game start
// that the engine was never validated against.
//
// Demo decks get a narrower exception: `deck.demo` marks a deck as
// intentionally undersized (the two bundled starter decks are demo decks
// for exactly this reason), so a demo deck is pickable when its only
// `validateDeck` complaint is that size — not unconditionally. A demo deck
// with, say, a RAM violation is exactly as unplayable as a non-demo deck
// with one, and the waiver was never meant to cover that (final-review
// item 4; docs/rulings.md §153).

import { validateDeck, validateDeckIgnoringSize, type DeckList } from '../engine/deck'
import type { CardDb } from '../engine/types'

/**
 * True when `deck` may be offered as a seat in the Play or Simulate views: a
 * demo deck with no `validateDeck` errors besides its size, or a non-demo
 * deck with zero `validateDeck` errors outright.
 */
export function isDeckPickable(db: CardDb, deck: DeckList): boolean {
  if (deck.demo === true) return validateDeckIgnoringSize(db, deck).length === 0
  return validateDeck(db, deck).length === 0
}

/** `deck.name`, with an "⚠ invalid" suffix when `isDeckPickable` is false. */
export function deckPickerLabel(db: CardDb, deck: DeckList): string {
  return isDeckPickable(db, deck) ? deck.name : `${deck.name} ⚠ invalid`
}
