import { spendSearchBudget, type SearchBudget } from './budget'
import { stillLive } from '../engine/game'
import { legalActions } from '../engine/legal'
import { applyAction } from '../engine/reduce'
import { PreviewStopped } from '../engine/preview'
import { actingPlayer, opponentOf } from '../engine/query'
import { createRng, nextInt, type RngState } from '../engine/rng'
import { DEFAULT_WEIGHTS, evaluate, type EvalWeights } from './evaluate'
import { evaluationKnowledge, type EvaluationKnowledge } from './strategy'
import type { Agent } from './random'
import type { Action, CardDb, GameState, PlayerId } from '../engine/types'

export const END_TURN_TEMPO_PENALTY = 5
export const QUIESCENCE_STEP_LIMIT = 32
export interface HeuristicOptions {
  weights?: EvalWeights
  quiescenceSteps?: number
  candidateLimit?: number
  continuationBudget?: number
  refinedCandidates?: number
  budget?: SearchBudget
  /** Extra main actions searched after a candidate. Zero provides an ablation. */
  searchDepth?: number
}
interface Context {
  db: CardDb
  perspective: PlayerId
  weights: EvalWeights
  knowledge: EvaluationKnowledge
  windows: number
  budget?: SearchBudget
}
interface Estimate { state: GameState; score: number; stopped: boolean }

function windowPhase(state: GameState): boolean {
  return ['react', 'chooseGig', 'intercept', 'gigReroll'].includes(state.phase)
}
function value(ctx: Context, state: GameState): number {
  return evaluate(ctx.db, state.pendingIntercept?.view ?? state, ctx.perspective, ctx.weights, ctx.knowledge)
}

/** Expected benefit at an unknown boundary. Never read the actual top card,
 * future roll, or face-down Legend position. Draw counts are already applied. */
function unknownBenefit(ctx: Context, error: PreviewStopped): number {
  const { boundary, state } = error
  const player = boundary.player ?? (boundary.viewer === 'all' ? state.activePlayer : boundary.viewer)
  const sign = player === ctx.perspective ? 1 : -1
  const profile = ctx.knowledge.strategies[player]
  if (boundary.kind === 'draw') return sign * (boundary.uids?.length ?? 0) * 12
  if (boundary.kind === 'legend') return sign * (ctx.weights.faceUpLegend + 40)
  if (boundary.kind !== 'script') return 0
  if (state.players[player].deck.length === 0) return 0
  const programRate = profile.programs / Math.max(1, profile.total)
  switch (boundary.script) {
    case 'judy-a-lvarez-braindance-maestro': return sign * (Math.round(programRate * (ctx.weights.handCard + 20)) - ctx.weights.deckCard)
    case 'judy-a-lvarez-nothing-to-doubt': return sign * 100
    case 'three-mouths-one-desire': return sign * Math.min(3, 1 + state.players[player].gigArea.filter(d => d.value === 1).length) * (ctx.weights.handCard + 16)
    case 'chrome-reverie':
    case 'optional-free-call': return sign * (state.players[player].calledLegendThisTurn ? 0 : ctx.weights.faceUpLegend + 40)
    case 'shattered-memories': {
      const mine = state.players[player], theirs = state.players[opponentOf(player)]
      const myDraw = mine.deck.length >= 5 ? 5 : 0, theirDraw = theirs.deck.length >= 5 ? 5 : 0
      return sign * ((myDraw - mine.hand.length) - (theirDraw - theirs.hand.length)) * ctx.weights.handCard
    }
    default: return sign * 35
  }
}

function applyPreview(ctx: Context, state: GameState, action: Action): Estimate {
  spendSearchBudget(ctx.budget)
  try {
    const next = applyAction(ctx.db, { ...state, simulationPreview: true, previewObserver: ctx.perspective }, action)
    return { state: next, score: value(ctx, next), stopped: false }
  } catch (error) {
    if (!(error instanceof PreviewStopped)) throw error
    return { state: error.state, score: value(ctx, error.state) + unknownBenefit(ctx, error), stopped: true }
  }
}

