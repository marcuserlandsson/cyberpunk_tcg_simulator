// The heuristic opponent: a one-ply greedy search over `legalActions`, scored
// by `evaluate`, with two layers on top of the plain argmax.
//
// LAYER 1 — one-ply greedy. For each legal action: `applyAction` on the state
// (which is pure — it deep-copies internally via `draftState`, so nothing here
// clones anything itself), score the result from the AI's own perspective, take
// the max, break ties with the agent's own seeded rng. Because *every* decision
// the engine asks for arrives as a `legalActions` list — main-phase plays,
// attacks, react windows, Gig-die steal picks, would-be-defeated/stolen
// interceptions, forced-attack turns — this one loop answers all of them
// uniformly. The brief's "special handling" for `chooseGig` (take the most
// valuable die) and for `react` (simulate each reaction) genuinely falls out of
// it: a higher-value die is worth more Street Cred to the AI and less to the
// rival, so it wins the argmax on its own.
//
// LAYER 2 — quiescence (`resolveWindows`). A plain one-ply score is blind to
// exactly the decisions that matter most, because an attack does not *do*
// anything until a window or two later: right after `attack` the Gig areas are
// untouched (the defender has yet to react), and right after a defender's
// `pass` the steal is still a pending `chooseGig` for the attacker. So a
// candidate whose result sits inside a decision window is played forward with a
// cheap, information-free default policy — the defender passes, a thief takes
// its best die, an interception is declined — until the position is quiet.
// This is what makes the brief's tactical layers real: a Gig-area attack is
// scored by the dice it actually takes, and a block is scored as "the Gig I
// keep vs the blocker I spend" rather than as two indistinguishable
// non-events.
//
// LAYER 0 — three pre-state policies, applied BEFORE any simulation, for the
// decisions whose outcome is rolled by the engine's own rng. Simulating those
// would let the AI read the die/shuffle it is about to get and pick the branch
// that happens to roll well — rng exploitation, not skill. So:
//   * `chooseGigDie` takes the largest die still in the fixer (every die is
//     rolled in eventually, so ordering only decides how much Street Cred
//     arrives early; `legalActions` already withholds the d20 until last);
//   * `chooseGigReroll` rerolls exactly when the die landed below its own
//     average — a decision that needs the face already showing, not the face
//     it would land on;
//   * `mulligan` reads the AI's OWN opening hand (legitimately visible) for
//     cheap, playable cards, rather than peeking at the hand it would draw.
// `choosePlayOrder` gets a fixed answer for the same reason: simulating it
// deals both opening hands.
//
// HIDDEN INFORMATION. `evaluate` is the only scoring read of the state and is
// hidden-info-clean by construction (see its header). This file adds no state
// reads of its own beyond the public ones the policies above name, and the
// quiescence policy picks its default actions by *predicate* (`pass`,
// `answer === -1`, best visible die value), never by list position — so the
// rival's hand contents cannot steer it even indirectly. `applyAction` itself
// of course reads hidden state while simulating (a draw's result, a random
// Legend flip); that is the engine simulating, not the AI peeking, and it
// cannot influence the choice because `evaluate` scores zone SIZES rather than
// contents. See docs/rulings.md and the task-10 report for the residual
// caveats.

import { legalActions } from '../engine/legal'
import { applyAction } from '../engine/reduce'
import { actingPlayer, opponentOf } from '../engine/query'
import { createRng, nextInt, type RngState } from '../engine/rng'
import { DEFAULT_WEIGHTS, evaluate, type EvalWeights } from './evaluate'
import type { Agent } from './random'
import type { Action, CardDb, GameState, PlayerId } from '../engine/types'

/**
 * Passing the turn is scored from the resulting position (the rival's start of
 * turn has already run) minus this, so a strictly-improving action is always
 * preferred to ending the turn even when the two positions score the same.
 * Deliberately tiny: the argmax, not this number, is what stops the AI from
 * ending its turn with playable cards in hand.
 */
export const END_TURN_TEMPO_PENALTY = 5

