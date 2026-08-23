// Would-be-mutation interceptions (docs/rulings.md §144).
//
// Two cards in the pool answer a mutation that is *about to* happen with an
// optional, costed decision by the player it would hurt:
//   * `jackie-welles-mama-s-favorite` — "If a friendly Unit would be defeated,
//     you may spend 1 €$ to defeat this Legend instead."
//   * `alt-cunningham-mother-of-daemons` — "When a rival Unit would steal a
//     Gig, you may discard 1 with cost equal to that Gig's value. If you do,
//     the Gig isn't stolen." (the clause docs/rulings.md §72 deferred).
//
// Both interception points sit deep inside a synchronous mutation (`combat.ts`'s
// `defeatUnit`, reached from fights, effect nodes and mass-defeat scripts alike,
// and `takeStolenGig`) — places that cannot simply *return* to the reducer to
// ask a question, because their callers go on to fire triggers that depend on
// the answer.
//
// Rather than capturing a continuation, the engine ROLLS BACK AND REPLAYS: the
// mutation asks for the next pre-supplied answer, and if there is none it
// throws `InterceptRequired`, which `reduce.ts`'s `runAction` catches. The
// half-finished draft is thrown away wholesale (so nothing it touched, the rng
// included, can leak) and the *original* state comes back with the question
// attached. Answering re-applies the identical action from that same original
// state with one more answer in hand — deterministic, because the rng is part
// of the state being replayed. Each round trip supplies exactly one answer, so
// an action containing several interceptions simply asks several times.
//
// Nothing here imports the rest of the engine, so it can be used from any
// module without a cycle.

import type { GameState, PendingIntercept } from './types'

/** The question an interception point asks, minus the replay bookkeeping. */
export type InterceptAsk = Pick<
  PendingIntercept,
  'kind' | 'player' | 'protector' | 'subject' | 'options'
>

/**
 * Thrown by `askIntercept` when the run has no answer for an interception it
 * reached. Caught only by `reduce.ts`'s `runAction`, which discards the draft
 * and turns the ask into a pending decision.
 */
export class InterceptRequired extends Error {
  readonly ask: InterceptAsk

  constructor(ask: InterceptAsk) {
    super(`Interception decision required (${ask.kind} on ${ask.subject}).`)
    this.name = 'InterceptRequired'
    this.ask = ask
  }
}

/**
 * The controller's answer to one interception: the next value the current run
 * was given, or — when the run has none — an abort that asks for it. `-1`
 * always means "decline"; every other value names whatever the intercepting
 * card's own text asks for (see `Action`'s `answerIntercept`).
 */
export function askIntercept(draft: GameState, ask: InterceptAsk): number {
  const answer = draft.interceptAnswers.shift()
  if (answer !== undefined) return answer
  throw new InterceptRequired(ask)
}

/** The decline answer, shared by every interception point. */
export const DECLINE = -1
