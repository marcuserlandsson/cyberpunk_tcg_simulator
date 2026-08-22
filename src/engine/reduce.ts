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
// touching the ones below. The combat handlers (`attack`, `react`,
// `chooseGig`) delegate every mechanic to combat.ts and keep only the
// dispatch here.

import {
  activateAbilityOnDraft,
  fireTriggerOnDraft,
  playCardOnDraft,
  spendOnDraft,
} from '../cards/effects'
import { blockAttack, declareAttack, resolveAttack, takeStolenGig } from './combat'
import { CALL_A_LEGEND_COST, canPayWith } from './economy'
import {
  beginTurn,
  checkOvertimeWin,
  clearTurnBuffs,
  draftState,
  drawCards,
  endGame,
  OPENING_HAND_SIZE,
} from './game'
import { legalActions } from './legal'
import { actingPlayer, effectiveCardCost, opponentOf } from './query'
import { nextInt, rollDie, shuffle } from './rng'
import type { Action, CardDb, GameState, PlayerId, Reaction } from './types'

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

/**
 * `playCard`, `callLegend`, the `callLegend` reaction and the `quick` reaction
 * carry a `payment` field that `legalActions` fills in with one canonical
 * payment (economy.ts), but the caller may pay with any valid combination of
 * ready eddies/legends totalling the same cost (Task 5 brief). So legality for
 * these action types is checked in two parts: the action *shape* (ignoring
 * `payment`) must match some entry in `legalActions`, and the *supplied*
 * payment must independently satisfy `canPayWith` for that action's cost. Every
 * other action type — `activateAbility` included, whose €$ cost the engine pays
 * from the canonical payment because the action carries none — still goes
 * through a plain structural `deepEqual` against the legal list.
 */
