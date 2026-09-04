import { describe, expect, it } from 'vitest'
import {
  parsePrintings,
  printingKey,
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

describe('printingKey', () => {
  it('omits the finish segment entirely when finish is null', () => {
    expect(printingKey('welcometonightcitybeta', 'β025', null)).toBe('welcometonightcitybeta/β025')
  })

  it('appends the finish segment when the printing has one', () => {
    expect(printingKey('welcometonightcityretail', '025', 'Foil')).toBe(
      'welcometonightcityretail/025/Foil'
    )
  })

  it('keeps a foil and its normal card distinct on a shared collector number', () => {
    // The whole point of the finish segment: without it these collide into a
    // duplicate key and the generator refuses to write the dataset at all.
    expect(printingKey('s', '1', null)).not.toBe(printingKey('s', '1', 'Foil'))
  })
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

  it('reports issues as readable lines, not zod\'s raw JSON message', () => {
    // This message reaches the user verbatim in the Collection tab's error
    // state, so it must not be a pretty-printed array of issue objects.
    const bad = { ...row() } as Record<string, unknown>
    bad.rarity = 42
    let message = ''
    try {
      parsePrintings([bad])
    } catch (err) {
      message = err instanceof Error ? err.message : String(err)
    }
    expect(message).toContain('0.rarity:')
    expect(message).not.toContain('"code"')
    expect(message).not.toContain('[\n')
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
