// Enumerates every action the acting player may legally take right now.
// `applyAction` validates against this list, so this file is the single
// authority on legality — reducers may assume their action was legal.
//
// Task 4 scope: setup decisions, the gig-die choice and `endTurn`. Task 5
// adds sellCard/playCard/callLegend for the main phase (vanilla cards only —
// effects/targeting for effects arrive in Task 7). Attacking and reactions
// are still out of scope; until Task 6/7 land they are never emitted, so
// `applyAction` rejects them.

import { canonicalPayment } from './economy'
import type { Action, CardDb, DieSize, GameState, PlayerId } from './types'

const D20: DieSize = 20
const CALL_A_LEGEND_COST = 1

/**
 * One `chooseGigDie` per distinct die size in the acting player's fixer,
 * ascending. The d20 "is always last" (guide p4/p12), so it is only offered
 * when no other die remains.
 */
function gigDieChoices(state: GameState): Action[] {
  const fixer = state.players[state.activePlayer].fixer
  const sizes = [...new Set(fixer.map((die) => die.size))].sort((a, b) => a - b)
  const others = sizes.filter((size) => size !== D20)
  const offered = others.length > 0 ? others : sizes
  return offered.map((size) => ({ type: 'chooseGigDie', size }))
}

/**
 * Legal gear-equip targets: a friendly field Unit (any readiness) or a
 * friendly face-up Legend. Every one of the 141-card pool's gear reminder
 * lines reads "friendly Unit or face-up Legend" (docs/rulings.md §8 is the
 * sole, narrower, exception on the *Unit* side only — its own Legend clause
 * still says "friendly face-up Legend" — so this generic, card-text-blind
 * rule is exactly right for every vanilla gear card in this task's scope;
 * per-card overrides, if ever needed, are Task 7/8's concern). Legends stay
 * ineligible while face-down: nothing can be equipped to a hidden identity.
 */
function friendlyGearTargets(state: GameState, player: PlayerId): number[] {
  const p = state.players[player]
  const faceUpLegends = p.legends.filter((uid) => state.cards[uid].faceUp)
  return [...p.field, ...faceUpLegends]
}

/**
 * Main-phase economy actions (Task 5): sell (once/turn, sellTag cards only),
 * play (one entry per affordable hand card, with one entry per legal target
 * for gear instead of a single targets:[] entry), and call a legend
 * (once/turn, 1 €$, only while a face-down legend remains). Each entry's
 * `payment` is the *canonical* payment (see economy.ts); `applyAction`
 * accepts any payment satisfying `canPayWith`, not just this one.
 */
function mainPhaseActions(db: CardDb, state: GameState): Action[] {
  const player = state.activePlayer
  const p = state.players[player]
  const actions: Action[] = []

  if (!p.soldThisTurn) {
    for (const uid of p.hand) {
      if (db[state.cards[uid].defId].sellTag) {
        actions.push({ type: 'sellCard', card: uid })
      }
    }
  }

  for (const uid of p.hand) {
    const def = db[state.cards[uid].defId]
    const payment = canonicalPayment(state, player, def.cost)
    if (payment === null) continue
    if (def.type === 'gear') {
      for (const target of friendlyGearTargets(state, player)) {
        actions.push({ type: 'playCard', card: uid, payment, targets: [target] })
      }
    } else {
      // Legends never sit in hand (Task 5 scope excludes go-solo legend
      // play), so only 'unit' and 'program' reach here.
      actions.push({ type: 'playCard', card: uid, payment, targets: [] })
    }
  }

  if (!p.calledLegendThisTurn && p.legends.some((uid) => !state.cards[uid].faceUp)) {
    const payment = canonicalPayment(state, player, CALL_A_LEGEND_COST)
    if (payment !== null) actions.push({ type: 'callLegend', payment })
  }

  actions.push({ type: 'endTurn' })
  return actions
}

export function legalActions(db: CardDb, state: GameState): Action[] {
  if (state.winner !== null || state.phase === 'gameOver') return []

  switch (state.phase) {
    case 'chooseOrder':
      return [
        { type: 'choosePlayOrder', goFirst: true },
        { type: 'choosePlayOrder', goFirst: false },
      ]

    case 'mulligan':
      return state.players[state.activePlayer].mulliganDone
        ? [{ type: 'keepHand' }]
        : [{ type: 'mulligan' }, { type: 'keepHand' }]

    case 'start':
      // Only reachable with a non-empty fixer (`beginTurn` skips to `main`
      // otherwise), but stay defensive rather than emitting a bad choice.
      return gigDieChoices(state)

    case 'main':
      // Task 6/7 add activateAbility/attack here.
      return mainPhaseActions(db, state)

    case 'react':
    case 'chooseGig':
      // Task 6 (combat) owns these windows.
      return []
  }
}