function isLegal(db: CardDb, state: GameState, legal: Action[], action: Action): boolean {
  if (action.type === 'react' && action.reaction.type === 'quick') {
    const reaction = action.reaction
    const shapeMatches = legal.some(
      (candidate) =>
        candidate.type === 'react' &&
        candidate.reaction.type === 'quick' &&
        candidate.reaction.card === reaction.card &&
        deepEqual(candidate.reaction.targets, reaction.targets)
    )
    if (!shapeMatches) return false
    // The payer is the defender, not the active player.
    const payer = actingPlayer(state)
    const cost = effectiveCardCost(db[state.cards[reaction.card].defId], state, payer)
    return canPayWith(state, payer, reaction.payment, cost)
  }

  if (action.type === 'react' && action.reaction.type === 'callLegend') {
    const shapeMatches = legal.some(
      (candidate) => candidate.type === 'react' && candidate.reaction.type === 'callLegend'
    )
    if (!shapeMatches) return false
    // The payer is the defender, not the active player (guide p11: Call a
    // Legend is one of the attacked Rival's reactions).
    return canPayWith(state, actingPlayer(state), action.reaction.payment, CALL_A_LEGEND_COST)
  }

  if (action.type === 'playCard') {
    const shapeMatches = legal.some(
      (candidate) =>
        candidate.type === 'playCard' &&
        candidate.card === action.card &&
        deepEqual(candidate.targets, action.targets)
    )
    if (!shapeMatches) return false
    const def = db[state.cards[action.card].defId]
    // A {go-solo} Legend can never help pay its own cost (docs/rulings.md §31).
    const exclude = def.type === 'legend' ? action.card : undefined
    const cost = effectiveCardCost(def, state, state.activePlayer)
    return canPayWith(state, state.activePlayer, action.payment, cost, exclude)
  }

  if (action.type === 'callLegend') {
    const shapeMatches = legal.some((candidate) => candidate.type === 'callLegend')
    if (!shapeMatches) return false
    return canPayWith(state, state.activePlayer, action.payment, CALL_A_LEGEND_COST)
  }

  return legal.some((candidate) => deepEqual(candidate, action))
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

/**
 * Sell (guide p10/glossary SELL; docs/rulings.md §21): move the card
 * face-down into the Eddies area, ready (so it can pay a cost this same
 * turn), and mark `soldThisTurn` so a second sell is rejected by
 * `legalActions` for the rest of this turn.
 */
function sellCard(draft: GameState, cardUid: number): void {
  const player = draft.activePlayer
  const p = draft.players[player]
  p.hand = p.hand.filter((uid) => uid !== cardUid)
  p.eddies.push(cardUid)
  const card = draft.cards[cardUid]
  card.faceUp = false
  card.ready = true
  p.soldThisTurn = true
  draft.events.push({ type: 'cardSold', player, uid: cardUid })
}

/**
 * Play (guide p10/p7). The mechanics — where the card goes, in what state, and
 * firing its onPlay effects — live in `playCardOnDraft` (src/cards/effects.ts)
 * so the main-phase action and the {quick} reaction share one implementation.
 * A Legend reaching here is a {go-solo} play from the legends zone
 * (docs/rulings.md §31).
 */
function playCard(
  draft: GameState,
  db: CardDb,
  cardUid: number,
  payment: number[],
  targets: number[]
): void {
  playCardOnDraft(db, draft, draft.activePlayer, cardUid, payment, targets)
}

/**
 * Activate an ability (guide's {Spend}/€$ ability costs). The action carries no
 * `payment`, so the engine spends the source (for a `selfSpend` cost) and pays
 * any €$ from the canonical payment — see `activateAbilityOnDraft`.
 */
function activateAbility(
  draft: GameState,
  db: CardDb,
  player: PlayerId,
  cardUid: number,
  abilityIndex: number,
  targets: number[]
): void {
  activateAbilityOnDraft(db, draft, player, cardUid, abilityIndex, targets)
}

/**
 * Call a Legend (guide p10/p11/glossary; docs/rulings.md §23): spend 1 €$,
 * then flip a uniformly random face-down legend of `player`'s own face up, via
 * the seeded RNG so the choice is deterministic and replayable. `player` is
 * the active player in the main phase and the *defender* when this runs as a
 * reaction (guide p11), and the once-per-turn gate is the same
 * `calledLegendThisTurn` flag either way (docs/rulings.md §26).
 */
function callLegend(draft: GameState, db: CardDb, player: PlayerId, payment: number[]): void {
  const p = draft.players[player]
  spendOnDraft(db, draft, payment)

  const faceDown = p.legends.filter((uid) => !draft.cards[uid].faceUp)
  const [index, rng] = nextInt(draft.rng, faceDown.length)
  draft.rng = rng
  const target = faceDown[index]
  draft.cards[target].faceUp = true
  p.calledLegendThisTurn = true
  draft.events.push({ type: 'legendCalled', player, uid: target })

  // [trigger] on-call effects resolve as the Legend turns face-up, in the main
  // phase and in the react window alike. The flip is random, so the action
  // carries no targets — any the effect needs are auto-chosen
  // (docs/rulings.md §32).
  fireTriggerOnDraft(db, draft, 'onCall', target, [])
}

/**
 * A reaction inside the react window (guide p10 step 03 / p11). The window
 * stays open across every reaction that does not resolve the attack, so the
 * defender may take "any number of these reactions" before deciding:
 *   * `pass`  — closes the window; the attack resolves (fight or steal);
 *   * `block` — spends the blocker, redirects, and resolves at once, because a
 *               redirected direct attack steals nothing (docs/rulings.md §27);
 *   * `callLegend` — flips a legend and leaves the window open;
 *   * `quick` — plays a {quick} Program from the defender's hand (paid like any
 *               other play) and leaves the window open;
 *   * `quickAbility` — activates a {quick} ability and leaves the window open.
 * A quick effect may defeat or bounce either combatant; `resolveAttack` already
 * fizzles an attack whose attacker or target has vanished.
 */
function react(draft: GameState, db: CardDb, reaction: Reaction): void {
  const defender = opponentOf(draft.activePlayer)
  switch (reaction.type) {
    case 'pass':
      resolveAttack(draft, db)
      break
    case 'block':
      blockAttack(draft, db, reaction.blocker)
      break
    case 'callLegend':
      callLegend(draft, db, defender, reaction.payment)
      break
    case 'quick':
      playCardOnDraft(db, draft, defender, reaction.card, reaction.payment, reaction.targets)
      break
    case 'quickAbility':
      activateAbility(draft, db, defender, reaction.card, reaction.abilityIndex, reaction.targets)
      break
  }
}

/**
 * Pass the turn: clear every until-end-of-turn buff (both players — the buff
 * lasts to the end of the *game* turn, docs/rulings.md §20), then the rival's
 * start-of-turn sequence runs immediately.
 */
function endTurn(draft: GameState): void {
  const player = draft.activePlayer
  draft.events.push({ type: 'turnEnded', player })
  clearTurnBuffs(draft)
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
  if (!isLegal(db, state, legal, action)) {
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
    case 'sellCard':
      sellCard(draft, action.card)
      break
    case 'playCard':
      playCard(draft, db, action.card, action.payment, action.targets)
      break
    case 'callLegend':
      callLegend(draft, db, draft.activePlayer, action.payment)
      break
    case 'activateAbility':
      activateAbility(
        draft,
        db,
        draft.activePlayer,
        action.card,
        action.abilityIndex,
        action.targets
      )
      break
    case 'attack':
      declareAttack(draft, db, action.attacker, action.target)
      break
    case 'react':
      react(draft, db, action.reaction)
      break
    case 'chooseGig':
      takeStolenGig(draft, db, action.dieIndex)
      break
    case 'endTurn':
      endTurn(draft)
      break
  }

  checkOvertimeWin(draft)
  return draft
}
