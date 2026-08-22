import { describe, it, expect } from 'vitest'
import { validateDeck, deckSize, type DeckList } from '../../src/engine/deck'
import { loadCardDb } from '../../src/engine/cardDb'
import type { CardDb, CardDef } from '../../src/engine/types'
import arasakaDeck from '../../data/decks/arasaka-embracing-power.json'
import mercsDeck from '../../data/decks/mercs-the-heist.json'

function legend(
  id: string,
  name: string,
  color: string,
  ramLimitValue: number | null,
  opts: Partial<CardDef> = {}
): CardDef {
  return {
    id,
    name,
    color,
    type: 'legend',
    cost: 0,
    power: null,
    ram: null,
    ramLimit: ramLimitValue === null ? null : { color, value: ramLimitValue },
    sellTag: false,
    keywords: [],
    text: 'Some rules text.',
    effects: [],
    ...opts,
  }
}

function nonLegend(
  id: string,
  name: string,
  type: 'unit' | 'program' | 'gear',
  color: string,
  ramValue: number,
  opts: Partial<CardDef> = {}
): CardDef {
  return {
    id,
    name,
    color,
    type,
    cost: 1,
    power: type === 'program' ? null : 1,
    ram: { color, value: ramValue },
    ramLimit: null,
    sellTag: false,
    keywords: [],
    text: '',
    effects: [],
    ...opts,
  }
}

describe('deckSize', () => {
  it('sums copy counts of non-legend cards', () => {
    const deck: DeckList = { name: 'x', legends: ['a', 'b', 'c'], cards: { foo: 2, bar: 3 } }
    expect(deckSize(deck)).toBe(5)
  })
})

