// The simplest possible Agent: picks uniformly among the legal actions it is
// handed. Exists mainly to drive the fuzz harness (tests/fuzz/invariants.test.ts)
// and as the baseline opponent for later AI work (Tasks 10/11 import this exact
// interface) — so its own randomness must be reproducible and independent of
// the game's own `state.rng` (which the engine advances deterministically from
// the game seed; an agent sharing that stream would make two different agents
// observe the same "random" draws whenever they faced the same state).
//
// `chooseAction` never mutates or reads game state beyond the `actions` list —
// `db`/`state` are accepted only to satisfy the shared `Agent` interface (a
// smarter agent will need them).

import { createRng, nextInt, type RngState } from '../engine/rng'
import type { Action, CardDb, GameState } from '../engine/types'

export interface Agent {
  chooseAction(db: CardDb, state: GameState, actions: Action[]): Action
}

/**
 * Uniform-random agent seeded independently of the game (own mulberry32
 * stream, not `state.rng`). Each call advances the agent's own rng, so the
 * same seed replayed against the same sequence of legal-action lists always
 * makes the same choices — the determinism the fuzz harness's replay/repro
 * story depends on.
 */
export function createRandomAgent(seed: number): Agent {
  let rng: RngState = createRng(seed)
  return {
    chooseAction(_db: CardDb, _state: GameState, actions: Action[]): Action {
      if (actions.length === 0) {
        throw new Error('createRandomAgent: chooseAction called with an empty actions list')
      }
      const [index, next] = nextInt(rng, actions.length)
      rng = next
      return actions[index]
    },
  }
}
