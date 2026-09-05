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
  PENDING_KEY,
  readPendingBuffer,
  clearPendingBuffer,
  setBaseRevision,
  getBaseRevision,
  setCollectionFromFile,
  readLegacyCollection,
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
    expect(JSON.parse(localStorage.getItem(PENDING_KEY)!)).toEqual({ counts: {}, baseRevision: 0 })
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

  // C1: the read side is forgiving (a schema-invalid blob falls back to
  // empty), so the write side must be strict — otherwise one bad count takes
  // the whole collection down with it on the next load.
  it('refuses to persist a blob its own reader would reject, and says so', () => {
    setCount('beta/1', 2)
    // 1e20: an integer, but not a *safe* integer — which is exactly what
    // collectionSchema's `.int()` refuses.
    setCount('beta/2', Number('99999999999999999999'))

    expect(getStorageError()).toContain('Could not save the collection')
    // Nothing was written: storage still holds the last readable blob…
    expect(JSON.parse(localStorage.getItem(PENDING_KEY)!)).toEqual({
      counts: { 'beta/1': 2 },
      baseRevision: 0,
    })
    // …and the cache was invalidated, so the UI snaps back to that truth
    // rather than showing the phantom count.
    _resetCollectionCacheForTests()
    expect(getCollection().counts).toEqual({ 'beta/1': 2 })
  })

  it('the refused blob would in fact have been unreadable (the bug this closes)', () => {
    localStorage.setItem(
      'ctcg:collection:v1',
      JSON.stringify({ counts: { 'beta/1': 2, 'beta/2': 1e20 } })
    )
    _resetCollectionCacheForTests()
    expect(getCollection().counts).toEqual({}) // every key gone, silently
  })

  it('a normal write still round-trips after the validation gate', () => {
    setCount('beta/1', 2)
    adjustCount('beta/1', 1)
    setCount('beta/2', 1)
    expect(getStorageError()).toBe('')
    _resetCollectionCacheForTests()
    expect(getCollection().counts).toEqual({ 'beta/1': 3, 'beta/2': 1 })
  })

  it('hands out frozen snapshots so a consumer cannot corrupt the cache', () => {
    expect(Object.isFrozen(getCollection().counts)).toBe(true) // the empty fallback
    setCount('beta/1', 1)
    const snapshot = getCollection()
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.counts)).toBe(true)
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

  // Found while testing the §5 banner: with a shared EMPTY singleton, a write
  // that failed on an empty collection returned the identical snapshot, React
  // bailed out of the re-render, and the storage-error banner never appeared
  // for the FIRST failed write. Every write attempt must change the identity.
  it('a failed write still changes the snapshot identity, even from empty', () => {
    const before = getCollection()
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    try {
      setCount('a/1', 1)
    } finally {
      Storage.prototype.setItem = original
    }
    expect(getStorageError()).toContain('Could not save')
    expect(getCollection()).not.toBe(before)
    expect(getCollection().counts).toEqual({}) // …but the data is unchanged
  })

  it('useCollection re-renders with fresh counts and keeps a stable snapshot otherwise', () => {
    const { result, rerender, unmount } = renderHook(() => useCollection())
    const first = result.current
    rerender()
    expect(result.current).toBe(first) // stable reference, no write between
    act(() => setCount('a/1', 3))
    expect(result.current.counts['a/1']).toBe(3)
    // Without this, the subscriber this hook registers via
    // subscribeCollection outlives the test (this repo has no global
    // testing-library auto-cleanup) and keeps calling getCollection() on
    // every later write for the rest of the file — silently repopulating
    // the module cache and turning later tests into order-dependent false
    // positives (see the 'clearPendingBuffer' test in the pending-buffer
    // describe below, which failed in isolation until this was added).
    unmount()
  })
})

