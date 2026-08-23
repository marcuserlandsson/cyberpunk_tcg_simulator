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
// Demo decks are the one deliberate exception: `deck.demo` marks a deck as
// intentionally undersized (the two bundled starter decks are demo decks
// for exactly this reason), so a demo deck is always pickable regardless of
// what `validateDeck` reports for it — the same unconditional treatment the
// UI spec calls for ("demo decks selectable"), not just a size-error waiver.

import { validateDeck, type DeckList } from '../engine/deck'
import type { CardDb } from '../engine/types'

/**
 * True when `deck` may be offered as a seat in the Play or Simulate views:
 * any demo deck, or a non-demo deck with zero `validateDeck` errors.
 */
export function isDeckPickable(db: CardDb, deck: DeckList): boolean {
  return deck.demo === true || validateDeck(db, deck).length === 0
}

/** `deck.name`, with an "⚠ invalid" suffix when `isDeckPickable` is false. */
export function deckPickerLabel(db: CardDb, deck: DeckList): string {
  return isDeckPickable(db, deck) ? deck.name : `${deck.name} ⚠ invalid`
}
