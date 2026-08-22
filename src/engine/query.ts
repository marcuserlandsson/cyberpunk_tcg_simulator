// Read-only derived views over GameState. Pure functions, no mutation.

import type { CardDb, GameState, PlayerId } from './types'

/** The rival of `player`. */
export function opponentOf(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0
}

/**
 * Street Cred = the sum of the top faces of every die in the player's gig
 * area (gameplay guide, p12). Dice still in the fixer are unrolled and do not
 * contribute.
 */
export function streetCred(state: GameState, player: PlayerId): number {
  return state.players[player].gigArea.reduce((sum, die) => sum + die.value, 0)
}

/**
 * The power a card fights with right now: printed power (null counts as 0, see
 * docs/rulings.md §11) plus any until-end-of-turn delta. Gear bonuses are
 * layered on in Task 7 — this function is the single place that will change.
 */
export function effectivePower(db: CardDb, state: GameState, uid: number): number {
  const card = state.cards[uid]
  if (!card) throw new Error(`Unknown card instance uid: ${uid}`)
  const def = db[card.defId]
  if (!def) throw new Error(`Unknown card definition: ${card.defId}`)
  return (def.power ?? 0) + card.tempPower
}

/**
 * Whose decision is pending. Normally the active player; during a `react`
 * window it is the defender (the rival of the attacking/active player).
 */
export function actingPlayer(state: GameState): PlayerId {
  return state.phase === 'react' ? opponentOf(state.activePlayer) : state.activePlayer
}
