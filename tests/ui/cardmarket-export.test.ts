import { describe, expect, it } from 'vitest'
import { loadCardDb } from '../../src/engine/cardDb'
import { loadPrintings } from '../../src/ui/printings'
import { buildExportGroups, bulkListingText, csvFilename, groupCsv, loadCardmarketMap, type CardmarketMap, type ExportGroup } from '../../src/ui/cardmarketExport'
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
  it('groups by Cardmarket expansion, mapped first, rows alphabetically then by collector number, and merges identical rows', () => {
    const groups = buildExportGroups([
      line('welcometonightcityretail/033', 1),
      line('welcometonightcityretail/001', 2),
      line('welcometonightcitybeta/β005b', 1),
      line('arasakademodeck/006', 2),
      line('PRM01/008', 0),
      line('no-such-set/999', 3),
    ], printings, db, map)
    expect(groups.map(g => [g.expansion, g.mapped, g.copies])).toEqual([['Welcome to Night City', true, 4], ['Arasaka Demo Deck', false, 2]])
    // Adam Smasher and Industrial Assembly each have another printing sharing
    // this expansion (welcometonightcitybeta), so both pick up an automatic
    // (V.n) suffix; V - Streetkid's suffix comes from a `names` override
    // instead, and it differs from what the automatic rule would have picked
    // (V.3, since two more V-Streetkid printings exist on the retail set) —
    // proving the override wins.
    expect(groups[0].rows).toEqual([
      { name: 'Adam Smasher - Ender of Legends (V.2)', collectorNumbers: ['001'], quantity: 2, condition: 'NM' },
      { name: 'Industrial Assembly (V.2)', collectorNumbers: ['033'], quantity: 1, condition: 'NM' },
      { name: 'V - Streetkid (V.2)', collectorNumbers: ['β005b'], quantity: 1, condition: 'NM', variant: 'Beta' },
    ])
  })
  it('keeps different conditions of one card as separate rows', () => {
    const [group] = buildExportGroups([line('welcometonightcityretail/033', 1, 'NM'), line('welcometonightcitybeta/β033', 1, 'EX')], printings, db, { ...map, expansions: { ...map.expansions, welcometonightcitybeta: { expansion: 'Welcome to Night City' } } })
    // Sharing one expansion also makes these two printings a V-numbered pair
    // (β033 sorts first), so the rows differ by name as well as condition —
    // still two rows, never merged.
    expect(group.rows.map(r => [r.name, r.condition, r.quantity, r.collectorNumbers])).toEqual([
      ['Industrial Assembly (V.1)', 'EX', 1, ['β033']],
      ['Industrial Assembly (V.2)', 'NM', 1, ['033']],
    ])
  })
  it('numbers same-name printings within one Cardmarket expansion (V.n), ordered by collector number', () => {
    const betaMap: CardmarketMap = { version: 1, subtitle: 'always', separator: ' - ', expansions: { welcometonightcitybeta: { expansion: 'Welcome to Night City - Beta' } }, names: {} }
    const [group] = buildExportGroups([
      line('welcometonightcitybeta/β005a', 1), line('welcometonightcitybeta/β005b', 1), line('welcometonightcitybeta/β144', 1),
      line('welcometonightcitybeta/β001', 1), line('welcometonightcitybeta/β141', 1), line('welcometonightcitybeta/β033', 1),
    ], printings, db, betaMap)
    const nameOf = (num: string) => group.rows.find(r => r.collectorNumbers.includes(num))!.name
    expect(nameOf('β005a')).toBe('V - Streetkid (V.1)')
    expect(nameOf('β005b')).toBe('V - Streetkid (V.2)')
    expect(nameOf('β144')).toBe('V - Streetkid (V.3)')
    expect(nameOf('β001')).toBe('Adam Smasher - Ender of Legends (V.1)')
    expect(nameOf('β141')).toBe('Adam Smasher - Ender of Legends (V.2)')
    expect(nameOf('β033')).toBe('Industrial Assembly') // the only printing of this card in this expansion: no suffix
  })
  it('never suffixes a printing from an unmapped set', () => {
    const groups = buildExportGroups([line('arasakademodeck/006', 1), line('embracingpowerbetastarterdeck/β009', 1)], printings, db, { version: 1, subtitle: 'always', separator: ' - ', expansions: {}, names: {} })
    for (const g of groups) for (const r of g.rows) expect(r.name).not.toMatch(/\(V\.\d+\)/)
  })
})

describe('formats', () => {
  const groups = buildExportGroups([line('welcometonightcityretail/001', 2), line('arasakademodeck/006', 1)], printings, db, map)
  it('writes the bulk-listing text with an unmapped-set marker', () => {
    expect(bulkListingText(groups, 'English')).toBe([
      '## Welcome to Night City (2 copies)',
      '2× Adam Smasher - Ender of Legends (V.2) · #001 · NM · English',
      '',
      '## Arasaka Demo Deck ⚠ check expansion (1 copy)',
      '1× Industrial Assembly · #006 · NM · English',
    ].join('\n'))
  })
  it('writes one CSV per expansion with the extension\'s column names', () => {
    expect(groupCsv(groups[0], 'English')).toBe('name,quantity,condition,language\r\nAdam Smasher - Ender of Legends (V.2),2,Near Mint,English\r\n')
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
  it('adds the variant segment to a bulk-listing line', () => {
    const variantGroups: ExportGroup[] = [{ expansion: 'Welcome to Night City - Beta', mapped: true, copies: 1, rows: [{ name: 'V - Streetkid (V.1)', collectorNumbers: ['β005a'], quantity: 1, condition: 'NM', variant: 'Foil' }] }]
    expect(bulkListingText(variantGroups, 'English')).toContain('1× V - Streetkid (V.1) · #β005a · Foil · NM · English')
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
  it('maps every set Cardmarket carries', () => {
    const shipped = loadCardmarketMap()
    // Edgerunner Open is not on Cardmarket (checked 2026-09-28).
    const notOnCardmarket = ['edgerunneropens1']
    const codes = [...new Set(printings.map(p => p.setCode))].filter(c => !notOnCardmarket.includes(c))
    expect(codes.filter(c => !shipped.expansions[c])).toEqual([])
  })
  it('exports V - Streetkid under Welcome to Night City - Beta with the automatic V.1 suffix', () => {
    const shipped = loadCardmarketMap()
    const groups = buildExportGroups([line('welcometonightcitybeta/β005a', 1)], printings, db, shipped)
    expect(groups).toEqual([{ expansion: 'Welcome to Night City - Beta', mapped: true, copies: 1, rows: [{ name: 'V - Streetkid (V.1)', collectorNumbers: ['β005a'], quantity: 1, condition: 'NM' }] }])
  })
})
