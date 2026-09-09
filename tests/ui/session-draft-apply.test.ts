// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { loadPrintings } from '../../src/ui/printings'
import { _resetCollectionCacheForTests, getCollection, setCount } from '../../src/ui/collection'
import { readCollectionJournal } from '../../src/ui/collectionJournal'
import {
  _resetDraftForTests, applyDraft, draftCounts, draftSummary, draftToText, getDraft,
  rarityBreakdown, stageLine, stageLines, updateDraft,
} from '../../src/ui/sessionDraft'

const printings = loadPrintings()
const demo = printings.find(p => p.key === 'arasakademodeck/006')!
const beta = printings.find(p => p.key === 'welcometonightcitybeta/β025')!

beforeEach(() => { localStorage.clear(); _resetCollectionCacheForTests(); _resetDraftForTests() })

describe('draft text round-trip', () => {
  it('serializes signed lines with explicit signs and exact lines bare', () => {
    stageLines([{ key: demo.key, delta: 3 }, { key: beta.key, delta: -1 }])
    expect(draftToText(getDraft())).toBe(`${demo.key},+3\n${beta.key},-1`)
    // Mixed single/batch staging: stageLines then stageLine gives newest-first order
    stageLine({ key: 'x/1', delta: 1 })
    expect(draftToText(getDraft())).toBe(`x/1,+1\n${demo.key},+3\n${beta.key},-1`)
    _resetDraftForTests(); localStorage.clear()
    updateDraft({ mode: 'exact' }); stageLine({ key: demo.key, exact: 4 })
    expect(draftToText(getDraft())).toBe(`${demo.key},4`)
  })
})

describe('draftCounts', () => {
  it('signed: adds deltas onto the current counts', () => {
    stageLines([{ key: demo.key, delta: 3 }])
    expect(draftCounts(getDraft(), printings, { [demo.key]: 1 })).toEqual({ [demo.key]: 4 })
  })
  it('signed: rejects an unknown key and a negative result with the parser messages', () => {
    stageLine({ key: 'nope/1', delta: 1 })
    expect(() => draftCounts(getDraft(), printings, {})).toThrow(/unknown printing/)
    _resetDraftForTests(); localStorage.clear()
    stageLine({ key: demo.key, delta: -2 })
    expect(() => draftCounts(getDraft(), printings, { [demo.key]: 1 })).toThrow(/invalid count/)
  })
  it('exact: replaces only the staged rows', () => {
    updateDraft({ mode: 'exact' }); stageLine({ key: demo.key, exact: 5 })
    expect(draftCounts(getDraft(), printings, { [demo.key]: 1, [beta.key]: 2 })).toEqual({ [demo.key]: 5, [beta.key]: 2 })
  })
})

describe('draftSummary and rarityBreakdown', () => {
  it('summarizes net copies and changed rows', () => {
    expect(draftSummary({ a: 1, b: 2 }, { a: 4, c: 1 })).toEqual({ copies: 2, printings: 3, before: 3, after: 5 })
  })
  it('counts positive deltas per rarity, biggest first', () => {
    const rows = rarityBreakdown({ [demo.key]: { before: 0, after: 3 }, [beta.key]: { before: 1, after: 2 }, ['x/1']: { before: 2, after: 0 } }, printings)
    expect(rows[0]).toEqual({ rarity: demo.rarity, copies: 3 })
    expect(rows).toContainEqual({ rarity: beta.rarity, copies: 1 })
    expect(rows.some(r => r.copies <= 0)).toBe(false)
  })
})

describe('applyDraft', () => {
  it('writes once with the session metadata and clears the draft', () => {
    setCount(demo.key, 1)
    updateDraft({ source: 'Launch boosters', cost: '100 SEK', kind: 'Trade' })
    stageLine({ key: demo.key, delta: 2 })
    applyDraft(printings)
    expect(getCollection().counts[demo.key]).toBe(3)
    expect(getDraft().lines).toEqual([])
    const entry = readCollectionJournal().entries[0]
    expect(entry.kind).toBe('Trade'); expect(entry.source).toBe('Launch boosters'); expect(entry.cost).toBe('100 SEK')
  })
  it('records exact drafts as Bulk counts', () => {
    updateDraft({ mode: 'exact' }); stageLine({ key: demo.key, exact: 2 })
    applyDraft(printings)
    expect(readCollectionJournal().entries[0].kind).toBe('Bulk counts')
  })
  it('leaves the draft intact when the computation throws', () => {
    stageLine({ key: 'nope/1', delta: 1 })
    expect(() => applyDraft(printings)).toThrow()
    expect(getDraft().lines).toHaveLength(1)
    expect(getCollection().counts).toEqual({})
  })
  it('refuses to apply when the collection changed since the preview', () => {
    stageLine({ key: demo.key, delta: 1 })
    setCount(beta.key, 5)
    expect(() => applyDraft(printings, {})).toThrow(/Collection changed/)
    expect(getDraft().lines).toEqual([{ key: demo.key, delta: 1 }])
    expect(getCollection().counts).toEqual({ [beta.key]: 5 })
  })
})