/**
 * How many default continuations `resolveWindows` will play out. An attack can
 * open a react window, a multi-die steal, and an interception per die; the
 * whole Gig pool is 12 dice, so this is a ceiling on a bounded process rather
 * than a guess — it exists only so a future card that reopens a window cannot
 * spin here forever.
 */
const QUIESCENCE_STEP_LIMIT = 32

/** Mulligan unless the opening hand holds at least this many cheap cards. */
const MULLIGAN_MIN_CHEAP_CARDS = 2
/** "Cheap" = castable off the first couple of €$ the game hands you. */
const MULLIGAN_CHEAP_COST = 2

/**
 * Whether to take the first turn when the d20 roll makes it this AI's call.
 * Going first wins the race to a 7-Gig turn start (the win check runs at the
 * start of each turn, so the first player checks first every round), but it
 * costs two Legends spent and un-readied through turn 1 (guide p9) — and
 * measured over 200 mirror games (heuristic vs heuristic, first player forced
 * and alternated) the second player wins 57%, so the tempo is not worth the
 * two Legends. See the task-10 report for the measurement.
 */
const PREFER_GOING_FIRST = false

/** The phases whose decision is a window inside a larger action. */
function isWindowPhase(state: GameState): boolean {
  return (
    state.phase === 'react' ||
    state.phase === 'chooseGig' ||
    state.phase === 'intercept' ||
    state.phase === 'gigReroll'
  )
}

/**
 * The default continuation of an open window: what the AI assumes will happen
 * while it is only *scoring* a candidate, never what it actually plays.
 *
 * Each branch picks by predicate on public information, so nothing hidden can
 * steer it:
 *   * `react` — the defender passes (a block is a candidate in its own right at
 *     the top level, so assuming it away here loses nothing but the
 *     block-after-quick combination);
 *   * `chooseGig` — the thief, whichever side it is, takes the highest top face
 *     on offer (ties to the lowest index, for determinism);
 *   * `intercept` — declined (`-1`), the answer `legal.ts` always offers first;
 *   * `gigReroll` — kept, since the reroll decision has its own policy at the
 *     top level.
 */
function continuationAction(db: CardDb, state: GameState, actions: Action[]): Action | null {
  if (state.phase === 'react') {
    return actions.find((a) => a.type === 'react' && a.reaction.type === 'pass') ?? actions[0]
  }
  if (state.phase === 'chooseGig') {
    const steal = state.pendingSteal
    if (steal === null) return actions[0]
    const victim = opponentOf(steal.thief ?? state.activePlayer)
    const dice = state.players[victim].gigArea
    let best: Action | null = null
    let bestValue = -Infinity
    for (const action of actions) {
      if (action.type !== 'chooseGig') continue
      const value = dice[action.dieIndex]?.value ?? -Infinity
      if (value > bestValue) {
        bestValue = value
        best = action
      }
    }
    return best ?? actions[0]
  }
  if (state.phase === 'intercept') {
    return actions.find((a) => a.type === 'answerIntercept' && a.answer === -1) ?? actions[0]
  }
  if (state.phase === 'gigReroll') {
    return (
      actions.find((a) => a.type === 'chooseGigReroll' && !a.reroll) ?? actions[0]
    )
  }
  return null
}

/**
 * Plays a candidate's result forward through any open decision window with
 * `continuationAction`, so `evaluate` sees the position an attack (or a block,
 * or an interception) actually reaches rather than the mid-air one it starts.
 * Stops the moment the game is over or the position is quiet.
 */
function resolveWindows(db: CardDb, state: GameState): GameState {
  let current = state
  for (let step = 0; step < QUIESCENCE_STEP_LIMIT; step++) {
    if (current.winner !== null || !isWindowPhase(current)) break
    const actions = legalActions(db, current)
    if (actions.length === 0) break
    const next = continuationAction(db, current, actions)
    if (next === null) break
    current = applyAction(db, current, next)
  }
  return current
}

