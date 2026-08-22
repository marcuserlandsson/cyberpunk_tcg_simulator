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
})
