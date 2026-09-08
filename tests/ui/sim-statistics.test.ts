// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { wilson } from '../../src/sim/statistics'
import { benchmarkPlan, compatibleComparison } from '../../src/ui/SimBenchmark'
import { cardStatsCsv } from '../../src/ui/simCsv'
import { createSimRun } from '../../src/ui/simHistory'
import { loadCardDb } from '../../src/engine/cardDb'
import { listDecks } from '../../src/ui/storage'
import type { SimResult } from '../../src/sim/runner'
const db = loadCardDb()
const result: SimResult = { games: [{ winner: 0, seed: 42, turns: 3, reason: 'sevenGigs' }], winRateA: 1, avgTurns: 3, cardStatsA: [{ defId: 'goro-takemura-hands-unclean', timesPlayed: 1, gamesSeen: 1, winRateWhenPlayed: 1 }], cardStatsB: [], reasons: { sevenGigs: 1 } }
describe('simulation interpretation', () => {
  it('handles empty, small and all-win samples with non-degenerate Wilson bounds', () => {
    expect(wilson(0,0)).toBeNull()
    const [lo,hi] = wilson(50,100)!
    expect(lo).toBeCloseTo(0.40383,4); expect(hi).toBeCloseTo(0.59617,4)
    expect(wilson(1,1)![0]).toBeCloseTo(0.20655,4)
    expect(wilson(0,1)![1]).toBeCloseTo(0.79345,4)
  })
  it('pairs snapshots across opponents and rejects changed sampling, policies or versions', () => {
    const [a,b] = structuredClone(listDecks())
    const plan = benchmarkPlan(a,b,[a,b],{games:1,seed:42,agentA:'random',agentB:'random'})
    expect(plan).toHaveLength(4)
    const first = createSimRun(db,plan[0],result), second = createSimRun(db,plan[1],result)
    a.cards = {}; expect(Object.keys(plan[0].deckA.cards).length).toBeGreaterThan(0)
    expect(compatibleComparison(first,second)).toBe(true)
    expect(compatibleComparison(first,{...second, engineVersion:'old'})).toBe(false)
    expect(compatibleComparison(first,{...second, options:{...second.options, agentB:'heuristic'}})).toBe(false)
    expect(compatibleComparison(first,{...second, result:{...result,games:[{...result.games[0],seed:43}]}})).toBe(false)
  })
  it('exports subtitles, sample sizes and spreadsheet-safe deck names', () => {
    const [deckA,deckB] = structuredClone(listDecks()); deckA.name = '=formula'
    const run = createSimRun(db,{deckA,deckB,games:1,seed:42,agentA:'random',agentB:'random'},result)
    const csv = cardStatsCsv(db,run)
    expect(csv).toContain('"\'=formula"')
    expect(csv).toContain('Hands Unclean')
    expect(csv).toContain('games_played')
  })
})
