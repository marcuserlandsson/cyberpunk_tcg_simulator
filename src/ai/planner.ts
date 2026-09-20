import type { DeckList } from '../engine/deck'
import { spendSearchBudget, SearchBudgetExhausted, type SearchBudget } from './budget'
import { applyAction } from '../engine/reduce'
import { legalActions } from '../engine/legal'
import { actingPlayer, opponentOf } from '../engine/query'
import { createRng, nextInt } from '../engine/rng'
import { evaluate, DEFAULT_WEIGHTS } from './evaluate'
import { createHeuristicAgent, rankHeuristicActions } from './heuristic'
import { sampleHiddenState } from './belief'
import { REFERENCE_ARCHETYPES } from './archetypes'
import type { Agent } from './random'
import type { Action, CardDb, GameState, PlayerId } from '../engine/types'

export interface PlannerOptions {
  archetypes?: readonly DeckList[]
  candidates?: number
  strategicCandidates?: boolean
  saleCandidates?: number
  searchOpening?: boolean
  samples?: number
  rolloutActions?: number
  turns?: number
  rolloutDepth?: number
  rolloutWindows?: number
  transitions?: number
  onProgress?: (action: Action) => void
  onDecision?: (stats: { transitions: number; samples: number }) => void
}

export const DEFAULT_PLANNER_OPTIONS = {
  candidates: 6, samples: 6, rolloutActions: 120, turns: 2,
  rolloutDepth: 2, rolloutWindows: 8, transitions: 12_000,
  strategicCandidates: true, saleCandidates: 2, searchOpening: false,
} as const

function family(state: GameState, action: Action): string {
  if (action.type === 'choosePlayOrder') return `${action.type}:${action.goFirst}`
  if ('card' in action) return `${action.type}:${state.cards[action.card].defId}`
  if (action.type === 'attack') return `${action.type}:${action.attacker}:${action.target === 'gigArea' ? 'gig' : 'fight'}`
  return action.type
}

const SEARCH_WEIGHTS = { ...DEFAULT_WEIGHTS, sevenGigs: 0 }
function utility(db: CardDb, state: GameState, player: PlayerId): number {
  if (state.phase === 'gameOver') return state.winner === null ? 0 : state.winner === player ? 1 : -1
  const view = state.pendingIntercept?.view ?? state
  const margin = (evaluate(db, view, player, SEARCH_WEIGHTS) - evaluate(db, view, opponentOf(player), SEARCH_WEIGHTS)) / 2
  return 0.85 * Math.tanh(margin / 2500)
}

/** Follow a candidate through this turn and the rival reply. Counting the
 * root's turn boundary keeps passing and playing on the same horizon. */
export function rolloutPlanningLine(db: CardDb, state: GameState, action: Action, seed: number,
  budget: SearchBudget, options: PlannerOptions = {}): GameState {
  spendSearchBudget(budget)
  let next = applyAction(db, state, action)
  const agents = [0, 1].map(player => createHeuristicAgent(seed + player,
    { searchDepth: options.rolloutDepth ?? 2, candidateLimit: 48, quiescenceSteps: options.rolloutWindows ?? 8, budget }))
  const opening = state.phase === 'chooseOrder' || state.phase === 'mulligan'
  const reachedHorizon = () => opening ? next.turnNumber >= 3 : boundaries >= (options.turns ?? 2)
  let boundaries = next.activePlayer === state.activePlayer ? 0 : 1
  for (let step = 0; step < (options.rolloutActions ?? 120) && next.phase !== 'gameOver'; step++) {
    if (reachedHorizon() && !next.pendingIntercept && ['main', 'start'].includes(next.phase)) break
    const offered = legalActions(db, next)
    if (!offered.length) throw new Error('Planner rollout reached a nonterminal state with no legal actions')
    const chosen = agents[actingPlayer(next)].chooseAction(db, next, offered)
    const previousPlayer = next.activePlayer
    spendSearchBudget(budget)
    next = applyAction(db, next, chosen)
    if (next.activePlayer !== previousPlayer) boundaries++
  }
  if (next.phase !== 'gameOver' && (!reachedHorizon() || next.pendingIntercept)) {
    throw new SearchBudgetExhausted('Could not finish the comparison horizon')
  }
  return next
}

