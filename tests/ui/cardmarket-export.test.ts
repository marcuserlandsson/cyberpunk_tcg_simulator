import { describe, expect, it } from 'vitest'
import { loadCardDb } from '../../src/engine/cardDb'
import { loadPrintings } from '../../src/ui/printings'
import { buildExportGroups, bulkListingText, csvFilename, groupCsv, loadCardmarketMap, type CardmarketMap } from '../../src/ui/cardmarketExport'
import type { EffectiveLine } from '../../src/ui/sellDraft'

const db = loadCardDb(), printings = loadPrintings()
const map: CardmarketMap = {
  version: 1, subtitle: 'always', separator: ' - ',
  expansions: {
    welcometonightcitybeta: { expansion: 'Welcome to Night City', variant: 'Beta' },
    welcometonightcityretail: { expansion: 'Welcome to Night City' },
  },
  names: { 'welcometonightcitybeta/β005b': 'V - Streetkid (V.2)' },
}
const line = (key: string, count: number, condition: EffectiveLine['condition'] = 'NM'): EffectiveLine => ({ key, requested: count, count, condition })

describe('buildExportGroups', () => {
  it('groups by Cardmarket expansion, mapped first, rows by collector number, and merges identical rows', () => {
    const groups = buildExportGroups([
      line('welcometonightcityretail/033', 1),
      line('welcometonightcityretail/001', 2),
      line('welcometonightcitybeta/β005b', 1),
      line('arasakademodeck/006', 2),
      line('PRM01/008', 0),
      line('no-such-set/999', 3),
    ], printings, db, map)
    expect(groups.map(g => [g.expansion, g.mapped, g.copies])).toEqual([['Welcome to Night City', true, 4], ['Arasaka Demo Deck', false, 2]])
    expect(groups[0].rows).toEqual([
      { name: 'Adam Smasher - Ender of Legends', collectorNumbers: ['001'], quantity: 2, condition: 'NM' },
      { name: 'V - Streetkid (V.2)', collectorNumbers: ['β005b'], quantity: 1, condition: 'NM', variant: 'Beta' },
      { name: 'Industrial Assembly', collectorNumbers: ['033'], quantity: 1, condition: 'NM' },
    ])
  })
  it('keeps different conditions of one card as separate rows', () => {
    const [group] = buildExportGroups([line('welcometonightcityretail/033', 1, 'NM'), line('welcometonightcitybeta/β033', 1, 'EX')], printings, db, { ...map, expansions: { ...map.expansions, welcometonightcitybeta: { expansion: 'Welcome to Night City' } } })
    expect(group.rows.map(r => [r.condition, r.quantity, r.collectorNumbers])).toEqual([['NM', 1, ['033']], ['EX', 1, ['β033']]])
  })
})

describe('formats', () => {
  const groups = buildExportGroups([line('welcometonightcityretail/001', 2), line('arasakademodeck/006', 1)], printings, db, map)
  it('writes the bulk-listing text with an unmapped-set marker', () => {
    expect(bulkListingText(groups, 'English')).toBe([
      '## Welcome to Night City (2 copies)',
      '2× Adam Smasher - Ender of Legends · #001 · NM · English',
      '',
      '## Arasaka Demo Deck ⚠ check expansion (1 copy)',
      '1× Industrial Assembly · #006 · NM · English',
    ].join('\n'))
  })
  it('writes one CSV per expansion with the extension\'s column names', () => {
    expect(groupCsv(groups[0], 'English')).toBe('name,quantity,condition,language\r\nAdam Smasher - Ender of Legends,2,Near Mint,English\r\n')
  })
  it('quotes cells containing commas or quotes', () => {
    const csv = groupCsv({ expansion: 'X', mapped: true, copies: 1, rows: [{ name: 'Say "Hi", Choom', collectorNumbers: ['1'], quantity: 1, condition: 'LP' }] }, 'German')
    expect(csv).toBe('name,quantity,condition,language\r\n"Say ""Hi"", Choom",1,Light Played,German\r\n')
  })
  it('names files by date and expansion, flagging unmapped sets', () => {
    const today = new Date('2026-09-28T12:00:00Z')
    expect(csvFilename(groups[0], today)).toBe('cardmarket-sell-2026-09-28-welcome-to-night-city.csv')
    expect(csvFilename(groups[1], today)).toBe('cardmarket-sell-2026-09-28-CHECK-arasaka-demo-deck.csv')
  })
})

describe('the shipped map', () => {
  it('parses and only names set codes that exist', () => {
    const shipped = loadCardmarketMap()
    const codes = new Set(printings.map(p => p.setCode))
    expect(Object.keys(shipped.expansions).filter(c => !codes.has(c))).toEqual([])
    const keys = new Set(printings.map(p => p.key))
    expect(Object.keys(shipped.names).filter(k => !keys.has(k))).toEqual([])
  })
  it('rejects a malformed map', () => {
    expect(() => loadCardmarketMap({ version: 1, expansions: [] })).toThrow()
  })
})
