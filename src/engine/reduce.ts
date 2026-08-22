// The reducer: `applyAction(db, state, action) -> newState`.
//
// Contract:
//   * the action must appear in `legalActions(db, state)` (structural equality)
//     or `IllegalActionError` is thrown;
//   * the input state is never mutated — handlers mutate a `draftState` copy;
//   * every state change appends the matching GameEvent(s);
//   * after every applied action the overtime sudden-death check runs.
//
// Handlers are one small function per action type, dispatched from a single
// switch. Later tasks add their action types as new cases + functions without
// touching the ones below.

import {
  beginTurn,
  checkOvertimeWin,
  draftState,
  drawCards,
  endGame,
  OPENING_HAND_SIZE,
} from './game'
import { legalActions } from './legal'
import { opponentOf } from './query'
import { rollDie, shuffle } from './rng'
import type { Action, CardDb, GameState, PlayerId } from './types'

export class IllegalActionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IllegalActionError'
  }
}

// ---------------------------------------------------------------------------
// Legality check
// ---------------------------------------------------------------------------

/**
 * Structural equality over the JSON-ish values an Action can hold (primitives,
 * plain objects, arrays). Actions carry no volatile fields in this task, so a
 * plain deep compare is exactly "deep-equal on the relevant fields".
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, i) => deepEqual(item, b[i]))
  }
  const aRec = a as Record<string, unknown>
  const bRec = b as Record<string, unknown>
  const aKeys = Object.keys(aRec)
  const bKeys = Object.keys(bRec)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((key) => key in bRec && deepEqual(aRec[key], bRec[key]))
}

// ---------------------------------------------------------------------------
// Handlers (mutate the draft)
// ---------------------------------------------------------------------------

/**
 * The roll winner picks who goes first. The first player spends their 2
 * leftmost legends (guide p9), then both players draw their opening 6 and the
 * first player decides on their mulligan first.
 */
function choosePlayOrder(draft: GameState, goFirst: boolean): void {
  const rollWinner = draft.activePlayer
  const first: PlayerId = goFirst ? rollWinner : opponentOf(rollWinner)
  draft.firstPlayer = first
  draft.events.push({ type: 'playOrderChosen', first })

  for (const uid of draft.players[first].legends.slice(0, 2)) {
    draft.cards[uid].ready = false
  }

  for (const player of [first, opponentOf(first)]) {
    if (!drawCards(draft, player, OPENING_HAND_SIZE)) {
      endGame(draft, opponentOf(player), 'deckout')
      return
    }
  }

  draft.phase = 'mulligan'
  draft.activePlayer = first
}

/** Shuffle the hand back in and draw a fresh 6. Once per player (guide p9). */
function mulligan(draft: GameState): void {
  const player = draft.activePlayer
  const p = draft.players[player]
  p.deck = p.deck.concat(p.hand)
  p.hand = []
  const [shuffled, rng] = shuffle(draft.rng, p.deck)
  p.deck = shuffled
  draft.rng = rng
  p.mulliganDone = true
  draft.events.push({ type: 'mulliganTaken', player })
  if (!drawCards(draft, player, OPENING_HAND_SIZE)) {
    endGame(draft, opponentOf(player), 'deckout')
  }
}

/**
 * The first player keeps first; once the second player keeps too, the first
 * player's turn 1 begins.
 */
function keepHand(draft: GameState): void {
  const player = draft.activePlayer
  draft.events.push({ type: 'handKept', player })
  if (player === draft.firstPlayer) {
    draft.activePlayer = opponentOf(player)
    return
  }
  beginTurn(draft, draft.firstPlayer, 1)
}

/** Gain a gig: take the chosen die from the fixer, roll it, keep the result. */
function chooseGigDie(draft: GameState, size: number): void {
  const player = draft.activePlayer
  const p = draft.players[player]
  const index = p.fixer.findIndex((die) => die.size === size)
  if (index === -1) {
    // Unreachable: legalActions only offers sizes present in the fixer.
    throw new IllegalActionError(`No d${size} in player ${player}'s fixer area.`)
  }
  const [die] = p.fixer.splice(index, 1)
  const [value, rng] = rollDie(draft.rng, die.size)
  draft.rng = rng
  p.gigArea.push({ size: die.size, value })
  draft.events.push({ type: 'dieRolled', player, size: die.size, value })
  draft.phase = 'main'
}

/** Pass the turn; the rival's start-of-turn sequence runs immediately. */
function endTurn(draft: GameState): void {
  const player = draft.activePlayer
  draft.events.push({ type: 'turnEnded', player })
  const next = opponentOf(player)
  // turnNumber counts each player's own turns and advances when the first
  // player begins a turn — see the comment at the top of game.ts.
  const nextTurn = next === draft.firstPlayer ? draft.turnNumber + 1 : draft.turnNumber
  beginTurn(draft, next, nextTurn)
}

// ---------------------------------------------------------------------------
// applyAction
// ---------------------------------------------------------------------------

export function applyAction(db: CardDb, state: GameState, action: Action): GameState {
  const legal = legalActions(db, state)
  if (!legal.some((candidate) => deepEqual(candidate, action))) {
    throw new IllegalActionError(
      `Illegal action ${JSON.stringify(action)} in phase "${state.phase}" ` +
        `(legal: ${JSON.stringify(legal)}).`
    )
  }

  const draft = draftState(state)

  switch (action.type) {
    case 'choosePlayOrder':
      choosePlayOrder(draft, action.goFirst)
      break
    case 'mulligan':
      mulligan(draft)
      break
    case 'keepHand':
      keepHand(draft)
      break
    case 'chooseGigDie':
      chooseGigDie(draft, action.size)
      break
    case 'endTurn':
      endTurn(draft)
      break
    default:
      // sellCard / playCard / callLegend / activateAbility / attack /
      // chooseGig / react arrive in Tasks 5-7. They are never legal yet, so
      // this is only reachable if legalActions and this switch disagree.
      throw new IllegalActionError(`Action type "${action.type}" is not implemented yet.`)
  }

  checkOvertimeWin(draft)
  return draft
}
