import { describe, expect, it } from 'vitest'
import snapshot from '../../data/catalog-source.json'
import status from '../../data/catalog-status.json'
import { loadCardDb } from '../../src/engine/cardDb'
import { loadPrintings } from '../../src/ui/printings'
import { validateDeck } from '../../src/engine/deck'
import starter from '../../data/decks/arasaka-embracing-power.json'
import embracingPower from '../../data/decks/embracing-power-starter.json'
import theHeist from '../../data/decks/the-heist-starter.json'
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
  it('ships the retail starter decks as constructed-legal 40 + 3 lists', () => {
    for (const deck of [embracingPower, theHeist] as unknown as DeckList[]) {
      expect(Object.values(deck.cards).reduce((a, b) => a + b, 0)).toBe(40)
      expect(deck.legends).toHaveLength(3)
      expect(deck.demo).toBeUndefined()
      expect(validateDeck(db, deck)).toEqual([])
    }
  })
  // Collection counts are keyed by printing key, so a key that changes shape
  // upstream detaches every owned copy recorded under the old one. Every
  // all-digit collector number in the dataset is zero-padded to three except
  // this one (the four `005a`/`005b` rows are alt-art suffixes, a different
  // and intentional shape), and the Embracing Power starter product is the
  // first thing to write it at scale — so pin it. If a regenerated
  // printings.json pads it to `010`, this fails here rather than silently
  // detaching owned copies in a player's collection file.
  it('pins the one unpadded collector number the starter products write', () => {
    const unpadded = loadPrintings().filter(row => /^\d+$/.test(row.collectorNumber) && row.collectorNumber.length !== 3)
    expect(unpadded.map(row => row.key)).toEqual(['embracingpowerretailstarterdeck/10'])
    expect(unpadded[0].cardId).toBe('over-the-edge')
  })
  it('does not silently simulate pending cards as blank cards', () => {
    for (const id of status.pendingCards) {
      const deck: DeckList = { ...starter, legends: [starter.legends[0], starter.legends[1], starter.legends[2]], cards: { ...starter.cards, [id]: 1 } }
      expect(validateDeck(db, deck).some(error => error.includes('awaiting simulator implementation'))).toBe(true)
      expect(() => newGame(db, { decks: [deck, deck], seed: 1 })).toThrow('awaiting simulator implementation')
    }
  })
})