/**
 * One candidate's score: apply it (one internal `draftState` copy — this
 * function never clones anything itself), quiesce, evaluate.
 */
function scoreAction(
  db: CardDb,
  state: GameState,
  action: Action,
  perspective: PlayerId,
  weights: EvalWeights
): number {
  const applied = applyAction(db, state, action)
  const quiet = resolveWindows(db, applied)
  const score = evaluate(db, quiet, perspective, weights)
  return action.type === 'endTurn' ? score - END_TURN_TEMPO_PENALTY : score
}

/**
 * The pre-simulation policies (LAYER 0 in the file header) — the decisions
 * whose result the engine rolls, answered from what is already on the table.
 * Returns null when the decision is one the search should handle.
 */
function policyAction(
  db: CardDb,
  state: GameState,
  actions: Action[],
  perspective: PlayerId
): Action | null {
  switch (state.phase) {
    case 'chooseOrder': {
      const wanted = actions.find(
        (a) => a.type === 'choosePlayOrder' && a.goFirst === PREFER_GOING_FIRST
      )
      return wanted ?? actions[0]
    }

    case 'mulligan': {
      const mulliganAction = actions.find((a) => a.type === 'mulligan')
      if (mulliganAction === undefined) return actions[0]
      const hand = state.players[perspective].hand
      const cheap = hand.filter(
        (uid) => db[state.cards[uid].defId].cost <= MULLIGAN_CHEAP_COST
      ).length
      if (cheap >= MULLIGAN_MIN_CHEAP_CARDS) {
        return actions.find((a) => a.type === 'keepHand') ?? actions[0]
      }
      return mulliganAction
    }

    case 'start': {
      // The largest die still in the fixer: every die is rolled in eventually,
      // so the only thing the order decides is how much Street Cred arrives
      // early. `legalActions` already holds the d20 back until it is the only
      // one left (guide p4/p12).
      let best: Action | null = null
      let bestSize = -Infinity
      for (const action of actions) {
        if (action.type !== 'chooseGigDie') continue
        if (action.size > bestSize) {
          bestSize = action.size
          best = action
        }
      }
      return best ?? actions[0]
    }

    case 'gigReroll': {
      // Reroll exactly when the face showing is below the die's own average —
      // decided from the face it HAS, never from the one it would land on.
      const pending = state.pendingGigRoll
      const die = pending === null ? undefined : state.players[pending.player].gigArea[pending.dieIndex]
      const worthRerolling = die !== undefined && die.value * 2 < die.size + 1
      return (
        actions.find((a) => a.type === 'chooseGigReroll' && a.reroll === worthRerolling) ??
        actions[0]
      )
    }

    default:
      return null
  }
}

/**
 * A heuristic agent: one-ply greedy over `legalActions` scored by `evaluate`,
 * with the layers described in this file's header. `seed` drives only the
 * tie-break among equally-scored actions, on the agent's own mulberry32 stream
 * (never `state.rng`) — so the same seed replayed against the same sequence of
 * questions always answers identically, exactly like `createRandomAgent`.
 */
export function createHeuristicAgent(
  seed: number,
  weights: EvalWeights = DEFAULT_WEIGHTS
): Agent {
  let rng: RngState = createRng(seed)
  return {
    chooseAction(db: CardDb, state: GameState, actions: Action[]): Action {
      if (actions.length === 0) {
        throw new Error('createHeuristicAgent: chooseAction called with an empty actions list')
      }
      if (actions.length === 1) return actions[0]

      const perspective: PlayerId = actingPlayer(state)
      const policy = policyAction(db, state, actions, perspective)
      if (policy !== null) return policy

      let bestScore = -Infinity
      let tied: Action[] = []
      for (const action of actions) {
        const score = scoreAction(db, state, action, perspective, weights)
        if (score > bestScore) {
          bestScore = score
          tied = [action]
        } else if (score === bestScore) {
          tied.push(action)
        }
      }

      if (tied.length === 1) return tied[0]
      const [index, next] = nextInt(rng, tied.length)
      rng = next
      return tied[index]
    },
  }
}
