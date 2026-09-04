import { describe, expect, it } from 'vitest'
import {
  parsePrintings,
  printingsByCard,
  getPrinting,
  listSets,
  loadPrintings,
  type Printing,
} from '../../src/ui/printings'

const row = (over: Partial<Printing> = {}): Printing => ({
  key: 'welcometonightcitybeta/β025',
  cardId: 'mantis-blades',
  setCode: 'welcometonightcitybeta',
  setName: 'Welcome to Night City — Beta',
  collectorNumber: 'β025',
  rarity: 'Common',
  finish: null,
  artist: 'Ricardo Padierne Silvera',
  sourcePrintingId: '84278f23-7323-47d2-b639-23edd76f87ae',
  ...over,
})

describe('parsePrintings', () => {
  it('accepts a valid array and returns it typed', () => {
    const out = parsePrintings([row()])
    expect(out).toHaveLength(1)
    expect(out[0].key).toBe('welcometonightcitybeta/β025')
  })

  it('rejects a row missing a required field', () => {
    const bad = { ...row() } as Record<string, unknown>
    delete bad.rarity
    expect(() => parsePrintings([bad])).toThrow(/rarity/)
  })

  it('rejects non-array input', () => {
    expect(() => parsePrintings({ nope: true })).toThrow()
  })

  it('rejects duplicate keys', () => {
    expect(() => parsePrintings([row(), row()])).toThrow(/duplicate/i)
  })

  it('accepts a string finish (open vocabulary, not an enum)', () => {
    const out = parsePrintings([row({ key: 'x/1', finish: 'Foil' })])
    expect(out[0].finish).toBe('Foil')
  })
})

describe('indexes', () => {
  const rows = [
    row(),
    row({ key: 'welcometonightcityretail/025', setCode: 'welcometonightcityretail', setName: 'Welcome to Night City — Retail', collectorNumber: '025' }),
    row({ key: 'welcometonightcitybeta/β001', cardId: 'v-streetkid', collectorNumber: 'β001' }),
  ]

  it('printingsByCard groups rows by cardId', () => {
    const byCard = printingsByCard(rows)
    expect(byCard.get('mantis-blades')).toHaveLength(2)
    expect(byCard.get('v-streetkid')).toHaveLength(1)
  })

  it('getPrinting finds by key', () => {
    expect(getPrinting(rows, 'welcometonightcityretail/025')?.setCode).toBe('welcometonightcityretail')
    expect(getPrinting(rows, 'missing/999')).toBeUndefined()
  })

  it('listSets returns unique sets in first-appearance order', () => {
    expect(listSets(rows)).toEqual([
      { code: 'welcometonightcitybeta', name: 'Welcome to Night City — Beta' },
      { code: 'welcometonightcityretail', name: 'Welcome to Night City — Retail' },
    ])
  })
})

describe('loadPrintings', () => {
  it('loads the bundled dataset and joins against real card ids', () => {
    const printings = loadPrintings()
    expect(printings.length).toBeGreaterThanOrEqual(141)
    expect(printings.some((p) => p.cardId === 'mantis-blades')).toBe(true)
  })

  it('returns the same array on repeated calls (memoized)', () => {
    expect(loadPrintings()).toBe(loadPrintings())
  })
})