describe('pending buffer', () => {
  it('records every mutation with the current base revision', () => {
    setBaseRevision(7)
    setCount('a/1', 2)
    expect(readPendingBuffer()).toEqual({ counts: { 'a/1': 2 }, baseRevision: 7 })
  })

  it('survives a reload (it is real localStorage, not memory)', () => {
    setCount('a/1', 3)
    _resetCollectionCacheForTests()
    expect(readPendingBuffer()?.counts).toEqual({ 'a/1': 3 })
  })

  it('clearPendingBuffer removes it without touching the collection', () => {
    setCount('a/1', 1)
    // Read the snapshot into cache BEFORE clearing, so this test pins the
    // real, isolation-safe claim: clearing the buffer does not invalidate an
    // already-read snapshot. Without this explicit read, the assertion below
    // only happened to pass by relying on some other test's subscriber
    // leaking a getCollection() call into this one via the module-level
    // listeners set — a false positive, not this behavior.
    getCollection()
    clearPendingBuffer()
    expect(readPendingBuffer()).toBeUndefined()
    expect(getCollection().counts).toEqual({ 'a/1': 1 })
  })

  it('setCollectionFromFile adopts server state WITHOUT creating a buffer', () => {
    setCollectionFromFile({ 'b/2': 4 }, 9)
    expect(getCollection().counts).toEqual({ 'b/2': 4 })
    expect(getBaseRevision()).toBe(9)
    expect(readPendingBuffer()).toBeUndefined()
  })

  it('setCollectionFromFile still notifies subscribers', () => {
    let calls = 0
    const unsubscribe = subscribeCollection(() => calls++)
    setCollectionFromFile({ 'b/2': 1 }, 2)
    expect(calls).toBe(1)
    unsubscribe()
  })

  it('does not write the legacy key any more, but still reads it', () => {
    localStorage.setItem('ctcg:collection:v1', JSON.stringify({ counts: { 'legacy/1': 5 } }))
    expect(readLegacyCollection()?.counts).toEqual({ 'legacy/1': 5 })
    setCount('a/1', 1)
    expect(JSON.parse(localStorage.getItem('ctcg:collection:v1')!).counts).toEqual({ 'legacy/1': 5 })
    // The buffer is the FULL intended collection, not a diff, and readCollection
    // falls back to the legacy key only until a buffer exists — so the first
    // mutation must fold the legacy counts in. If it only captured 'a/1', the
    // legacy/1 count would be silently and permanently lost the moment this
    // buffer is written, since every read from here on sees the buffer and
    // never looks at the legacy key again.
    expect(readPendingBuffer()?.counts).toEqual({ 'legacy/1': 5, 'a/1': 1 })
  })

  it('a malformed buffer is ignored rather than throwing', () => {
    localStorage.setItem(PENDING_KEY, '{ not json')
    expect(readPendingBuffer()).toBeUndefined()
  })

  it('refuses to buffer counts the reader would reject, and says so', () => {
    setCount('a/1', 1)
    setCount('b/2', 1e20)
    expect(getStorageError()).toContain('Could not save')
    expect(readPendingBuffer()?.counts).toEqual({ 'a/1': 1 })
  })
})

import type { CardDb } from '../../src/engine/types'
import type { Printing } from '../../src/ui/printings'
import {
  ownedByCard,
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
  // I1/I2: the single implementation of "owned copies per card" — the
  // Collection tile badge, the Deck Builder badge, playsetGaps and
  // completionStats all read this one map. (Replaces `cardTotal`, which had
  // no caller outside its own test.)
  it('ownedByCard sums across a card\'s printings, omitting cards with none', () => {
    const collection = { counts: { 'beta/1': 2, 'retail/1': 1 } }
    const owned = ownedByCard(miniPrintings, collection)
    expect(owned.alpha).toBe(3)
    expect(owned.boss).toBeUndefined() // absent means 0; callers read with ?? 0
  })

  it('ownedByCard ignores keys that are not in the printings list', () => {
    expect(ownedByCard(miniPrintings, { counts: { 'ghost/999': 7 } })).toEqual({})
  })

  it('ownedByCard agrees with playsetGaps and completionStats by construction', () => {
    const collection = { counts: { 'beta/1': 2, 'retail/1': 1, 'beta/2': 1 } }
    const owned = ownedByCard(miniPrintings, collection)
    for (const gap of playsetGaps(miniDb, miniPrintings, collection)) {
      expect(gap.owned).toBe(owned[gap.cardId] ?? 0)
    }
    expect(completionStats(miniDb, miniPrintings, collection).playsetPct).toBe(100)
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

  // M1: this message is rendered verbatim in a pre-wrap block in the UI, so
  // it must be readable lines and not zod's pretty-printed issue array.
  it('reports validation failures as readable lines, not raw zod JSON', () => {
    let message = ''
    try {
      importCollectionJson('{"version":1,"counts":{"a":-2}}', 'replace')
    } catch (err) {
      message = err instanceof Error ? err.message : String(err)
    }
    expect(message).toContain('counts.a:')
    expect(message).not.toContain('"code"')
    expect(message).not.toContain('"path"')
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

  // C1, import side: `^(\d+)` is unbounded, so a mangled pasted line could
  // carry a count that parses but is not a *safe* integer — and that used to
  // be persisted, making the next page load discard the whole collection.
  it('rejects an out-of-range count through the all-or-nothing error path', () => {
    setCount('beta/1', 1)
    expect(() =>
      importCollectionText('2x alpha [beta/1]\n99999999999999999999x boss [beta/2]', 'replace')
    ).toThrow(/count out of range/)
    expect(getCollection().counts).toEqual({ 'beta/1': 1 })
  })

  it('an out-of-range count is reported alongside other errors, not instead of them', () => {
    expect(() => importCollectionText('99999999999999999999x boss [beta/2]\ngarbage', 'replace'))
      .toThrow(/count out of range[\s\S]*garbage/)
  })

  it('accepts a large but safe count', () => {
    importCollectionText(`${Number.MAX_SAFE_INTEGER}x alpha [beta/1]`, 'replace')
    expect(getCollection().counts['beta/1']).toBe(Number.MAX_SAFE_INTEGER)
    expect(getStorageError()).toBe('')
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
