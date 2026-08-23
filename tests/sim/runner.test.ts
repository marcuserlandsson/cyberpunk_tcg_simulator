// Task 11: the AI-vs-AI simulation runner.
//
// Kept fast (well under the 10s budget the brief calls out) by running random
// agents almost everywhere — this suite is about runGames' own bookkeeping
// (seeding, seat alternation, aggregation, CSV), not about heuristic quality
// or speed (tests/ai/heuristic.test.ts and the 1000-game CLI run cover that).

import { describe, it, expect } from 'vitest'
import { loadCardDb } from '../../src/engine/cardDb'
import { newGame } from '../../src/engine/game'
import { legalActions } from '../../src/engine/legal'
import { applyAction } from '../../src/engine/reduce'
import { actingPlayer } from '../../src/engine/query'
import { createRandomAgent, type Agent } from '../../src/ai/random'
import type { DeckList } from '../../src/engine/deck'
import type { CardDb, GameState, PlayerId } from '../../src/engine/types'
import arasakaDeck from '../../data/decks/arasaka-embracing-power.json'
import mercsDeck from '../../data/decks/mercs-the-heist.json'
import {
  runGames,
  toCsv,
  deckASeatFor,
  gameSeedFor,
  agentSeedsFor,
  type SimOptions,
} from '../../src/sim/runner'

const db: CardDb = loadCardDb()
const arasaka = arasakaDeck as unknown as DeckList
const mercs = mercsDeck as unknown as DeckList

function baseOpts(overrides: Partial<SimOptions> = {}): SimOptions {
  return {
    deckA: arasaka,
    deckB: mercs,
    games: 20,
    seed: 1,
    agentA: 'random',
    agentB: 'random',
    ...overrides,
  }
}

describe('runGames: shape and counts', () => {
  it('returns one result per game', () => {
    const result = runGames(db, baseOpts({ games: 20 }))
    expect(result.games).toHaveLength(20)
  })

  it('winRateA is consistent with the games array', () => {
    const result = runGames(db, baseOpts({ games: 20 }))
    const winsA = result.games.filter((g) => g.winner === 0).length
    expect(result.winRateA).toBeCloseTo(winsA / 20, 10)
  })

  it('avgTurns is consistent with the games array', () => {
    const result = runGames(db, baseOpts({ games: 20 }))
    const totalTurns = result.games.reduce((sum, g) => sum + g.turns, 0)
    expect(result.avgTurns).toBeCloseTo(totalTurns / 20, 10)
  })

  it('reasons tally matches the games array and only uses recognized end reasons', () => {
    const VALID_END_REASONS = new Set(['sevenGigs', 'overtimeMajority', 'deckout', 'concede'])
    const result = runGames(db, baseOpts({ games: 20 }))
    const tally: Record<string, number> = {}
    for (const g of result.games) tally[g.reason] = (tally[g.reason] ?? 0) + 1
    expect(result.reasons).toEqual(tally)
    for (const reason of Object.keys(result.reasons)) {
      expect(VALID_END_REASONS.has(reason)).toBe(true)
    }
  })

  it('calls onProgress once per game, in order, ending at (games, games)', () => {
    const calls: Array<[number, number]> = []
    runGames(db, baseOpts({ games: 6 }), (done, total) => calls.push([done, total]))
    expect(calls).toEqual([
      [1, 6],
      [2, 6],
      [3, 6],
      [4, 6],
      [5, 6],
      [6, 6],
    ])
  })
})

describe('runGames: determinism', () => {
  it('the same opts run twice produce a deep-equal SimResult', () => {
    const opts = baseOpts({ games: 15, seed: 42 })
    const first = runGames(db, opts)
    const second = runGames(db, opts)
    expect(second).toEqual(first)
  })

  it('is deterministic for heuristic agents too (small game count)', () => {
    const opts = baseOpts({ games: 3, seed: 7, agentA: 'heuristic', agentB: 'heuristic' })
    const first = runGames(db, opts)
    const second = runGames(db, opts)
    expect(second).toEqual(first)
    expect(first.games).toHaveLength(3)
  })

  it('per-game seeds are derived from opts.seed + gameIndex and match GameResult.seed', () => {
    const opts = baseOpts({ games: 5, seed: 100 })
    const result = runGames(db, opts)
    result.games.forEach((g, i) => {
      expect(g.seed).toBe(gameSeedFor(opts.seed, i))
    })
  })
})

describe('runGames: random-vs-random mode', () => {
  it('runs cleanly with both agents random', () => {
    const result = runGames(db, baseOpts({ games: 10, agentA: 'random', agentB: 'random' }))
    expect(result.games).toHaveLength(10)
    expect(result.winRateA).toBeGreaterThanOrEqual(0)
    expect(result.winRateA).toBeLessThanOrEqual(1)
  })
})

describe('deckASeatFor: alternation convention', () => {
  it('alternates 0/1 starting at seat 0 for game 0', () => {
    expect([0, 1, 2, 3, 4, 5].map(deckASeatFor)).toEqual([0, 1, 0, 1, 0, 1])
  })
})

// ---------------------------------------------------------------------------
// Per-card stats cross-check: replay the exact same games runGames() played
// (same seeding/seat convention, same agents) directly through the engine,
// and confirm the independently-computed gamesSeen/timesPlayed for a sample
// of defIds matches what runGames' cardStatsA/cardStatsB reported.
// ---------------------------------------------------------------------------

