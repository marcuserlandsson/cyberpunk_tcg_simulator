// The heuristic AI's static evaluation function: how good is this position for
// one player, in a single number?
//
// HIDDEN-INFORMATION DISCIPLINE (the hard constraint on this file). Every
// feature below is derived only from facts a human sitting at the table can
// see:
//
//   * both Gig areas — dice on the table, sizes and top faces alike;
//   * both fields — Units are played face-up, so their `effectivePower` (Gear,
//     buffs and active statics included) is public;
//   * face-up Legends — public by definition;
//   * ZONE SIZES: hand, deck, eddies, and the ready/spent split within the
//     eddies and legends zones. A face-down €$ is worth exactly 1 €$ whichever
//     card it is (economy.ts), so its count is all that matters and its
//     identity is never read;
//   * the terminal `winner`.
//
// What is deliberately NOT read anywhere in this file: the rival's hand
// *contents*, either player's deck *contents or order*, and any face-down
// Legend's `defId`. `effectivePower` is safe on both sides because
// `query.inPlay` only lets a Legend contribute statics once it is face-up, so
// no face-down identity can leak into a power number. The AI's own hand is
// legitimately visible to it, but this function ignores its contents too, and
// scores only its size — which is what lets tests/ai/heuristic.test.ts shuffle
// *both* decks in a clone and still demand an identical score (a strictly
// stronger property than the brief's rival-only invariance).
//
// Sign convention: positive is good for `perspective`. Every term is an
// integer, so two equal positions score exactly equal and the caller's
// tie-break is a real tie-break rather than float noise.

import { GIGS_TO_WIN, isOvertime } from '../engine/game'
import { effectivePower, opponentOf, streetCred } from '../engine/query'
import type { CardDb, GameState, PlayerId } from '../engine/types'

export interface EvalWeights {
  /** A Gig die is the win condition; nothing else comes close. */
  gig: number
  /**
   * Holding 7+ Gigs wins outright at the start of your next turn
   * (`game.beginTurn`), so it is a win in all but name — worth far more than
   * the 7th die's own `gig` term, but still short of `terminal` because the
   * rival gets one whole turn to steal one back.
   */
  sevenGigs: number
  /** Overtime is sudden death on Gig COUNT, so a lead there is nearly terminal. */
  overtimeMajority: number
  /** Sum of Gig top faces (guide p12) — gates a lot of printed conditions. */
  streetCred: number
  friendlyPower: number
  rivalPower: number
  handCard: number
  /**
   * An €$ card in the eddies zone is a permanent income source (it readies
   * every turn), so owning one is worth appreciably more than a card in hand;
   * `readyPayer` prices only the *readiness* that a play spends, which is why
   * spending €$ on a decent body is a clear gain rather than a wash.
   */
  eddie: number
  readyPayer: number
  faceUpLegend: number
  deckCard: number
  /** Extra penalty per card below `DECKOUT_THRESHOLD` — running out is a loss. */
  deckoutAversion: number
  /** A won/lost game. */
  terminal: number
}

/** Below this many cards left, deckout stops being theoretical. */
export const DECKOUT_THRESHOLD = 5

/**
 * The tuned weights (see .superpowers/sdd/.../task-10-report.md for the
 * measured tuning rounds). The brief's starting set, with three changes the
 * measurements forced:
 *   * `friendlyPower` up and the €$ cost of a play split into `eddie` (kept)
 *     vs `readyPayer` (spent), because at the brief's numbers a 2-cost 3-power
 *     Unit scored NEGATIVE and the AI simply never played anything;
 *   * `sevenGigs`, which the brief's set had no term for at all, so a steal to
 *     7 looked exactly as good as any other steal;
 *   * `rivalPower` slightly below `friendlyPower`, so trading bodies evenly is
 *     mildly good for the side that keeps initiative.
 */
export const DEFAULT_WEIGHTS: EvalWeights = {
  gig: 1000,
  sevenGigs: 300_000,
  overtimeMajority: 5_000,
  streetCred: 10,
  friendlyPower: 25,
  rivalPower: 20,
  handCard: 12,
  eddie: 14,
  readyPayer: 6,
  faceUpLegend: 25,
  deckCard: 1,
  deckoutAversion: 50,
  terminal: 1_000_000_000,
}

/** Total `effectivePower` of everything `player` has on the field. */
function fieldPower(db: CardDb, state: GameState, player: PlayerId): number {
  let total = 0
  for (const uid of state.players[player].field) total += effectivePower(db, state, uid)
  return total
}

/**
 * How many €$ `player` could pay right now: every ready card in the eddies and
 * legends zones (economy.ts prices each at 1 €$). Counts only readiness, never
 * which card it is.
 */
function readyPayers(state: GameState, player: PlayerId): number {
  const p = state.players[player]
  let count = 0
  for (const uid of p.eddies) if (state.cards[uid].ready) count += 1
  for (const uid of p.legends) if (state.cards[uid].ready) count += 1
  return count
}

function faceUpLegends(state: GameState, player: PlayerId): number {
  return state.players[player].legends.filter((uid) => state.cards[uid].faceUp).length
}

/**
 * Position value for `perspective`, in "score units" (a Gig die is 1000 of
 * them). Pure: never mutates `state`, never reads hidden information — see the
 * file header.
 */
export function evaluate(
  db: CardDb,
  state: GameState,
  perspective: PlayerId,
  weights: EvalWeights = DEFAULT_WEIGHTS
): number {
  if (state.winner !== null) {
    return state.winner === perspective ? weights.terminal : -weights.terminal
  }

  const rival = opponentOf(perspective)
  const mine = state.players[perspective]
  const theirs = state.players[rival]

  const myGigs = mine.gigArea.length
  const theirGigs = theirs.gigArea.length

  let score = (myGigs - theirGigs) * weights.gig

  // Win proximity: 7 Gigs held at a turn start is an outright win, so reaching
  // 7 dominates every board consideration below.
  if (myGigs >= GIGS_TO_WIN) score += weights.sevenGigs
  if (theirGigs >= GIGS_TO_WIN) score -= weights.sevenGigs

  // In overtime any strict Gig majority ends the game immediately
  // (`game.checkOvertimeWin`), so a non-terminal overtime state always has
  // equal counts — this term therefore only ever fires on a state whose
  // majority the engine has not yet checked, where it is worth a lot.
  if (isOvertime(state)) score += Math.sign(myGigs - theirGigs) * weights.overtimeMajority

  score += (streetCred(state, perspective) - streetCred(state, rival)) * weights.streetCred

  score += fieldPower(db, state, perspective) * weights.friendlyPower
  score -= fieldPower(db, state, rival) * weights.rivalPower

  score += (mine.hand.length - theirs.hand.length) * weights.handCard

  score += mine.eddies.length * weights.eddie
  score += readyPayers(state, perspective) * weights.readyPayer
  score += faceUpLegends(state, perspective) * weights.faceUpLegend

  score += mine.deck.length * weights.deckCard
  if (mine.deck.length < DECKOUT_THRESHOLD) {
    score -= (DECKOUT_THRESHOLD - mine.deck.length) * weights.deckoutAversion
  }

  return score
}
