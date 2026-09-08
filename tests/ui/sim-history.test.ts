// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { loadCardDb } from '../../src/engine/cardDb'
import { listDecks } from '../../src/ui/storage'
import { createSimRun, parseSimRun, readSimRuns, saveSimRun, runUsesCurrentRules } from '../../src/ui/simHistory'
import type { SimResult } from '../../src/sim/runner'
const db = loadCardDb()
const result: SimResult = { games: [{ winner: 0, turns: 5, seed: 42, reason: 'sevenGigs' }], winRateA: 1, avgTurns: 5, cardStatsA: [], cardStatsB: [], reasons: { sevenGigs: 1 } }
function run() { const [deckA,deckB] = listDecks(); return createSimRun(db, { deckA,deckB,games: 1,seed: 42,agentA: 'random',agentB: 'random' }, result) }
beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())
describe('complete simulation history', () => {
  it('stores independent runs and immutable deck/settings/result snapshots', () => {
    const [deckA,deckB] = structuredClone(listDecks())
    const opts = { deckA,deckB,games: 1,seed: 42,agentA: 'random' as const,agentB: 'random' as const }
    const snapshot = createSimRun(db, opts, result)
    deckA.name = 'Later edit'; deckA.cards = {}; opts.seed = 99
    expect(snapshot.options.deckA.name).not.toBe('Later edit')
    expect(Object.keys(snapshot.options.deckA.cards).length).toBeGreaterThan(0)
    expect(snapshot.options.seed).toBe(42)
    expect(saveSimRun(snapshot)).toBeNull()
    expect(saveSimRun(run())).toBeNull()
    expect(readSimRuns().runs).toHaveLength(2)
    expect(parseSimRun(JSON.stringify(snapshot))).toEqual(snapshot)
  })
  it('keeps existing history intact on quota failure', () => {
    const saved = run(); saveSimRun(saved)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota') })
    expect(saveSimRun(run())).toContain('export JSON')
    expect(readSimRuns().runs).toEqual([saved])
  })
  it('leaves malformed records untouched and reads healthy entries', () => {
    saveSimRun(run()); localStorage.setItem('ctcg:simRun:v1:broken', '{')
    const loaded = readSimRuns()
    expect(loaded.runs).toHaveLength(1)
    expect(loaded.error).toContain('1 unreadable')
    expect(localStorage.getItem('ctcg:simRun:v1:broken')).toBe('{')
    expect(() => parseSimRun('{}')).toThrow('not a complete')
  })
  it('detects old engine or card data without destroying historical results', () => {
    const saved = run()
    expect(runUsesCurrentRules(db,saved)).toBe(true)
    expect(runUsesCurrentRules(db,{...saved, engineVersion:'older'})).toBe(false)
    const changed = { ...db, 'animals-wrecker': {...db['animals-wrecker'], cost: 10} }
    expect(runUsesCurrentRules(changed,saved)).toBe(false)
  })
})