/** Opponent replies can use public Blockers and abilities, not unseen hand cards.
 * The real opponent still makes its own full decision when its window arrives. */
function visibleActions(ctx: Context, state: GameState): Action[] {
  const actions = legalActions(ctx.db, state)
  if (actingPlayer(state) === ctx.perspective) return actions
  return actions.filter(a => {
    if (a.type === 'react' && a.reaction.type === 'quick') return false
    if (a.type === 'answerIntercept' && a.answer !== -1 && state.pendingIntercept?.kind === 'steal') return false
    return true
  })
}

function defaultChoice(ctx: Context, state: GameState, actions: Action[]): Action {
  if (state.phase === 'react') return actions.find(a => a.type === 'react' && a.reaction.type === 'pass') ?? actions[0]
  if (state.phase === 'gigReroll') return actions.find(a => a.type === 'chooseGigReroll' && !a.reroll) ?? actions[0]
  if (state.phase === 'chooseGig') {
    const victim = opponentOf(state.pendingSteal?.thief ?? state.activePlayer)
    return [...actions].sort((a,b) => (b.type === 'chooseGig' ? state.players[victim].gigArea[b.dieIndex]?.value ?? 0 : 0)
      - (a.type === 'chooseGig' ? state.players[victim].gigArea[a.dieIndex]?.value ?? 0 : 0))[0]
  }
  return actions.find(a => a.type === 'answerIntercept' && a.answer === -1) ?? actions[0]
}

/** Complete the current effect/attack, optimizing its first decision and using
 * bounded continuations for later ones. Each real subsequent decision is searched
 * again. Unlike assuming an unblocked attack, rival public replies minimize our score. */
function settle(ctx: Context, initial: Estimate, steps: number, optimize = true): Estimate {
  let current = initial
  for (let i = 0; i < steps; i++) {
    if (current.stopped || !stillLive(current.state) || !windowPhase(current.state)) return current
    const actions = visibleActions(ctx, current.state)
    if (!actions.length) return current
    if (optimize && actions.length > 1) {
      const maximize = actingPlayer(current.state) === ctx.perspective
      let best: Estimate | undefined
      for (const action of actions) {
        const candidate = settle(ctx, applyPreview(ctx, current.state, action), steps - i - 1, false)
        if (!best || (maximize ? candidate.score > best.score : candidate.score < best.score)) best = candidate
      }
      return best!
    }
    current = applyPreview(ctx, current.state, defaultChoice(ctx, current.state, actions))
  }
  return current
}

function estimate(ctx: Context, state: GameState, action: Action): Estimate {
  const result = settle(ctx, applyPreview(ctx, state, action), ctx.windows)
  // A draw/reveal trigger on attack does not make the public attack disappear.
  if (result.stopped && result.state.phase === 'react' && result.state.pendingAttack && ctx.windows > 0) {
    const resumed = settle(ctx, { ...result, stopped: false }, ctx.windows, false)
    result.score = !stillLive(resumed.state) ? resumed.score : result.score + resumed.score - value(ctx, result.state)
  }
  if (action.type === 'endTurn') result.score -= END_TURN_TEMPO_PENALTY
  return result
}

export function scoreAction(
  db: CardDb, state: GameState, action: Action, perspective: PlayerId,
  weights: EvalWeights = DEFAULT_WEIGHTS, quiescenceSteps: number = QUIESCENCE_STEP_LIMIT,
): number {
  const ctx: Context = { db, perspective, weights, knowledge: evaluationKnowledge(db, state, perspective), windows: quiescenceSteps }
  return estimate(ctx, state, action).score
}

