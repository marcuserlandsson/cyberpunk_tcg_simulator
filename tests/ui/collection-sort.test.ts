import { describe, expect, it } from 'vitest'
import { loadCardDb } from '../../src/engine/cardDb'
import { loadPrintings, listSets, printingsByCard } from '../../src/ui/printings'
import { biggestSet, cardNumberKey, collectorNumberKey, compareCards, compareNumberKeys, comparePrintings } from '../../src/ui/collectionSort'

const db = loadCardDb()
const printings = loadPrintings()
const byCard = printingsByCard(printings)
const core = biggestSet(printings)
const setOrder = listSets(printings).map(s => s.code)

describe('collectorNumberKey', () => {
  it('reads the digits and keeps a letter suffix', () => {
    expect(collectorNumberKey('β005a')).toEqual({ n: 5, suffix: 'a' })
    expect(collectorNumberKey('033')).toEqual({ n: 33, suffix: '' })
    expect(compareNumberKeys(collectorNumberKey('β005'), collectorNumberKey('β005a'))).toBeLessThan(0)
    expect(compareNumberKeys(collectorNumberKey('β009'), collectorNumberKey('β010'))).toBeLessThan(0)
  })
  it('puts a number without digits last', () => {
    expect(compareNumberKeys(collectorNumberKey('PROMO'), collectorNumberKey('001'))).toBeGreaterThan(0)
  })
})

describe('cardNumberKey', () => {
  it('uses the chosen set when one is filtered', () => {
    const prints = byCard.get('industrial-assembly')!
    const demo = prints.find(p => p.setCode === 'arasakademodeck')!
    expect(cardNumberKey(prints, 'arasakademodeck', core)).toEqual({ ...collectorNumberKey(demo.collectorNumber), tier: 0 })
  })
  it('falls back to the core set, and to any set at tier 1', () => {
    const prints = byCard.get('industrial-assembly')!
    const key = cardNumberKey(prints, '', core)!
    expect(key.tier).toBe(0)
    const promoOnly = printings.filter(p => p.setCode === 'PRM01')
    expect(cardNumberKey(promoOnly, '', core)!.tier).toBe(1)
    expect(cardNumberKey([], '', core)).toBeUndefined()
  })
})

describe('compareCards', () => {
  const cards = Object.values(db).map(def => ({ def, printings: byCard.get(def.id) ?? [] }))
  it('number order starts at the core set\'s lowest collector number', () => {
    const sorted = [...cards].sort((a, b) => compareCards(a, b, 'number', '', core))
    const first = printings.filter(p => p.setCode === core).sort((a, b) => compareNumberKeys(collectorNumberKey(a.collectorNumber), collectorNumberKey(b.collectorNumber)))[0]
    expect(sorted[0].def.id).toBe(first.cardId)
    // every tier-0 card precedes every tier-1 card
    const tiers = sorted.map(c => cardNumberKey(c.printings, '', core)?.tier ?? 1)
    expect(tiers.indexOf(1) === -1 || tiers.lastIndexOf(0) < tiers.indexOf(1)).toBe(true)
  })
  it('name order is alphabetical', () => {
    const sorted = [...cards].sort((a, b) => compareCards(a, b, 'name', '', core))
    expect(sorted.map(c => c.def.name)).toEqual([...sorted.map(c => c.def.name)].sort((a, b) => a.localeCompare(b)))
  })
  it('a set filter re-anchors the numbering', () => {
    const inDemo = cards.filter(c => c.printings.some(p => p.setCode === 'arasakademodeck'))
    const sorted = [...inDemo].sort((a, b) => compareCards(a, b, 'number', 'arasakademodeck', core))
    const numbers = sorted.map(c => cardNumberKey(c.printings, 'arasakademodeck', core)!.n)
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b))
  })
})

describe('comparePrintings', () => {
  it('orders the preferred set first, then set order, then number', () => {
    const prints = [...byCard.get('industrial-assembly')!].sort((a, b) => comparePrintings(a, b, core, setOrder))
    expect(prints[0].setCode).toBe(core)
    for (let i = 1; i < prints.length; i++) {
      if (prints[i].setCode === prints[i - 1].setCode) expect(compareNumberKeys(collectorNumberKey(prints[i - 1].collectorNumber), collectorNumberKey(prints[i].collectorNumber))).toBeLessThanOrEqual(0)
    }
  })
})