describe('validateDeck', () => {
  describe('worked RAM example: 2 Green + 2 Green + 2 Red legends (Green <= 4, Red <= 2)', () => {
    const db: CardDb = {
      'legend-a': legend('legend-a', 'Legend A', 'Green', 2),
      'legend-b': legend('legend-b', 'Legend B', 'Green', 2),
      'legend-c': legend('legend-c', 'Legend C', 'Red', 2),
      'green-4-unit': nonLegend('green-4-unit', 'Green Four', 'unit', 'Green', 4),
      'green-5-unit': nonLegend('green-5-unit', 'Green Five', 'unit', 'Green', 5),
      'red-2-unit': nonLegend('red-2-unit', 'Red Two', 'unit', 'Red', 2),
      'red-3-unit': nonLegend('red-3-unit', 'Red Three', 'unit', 'Red', 3),
    }
    const baseDeck = (cardId: string): DeckList => ({
      name: 'worked example',
      legends: ['legend-a', 'legend-b', 'legend-c'],
      demo: true,
      cards: { [cardId]: 3 },
    })

    it('allows a Green card exactly at the Green limit (4)', () => {
      expect(validateDeck(db, baseDeck('green-4-unit'))).toEqual([])
    })

    it('rejects a Green card over the Green limit (5 > 4)', () => {
      expect(validateDeck(db, baseDeck('green-5-unit')).length).toBeGreaterThan(0)
    })

    it('allows a Red card exactly at the Red limit (2)', () => {
      expect(validateDeck(db, baseDeck('red-2-unit'))).toEqual([])
    })

    it('rejects a Red card over the Red limit (3 > 2)', () => {
      expect(validateDeck(db, baseDeck('red-3-unit')).length).toBeGreaterThan(0)
    })
  })

  it('rejects unknown card ids', () => {
    const db: CardDb = {
      'legend-a': legend('legend-a', 'Legend A', 'Green', 2),
      'legend-b': legend('legend-b', 'Legend B', 'Green', 2),
      'legend-c': legend('legend-c', 'Legend C', 'Red', 2),
    }
    const deck: DeckList = {
      name: 'unknown',
      demo: true,
      legends: ['legend-a', 'legend-b', 'legend-c'],
      cards: { 'does-not-exist': 3 },
    }
    const errors = validateDeck(db, deck)
    expect(errors.some((e) => /does-not-exist/.test(e))).toBe(true)
  })

  it('rejects more than 3 copies of a card', () => {
    const db: CardDb = {
      'legend-a': legend('legend-a', 'Legend A', 'Green', 4),
      'legend-b': legend('legend-b', 'Legend B', 'Green', 4),
      'legend-c': legend('legend-c', 'Legend C', 'Red', 4),
      'card-x': nonLegend('card-x', 'Card X', 'unit', 'Green', 1),
    }
    const deck: DeckList = {
      name: 'too many copies',
      demo: true,
      legends: ['legend-a', 'legend-b', 'legend-c'],
      cards: { 'card-x': 4 },
    }
    const errors = validateDeck(db, deck)
    expect(errors.some((e) => /card-x/.test(e))).toBe(true)
  })

  it('rejects legends that do not have 3 unique names', () => {
    const db: CardDb = {
      'legend-a': legend('legend-a', 'Same Name', 'Green', 4),
      'legend-b': legend('legend-b', 'Same Name', 'Green', 4),
      'legend-c': legend('legend-c', 'Legend C', 'Red', 4),
    }
    const deck: DeckList = {
      name: 'dupe names',
      demo: true,
      legends: ['legend-a', 'legend-b', 'legend-c'],
      cards: {},
    }
    const errors = validateDeck(db, deck)
    expect(errors.some((e) => /unique/i.test(e))).toBe(true)
  })

  it('rejects a deck below the 40-card minimum when demo is not set', () => {
    const db: CardDb = {
      'legend-a': legend('legend-a', 'Legend A', 'Green', 4),
      'legend-b': legend('legend-b', 'Legend B', 'Green', 4),
      'legend-c': legend('legend-c', 'Legend C', 'Red', 4),
      'card-x': nonLegend('card-x', 'Card X', 'unit', 'Green', 1),
    }
    const deck: DeckList = {
      name: 'too small',
      legends: ['legend-a', 'legend-b', 'legend-c'],
      cards: { 'card-x': 3 },
    }
    const errors = validateDeck(db, deck)
    expect(errors.some((e) => /40/.test(e))).toBe(true)
  })

  it('rejects a deck above the 50-card maximum when demo is not set', () => {
    // 20 distinct cards x 3 copies each = 60 non-legend cards, over the 50 max.
    const bigDb: CardDb = {
      'legend-a': legend('legend-a', 'Legend A', 'Green', 60),
      'legend-b': legend('legend-b', 'Legend B', 'Green', 60),
      'legend-c': legend('legend-c', 'Legend C', 'Red', 60),
    }
    const bigDeck: DeckList = {
      name: 'too big',
      legends: ['legend-a', 'legend-b', 'legend-c'],
      cards: {},
    }
    for (let i = 0; i < 20; i++) {
      const id = `card-x-${i}`
      bigDb[id] = nonLegend(id, `Card X ${i}`, 'unit', 'Green', 1)
      bigDeck.cards[id] = 3
    }
    const errors = validateDeck(bigDb, bigDeck)
    expect(errors.some((e) => /50/.test(e))).toBe(true)
  })

  it('does not enforce the 40-50 size minimum/maximum when demo is true', () => {
    const db: CardDb = {
      'legend-a': legend('legend-a', 'Legend A', 'Green', 4),
      'legend-b': legend('legend-b', 'Legend B', 'Green', 4),
      'legend-c': legend('legend-c', 'Legend C', 'Red', 4),
      'card-x': nonLegend('card-x', 'Card X', 'unit', 'Green', 1),
    }
    const deck: DeckList = {
      name: 'demo small',
      demo: true,
      legends: ['legend-a', 'legend-b', 'legend-c'],
      cards: { 'card-x': 3 },
    }
    expect(validateDeck(db, deck)).toEqual([])
  })

  it('still enforces non-size rules on a demo deck', () => {
    const db: CardDb = {
      'legend-a': legend('legend-a', 'Same Name', 'Green', 4),
      'legend-b': legend('legend-b', 'Same Name', 'Green', 4),
      'legend-c': legend('legend-c', 'Legend C', 'Red', 4),
      'card-x': nonLegend('card-x', 'Card X', 'unit', 'Green', 1),
    }
    const deck: DeckList = {
      name: 'demo dupe names',
      demo: true,
      legends: ['legend-a', 'legend-b', 'legend-c'],
      cards: { 'card-x': 4 },
    }
    const errors = validateDeck(db, deck)
    expect(errors.some((e) => /unique/i.test(e))).toBe(true)
    expect(errors.some((e) => /card-x/.test(e))).toBe(true)
  })

  it('rejects an art-only promo legend (null ramLimit and empty text)', () => {
    const db: CardDb = {
      'promo-legend': legend('promo-legend', 'Promo Legend', 'Red', null, { text: '' }),
      'legend-b': legend('legend-b', 'Legend B', 'Green', 4),
      'legend-c': legend('legend-c', 'Legend C', 'Green', 4),
    }
    const deck: DeckList = {
      name: 'art only',
      demo: true,
      legends: ['promo-legend', 'legend-b', 'legend-c'],
      cards: {},
    }
    const errors = validateDeck(db, deck)
    expect(errors.some((e) => /art-only promo/i.test(e))).toBe(true)
  })

  it('a null ramLimit legend contributes 0 RAM to limit calculations', () => {
    // promo-legend has ramLimit: null but non-empty text, so it is not the
    // "art-only" rejection case -- it should just add nothing to the pool.
    const db: CardDb = {
      'promo-legend': legend('promo-legend', 'Promo Legend', 'Red', null, {
        text: 'Some non-empty rules text so this is not an art-only promo.',
      }),
      'legend-b': legend('legend-b', 'Legend B', 'Green', 4),
      'legend-c': legend('legend-c', 'Legend C', 'Green', 4),
      'red-1-unit': nonLegend('red-1-unit', 'Red One', 'unit', 'Red', 1),
    }
    const deck: DeckList = {
      name: 'null ramLimit contributes zero',
      demo: true,
      legends: ['promo-legend', 'legend-b', 'legend-c'],
      cards: { 'red-1-unit': 1 },
    }
    const errors = validateDeck(db, deck)
    expect(errors.some((e) => /red-1-unit/.test(e))).toBe(true)
  })

  it('both bundled starter decks validate as legal against the real card db', () => {
    const db = loadCardDb()
    expect(validateDeck(db, arasakaDeck as unknown as DeckList)).toEqual([])
    expect(validateDeck(db, mercsDeck as unknown as DeckList)).toEqual([])
  })
})
