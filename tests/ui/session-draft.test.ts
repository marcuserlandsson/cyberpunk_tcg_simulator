// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  DRAFT_KEY, _resetDraftForTests, clearDraft, emptyDraft, getDraft, isDraftStale,
  removeGroup, removeLine, stageLine, stageLines, updateDraft,
} from '../../src/ui/sessionDraft'

beforeEach(() => { localStorage.clear(); _resetDraftForTests() })

describe('session draft — shape and persistence', () => {
  it('starts as an empty signed Acquisition dated today', () => {
    const d = getDraft()
    expect(d.kind).toBe('Acquisition')
    expect(d.mode).toBe('signed')
    expect(d.lines).toEqual([])
    expect(d.date).toBe(new Date().toISOString().slice(0, 10))
  })

  it('persists every change under the existing key', () => {
    updateDraft({ source: 'Launch boosters', cost: '100 SEK' })
    stageLine({ key: 'arasakademodeck/006', delta: 3 })
    const stored = JSON.parse(localStorage.getItem(DRAFT_KEY)!)
    expect(stored.source).toBe('Launch boosters')
    expect(stored.lines).toEqual([{ key: 'arasakademodeck/006', delta: 3 }])
  })

  it('migrates a legacy text draft into signed lines', () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      text: 'arasakademodeck/006,+3\nwelcometonightcitybeta/β025,-1', date: '2026-09-01', source: 'old', cost: '', kind: 'Trade',
    }))
    const d = getDraft()
    expect(d.kind).toBe('Trade')
    expect(d.mode).toBe('signed')
    expect(d.lines).toEqual([
      { key: 'arasakademodeck/006', delta: 3 },
      { key: 'welcometonightcitybeta/β025', delta: -1 },
    ])
    expect(d.legacyText).toBeUndefined()
  })

  it('keeps unparsable legacy text for the paste box instead of dropping it', () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ text: 'not a line', date: '2026-09-01', source: '', cost: '', kind: 'Acquisition' }))
    const d = getDraft()
    expect(d.lines).toEqual([])
    expect(d.legacyText).toBe('not a line')
  })

  it('falls back to an empty draft on garbage', () => {
    localStorage.setItem(DRAFT_KEY, '{"nope":true}')
    expect(getDraft().lines).toEqual([])
  })
})

describe('session draft — staging rules', () => {
  it('signed mode merges a repeated key by adding deltas', () => {
    stageLine({ key: 'a/1', delta: 1 })
    stageLine({ key: 'a/1', delta: 2 })
    expect(getDraft().lines).toEqual([{ key: 'a/1', delta: 3 }])
  })

  it('signed mode drops a line whose delta reaches zero', () => {
    stageLine({ key: 'a/1', delta: 1 })
    stageLine({ key: 'a/1', delta: -1 })
    expect(getDraft().lines).toEqual([])
  })

  it('exact mode replaces a repeated key', () => {
    updateDraft({ mode: 'exact' })
    stageLine({ key: 'a/1', exact: 2 })
    stageLine({ key: 'a/1', exact: 5 })
    expect(getDraft().lines).toEqual([{ key: 'a/1', exact: 5 }])
  })

  it('newest lines come first', () => {
    stageLine({ key: 'a/1', delta: 1 })
    stageLine({ key: 'b/2', delta: 1 })
    expect(getDraft().lines.map(l => l.key)).toEqual(['b/2', 'a/1'])
  })

  it('a grouped line and an ungrouped line for the same key stay separate', () => {
    stageLines([{ key: 'a/1', delta: 1, group: 'Arasaka Demo Deck' }])
    stageLine({ key: 'a/1', delta: 2 })
    expect(getDraft().lines).toHaveLength(2)
  })

  it('removeLine removes only the ungrouped line; removeGroup removes the whole group', () => {
    stageLines([{ key: 'a/1', delta: 1, group: 'G' }, { key: 'b/2', delta: 1, group: 'G' }])
    stageLine({ key: 'a/1', delta: 2 })
    removeLine('a/1')
    expect(getDraft().lines.map(l => l.group)).toEqual(['G', 'G'])
    removeGroup('G')
    expect(getDraft().lines).toEqual([])
  })

  it('refuses to change mode while lines are staged', () => {
    stageLine({ key: 'a/1', delta: 1 })
    expect(() => updateDraft({ mode: 'exact' })).toThrow(/Apply or clear/)
    expect(getDraft().mode).toBe('signed')
  })

  it('clearDraft keeps the metadata but empties the lines', () => {
    updateDraft({ source: 'x' })
    stageLine({ key: 'a/1', delta: 1 })
    clearDraft()
    expect(getDraft().lines).toEqual([])
    expect(getDraft().source).toBe('x')
  })
})

describe('session draft — staleness', () => {
  it('a draft read back from storage is stale until touched in this page load', () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...emptyDraft(), lines: [{ key: 'a/1', delta: 1 }] }))
    expect(isDraftStale()).toBe(true)
    stageLine({ key: 'b/2', delta: 1 })
    expect(isDraftStale()).toBe(false)
  })

  it('an empty draft is never stale', () => {
    expect(isDraftStale()).toBe(false)
  })
})
