// The save/replay/undo format.
//
// A whole game is exactly two things: the config it was dealt from, and the
// ordered list of actions that were applied to it. Nothing else needs storing
// because `newGame` is a pure function of the config (the rng lives in the
// state it seeds) and `applyAction` is a pure function of (db, state, action).
// So a `GameRecord` is a complete, tiny, JSON-safe description of a game — the
// save format, the resume format, and the undo substrate all at once.
//
// AI SEED. `GameRecord` deliberately does NOT store the opponent agent's rng
// seed. The UI derives every AI decision's seed from `config.seed` plus the
// number of actions already recorded (see `src/ui/useGame.ts`'s `aiSeedFor`),
// which makes the AI a pure function of the record itself: loading a saved
// record and continuing reproduces the same opponent, and so does undoing back
// into the middle of a turn. Storing a mutable agent rng position in the record
// would have made the record's meaning depend on *when* it was written.
//
// PURITY. This is engine code: no React, no UI imports, no `Math.random`, no
// `Date.now` (guarded by tests/engine/purity.test.ts).

import { newGame, type NewGameConfig } from './game'
import { actingPlayer } from './query'
import { applyAction } from './reduce'
import type { Action, CardDb, GameState, PlayerId } from './types'

/**
 * A complete game: the deal plus every decision taken, in order. JSON-safe by
 * construction — `NewGameConfig` is two `DeckList`s and a number, and every
 * `Action` variant holds only primitives and arrays of primitives.
 */
export interface GameRecord {
  config: NewGameConfig
  actions: Action[]
}

/**
 * Folds a record back into the state it describes. Throws (via `applyAction`'s
 * own `IllegalActionError`) if any recorded action is not legal in the state
 * the fold reaches — a corrupt or hand-edited record fails loudly rather than
 * producing a state no sequence of legal play could reach.
 */
export function replay(db: CardDb, record: GameRecord): GameState {
  let state = newGame(db, record.config)
  for (const action of record.actions) {
    state = applyAction(db, state, action)
  }
  return state
}

/**
 * Which player's decision each recorded action answered.
 *
 * ATTRIBUTION. An action belongs to `actingPlayer(state)` evaluated on the
 * state *before* it is applied — not to `activePlayer`, because both players
 * take actions during a single game turn (a defender's `react` window, an
 * effect-driven `chooseGig`, a would-be-defeated `answerIntercept`). The only
 * way to know that from a record alone is to replay it, which is exactly what
 * this does: the attribution is derived, never stored, so a record written by
 * any producer (UI, sim, test) is undoable without carrying redundant
 * bookkeeping that could disagree with the actions themselves.
 */
function attributions(db: CardDb, record: GameRecord): PlayerId[] {
  let state = newGame(db, record.config)
  const owners: PlayerId[] = []
  for (const action of record.actions) {
    owners.push(actingPlayer(state))
    state = applyAction(db, state, action)
  }
  return owners
}

/**
 * Rewinds to the last point `player` was being asked to decide something:
 * strips the trailing actions up to *and including* that player's own last
 * action, so every action the opponent took in response to it falls away too.
 *
 * `replay(db, undoToLastDecisionOf(db, record, p))` is therefore a state in
 * which `actingPlayer` is `p` again and their previous choice is un-made — the
 * meaning of "undo" for a game where the opponent answers immediately.
 *
 * A record in which `player` has taken no action at all is returned unchanged
 * (there is nothing of theirs to undo). The input record is never mutated; the
 * returned record shares the same `config` object and a fresh actions array.
 */
export function undoToLastDecisionOf(
  db: CardDb,
  record: GameRecord,
  player: PlayerId
): GameRecord {
  const owners = attributions(db, record)
  const lastOwn = owners.lastIndexOf(player)
  if (lastOwn === -1) return record
  return { config: record.config, actions: record.actions.slice(0, lastOwn) }
}

/** True when `player` has an action in `record` that `undoToLastDecisionOf` would strip. */
export function canUndo(db: CardDb, record: GameRecord, player: PlayerId): boolean {
  return attributions(db, record).includes(player)
}
