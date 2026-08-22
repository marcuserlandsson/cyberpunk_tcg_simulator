import { describe, it, expect } from 'vitest'
import { loadCardDb, cardDbSchema } from '../../src/engine/cardDb'

describe('cardDb', () => {
  const db = loadCardDb()
  const cards = Object.values(db)

  it('loads all 141 cards', () => {
    expect(cards.length).toBe(141)
  })

  it('has a unique id for every card', () => {
    const ids = cards.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(ids).size).toBe(141)
  })

  it('keys the db by card id', () => {
    for (const [key, card] of Object.entries(db)) {
      expect(card.id).toBe(key)
    }
  })

  it('rejects a card missing "type" via the zod schema', () => {
    const badCard = {
      id: 'test-bad-card',
      name: 'Test',
      color: 'Red',
      cost: 1,
      power: null,
      ram: { color: 'Red', value: 1 },
      ramLimit: null,
      sellTag: false,
      keywords: [],
      text: '',
      effects: [],
      // type omitted deliberately
    }
    const result = cardDbSchema.safeParse([badCard])
    expect(result.success).toBe(false)
  })

  it('every legend has a ramLimit field and null ram', () => {
    const legends = cards.filter((c) => c.type === 'legend')
    expect(legends.length).toBeGreaterThan(0)
    for (const legend of legends) {
      expect(legend.ram).toBeNull()
      expect('ramLimit' in legend).toBe(true)
    }
  })

  it('every non-legend has a ram value', () => {
    const nonLegends = cards.filter((c) => c.type !== 'legend')
    expect(nonLegends.length).toBeGreaterThan(0)
    for (const card of nonLegends) {
      expect(card.ram).not.toBeNull()
      expect(typeof card.ram?.value).toBe('number')
    }
  })

  it('every non-Rebecca legend has a non-null ramLimit', () => {
    const legends = cards.filter((c) => c.type === 'legend' && c.id !== 'rebecca-having-a-moment')
    for (const legend of legends) {
      expect(legend.ramLimit).not.toBeNull()
    }
  })

  describe('strictness against extra/typo keys', () => {
    const validCard = {
      id: 'test-strict-card',
      name: 'Test',
      color: 'Red',
      type: 'unit',
      cost: 1,
      power: 1,
      ram: { color: 'Red', value: 1 },
      ramLimit: null,
      sellTag: false,
      keywords: [],
      text: '',
      effects: [],
    }

    it('accepts the valid card as a baseline sanity check', () => {
      const result = cardDbSchema.safeParse([validCard])
      expect(result.success).toBe(true)
    })

    it('rejects a card with an extra unknown key', () => {
      const result = cardDbSchema.safeParse([{ ...validCard, notARealField: 'oops' }])
      expect(result.success).toBe(false)
    })

    it('rejects a card with a typo\'d optional key (subtitel instead of subtitle)', () => {
      const result = cardDbSchema.safeParse([{ ...validCard, subtitel: 'Typo' }])
      expect(result.success).toBe(false)
    })

    it('rejects a card whose ram object has a stray key', () => {
      const result = cardDbSchema.safeParse([
        { ...validCard, ram: { color: 'Red', value: 1, extra: true } },
      ])
      expect(result.success).toBe(false)
    })

    it('rejects an effect def with a stray key', () => {
      const cardWithBadEffect = {
        ...validCard,
        effects: [
          {
            trigger: 'onPlay',
            effect: { kind: 'draw', count: 1 },
            strayKey: 'oops',
          },
        ],
      }
      const result = cardDbSchema.safeParse([cardWithBadEffect])
      expect(result.success).toBe(false)
    })

    it('rejects an effect def whose cost sub-object has a stray key', () => {
      const cardWithBadEffectCost = {
        ...validCard,
        effects: [
          {
            trigger: 'onPlay',
            cost: { eddies: 1, strayKey: 'oops' },
            effect: { kind: 'draw', count: 1 },
          },
        ],
      }
      const result = cardDbSchema.safeParse([cardWithBadEffectCost])
      expect(result.success).toBe(false)
    })

    it('rejects an effect def whose condition sub-object has a stray key', () => {
      const cardWithBadEffectCondition = {
        ...validCard,
        effects: [
          {
            trigger: 'onPlay',
            condition: { streetCredAtLeast: 1, strayKey: 'oops' },
            effect: { kind: 'draw', count: 1 },
          },
        ],
      }
      const result = cardDbSchema.safeParse([cardWithBadEffectCondition])
      expect(result.success).toBe(false)
    })

    it('rejects an effect node with a stray key', () => {
      const cardWithBadEffectNode = {
        ...validCard,
        effects: [
          {
            trigger: 'onPlay',
            effect: { kind: 'draw', count: 1, strayKey: 'oops' },
          },
        ],
      }
      const result = cardDbSchema.safeParse([cardWithBadEffectNode])
      expect(result.success).toBe(false)
    })
  })
})
