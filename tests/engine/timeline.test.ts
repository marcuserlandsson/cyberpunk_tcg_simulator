// The recorder behind paced presentation. The core contract is equivalence:
// recording must never change what the engine computes. The fuzz block below
// replays random games through both entry points and demands identical
// states, plus exactly one frame per new event.
import { describe, expect, it } from 'vitest'
import { applyAction } from '../../src/engine/reduce'
import { applyActionTimeline, recordFrames } from '../../src/engine/timeline'
import { emit } from '../../src/engine/emit'
import { draftState, newGame } from '../../src/engine/game'
import { legalActions } from '../../src/engine/legal'
import { createRandomAgent } from '../../src/ai/random'
import { db, decks, startedGame } from './gameHelpers'
import type { Action, GameState } from '../../src/engine/types'

/** Plays a random game, calling `visit` with the state before each action. */
function eachStep(seed: number, visit: (before: GameState, action: Action) => GameState, cap = 300): void {
  let state = newGame(db, { decks, seed })
  const agent = createRandomAgent(seed * 31 + 7)
  for (let i = 0; i < cap && state.phase !== 'gameOver'; i++) {
    const actions = legalActions(db, state)
    if (actions.length === 0) break
    state = visit(state, agent.chooseAction(db, state, actions))
  }
}

describe('applyActionTimeline', () => {
  it('is equivalent to applyAction and records one frame per new event', () => {
    for (let seed = 1; seed <= 12; seed++) {
      eachStep(seed, (before, action) => {
        const plain = applyAction(db, before, action)
        const { state, frames } = applyActionTimeline(db, before, action)
        expect(state).toEqual(plain)
        const result = state.pendingIntercept?.view ?? state
        const fresh = result.events.length - before.events.length
        expect(frames).toHaveLength(Math.max(0, fresh))
        frames.forEach((frame, i) => {
          expect(frame.eventIndex).toBe(before.events.length + i)
          expect(frame.event).toBe(result.events[frame.eventIndex])
          expect(frame.board.events).toHaveLength(frame.eventIndex + 1)
        })
        return state
      })
    }
  })

  it('returns the frames up to the pause point when an intercept is required', () => {
    let found = false
    for (let seed = 1; seed <= 80 && !found; seed++) {
      eachStep(seed, (before, action) => {
        const timeline = applyActionTimeline(db, before, action)
        if (!found && timeline.state.phase === 'intercept' && before.phase !== 'intercept') {
          found = true
          const view = timeline.state.pendingIntercept!.view!
          expect(timeline.state.events).toHaveLength(before.events.length)
          expect(timeline.frames.length).toBe(view.events.length - before.events.length)
        }
        return timeline.state
      })
    }
    expect(found).toBe(true)
  })

  it('clears the recorder when the action is illegal', () => {
    const state = startedGame()
    expect(() => applyActionTimeline(db, state, { type: 'mulligan' })).toThrow()
    // A second timeline would throw "already recording" if the first leaked.
    const action = legalActions(db, state)[0]
    expect(() => applyActionTimeline(db, state, action)).not.toThrow()
  })

  it('refuses to nest', () => {
    const state = startedGame()
    expect(() => recordFrames(() => {
      applyActionTimeline(db, state, legalActions(db, state)[0])
      return state
    })).toThrow(/already recording/)
  })

  it('drops frames emitted on a scratch draft that never reaches the result', () => {
    const state = startedGame()
    const { frames } = recordFrames(() => {
      const scratch = draftState(state)
      emit(scratch, { type: 'turnEnded', player: 0 })
      return state
    })
    expect(frames).toEqual([])
  })
})
