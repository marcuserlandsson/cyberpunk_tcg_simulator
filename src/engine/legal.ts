// Enumerates every action the acting player may legally take right now.
// `applyAction` validates against this list, so this file is the single
// authority on legality — reducers may assume their action was legal.
//
// Task 4 scope: setup decisions, the gig-die choice and `endTurn`. Task 5
// adds sellCard/playCard/callLegend for the main phase. Task 6 adds combat: the
// `attack` entries of the main phase and the whole of the `react` and
// `chooseGig` windows, all enumerated by combat.ts. Task 7 adds the effect
// system's decisions: per-effect target tuples on `playCard`, `activateAbility`,
// {go-solo} Legend plays, and (via combat.ts's `reactActions`) the
// `quick`/`quickAbility` reactions. Enumerating those is delegated to
// src/cards/effects.ts + src/cards/targets.ts, which own the effect vocabulary;
// this file stays the single authority on *which* slices are legal *when*.

import { activatedAbilityActions, goSoloPayment, playCardTargetChoices } from '../cards/effects'
import { attackActions, chooseGigActions, reactActions } from './combat'
import { canonicalPayment, legendCallPayment } from './economy'
import { effectiveCardCost } from './query'
import type { Action, CardDb, DieSize, GameState } from './types'

const D20: DieSize = 20

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
 * Main-phase actions: the Task 5 economy ones — sell (once/turn, sellTag
 * cards only), play (one entry per affordable hand card x legal target tuple),
 * and call a legend (once/turn, 1 €$, only while a face-down legend remains) —
 * plus Task 6's attacks (combat.ts) and Task 7's activated abilities and
 * {go-solo} Legend plays. Each entry's `payment` is the *canonical* payment
 * (see economy.ts); `applyAction` accepts any payment satisfying `canPayWith`,
 * not just this one.
 *
 * A `playCard` action's `targets` is: the Gear equip target first (Gear only),
 * then one uid per fillable onPlay target slot (docs/rulings.md §34). Gear with
 * no legal host produces no entries at all — it may not be played.
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
    // "Play this Program for -1 €$ for each friendly Gig with 8+ value" — the
    // cost a play actually asks for is the reduced one (docs/rulings.md §44).
    const payment = canonicalPayment(state, player, effectiveCardCost(def, state, player))
    if (payment === null) continue
    for (const targets of playCardTargetChoices(db, state, uid)) {
      actions.push({ type: 'playCard', card: uid, payment, targets })
    }
  }

  // {go-solo}: "Pay this Legend's cost to play it as a ready Unit" — a play
  // from the legends zone, not from hand (docs/rulings.md §31).
  for (const uid of p.legends) {
    const payment = goSoloPayment(db, state, player, uid)
    if (payment === null) continue
    for (const targets of playCardTargetChoices(db, state, uid)) {
      actions.push({ type: 'playCard', card: uid, payment, targets })
    }
  }

  const legendPayment = legendCallPayment(state, player)
  if (legendPayment !== null) actions.push({ type: 'callLegend', payment: legendPayment })

  actions.push(...activatedAbilityActions(db, state, player))

  actions.push(...attackActions(db, state))

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
      return mainPhaseActions(db, state)

    case 'react':
      // The defender's reactions (combat.ts) — note `actingPlayer(state)` is
      // the *rival* of `activePlayer` for the whole of this window.
      return reactActions(db, state)

    case 'chooseGig':
      // The attacker picking the dice a successful steal takes.
      return chooseGigActions(state)
  }
}
