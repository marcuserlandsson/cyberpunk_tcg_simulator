// The engine's "invariant net": the battery of structural checks no legal
// sequence of actions should ever be able to break. Extracted from
// tests/fuzz/invariants.test.ts (Task 9) so the Task 10 AI suite can drive
// heuristic-vs-heuristic games through the *same* checks rather than a
// second, drifting copy of them.
//
// These functions know nothing about the rules of any one card — only the
// shape every GameState must keep no matter which cards fired. Not a
// *.test.ts file, so vitest does not collect it as a suite.

import { legalActions } from '../../src/engine/legal'
import type { Action, CardDb, GameState } from '../../src/engine/types'

// The brief guessed "turn 30 at the latest." That number doesn't survive
// contact with the real deck sizes: `deck.ts`'s `MAX_DECK_SIZE` is 50, so a
// player's WORST-CASE deck life — with zero extra draws and zero cards ever
// returned to a deck — is `50 - OPENING_HAND_SIZE(6) = 44` more forced
// start-of-turn draws before the required draw off an empty deck ends the
// game via deckout (`beginTurn`'s own `drawCards(..., 1)` guarantee, the
// same hard rule as the opening-hand/mulligan draw). Since `turnNumber`
// advances once per ROUND (both players' Nth turn), a player's 45th own
// turn lands at `turnNumber === 45`; extra-draw effects only shorten this,
// and no printed effect returns cards to a deck faster than an agent could
// plausibly sustain turn after turn. 50 is that ceiling (45) plus a flat
// margin, not a re-guess: a game that reaches it is a real bug, not an
// unlucky shuffle. (Measured for real: across 24,000 sampled starter+synthetic
// games, the observed maximum was `turnNumber === 14` — see
// task-9-report.md's "turn-bound" section.)
export const MAX_TURN_NUMBER = 50

export const VALID_END_REASONS = new Set(['sevenGigs', 'overtimeMajority', 'deckout', 'concede'])

type ZoneName = 'deck' | 'hand' | 'field' | 'legends' | 'eddies' | 'trash' | 'removed'
const ZONE_NAMES: readonly ZoneName[] = ['deck', 'hand', 'field', 'legends', 'eddies', 'trash', 'removed']

/**
 * "Every card uid is in exactly one zone" — the 7 per-player arrays
 * enumerated in `types.ts`'s `PlayerState`, PLUS a card equipped as Gear
 * (which `playCardOnDraft`/`leaveField` never push onto `field` — it lives
 * only in its host's `attachedGear`, docs/rulings.md §8/§37). A uid must show
 * up in exactly one of those 8 places, and every key of `state.cards` must be
 * accounted for.
 */
export function checkZones(state: GameState): string[] {
  const problems: string[] = []
  const location = new Map<number, string>()
  const record = (uid: number, where: string): void => {
    const prior = location.get(uid)
    if (prior !== undefined) {
      problems.push(`uid ${uid} is in both "${prior}" and "${where}"`)
      return
    }
    location.set(uid, where)
  }

  for (const player of [0, 1] as const) {
    const p = state.players[player]
    const zones: Record<ZoneName, number[]> = {
      deck: p.deck,
      hand: p.hand,
      field: p.field,
      legends: p.legends,
      eddies: p.eddies,
      trash: p.trash,
      removed: p.removed,
    }
    for (const zone of ZONE_NAMES) {
      for (const uid of zones[zone]) {
        if (state.cards[uid] === undefined) {
          problems.push(`player${player}.${zone} references unknown uid ${uid}`)
          continue
        }
        record(uid, `player${player}.${zone}`)
      }
    }
  }

  for (const key of Object.keys(state.cards)) {
    const hostUid = Number(key)
    for (const gearUid of state.cards[hostUid].attachedGear) {
      if (state.cards[gearUid] === undefined) {
        problems.push(`card ${hostUid}'s attachedGear references unknown uid ${gearUid}`)
        continue
      }
      record(gearUid, `attachedGear of ${hostUid}`)
    }
  }

  const allUids = Object.keys(state.cards).map(Number)
  for (const uid of allUids) {
    if (!location.has(uid)) problems.push(`uid ${uid} exists in state.cards but is in no zone at all`)
  }
  if (state.nextUid - 1 !== allUids.length) {
    problems.push(`nextUid is ${state.nextUid} but state.cards has ${allUids.length} entries`)
  }
  return problems
}