function policyAction(ctx: Context, state: GameState, actions: Action[]): Action | null {
  const p = state.players[ctx.perspective]
  const strategy = ctx.knowledge.strategies[ctx.perspective]
  if (state.phase === 'chooseOrder') return actions.find(a => a.type === 'choosePlayOrder' && a.goFirst) ?? actions[0]
  if (state.phase === 'mulligan') {
    const hand = p.hand.map(uid => ctx.db[state.cards[uid].defId])
    const sellers = hand.filter(c => c.sellTag).length
    const earlyUnits = hand.filter(c => c.type === 'unit' && c.cost <= 3).length
    const cheap = hand.filter(c => c.cost <= 2).length
    const keep = sellers >= 2 && (earlyUnits > 0 || (strategy.units / Math.max(1, strategy.total) < 0.2 && cheap >= 2))
    return actions.find(a => a.type === (keep ? 'keepHand' : 'mulligan')) ?? actions[0]
  }
  if (state.phase === 'start') {
    const dice = actions.filter(a => a.type === 'chooseGigDie')
    const low = strategy.minD4 || strategy.minGig || strategy.lowCred
    return dice.sort((a,b) => low ? a.size - b.size : b.size - a.size)[0] ?? actions[0]
  }
  if (state.phase === 'gigReroll') {
    const roll = state.pendingGigRoll
    const die = roll ? state.players[roll.player].gigArea[roll.dieIndex] : undefined
    let reroll = die !== undefined && die.value * 2 < die.size + 1
    if (die && (strategy.minD4 || strategy.minGig || strategy.lowCred)) reroll = die.value > (die.size + 1) / 2
    if (die && strategy.minGig && die.value === 1) reroll = false
    if (die && strategy.pairs && p.gigArea.some((d,i) => i !== roll?.dieIndex && d.value === die.value)) reroll = false
    return actions.find(a => a.type === 'chooseGigReroll' && a.reroll === reroll) ?? actions[0]
  }
  return null
}

function actionFamily(action: Action): string {
  if ('card' in action) return action.type + ':' + action.card
  if (action.type === 'attack') return action.type + ':' + action.attacker
  return action.type
}

function targetPriority(ctx: Context, state: GameState, action: Action): number {
  if (action.type === 'endTurn') return 1_000_000
  if (action.type === 'attack' && action.target === 'gigArea') return 10_000
  const targets = 'targets' in action ? action.targets : action.type === 'attack' && typeof action.target === 'number' ? [action.target] : []
  let result = 0
  const view = state.pendingIntercept?.view ?? state
  for (const uid of targets) {
    const card = view.cards[uid]
    if (!card || !view.players.some(p => p.field.includes(uid))) continue
    const def = ctx.db[card.defId]
    result += (def.power ?? 0) + (def.keywords.includes('blocker') ? 10 : 0)
    if (view.players[ctx.perspective].field.includes(uid)) result += card.ready && !card.lag ? 30 : 0
  }
  return result
}

/** Bound target Cartesian products while retaining each distinct card/ability
 * and several target alternatives. No elapsed-time cutoff: seeded runs remain
 * deterministic on both fast and slow machines. */
function candidateActions(ctx: Context, state: GameState, actions: Action[], limit = 48): Action[] {
  if (actions.length <= Math.min(24, limit) || state.phase !== 'main') return actions
  const groups = new Map<string, Action[]>()
  for (const action of actions) {
    const key = actionFamily(action)
    const group = groups.get(key) ?? []
    group.push(action)
    groups.set(key, group)
  }
  const lists = [...groups.values()].map(group => group.sort((a,b) => targetPriority(ctx,state,b) - targetPriority(ctx,state,a)))
  const result: Action[] = []
  for (let round = 0; round < 4 && result.length < limit; round++) {
    for (const list of lists) if (list[round] && result.length < limit) result.push(list[round])
  }
  const end = actions.find(a => a.type === 'endTurn')
  if (limit < 48 && end && !result.includes(end)) result[result.length - 1] = end
  return result
}

