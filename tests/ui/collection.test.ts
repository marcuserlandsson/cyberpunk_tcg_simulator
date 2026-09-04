// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  getCollection,
  getStorageError,
  setCount,
  adjustCount,
  subscribeCollection,
  useCollection,
  _resetCollectionCacheForTests,
} from '../../src/ui/collection'

beforeEach(() => {
  localStorage.clear()
  _resetCollectionCacheForTests()
})

describe('counts', () => {
  it('starts empty', () => {
    expect(getCollection().counts).toEqual({})
  })

  it('setCount stores and getCollection reads back', () => {
    setCount('welcometonightcitybeta/β025', 2)
    expect(getCollection().counts['welcometonightcitybeta/β025']).toBe(2)
  })

  it('setCount clamps negatives to 0 and prunes zero counts', () => {
    setCount('a/1', 2)
    setCount('a/1', -5)
    expect(getCollection().counts).toEqual({})
    expect(JSON.parse(localStorage.getItem('ctcg:collection:v1')!)).toEqual({ counts: {} })
  })

  it('adjustCount adds and subtracts with a floor of 0', () => {
    adjustCount('a/1', 1)
    adjustCount('a/1', 1)
    adjustCount('a/1', -5)
    expect(getCollection().counts['a/1']).toBeUndefined()
  })

  it('preserves unknown keys already in storage across writes', () => {
    localStorage.setItem('ctcg:collection:v1', JSON.stringify({ counts: { 'ghost/999': 4 } }))
    _resetCollectionCacheForTests()
    setCount('a/1', 1)
    expect(getCollection().counts['ghost/999']).toBe(4)
  })

  it('falls back to empty on a malformed blob', () => {
    localStorage.setItem('ctcg:collection:v1', '{not json')
    _resetCollectionCacheForTests()
    expect(getCollection().counts).toEqual({})
  })

  it('surfaces a storage error instead of throwing when the write fails', () => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    try {
      expect(() => setCount('a/1', 1)).not.toThrow()
      expect(getStorageError()).toContain('Could not save')
    } finally {
      Storage.prototype.setItem = original
    }
    setCount('a/1', 1) // a later successful write clears the error
    expect(getStorageError()).toBe('')
  })
})

describe('subscription', () => {
  it('notifies on write and stops after unsubscribe', () => {
    let calls = 0
    const unsubscribe = subscribeCollection(() => calls++)
    setCount('a/1', 1)
    expect(calls).toBe(1)
    unsubscribe()
    setCount('a/1', 2)
    expect(calls).toBe(1)
  })

  it('useCollection re-renders with fresh counts and keeps a stable snapshot otherwise', () => {
    const { result, rerender } = renderHook(() => useCollection())
    const first = result.current
    rerender()
    expect(result.current).toBe(first) // stable reference, no write between
    act(() => setCount('a/1', 3))
    expect(result.current.counts['a/1']).toBe(3)
  })
})

import type { CardDb } from '../../src/engine/types'
import type { Printing } from '../../src/ui/printings'
import {
  cardTotal,
  playsetTarget,
  playsetGaps,
  missingPrintings,
  completionStats,
  buildBuyList,
  exportCollectionJson,
  importCollectionJson,
  exportCollectionText,
  importCollectionText,
} from '../../src/ui/collection'

// Minimal defs: only the fields the queries touch matter, but build full
// CardDefs so the CardDb type is satisfied without casts scattered per test.
const def = (id: string, type: 'legend' | 'unit') =>
  ({
    id, name: id, color: 'Red', type, cost: 1, power: 1,
    ram: null, ramLimit: null, sellTag: false, keywords: [], text: '', effects: [],
  }) as unknown as CardDb[string]

const miniDb: CardDb = { alpha: def('alpha', 'unit'), boss: def('boss', 'legend') }

const p = (key: string, cardId: string): Printing => ({
  key, cardId,
  setCode: key.split('/')[0], setName: key.split('/')[0],
  collectorNumber: key.split('/')[1],
  rarity: 'Common', finish: null, artist: '', sourcePrintingId: key,
})

const miniPrintings = [p('beta/1', 'alpha'), p('retail/1', 'alpha'), p('beta/2', 'boss')]

