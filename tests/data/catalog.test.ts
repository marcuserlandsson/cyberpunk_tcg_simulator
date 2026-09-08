import { describe, expect, it } from 'vitest'
import snapshot from '../../data/catalog-source.json'
import status from '../../data/catalog-status.json'
import { loadCardDb } from '../../src/engine/cardDb'
import { loadPrintings } from '../../src/ui/printings'
import { validateDeck } from '../../src/engine/deck'
import starter from '../../data/decks/arasaka-embracing-power.json'
import type { DeckList } from '../../src/engine/deck'
import { newGame } from '../../src/engine/game'

describe('official catalog import', () => {
  const db = loadCardDb()
  it('contains every independently discovered ID and preserves printed cost values', () => {
    expect(Object.keys(db).sort()).toEqual(snapshot.cards.map(card => card.slug).sort())
    for (const card of snapshot.cards) expect(db[card.slug].printedCost).toBe(card.cost)
    expect(Object.keys(db)).toHaveLength(status.cardCount)
  })
  it('contains every current printing with the official card identity', () => {
    const printings = loadPrintings()
    for (const card of snapshot.cards) for (const printing of card.printings) {
      expect(printings.find(row => row.sourcePrintingId === printing.id)?.cardId).toBe(card.slug)
    }
    expect(printings).toHaveLength(status.printingCount)
    expect(printings.filter(row => row.cardId === 'nocturne-op55-n1').every(row => row.artist === 'Daniel Valaisis')).toBe(true)
  })
  it('does not silently simulate pending cards as blank cards', () => {
    for (const id of status.pendingCards) {
      const deck: DeckList = { ...starter, legends: [starter.legends[0], starter.legends[1], starter.legends[2]], cards: { ...starter.cards, [id]: 1 } }
      expect(validateDeck(db, deck).some(error => error.includes('awaiting simulator implementation'))).toBe(true)
      expect(() => newGame(db, { decks: [deck, deck], seed: 1 })).toThrow('awaiting simulator implementation')
    }
  })
})
