// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { _resetCollectionCacheForTests, getCollection, setCount } from '../../src/ui/collection'
import { setCollectionAccess } from '../../src/ui/collectionAccess'
import { readCollectionJournal } from '../../src/ui/collectionJournal'
import {
  SELL_KEY, _resetSellListForTests, addToSellList, clearSold, effectiveLines, getSellList, getSellListStorageError,
  localDate, markSold, removeSellLine, setLineCondition, setSellCount, setSellDefaults, type SellList,
} from '../../src/ui/sellDraft'

beforeEach(() => { localStorage.clear(); _resetCollectionCacheForTests(); _resetSellListForTests(); setCollectionAccess('writer') })

describe('sell list store', () => {
  it('starts empty with NM and English defaults', () => {
    expect(getSellList()).toEqual({ version: 1, condition: 'NM', language: 'English', lines: [] })
  })
  it('merges additions by printing key and persists across a reload', () => {
    addToSellList([{ key: 'a/1', count: 2 }, { key: 'b/2', count: 1 }])
    addToSellList([{ key: 'a/1', count: 1 }])
    setLineCondition('b/2', 'EX')
    setSellDefaults({ language: 'German' })
    _resetSellListForTests()
    expect(getSellList()).toEqual({ version: 1, condition: 'NM', language: 'German', lines: [{ key: 'a/1', count: 3 }, { key: 'b/2', count: 1, condition: 'EX' }] })
  })
  it('edits, removes and clears lines; ignores counts below one', () => {
    addToSellList([{ key: 'a/1', count: 2 }, { key: 'b/2', count: 1 }, { key: 'c/3', count: 1 }])
    setSellCount('a/1', 5); setSellCount('b/2', 0); removeSellLine('c/3')
    expect(getSellList().lines).toEqual([{ key: 'a/1', count: 5 }, { key: 'b/2', count: 1 }])
    clearSold(['a/1'])
    expect(getSellList().lines).toEqual([{ key: 'b/2', count: 1 }])
  })
  it('resets unreadable stored data and says so', () => {
    localStorage.setItem(SELL_KEY, '{"version":1,"lines":"nope"}')
    expect(getSellList().lines).toEqual([])
    expect(getSellListStorageError()).toMatch(/could not be read/)
  })
  it('caps every line at the copies currently owned', () => {
    addToSellList([{ key: 'a/1', count: 3 }, { key: 'b/2', count: 1 }])
    setLineCondition('b/2', 'LP')
    expect(effectiveLines(getSellList(), { 'a/1': 2 })).toEqual([
      { key: 'a/1', requested: 3, count: 2, condition: 'NM' },
      { key: 'b/2', requested: 1, count: 0, condition: 'LP' },
    ])
  })
  it('drops a stale snapshot when another tab writes the sell list', () => {
    addToSellList([{ key: 'a/1', count: 1 }])
    const other: SellList = { version: 1, condition: 'NM', language: 'English', lines: [{ key: 'z/9', count: 3 }] }
    localStorage.setItem(SELL_KEY, JSON.stringify(other))
    window.dispatchEvent(new StorageEvent('storage', { key: SELL_KEY }))
    expect(getSellList()).toEqual(other)
  })
})

describe('localDate', () => {
  it('formats the viewer\'s own calendar day, not UTC\'s', () => {
    expect(localDate(new Date(2026, 8, 28))).toBe('2026-09-28')
    expect(localDate(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('markSold', () => {
  const key = 'arasakademodeck/006', other = 'welcometonightcityretail/033'
  beforeEach(() => { setCount(key, 3); setCount(other, 1) })

  it('decrements the capped count, records a Sale and removes only the sold lines', () => {
    addToSellList([{ key, count: 5 }, { key: other, count: 1 }])
    markSold([key], getCollection().counts, new Date('2026-09-28T12:00:00Z'))
    expect(getCollection().counts[key] ?? 0).toBe(0)
    expect(getCollection().counts[other]).toBe(1)
    expect(getSellList().lines).toEqual([{ key: other, count: 1 }])
    expect(readCollectionJournal().entries.some(e => e.kind === 'Sale' && e.source === 'Cardmarket' && e.date === '2026-09-28')).toBe(true)
  })
  it('refuses when the collection changed since the confirm opened', () => {
    addToSellList([{ key, count: 1 }])
    const seen = { ...getCollection().counts }
    setCount(key, 2)
    expect(() => markSold([key], seen)).toThrow('Collection changed; review again.')
    expect(getSellList().lines).toHaveLength(1)
  })
  it('keeps the sell list when the tab cannot write the collection', () => {
    addToSellList([{ key, count: 1 }])
    const seen = { ...getCollection().counts }
    setCollectionAccess('waiting')
    expect(() => markSold([key], seen)).toThrow('Could not save the collection; the sell list was kept.')
    expect(getSellList().lines).toHaveLength(1)
    expect(getCollection().counts[key]).toBe(3)
  })
})
