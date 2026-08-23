// Tests for the save/replay/undo format (src/engine/replay.ts).
//
// A GameRecord is nothing but the new-game config plus the ordered list of
// actions that were applied to it, so every property below is really a
// statement about `applyAction` being a pure fold: replaying the list must
// reproduce the exact live state, and *truncating* the list must reproduce an
// exact earlier state (which is what undo is).

import { describe, expect, it } from 'vitest'
import { loadCardDb } from '../../src/engine/cardDb'
import { newGame, type NewGameConfig } from '../../src/engine/game'
import { legalActions } from '../../src/engine/legal'
import { applyAction } from '../../src/engine/reduce'
import { actingPlayer } from '../../src/engine/query'
import { replay, undoToLastDecisionOf, type GameRecord } from '../../src/engine/replay'
import { createRandomAgent } from '../../src/ai/random'
import type { DeckList } from '../../src/engine/deck'
import type { Action, CardDb, GameState, PlayerId } from '../../src/engine/types'
import arasakaDeck from '../../data/decks/arasaka-embracing-power.json'
import mercsDeck from '../../data/decks/mercs-the-heist.json'

const db: CardDb = loadCardDb()
const arasaka = arasakaDeck as unknown as DeckList
const mercs = mercsDeck as unknown as DeckList

function configFor(seed: number): NewGameConfig {
  return { decks: [arasaka, mercs], seed }
}

interface PlayedGame {
  record: GameRecord
  /** The live state after the last recorded action. */
  state: GameState
  /** `owners[i]` is the player whose decision `record.actions[i]` answered. */
  owners: PlayerId[]
  /** The live state after each prefix: `states[i]` is before `actions[i]`. */
  states: GameState[]
}

/**
 * Plays a two-random-agent game for at most `maxActions` actions, recording
 * both the action list and (for the assertions below) the per-action
 * attribution and every intermediate state.
 */
function playGame(seed: number, maxActions: number): PlayedGame {
  const config = configFor(seed)
  const agents = [createRandomAgent(seed * 2 + 1), createRandomAgent(seed * 2 + 2)]
  let state = newGame(db, config)
  const actions: Action[] = []
  const owners: PlayerId[] = []
  const states: GameState[] = [state]

  while (state.phase !== 'gameOver' && actions.length < maxActions) {
    const legal = legalActions(db, state)
    if (legal.length === 0) break
    const actor = actingPlayer(state)
    const chosen = agents[actor].chooseAction(db, state, legal)
    actions.push(chosen)
    owners.push(actor)
    state = applyAction(db, state, chosen)
    states.push(state)
  }

  return { record: { config, actions }, state, owners, states }
}

describe('replay', () => {
  it('folds a recorded action list back into the exact live state', () => {
    for (const seed of [1, 7, 42, 1234]) {
      const game = playGame(seed, 60)
      expect(game.record.actions.length).toBeGreaterThan(10)
      expect(replay(db, game.record)).toEqual(game.state)
    }
  })

  it('reproduces every intermediate state from the matching prefix', () => {
    const game = playGame(9, 40)
    for (let i = 0; i <= game.record.actions.length; i++) {
      const prefix: GameRecord = {
        config: game.record.config,
        actions: game.record.actions.slice(0, i),
      }
      expect(replay(db, prefix)).toEqual(game.states[i])
    }
  })

  it('replays an empty record to the freshly-dealt game', () => {
    const record: GameRecord = { config: configFor(5), actions: [] }
    expect(replay(db, record)).toEqual(newGame(db, configFor(5)))
  })

  it('throws on a record whose actions were never legal', () => {
    const record: GameRecord = {
      config: configFor(3),
      // `chooseOrder` is the opening phase; `endTurn` is not one of its two
      // legal answers, so the fold must reject the record rather than
      // silently produce a corrupt state.
      actions: [{ type: 'endTurn' }],
    }
    expect(() => replay(db, record)).toThrow()
  })
})

describe('undoToLastDecisionOf', () => {
  it('strips the player`s last action and every action after it', () => {
    for (const seed of [1, 7, 42]) {
      const game = playGame(seed, 60)
      const undone = undoToLastDecisionOf(db, game.record, 0)

      const lastOwn = game.owners.lastIndexOf(0)
      expect(lastOwn).toBeGreaterThanOrEqual(0)
      expect(undone.actions).toEqual(game.record.actions.slice(0, lastOwn))
      expect(undone.config).toEqual(game.record.config)

      // The state it lands on is exactly the one that player was deciding in.
      const state = replay(db, undone)
      expect(state).toEqual(game.states[lastOwn])
      expect(actingPlayer(state)).toBe(0)
      expect(legalActions(db, state).length).toBeGreaterThan(0)
    }
  })

  it('works for either player', () => {
    const game = playGame(11, 60)
    for (const player of [0, 1] as const) {
      const undone = undoToLastDecisionOf(db, game.record, player)
      const state = replay(db, undone)
      expect(actingPlayer(state)).toBe(player)
      expect(undone.actions).toEqual(
        game.record.actions.slice(0, game.owners.lastIndexOf(player))
      )
    }
  })

  it('undoes twice, landing on the player`s previous decision point', () => {
    const game = playGame(7, 60)
    const once = undoToLastDecisionOf(db, game.record, 0)
    const twice = undoToLastDecisionOf(db, once, 0)

    expect(twice.actions.length).toBeLessThan(once.actions.length)

    const ownersOnce = game.owners.slice(0, once.actions.length)
    expect(twice.actions).toEqual(once.actions.slice(0, ownersOnce.lastIndexOf(0)))

    const state = replay(db, twice)
    expect(actingPlayer(state)).toBe(0)
    expect(legalActions(db, state).length).toBeGreaterThan(0)
  })

  it('leaves the record untouched when that player has taken no action', () => {
    // The very first decision of the game (`chooseOrder`) belongs to whoever
    // won the order roll, so the OTHER player has no action to undo.
    const config = configFor(4)
    const opening = newGame(db, config)
    const idle: PlayerId = opening.activePlayer === 0 ? 1 : 0
    const record: GameRecord = {
      config,
      actions: [{ type: 'choosePlayOrder', goFirst: true }],
    }
    expect(undoToLastDecisionOf(db, record, idle)).toEqual(record)
  })

  it('never mutates the record it is given', () => {
    const game = playGame(13, 40)
    const before = JSON.stringify(game.record)
    undoToLastDecisionOf(db, game.record, 0)
    expect(JSON.stringify(game.record)).toBe(before)
  })
})

describe('GameRecord serialization', () => {
  it('round-trips through JSON and still replays identically', () => {
    const game = playGame(42, 60)
    const parsed = JSON.parse(JSON.stringify(game.record)) as GameRecord
    expect(parsed).toEqual(game.record)
    expect(replay(db, parsed)).toEqual(game.state)
  })

  it('round-trips an undone record through JSON', () => {
    const game = playGame(42, 60)
    const undone = undoToLastDecisionOf(db, game.record, 0)
    const parsed = JSON.parse(JSON.stringify(undone)) as GameRecord
    expect(replay(db, parsed)).toEqual(replay(db, undone))
  })
})
