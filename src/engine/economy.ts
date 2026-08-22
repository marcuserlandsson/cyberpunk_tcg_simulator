// Payment primitives shared by every cost-paying action (playCard,
// callLegend now; combat/effect costs in later tasks). See docs/rulings.md
// §21+ for the sell/play/call-a-legend semantics this file implements.
//
// A "payment" is a list of card uids: ready cards sitting in the payer's
// `eddies` or `legends` zone, each worth exactly 1 €$ (guide p10/glossary
// COST, EDDIES). Legends pay whether face-up or face-down (guide p7/p11) and
// stay in the legends zone, merely spent, when used this way.

import type { GameState, PlayerId } from './types'

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
  cost: number
): boolean {
  if (payment.length !== cost) return false
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
 * needs. Returns null if the player cannot afford `cost` at all.
 */
export function canonicalPayment(
  state: GameState,
  player: PlayerId,
  cost: number
): number[] | null {
  const p = state.players[player]
  const readyEddies = p.eddies.filter((uid) => state.cards[uid].ready)
  const readyLegends = p.legends.filter((uid) => state.cards[uid].ready)
  const combined = [...readyEddies, ...readyLegends]
  if (combined.length < cost) return null
  return combined.slice(0, cost)
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