/** Shared, hidden-information-safe move ordering for the multi-turn planner. */
export function rankHeuristicActions(db: CardDb, state: GameState, actions: Action[], options: HeuristicOptions = {}): { action: Action; score: number }[] {
  const perspective = actingPlayer(state)
  const ctx: Context = { db, perspective, weights: options.weights ?? DEFAULT_WEIGHTS,
    knowledge: evaluationKnowledge(db, state, perspective), windows: options.quiescenceSteps ?? QUIESCENCE_STEP_LIMIT, budget: options.budget }
  return candidateActions(ctx, state, actions, options.candidateLimit ?? 48)
    .map(action => ({ action, score: estimate(ctx, state, action).score }))
    .sort((a,b) => b.score - a.score)
}

/** Explore short sequences within the current turn. Every edge is a legal engine
 * action. Unknown outcomes end a branch; no hypothetical drawn card gets played.
 * Separate budgets per candidate avoid favoring the first action in enumeration. */
function continuation(ctx: Context, first: Estimate, depth: number, budget: { left: number }): number {
  if (depth <= 0 || first.stopped || first.state.phase !== 'main' || first.state.activePlayer !== ctx.perspective || budget.left <= 0) return first.score
  const actions = candidateActions(ctx, first.state, legalActions(ctx.db, first.state))
  // Attacks and passing must not disappear when a large target Cartesian product
  // exhausts the budget. Sampling targets is deterministic and public.
  const ordered = [...actions.filter(a => a.type === 'attack' || a.type === 'endTurn'), ...actions.filter(a => a.type !== 'attack' && a.type !== 'endTurn')]
  const candidates: Estimate[] = []
  const perFamily = new Map<string, number>()
  const allowance = Math.min(budget.left, depth > 1 ? 10 : budget.left)
  let used = 0
  for (const action of ordered) {
    const family = actionFamily(action), count = perFamily.get(family) ?? 0
    if (count >= 3) continue
    perFamily.set(family, count + 1)
    if (used++ >= allowance || budget.left-- <= 0) break
    candidates.push(estimate(ctx, first.state, action))
  }
  candidates.sort((a,b) => b.score - a.score)
  let best = first.score
  for (const candidate of candidates.slice(0, 2)) best = Math.max(best, continuation(ctx, candidate, depth - 1, budget) - 1)
  return best
}

/** Bounded tactical search with explicit knowledge and seeded tie-breaking.
 * Simulations and live play use the same policy; no training or hidden-state RNG
 * is used to choose moves. Options expose useful strength/speed ablations. */
export function createHeuristicAgent(seed: number, options: HeuristicOptions = {}): Agent {
  let rng: RngState = createRng(seed)
  return {
    chooseAction(db, state, actions) {
      if (!actions.length) throw new Error('createHeuristicAgent: chooseAction called with an empty actions list')
      if (actions.length === 1) return actions[0]
      const perspective = actingPlayer(state)
      const ctx: Context = { db, perspective, weights: options.weights ?? DEFAULT_WEIGHTS,
        knowledge: evaluationKnowledge(db, state, perspective), windows: options.quiescenceSteps ?? QUIESCENCE_STEP_LIMIT, budget: options.budget }
      const policy = policyAction(ctx, state, actions)
      if (policy) return policy
      const candidates = candidateActions(ctx, state, actions, options.candidateLimit ?? 48).map(action => ({ action, result: estimate(ctx, state, action) }))
      candidates.sort((a,b) => b.result.score - a.result.score)
      const depth = options.searchDepth ?? 2
      if (depth > 0 && state.phase === 'main') {
        const families = new Set<string>()
        const selected = candidates.filter(c => {
          const key = actionFamily(c.action)
          if (families.has(key)) return false
          families.add(key)
          return true
        }).slice(0, options.refinedCandidates ?? 3)
        for (const candidate of selected) candidate.result.score = continuation(ctx, candidate.result, depth, { left: options.continuationBudget ?? 16 })
      }
      const best = Math.max(...candidates.map(c => c.result.score))
      const tied = candidates.filter(c => c.result.score === best)
      if (tied.length === 1) return tied[0].action
      const [index, next] = nextInt(rng, tied.length)
      rng = next
      return tied[index].action
    },
  }
}
