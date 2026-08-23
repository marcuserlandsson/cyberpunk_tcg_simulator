// Final-review item 4: `deckPicker.isDeckPickable`'s demo waiver used to be
// unconditional — `deck.demo === true` made a deck pickable no matter what
// else was wrong with it, even a RAM violation that would make the deck
// unplayable the instant a game started. The waiver should cover only the
// thing demo decks are actually exempt from: the 40–50 card-count check
// (`validateDeck`'s own `deck.demo` branch, src/engine/deck.ts).

import { describe, expect, it } from 'vitest'
import { loadCardDb } from '../../src/engine/cardDb'
import { deckPickerLabel, isDeckPickable } from '../../src/ui/deckPicker'
import type { DeckList } from '../../src/engine/deck'
import arasakaDeck from '../../data/decks/arasaka-embracing-power.json'
import mercsDeck from '../../data/decks/mercs-the-heist.json'

const db = loadCardDb()
const arasaka = arasakaDeck as unknown as DeckList
const mercs = mercsDeck as unknown as DeckList

// Same fixture combination tests/ui/deckbuilder.test.tsx uses for its own
// "over the RAM limit" case: these three legends between them license no
// Blue RAM at all, so any Blue-RAM card in the deck is a real violation.
const LEGENDS: [string, string, string] = [
  'goro-takemura-hands-unclean',
  'yorinobu-arasaka-embracing-destruction',
  'saburo-arasaka-stubborn-patriarch',
]

const BLUE_RAM_CARD = Object.values(db).find(
  (def) => def.type !== 'legend' && def.ram !== null && def.ram.color === 'Blue'
)
if (BLUE_RAM_CARD === undefined) throw new Error('fixture assumption failed: no Blue-ram card')

describe('isDeckPickable', () => {
  it('rejects a demo-flagged deck whose only problem used to be waived: a RAM violation', () => {
    const deck: DeckList = {
      name: 'Busted Demo Deck',
      legends: LEGENDS,
      cards: { [BLUE_RAM_CARD.id]: 1 },
      demo: true,
    }
    expect(isDeckPickable(db, deck)).toBe(false)
    expect(deckPickerLabel(db, deck)).toContain('invalid')
  })

  it('still accepts a demo-flagged deck whose only problem is its size', () => {
    // The bundled starter decks are themselves undersized (14–15 cards,
    // short of the 40-card minimum) but otherwise legal — exactly the case
    // the demo waiver exists for.
    expect(arasaka.demo).toBe(true)
    expect(mercs.demo).toBe(true)
    expect(isDeckPickable(db, arasaka)).toBe(true)
    expect(isDeckPickable(db, mercs)).toBe(true)
    expect(deckPickerLabel(db, arasaka)).toBe(arasaka.name)
    expect(deckPickerLabel(db, mercs)).toBe(mercs.name)
  })

  it('still rejects a non-demo deck with any validateDeck error, unchanged', () => {
    const deck: DeckList = {
      name: 'Busted Non-Demo Deck',
      legends: LEGENDS,
      cards: { [BLUE_RAM_CARD.id]: 1 },
    }
    expect(isDeckPickable(db, deck)).toBe(false)
  })

  it('accepts a demo-flagged deck with no errors besides size', () => {
    const deck: DeckList = {
      name: 'Clean Demo Deck',
      legends: LEGENDS,
      cards: { 'mantis-blades': 1 },
      demo: true,
    }
    expect(isDeckPickable(db, deck)).toBe(true)
  })
})