function selectPlannedAction(candidates: { action: Action }[], outcomes: number[][], completed: number): Action {
  let best = 0
  let bestGain = 0
  for (let i = 0; i < candidates.length; i++) {
    const gains = outcomes[i].slice(0, completed).map((value, trial) => value - outcomes[0][trial])
    const mean = gains.reduce((sum, value) => sum + value, 0) / completed
    const variance = gains.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, completed - 1)
    // A noisy hypothetical draw should not casually overrule a sound tactical
    // move. Compare paired futures, with a modest uncertainty penalty.
    const gain = mean - Math.sqrt(variance / completed)
    if (gain > bestGain + 0.025) { bestGain = gain; best = i }
  }
  return candidates[best].action
}

/** Multi-turn Monte Carlo planning. Every sample uses a legal rules-engine
 * trajectory and independent hypothetical hidden cards. Budgeted action counts
 * preserve reproducibility; the UI runs this work in a cancellable worker.
 */
export function createPlanningAgent(seed: number, options: PlannerOptions = {}): Agent {
  options = { archetypes: REFERENCE_ARCHETYPES, ...DEFAULT_PLANNER_OPTIONS, ...options }
  let rng = createRng(seed)
  const fallback = createHeuristicAgent(seed)
  return { chooseAction(db, state, actions) {
    if (!actions.length) throw new Error('Planning agent received no legal actions')
    const baseline = fallback.chooseAction(db, state, actions)
    options.onProgress?.(baseline)
    if (options.searchOpening === false && ['chooseOrder', 'mulligan'].includes(state.phase)) return baseline
    if (actions.length === 1 || state.pendingIntercept || !['main', 'react', 'chooseOrder', 'mulligan'].includes(state.phase)) return baseline
    const player = actingPlayer(state)
    const ranked = rankHeuristicActions(db, state, actions)
    if (ranked[0].score >= DEFAULT_WEIGHTS.terminal / 2) return ranked[0].action
    const baselineEntry = ranked.find(entry => JSON.stringify(entry.action) === JSON.stringify(baseline))
      ?? { action: baseline, score: ranked[0].score }
    const candidates = [baselineEntry]
    const families = new Set([family(state, baseline)])
    const limitCandidates = Math.max(2, options.candidates ?? 4)
    const end = ranked.find(entry => entry.action.type === 'endTurn')
    if (options.strategicCandidates) {
      // Setup moves can rank below immediately useful spells, even when they
      // enable a board wipe or a recurring Legend engine this turn.
      for (const type of ['callLegend', ...Array<string>(options.saleCandidates ?? 1).fill('sellCard')]) {
        const entry = ranked.find(entry => entry.action.type === type && !families.has(family(state, entry.action)))
        if (entry && candidates.length < limitCandidates - (end && baseline.type !== 'endTurn' ? 1 : 0)) {
          families.add(family(state, entry.action))
          candidates.push(entry)
        }
      }
    }
    for (const entry of ranked) {
      if (candidates.length >= limitCandidates - (end && baseline.type !== 'endTurn' ? 1 : 0)) break
      const key = family(state, entry.action)
      if (families.has(key) || entry === end) continue
      families.add(key)
      candidates.push(entry)
    }
    if (end && baseline.type !== 'endTurn') candidates.push(end)
    if (candidates.length === 1) return candidates[0].action
    const outcomes = candidates.map(() => [] as number[])
    const sampleCount = options.samples ?? 6
    const limit = options.transitions ?? 12_000
    const budget = { left: limit }
    let completed = 0
    try {
      for (let trial = 0; trial < sampleCount; trial++) {
        const [sampleSeed, after] = nextInt(rng, 0x7fffffff)
        rng = after
        const belief = sampleHiddenState(db, state, player, sampleSeed, options.archetypes)
        for (let index = 0; index < candidates.length; index++) {
          const next = rolloutPlanningLine(db, belief, candidates[index].action, sampleSeed, budget, options)
          outcomes[index].push(utility(db, next, player))
        }
        if (trial >= 1 && options.onProgress) options.onProgress(selectPlannedAction(candidates, outcomes, trial + 1))
      }
    } catch (error) { if (!(error instanceof SearchBudgetExhausted)) throw error }
    // Discard an unfinished round so every candidate has exactly the same futures.
    completed = Math.min(...outcomes.map(values => values.length))
    options.onDecision?.({ transitions: limit - Math.max(0, budget.left), samples: completed })
    if (completed < 2) return baseline
    return selectPlannedAction(candidates, outcomes, completed)
  } }
}