describe('derived queries', () => {
  it('cardTotal sums across printings', () => {
    const collection = { counts: { 'beta/1': 2, 'retail/1': 1 } }
    expect(cardTotal(miniPrintings, collection, 'alpha')).toBe(3)
    expect(cardTotal(miniPrintings, collection, 'boss')).toBe(0)
  })

  it('playsetTarget is 1 for legends, 3 otherwise', () => {
    expect(playsetTarget(miniDb.alpha)).toBe(3)
    expect(playsetTarget(miniDb.boss)).toBe(1)
  })

  it('playsetGaps lists only cards below target, capped at target', () => {
    const collection = { counts: { 'beta/1': 2 } }
    expect(playsetGaps(miniDb, miniPrintings, collection)).toEqual([
      { cardId: 'alpha', owned: 2, target: 3, missing: 1 },
      { cardId: 'boss', owned: 0, target: 1, missing: 1 },
    ])
  })

  it('missingPrintings returns printings with count 0', () => {
    const collection = { counts: { 'beta/1': 1 } }
    expect(missingPrintings(miniPrintings, collection).map((x) => x.key)).toEqual([
      'retail/1', 'beta/2',
    ])
  })

  it('completionStats: owned-toward-target over total targets; arts over printings', () => {
    // alpha 2/3 + boss 0/1 => 2/4 = 50%; arts: 1 of 3 printings owned => 33%.
    const collection = { counts: { 'beta/1': 2 } }
    expect(completionStats(miniDb, miniPrintings, collection)).toEqual({
      playsetPct: 50, artsPct: 33, totalOwned: 2,
    })
  })

  it('overshoot does not inflate playsetPct past the target', () => {
    const collection = { counts: { 'beta/1': 9, 'beta/2': 1 } }
    expect(completionStats(miniDb, miniPrintings, collection).playsetPct).toBe(100)
  })

  it('buildBuyList renders playset gaps and missing arts per options', () => {
    const collection = { counts: { 'beta/1': 2 } }
    const both = buildBuyList(miniDb, miniPrintings, collection, { playset: true, arts: true })
    expect(both).toContain('1x alpha')                 // playset shortfall
    expect(both).toContain('alpha [retail/1]')        // missing art
    expect(both).toContain('boss [beta/2]')
    const playsetOnly = buildBuyList(miniDb, miniPrintings, collection, { playset: true, arts: false })
    expect(playsetOnly).not.toContain('[retail/1]')
  })
})

describe('JSON export/import', () => {
  it('round-trips through export -> import replace', () => {
    setCount('beta/1', 2)
    const json = exportCollectionJson(getCollection())
    setCount('beta/1', 0)
    setCount('retail/1', 5)
    importCollectionJson(json, 'replace')
    expect(getCollection().counts).toEqual({ 'beta/1': 2 })
  })

  it('merge sums counts', () => {
    setCount('beta/1', 1)
    importCollectionJson(JSON.stringify({ version: 1, counts: { 'beta/1': 2, 'beta/2': 1 } }), 'merge')
    expect(getCollection().counts).toEqual({ 'beta/1': 3, 'beta/2': 1 })
  })

  it('throws loudly on malformed JSON and writes nothing', () => {
    setCount('beta/1', 1)
    expect(() => importCollectionJson('{"version":1,"counts":{"a":-2}}', 'replace')).toThrow()
    expect(() => importCollectionJson('not json', 'replace')).toThrow()
    expect(getCollection().counts).toEqual({ 'beta/1': 1 })
  })

  it('a well-formed JSON import with empty counts still performs a real replace (not a no-op guard)', () => {
    setCount('beta/1', 1)
    importCollectionJson(JSON.stringify({ version: 1, counts: {} }), 'replace')
    expect(getCollection().counts).toEqual({})
  })
})

describe('text export/import', () => {
  it('exports one line per owned printing with the bracketed key', () => {
    const collection = { counts: { 'beta/1': 2 } }
    const text = exportCollectionText(miniDb, miniPrintings, collection)
    expect(text).toBe('2x alpha [beta/1]')
  })

  it('round-trips unknown keys with a ??? name', () => {
    const collection = { counts: { 'ghost/999': 4 } }
    const text = exportCollectionText(miniDb, miniPrintings, collection)
    expect(text).toBe('4x ??? [ghost/999]')
    importCollectionText(text, 'replace')
    expect(getCollection().counts).toEqual({ 'ghost/999': 4 })
  })

  it('collects all malformed lines into one error and writes nothing', () => {
    setCount('beta/1', 1)
    expect(() => importCollectionText('2x alpha [beta/1]\ngarbage line\nalso bad', 'replace'))
      .toThrow(/garbage line[\s\S]*also bad/)
    expect(getCollection().counts).toEqual({ 'beta/1': 1 })
  })

  it('merge adds text counts onto existing ones, ignoring blank lines', () => {
    setCount('beta/1', 1)
    importCollectionText('\n2x alpha [beta/1]\n', 'merge')
    expect(getCollection().counts['beta/1']).toBe(3)
  })

  it('rejects blank input instead of silently wiping the collection', () => {
    setCount('beta/1', 1)
    expect(() => importCollectionText('', 'replace')).toThrow(/no card lines found/)
    expect(getCollection().counts).toEqual({ 'beta/1': 1 })
  })

  it('rejects whitespace-only input instead of silently wiping the collection', () => {
    setCount('beta/1', 1)
    expect(() => importCollectionText('   \n\t\n  ', 'replace')).toThrow(/no card lines found/)
    expect(getCollection().counts).toEqual({ 'beta/1': 1 })
  })
})
