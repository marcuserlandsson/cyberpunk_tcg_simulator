// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { loadCardDb } from '../../src/engine/cardDb'
import { loadPrintings, type Printing } from '../../src/ui/printings'
import { buildBuyList, completionStats, playsetGaps, playsetTarget } from '../../src/ui/collection'
import { artworkGroups, completionPercentage, missingArtworks } from '../../src/ui/artworks'
import catalog from '../../data/artworks.json'

const db = loadCardDb(), printings = loadPrintings()
describe('independent artwork and playset goals', () => {
  it('retains every printing exactly once in the reviewed identity map', () => {
    const mapped = catalog.artworks.flatMap(a => a.printingKeys)
    expect(mapped.length).toBe(new Set(mapped).size)
    expect([...mapped].sort()).toEqual(printings.map(p => p.key).sort())
    for (const art of catalog.artworks) for (const key of art.printingKeys) {
      const p = printings.find(p => p.key === key)!
      expect(p.artworkId).toBe(art.id)
      expect(p.cardId).toBe(art.cardId)
      expect(art.imageHashes[key as keyof typeof art.imageHashes]).toMatch(/^[a-f0-9]{64}$/)
    }
  })
  it('one of several reprints completes one artwork, but a second copy only advances the playset', () => {
    const prints = printings.filter(p => p.cardId === 'industrial-assembly')
    expect(artworkGroups(prints)).toHaveLength(1) // includes the visually reviewed Edgerunner crop
    const collection = { counts: { [prints[0].key]: 1 } }
    expect(missingArtworks(prints, collection.counts)).toHaveLength(0)
    const cards = { 'industrial-assembly': db['industrial-assembly'] }
    const one = completionStats(cards, prints, collection)
    const two = completionStats(cards, prints, { counts: { ...collection.counts, [prints[1].key]: 1 } })
    expect(one).toMatchObject({ artsOwned: 1, artsTarget: 1, artsPct: 100, playsetOwned: 1, playsetTarget: 3 })
    expect(two).toMatchObject({ artsOwned: 1, playsetOwned: 2 })
    expect(buildBuyList(cards, prints, collection, { playset: false, arts: true })).not.toContain('1x')
  })
  it('different artwork remains a collection gap after completing gameplay copies', () => {
    const prints = printings.filter(p => p.cardId === 'v-streetkid')
    const cards = { 'v-streetkid': db['v-streetkid'] }
    const collection = { counts: { [prints[0].key]: 3 } }
    expect(playsetGaps(cards, prints, collection)).toHaveLength(0)
    expect(missingArtworks(prints, collection.counts)).toHaveLength(2)
    const list = buildBuyList(cards, prints, collection, { playset: false, arts: true })
    expect(list.split('\n').filter(line => line.startsWith('1x'))).toHaveLength(2)
    expect(list).toContain(' OR ')
  })
  it('art-only promos count for artwork and physical ownership, not a playset', () => {
    expect(playsetTarget(db['rebecca-having-a-moment'])).toBe(0)
    const promo = printings.find(p => p.key === 'PRM01/008')!
    const collection = { counts: { [promo.key]: 3 } }
    const gap = playsetGaps(db, printings, collection).find(g => g.cardId === promo.cardId)!
    expect(gap.owned).toBe(0)
    expect(completionStats(db, printings, collection)).toMatchObject({ totalOwned: 3, artsOwned: 1, playsetOwned: 0 })
  })
  it('never rounds an incomplete goal up to 100%, or guesses unknown artwork identities', () => {
    expect(completionPercentage(399, 400)).toBe(99)
    expect(completionPercentage(400, 400)).toBe(100)
    const unknown: Printing = { ...printings[0], key: 'future/1', artworkId: undefined }
    const stats = completionStats(db, [printings[0], unknown], { counts: { [printings[0].key]: 1 } })
    expect(stats.unreviewedPrintings).toBe(1)
    expect(stats.artsPct).toBeLessThan(100)
  })
})
