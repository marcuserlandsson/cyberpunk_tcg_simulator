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

import { blockAttack, declareAttack, resolveAttack, takeStolenGig } from './combat'
import { CALL_A_LEGEND_COST, canPayWith, pay } from './economy'
import {
  beginTurn,
  checkOvertimeWin,
  draftState,
  drawCards,
  endGame,
  OPENING_HAND_SIZE,
} from './game'
import { legalActions } from './legal'
import { actingPlayer, opponentOf } from './query'
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
 * `playCard`, `callLegend` and the `callLegend` *reaction* carry a `payment`
 * field that `legalActions` fills in with one canonical payment (economy.ts),
 * but the caller may pay with any valid combination of ready eddies/legends
 * totalling the same cost (Task 5 brief). So legality for these action types
 * is checked in two parts: the action *shape* (ignoring `payment`) must match
 * some entry in `legalActions`, and the *supplied* payment must independently
 * satisfy `canPayWith` for that action's cost. Every other action type — every
 * other reaction included — still goes through a plain structural `deepEqual`
 * against the legal list.
 */
function isLegal(db: CardDb, state: GameState, legal: Action[], action: Action): boolean {
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
    const cost = db[state.cards[action.card].defId].cost
    return canPayWith(state, state.activePlayer, action.payment, cost)
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
 * Play (guide p10/p7; Task 5 scope is vanilla cards only — no on-play
 * effects yet, and legends never reach this handler since they can't be in
 * hand). Units enter the field ready with Lag; Programs resolve (nothing to
 * resolve yet) and go straight to the trash; Gear is equipped to the chosen
 * target (already validated as legal by `legalActions`/`isLegal`).
 */
function playCard(
  draft: GameState,
  db: CardDb,
  cardUid: number,
  payment: number[],
  targets: number[]
): void {
  const player = draft.activePlayer
  const p = draft.players[player]
  const card = draft.cards[cardUid]
  const def = db[card.defId]

  p.hand = p.hand.filter((uid) => uid !== cardUid)
  pay(draft, payment)
  draft.events.push({ type: 'cardPlayed', player, uid: cardUid })

  switch (def.type) {
    case 'unit':
      card.ready = true
      card.lag = true
      p.field.push(cardUid)
      break
    case 'program':
      p.trash.push(cardUid)
      draft.events.push({ type: 'cardTrashed', uid: cardUid })
      break
    case 'gear':
      draft.cards[targets[0]].attachedGear.push(cardUid)
      break
    case 'legend':
      // Unreachable in this task: legends never sit in hand (go-solo play is
      // Task 7 scope).
      break
  }
}

/**
 * Call a Legend (guide p10/p11/glossary; docs/rulings.md §23): spend 1 €$,
 * then flip a uniformly random face-down legend of `player`'s own face up, via
 * the seeded RNG so the choice is deterministic and replayable. `player` is
 * the active player in the main phase and the *defender* when this runs as a
 * reaction (guide p11), and the once-per-turn gate is the same
 * `calledLegendThisTurn` flag either way (docs/rulings.md §26).
 */
function callLegend(draft: GameState, player: PlayerId, payment: number[]): void {
  const p = draft.players[player]
  pay(draft, payment)

  const faceDown = p.legends.filter((uid) => !draft.cards[uid].faceUp)
  const [index, rng] = nextInt(draft.rng, faceDown.length)
  draft.rng = rng
  const target = faceDown[index]
  draft.cards[target].faceUp = true
  p.calledLegendThisTurn = true
  draft.events.push({ type: 'legendCalled', player, uid: target })
}

/**
 * A reaction inside the react window (guide p10 step 03 / p11). The window
 * stays open across every reaction that does not resolve the attack, so the
 * defender may take "any number of these reactions" before deciding:
 *   * `pass`  — closes the window; the attack resolves (fight or steal);
 *   * `block` — spends the blocker, redirects, and resolves at once, because a
 *               redirected direct attack steals nothing (docs/rulings.md §27);
 *   * `callLegend` — flips a legend and leaves the window open.
 * `quick` / `quickAbility` arrive in Task 7; `legalActions` never offers them
 * yet, so they are unreachable here.
 */
function react(draft: GameState, db: CardDb, reaction: Reaction): void {
  switch (reaction.type) {
    case 'pass':
      resolveAttack(draft, db)
      break
    case 'block':
      blockAttack(draft, db, reaction.blocker)
      break
    case 'callLegend':
      callLegend(draft, opponentOf(draft.activePlayer), reaction.payment)
      break
    case 'quick':
    case 'quickAbility':
      throw new IllegalActionError(`Reaction "${reaction.type}" is not implemented yet.`)
  }
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
      callLegend(draft, draft.activePlayer, action.payment)
      break
    case 'attack':
      declareAttack(draft, action.attacker, action.target)
      break
    case 'react':
      react(draft, db, action.reaction)
      break
    case 'chooseGig':
      takeStolenGig(draft, action.dieIndex)
      break
    case 'endTurn':
      endTurn(draft)
      break
    default:
      // activateAbility arrives in Task 7. It is never legal yet, so this is
      // only reachable if legalActions and this switch disagree.
      throw new IllegalActionError(`Action type "${action.type}" is not implemented yet.`)
  }

  checkOvertimeWin(draft)
  return draft
}
