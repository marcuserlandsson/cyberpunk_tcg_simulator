// Shared helpers for the engine setup/turn tests. Not a *.test.ts file, so
// vitest does not collect it as a suite (see vite.config.ts `include`).

import { loadCardDb } from '../../src/engine/cardDb'
import type { DeckList } from '../../src/engine/deck'
import { newGame } from '../../src/engine/game'
import { legalActions } from '../../src/engine/legal'
import { applyAction } from '../../src/engine/reduce'
import type { Action, CardDb, GameState } from '../../src/engine/types'
import arasakaDeck from '../../data/decks/arasaka-embracing-power.json'
import mercsDeck from '../../data/decks/mercs-the-heist.json'

export const db: CardDb = loadCardDb()

export const arasaka = arasakaDeck as unknown as DeckList
export const mercs = mercsDeck as unknown as DeckList
export const decks: [DeckList, DeckList] = [arasaka, mercs]

/** Non-legend card count of the bundled demo decks (27 each). */
export const DECK_CARDS = Object.values(arasaka.cards).reduce((a, b) => a + b, 0)

export function freshGame(seed = 1): GameState {
  return newGame(db, { decks, seed })
}

/** newGame -> roll winner chooses to go first -> both players keep their hand. */
export function startedGame(seed = 1): GameState {
  let state = freshGame(seed)
  state = applyAction(db, state, { type: 'choosePlayOrder', goFirst: true })
  state = applyAction(db, state, { type: 'keepHand' })
  state = applyAction(db, state, { type: 'keepHand' })
  return state
}

/**
 * Plays the skeleton game (take the first legal gig die, then end the turn)
 * until `stop` returns true or the game ends. `maxActions` guards runaway loops.
 */
export function drive(
  state: GameState,
  stop: (s: GameState) => boolean,
  maxActions = 500
): GameState {
  let current = state
  for (let i = 0; i < maxActions; i++) {
    if (stop(current) || current.phase === 'gameOver') return current
    const actions = legalActions(db, current)
    if (actions.length === 0) return current
    current = applyAction(db, current, actions[0])
  }
  throw new Error('drive() exceeded maxActions without reaching the stop condition')
}

export function totalDice(state: GameState): number {
  return state.players.reduce((sum, p) => sum + p.fixer.length + p.gigArea.length, 0)
}

export function dieSizes(state: GameState, player: 0 | 1): number[] {
  return state.players[player].fixer.map((d) => d.size)
}

export function gigDieActions(actions: Action[]): number[] {
  return actions.flatMap((a) => (a.type === 'chooseGigDie' ? [a.size] : []))
}