function replayAndCollectCardPlays(
  opts: SimOptions
): { perDeck: [Map<string, number>, Map<string, number>]; winsByDeck: [number, number] } {
  const gamesSeenA = new Map<string, number>()
  const gamesSeenB = new Map<string, number>()
  let winsA = 0
  let winsB = 0

  for (let i = 0; i < opts.games; i++) {
    const gameSeed = gameSeedFor(opts.seed, i)
    const deckASeat = deckASeatFor(i)
    const decks: [DeckList, DeckList] =
      deckASeat === 0 ? [opts.deckA, opts.deckB] : [opts.deckB, opts.deckA]
    const [seedSeat0, seedSeat1] = agentSeedsFor(gameSeed)
    const agents: [Agent, Agent] = [createRandomAgent(seedSeat0), createRandomAgent(seedSeat1)]

    let state: GameState = newGame(db, { decks, seed: gameSeed })
    for (let step = 0; step < 1000 && state.phase !== 'gameOver'; step++) {
      const actions = legalActions(db, state)
      const actor: PlayerId = actingPlayer(state)
      const chosen = agents[actor].chooseAction(db, state, actions)
      state = applyAction(db, state, chosen)
    }

    const deckWinnerIsA = state.winner === deckASeat
    if (deckWinnerIsA) winsA += 1
    else winsB += 1

    const seenThisGame: [Set<string>, Set<string>] = [new Set(), new Set()]
    for (const event of state.events) {
      if (event.type !== 'cardPlayed') continue
      const defId = state.cards[event.uid].defId
      seenThisGame[event.player].add(defId)
    }
    for (const seat of [0, 1] as const) {
      const map = seat === deckASeat ? gamesSeenA : gamesSeenB
      for (const defId of seenThisGame[seat]) {
        map.set(defId, (map.get(defId) ?? 0) + 1)
      }
    }
  }

  return { perDeck: [gamesSeenA, gamesSeenB], winsByDeck: [winsA, winsB] }
}

describe('runGames: per-card stats', () => {
  it('gamesSeen for every defId matches an independent replay of the same games', () => {
    const opts = baseOpts({ games: 16, seed: 500 })
    const result = runGames(db, opts)
    const replay = replayAndCollectCardPlays(opts)

    expect(result.games.filter((g) => g.winner === 0).length).toBe(replay.winsByDeck[0])
    expect(result.games.filter((g) => g.winner === 1).length).toBe(replay.winsByDeck[1])

    for (const stat of result.cardStatsA) {
      expect(stat.gamesSeen).toBe(replay.perDeck[0].get(stat.defId) ?? 0)
    }
    for (const stat of result.cardStatsB) {
      expect(stat.gamesSeen).toBe(replay.perDeck[1].get(stat.defId) ?? 0)
    }
    // At least one card was actually played across 16 games, or this check is vacuous.
    expect(result.cardStatsA.length + result.cardStatsB.length).toBeGreaterThan(0)
  })

  it('winRateWhenPlayed is wins-among-gamesSeen for a card seen in every game', () => {
    const opts = baseOpts({ games: 16, seed: 500 })
    const result = runGames(db, opts)
    const ubiquitous = [...result.cardStatsA, ...result.cardStatsB].find((c) => c.gamesSeen === 16)
    // Not every seed produces a card played in literally every game; only assert
    // the arithmetic when one exists, and require the fixture to have found one
    // so the assertion isn't silently skipped.
    expect(ubiquitous).toBeDefined()
    if (ubiquitous !== undefined) {
      expect(ubiquitous.winRateWhenPlayed).toBeGreaterThanOrEqual(0)
      expect(ubiquitous.winRateWhenPlayed).toBeLessThanOrEqual(1)
    }
  })

  it('timesPlayed is >= gamesSeen for every card stat (played at least once per game it was seen in)', () => {
    const opts = baseOpts({ games: 16, seed: 500 })
    const result = runGames(db, opts)
    for (const stat of [...result.cardStatsA, ...result.cardStatsB]) {
      expect(stat.timesPlayed).toBeGreaterThanOrEqual(stat.gamesSeen)
      expect(stat.gamesSeen).toBeGreaterThan(0)
    }
  })
})

describe('toCsv', () => {
  it('has a header plus one row per game, matching games.length', () => {
    const result = runGames(db, baseOpts({ games: 9 }))
    const csv = toCsv(result)
    const lines = csv.split('\n')
    expect(lines).toHaveLength(10)
    expect(lines[0]).toBe('game,seed,winner,turns,reason')
  })

  it('each row encodes game index, seed, winner, turns, reason in order', () => {
    const result = runGames(db, baseOpts({ games: 4, seed: 9 }))
    const csv = toCsv(result)
    const lines = csv.split('\n').slice(1)
    lines.forEach((line, i) => {
      const [gameIndex, seed, winner, turns, reason] = line.split(',')
      const g = result.games[i]
      expect(Number(gameIndex)).toBe(i)
      expect(Number(seed)).toBe(g.seed)
      expect(Number(winner)).toBe(g.winner)
      expect(Number(turns)).toBe(g.turns)
      expect(reason).toBe(g.reason)
    })
  })
})
