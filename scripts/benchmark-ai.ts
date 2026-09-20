import { REFERENCE_ARCHETYPES } from '../src/ai/archetypes'
import { createPlanningAgent, DEFAULT_PLANNER_OPTIONS } from '../src/ai/planner'
/** Reproducible strength checks with paired seats and exact deck snapshots.
 * npx tsx scripts/benchmark-ai.ts strength 60 52000 test-results/ai-strength.json
 * Modes: strength (Hard/Medium mirrors), ladder (Medium/Easy mirrors),
 * judy (Hard Judy/Medium starter), judy-hard (Hard on both decks).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { loadCardDb } from '../src/engine/cardDb'
import { newGame } from '../src/engine/game'
import { legalActions } from '../src/engine/legal'
import { applyAction } from '../src/engine/reduce'
import { actingPlayer } from '../src/engine/query'
import { createAgent, AI_VERSION, type AgentKind } from '../src/ai/agents'
import { ENGINE_VERSION, cardDataFingerprint } from '../src/engine/version'
import type { DeckList } from '../src/engine/deck'
import type { PlayerId } from '../src/engine/types'
const [mode = 'strength', count = '60', seedText = '52000', output = 'test-results/ai-strength.json', offsetText = '0', model = 'current'] = process.argv.slice(2)
if (!['current', 'reference', 'catalog', 'strategic', 'tactical', 'setup'].includes(model)) throw new Error('Unknown planning model')
if (!['strength','ladder','judy','judy-hard','judy-medium'].includes(mode)) throw new Error('Unknown benchmark mode')
const games = Number(count), baseSeed = Number(seedText), offset = Number(offsetText)
if (!Number.isSafeInteger(games) || games < 2 || games % 2 || !Number.isSafeInteger(baseSeed) || !Number.isSafeInteger(offset) || offset < 0 || offset % 2) throw new Error('Use an even positive game count and an integer seed')
const db = loadCardDb()
const load = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as DeckList
const decks = [load('data/decks/embracing-power-starter.json'), load('data/decks/the-heist-starter.json'), load('tests/ai/fixtures/bbg-judy-user.json')]
const records: { seed: number; deck: string; seat: PlayerId; won: boolean; winner: PlayerId | null; turns: number; actions: number; ms: number }[] = []
const times: number[] = []
const planningOptions = model === 'current' || model === 'setup' ? DEFAULT_PLANNER_OPTIONS : {
  ...DEFAULT_PLANNER_OPTIONS, candidates: ['strategic','tactical'].includes(model) ? 6 : 4,
  strategicCandidates: ['strategic','tactical'].includes(model), saleCandidates: 1,
  searchOpening: model !== 'tactical',
}
let slowestMs = 0
const agentA: AgentKind = mode === 'ladder' || mode === 'judy-medium' ? 'medium' : 'hard'
const agentB: AgentKind = mode === 'ladder' ? 'easy' : mode === 'judy-hard' ? 'hard' : 'medium'
for (let i = 0; i < games; i++) {
  const index = i + offset
  const seed = baseSeed + Math.floor(index / 2), seat = index % 2 as PlayerId
  const list = decks[Math.floor(index / 2) % 3]
  const a = mode.startsWith('judy') ? decks[2] : list
  const b = mode.startsWith('judy') ? decks[0] : list
  const agents = [0,1].map(p => {
    const kind = p === seat ? agentA : agentB, agentSeed = seed + p * 5000
    return kind === 'hard' && model !== 'current'
      ? createPlanningAgent(agentSeed, { ...planningOptions, archetypes: model === 'catalog' ? [] : REFERENCE_ARCHETYPES })
      : createAgent(kind, agentSeed)
  })
  let state = newGame(db, { decks: seat === 0 ? [a,b] : [b,a], seed })
  const begin = performance.now()
  let actions = 0
  while (state.phase !== 'gameOver') {
    if (actions++ >= 1500) throw new Error(`Nonterminal action cap: ${seed}, seat ${seat}`)
    const actor = actingPlayer(state), start = performance.now()
    const action = agents[actor].chooseAction(db, state, legalActions(db, state))
    if (actor === seat) {
      const elapsed = performance.now() - start
      times.push(elapsed)
      if (elapsed > slowestMs) {
        slowestMs = elapsed
        writeFileSync(output + '.slow-state.json', JSON.stringify({ seed, agentSeed: seed + actor * 5000, actor, elapsed, state }))
      }
    }
    state = applyAction(db, state, action)
  }
  const record = { seed, deck: a.name, seat, won: state.winner === seat, winner: state.winner, turns: state.turnNumber, actions, ms: performance.now() - begin }
  records.push(record)
  const sorted = [...times].sort((x,y) => x-y)
  const percentile = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
  const wins = records.filter(r => r.won).length
  const report = { aiVersion: AI_VERSION, engineVersion: ENGINE_VERSION, cardData: cardDataFingerprint(db), mode, model, planningOptions, baseSeed, offset, requested: games,
    agentA, agentB, decks, completed: records.length, wins, losses: records.filter(r => r.winner !== null && !r.won).length,
    draws: records.filter(r => r.winner === null).length,
    decisionMs: { count: times.length, mean: times.reduce((a,b) => a+b,0) / times.length, p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), max: sorted.at(-1) }, decisionTimesMs: times, records }
  writeFileSync(output, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ ...record, games: records.length, wins, decisionMs: report.decisionMs }))
}
