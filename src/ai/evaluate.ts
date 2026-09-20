import { GIGS_TO_WIN, isOvertime, stillLive } from '../engine/game'
import { readyPaymentUids } from '../engine/economy'
import { attackActions, stealCount } from '../engine/combat'
import { cantAttack, cantAttackGigArea, effectiveKeywords, effectivePower, opponentOf, signedPower, streetCred, valuePairCount } from '../engine/query'
import type { CardDb, GameState, PlayerId } from '../engine/types'
import { evaluationKnowledge, retainedCardValue, type EvaluationKnowledge } from './strategy'

export interface EvalWeights {
  gig: number
  sevenGigs: number
  overtimeMajority: number
  streetCred: number
  friendlyPower: number
  rivalPower: number
  handCard: number
  eddie: number
  readyPayer: number
  faceUpLegend: number
  readyBlocker: number
  deckCard: number
  deckoutAversion: number
  terminal: number
}

export const DECKOUT_THRESHOLD = 5
export const DEFAULT_WEIGHTS: EvalWeights = {
  gig: 1000,
  sevenGigs: 300_000,
  overtimeMajority: 5_000,
  streetCred: 10,
  friendlyPower: 25,
  rivalPower: 20,
  handCard: 24,
  eddie: 32,
  readyPayer: 6,
  faceUpLegend: 45,
  readyBlocker: 300,
  deckCard: 1,
  deckoutAversion: 50,
  terminal: 1_000_000_000,
}

/** Evaluate public board facts and the observer's already-known hand. Lookahead
 * supplies knowledge captured BEFORE the candidate, so a random draw cannot
 * leak its identity through hand quality or newly discovered deck strategy. */
export function evaluate(
  db: CardDb, state: GameState, perspective: PlayerId,
  weights: EvalWeights = DEFAULT_WEIGHTS,
  knowledge: EvaluationKnowledge = evaluationKnowledge(db, state, perspective),
): number {
  if (!stillLive(state)) return state.winner === null ? 0 : state.winner === perspective ? weights.terminal : -weights.terminal
  const rival = opponentOf(perspective)
  const mine = state.players[perspective], theirs = state.players[rival]
  const myGigs = mine.gigArea.length, theirGigs = theirs.gigArea.length
  let score = (myGigs - theirGigs) * weights.gig
  if (myGigs >= GIGS_TO_WIN) score += weights.sevenGigs
  if (theirGigs >= GIGS_TO_WIN) score -= weights.sevenGigs
  if (isOvertime(state)) score += ((myGigs >= GIGS_TO_WIN ? 1 : 0) - (theirGigs >= GIGS_TO_WIN ? 1 : 0)) * weights.overtimeMajority

  for (const player of [perspective, rival]) {
    const sign = player === perspective ? 1 : -1
    const p = state.players[player]
    const strategy = knowledge.strategies[player]
    const cred = streetCred(state, player) ?? 0
    // Low-Cred decks care about dice for victory, but lower faces unlock effects.
    score += sign * cred * (strategy.lowCred ? 0 : weights.streetCred)
    if (strategy.lowCred && cred < (streetCred(state, opponentOf(player)) ?? 0)) score += sign * 90
    if (strategy.minD4 && p.gigArea.some(d => d.size === 4 && d.value === 1)) score += sign * 180
    else if (strategy.minGig && p.gigArea.some(d => d.value === 1)) score += sign * 65
    const faceUp = p.legends.filter(uid => state.cards[uid].faceUp)
    if (strategy.pairs) score += sign * valuePairCount(state, player) * (faceUp.length ? 70 : 25)

    const currentAttacks = new Set(attackActions(db, { ...state, activePlayer: player })
      .filter(a => a.type === 'attack').map(a => a.type === 'attack' ? a.attacker : -1))
    for (const uid of p.field) {
      const card = state.cards[uid], def = db[card.defId]
      const power = effectivePower(db, state, uid)
      // A temporary debuff without a follow-up is not lasting removal.
      const lastingPower = Math.max(0, signedPower(db, state, uid) - card.tempPower)
      score += sign * lastingPower * (player === perspective ? weights.friendlyPower : weights.rivalPower)
      const blocker = effectiveKeywords(db, state, uid).includes('blocker')
      if (blocker) {
        // A rival blocker spent on our turn readies before its next turn. Its
        // temporary absence matters only if we can exploit it with attackers.
        const facingAttackers = state.players[opponentOf(player)].field.some(other => effectivePower(db, state, other) > 0 && !cantAttack(db, state, other))
        score += sign * Math.round(weights.readyBlocker * 0.5)
        if (card.ready) score += sign * Math.round(weights.readyBlocker * (facingAttackers ? 0.5 : 0.1))
      }
      const locked = state.floatingEffects.some(e => e.unitUid === uid &&
        (e.kind === 'unitCantAttack' || (e.kind === 'unitCantReady' && !card.ready)) &&
        (e.expiry === 'ownerNextTurnStart' || player === state.activePlayer)) || (card.skipNextReady && !card.ready)
      // A spent/Lag body is still a future attacker. Persistent denial removes
      // that threat for a turn; being spent alone does not.
      if (!locked && !cantAttackGigArea(db, state, uid) && !cantAttack(db, state, uid)) {
        score += sign * stealCount(lastingPower) * 100
      }
      if (player === knowledge.turnPlayer && player === state.activePlayer && currentAttacks.has(uid)) {
        score += sign * (stealCount(power) * 100 + (def.effects.some(e => e.trigger === 'onAttack') ? 20 : 0))
        if (card.tempPower > 0) score += sign * Math.min(card.tempPower, 5) * 6
      }
    }
    for (const uid of faceUp) {
      const def = db[state.cards[uid].defId]
      score += sign * weights.faceUpLegend
      if (def.effects.some(e => e.trigger === 'onStartTurn' || e.trigger === 'onFriendlyCardPlayed')) score += sign * 65
    }
  }

  score += (mine.hand.length - theirs.hand.length) * weights.handCard
  const copies = new Map<string, number>()
  // Only the observer's identities are known, even when scoring a rival reply.
  const observer = knowledge.observer
  const handSign = observer === perspective ? 1 : -1
  for (const uid of state.players[observer].hand) {
    const defId = knowledge.hand.get(uid)
    if (!defId) continue
    const count = copies.get(defId) ?? 0
    copies.set(defId, count + 1)
    score += handSign * Math.round(retainedCardValue(db, state, observer, defId) / (count + 1))
  }
  score += mine.eddies.length * weights.eddie
  score += readyPaymentUids(db, state, perspective).length * weights.readyPayer
  score += mine.deck.length * weights.deckCard
  if (mine.deck.length < DECKOUT_THRESHOLD) score -= (DECKOUT_THRESHOLD - mine.deck.length) * weights.deckoutAversion
  return score
}
