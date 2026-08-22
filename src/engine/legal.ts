// Enumerates every action the acting player may legally take right now.
// `applyAction` validates against this list, so this file is the single
// authority on legality — reducers may assume their action was legal.
//
// Task 4 scope: setup decisions, the gig-die choice and `endTurn`. Selling,
// playing, calling legends, attacking and reactions are added by later tasks;
// until then they are never emitted, so `applyAction` rejects them.

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
      // Task 5 adds sellCard/playCard/callLegend/activateAbility/attack here.
      return [{ type: 'endTurn' }]

    case 'react':
    case 'chooseGig':
      // Task 6 (combat) owns these windows.
      return []
  }
}
