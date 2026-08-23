// Payment primitives shared by every cost-paying action (playCard,
// callLegend now; combat/effect costs in later tasks). See docs/rulings.md
// §21+ for the sell/play/call-a-legend semantics this file implements.
//
// A "payment" is a list of card uids: ready cards sitting in the payer's
// `eddies` or `legends` zone, each worth exactly 1 €$ (guide p10/glossary
// COST, EDDIES). Legends pay whether face-up or face-down (guide p7/p11) and
// stay in the legends zone, merely spent, when used this way.

import { friendlyLegendCallFree } from './query'
import type { CardDb, GameState, PlayerId } from './types'

/**
 * Call a Legend costs 1 €$ (guide p10/p11/glossary CALL A LEGEND) — the same
 * price in the main phase and as a reaction to an attack.
 */
export const CALL_A_LEGEND_COST = 1

/**
 * What Call a Legend actually costs `player` right now: the printed 1 €$,
 * or 0 while a friendly "During your turn, you may Call a Legend for free"
 * static is active (panam-palmer-strength-through-family, docs/rulings.md
 * §107 ff.). Consulted by both `legendCallPayment` below and `reduce.ts`'s
 * `isLegal`, so the two can never drift apart.
 */
export function legendCallCost(db: CardDb, state: GameState, player: PlayerId): number {
  return friendlyLegendCallFree(db, state, player) ? 0 : CALL_A_LEGEND_COST
}

/** The payer's own ready eddies + legends — every uid worth 1 €$ right now. */
function readyPaymentUids(state: GameState, player: PlayerId): number[] {
  const p = state.players[player]
  return [...p.eddies, ...p.legends].filter((uid) => state.cards[uid].ready)
}

/**
 * True iff `payment` is a legal way to pay `cost` €$: every uid is a card
 * ready in the payer's own eddies or legends zone, no uid repeated, and the
 * uids total exactly `cost`. `applyAction` uses this (not a fixed canonical
 * payment) to accept any valid payment the caller supplies.
 */
export function canPayWith(
  state: GameState,
  player: PlayerId,
  payment: number[],
  cost: number,
  exclude?: number
): boolean {
  if (payment.length !== cost) return false
  if (exclude !== undefined && payment.includes(exclude)) return false
  const eligible = new Set(readyPaymentUids(state, player))
  const seen = new Set<number>()
  for (const uid of payment) {
    if (seen.has(uid)) return false
    seen.add(uid)
    if (!eligible.has(uid)) return false
  }
  return true
}

/**
 * The payment `legalActions` offers for a given cost: ready eddies first (in
 * zone order), then ready legends left-to-right (index 0 = leftmost, per
 * game.ts's zone-order convention), taking only as many uids as `cost`
 * needs. Returns null if the player cannot afford `cost` at all. `exclude`
 * bars one uid from paying — see `canPayWith`.
 */
export function canonicalPayment(
  state: GameState,
  player: PlayerId,
  cost: number,
  exclude?: number
): number[] | null {
  const p = state.players[player]
  const readyEddies = p.eddies.filter((uid) => state.cards[uid].ready)
  const readyLegends = p.legends.filter((uid) => state.cards[uid].ready)
  const combined = [...readyEddies, ...readyLegends].filter((uid) => uid !== exclude)
  if (combined.length < cost) return null
  return combined.slice(0, cost)
}

/**
 * The canonical payment for `player`'s Call a Legend right now, or null when
 * they may not call at all: the once-per-turn gate is already used (that gate
 * is *shared* between the main-phase action and the react-window reaction —
 * docs/rulings.md §26), every Legend is already face-up so there is nothing
 * to flip, or nothing ready is left to pay the 1 €$. Used by both
 * `legalActions` slices (main phase and react window) so the two can never
 * drift apart.
 */
export function legendCallPayment(db: CardDb, state: GameState, player: PlayerId): number[] | null {
  const p = state.players[player]
  if (p.calledLegendThisTurn) return null
  if (!p.legends.some((uid) => !state.cards[uid].faceUp)) return null
  return canonicalPayment(state, player, legendCallCost(db, state, player))
}

/**
 * Spends a payment: marks every uid in it spent (`ready = false`). Mutates
 * `state.cards` in place and returns the same object — this follows
 * game.ts/reduce.ts's draft convention (see e.g. `drawCards`), not the
 * copy-on-write style of `canPayWith`/`canonicalPayment` above. Callers must
 * always pass a private draft (from `draftState`), never the canonical
 * GameState a caller still holds a reference to.
 */
export function pay(state: GameState, payment: number[]): GameState {
  for (const uid of payment) {
    state.cards[uid].ready = false
  }
  return state
}