/** 12 dice total across all 4 dice zones; unrolled iff still in the fixer. */
export function checkDice(state: GameState): string[] {
  const problems: string[] = []
  let total = 0
  for (const player of [0, 1] as const) {
    const p = state.players[player]
    total += p.fixer.length + p.gigArea.length
    for (const die of p.fixer) {
      if (die.value !== 0) problems.push(`player${player}.fixer has a d${die.size} showing ${die.value} (unrolled dice must show 0)`)
    }
    for (const die of p.gigArea) {
      if (die.value < 1 || die.value > die.size) {
        problems.push(`player${player}.gigArea has a d${die.size} showing ${die.value} (out of [1, ${die.size}])`)
      }
    }
  }
  if (total !== 12) problems.push(`total dice across both players is ${total}, expected 12`)
  return problems
}

/** These 4 "paused decision" fields must all be clear outside their own window. */
export function checkPendingClearedInMainOrStart(state: GameState): string[] {
  if (state.phase !== 'main' && state.phase !== 'start') return []
  const problems: string[] = []
  if (state.pendingAttack !== null) problems.push(`phase is "${state.phase}" but pendingAttack is set`)
  if (state.pendingSteal !== null) problems.push(`phase is "${state.phase}" but pendingSteal is set`)
  if (state.pendingIntercept !== null) problems.push(`phase is "${state.phase}" but pendingIntercept is set`)
  if (state.pendingGigRoll !== null) problems.push(`phase is "${state.phase}" but pendingGigRoll is set`)
  return problems
}

export function checkGameOver(db: CardDb, state: GameState): string[] {
  if (state.phase !== 'gameOver') return []
  const problems: string[] = []
  if (state.winner === null) problems.push('phase is gameOver but winner is null')
  if (legalActions(db, state).length !== 0) problems.push('phase is gameOver but legalActions is non-empty')
  const last = state.events.at(-1)
  if (last === undefined || last.type !== 'gameEnded') {
    problems.push('phase is gameOver but the last event is not gameEnded')
  } else {
    if (!VALID_END_REASONS.has(last.reason)) problems.push(`gameEnded reason "${last.reason}" is not a recognized reason`)
    if (last.winner !== state.winner) problems.push(`gameEnded.winner (${last.winner}) does not match state.winner (${state.winner})`)
  }
  return problems
}

/**
 * The brief's turn-bound invariant, restated as a real ceiling instead of a
 * guessed one — see `MAX_TURN_NUMBER`'s own comment for the derivation. This
 * is checked every action (not just at game end) so a genuinely unbounded
 * game fails here, from `turnNumber` alone, independent of whether it would
 * also eventually trip an action cap.
 */
export function checkTurnBound(state: GameState): string[] {
  if (state.turnNumber <= MAX_TURN_NUMBER) return []
  return [
    `turnNumber is ${state.turnNumber}, past the ${MAX_TURN_NUMBER}-turn provable ` +
      `ceiling (deckout guarantees termination by turn ~45 for the largest legal ` +
      `deck) — this game is not bounded the way the rules guarantee it should be`,
  ]
}

export function checkInvariants(db: CardDb, state: GameState): string[] {
  return [
    ...checkDice(state),
    ...checkZones(state),
    ...checkPendingClearedInMainOrStart(state),
    ...checkGameOver(db, state),
    ...checkTurnBound(state),
  ]
}

/**
 * "Spent cards never in legalActions as attackers/payers" — a sanity check on
 * the ENUMERATOR itself, not just the state after applying a choice: a spent
 * card slipping into `legalActions` would let an agent choose it and only then
 * blow up (or worse, silently succeed on a broken assumption elsewhere), which
 * would mask exactly which layer the bug is in.
 */
export function checkLegalActionsSanity(state: GameState, actions: Action[]): string[] {
  const problems: string[] = []
  for (const action of actions) {
    if (action.type === 'attack' && !state.cards[action.attacker].ready) {
      problems.push(`legalActions offered an attack by spent card ${action.attacker}`)
    }
    if (action.type === 'playCard' || action.type === 'callLegend') {
      for (const uid of action.payment) {
        if (!state.cards[uid].ready) problems.push(`legalActions offered a payment using spent card ${uid}`)
      }
    }
  }
  return problems
}
