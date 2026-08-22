// Game construction and the automatic turn machinery (start-of-turn sequence,
// win checks, overtime). Everything here is pure with respect to the caller's
// state: reducers work on a *draft* produced by `draftState`, which is a fresh
// copy of every container the engine can touch, so the input GameState is
// never mutated.
//
// TURN NUMBERING (see `GameState.turnNumber`): `turnNumber` is the *per-player*
// turn count, shared by both players. It is set to 1 when the first player
// begins their first turn and increments only when the first player begins a
// turn, so a game reads:
//
//   turnNumber 1: first player's 1st turn, then second player's 1st turn
//   turnNumber 2: first player's 2nd turn, then second player's 2nd turn
//   ...
//
// Consequences used below:
//   * "a player's Nth turn" is exactly `turnNumber === N`;
//   * when the active player is the first player on turn N, both players have
//     completed N-1 turns; when it is the second player on turn N, the first
//     player has completed N turns and the second N-1. So *both* players have
//     completed 7 turns exactly when `turnNumber >= 8`, which is the overtime
//     trigger (`isOvertime`).

import { createRng, rollDie, shuffle, type RngState } from './rng'
import type { DeckList } from './deck'
import { opponentOf } from './query'
import type {
  CardDb,
  CardInstance,
  DieSize,
  GameEvent,
  GameState,
  GigDie,
  PlayerId,
  PlayerState,
} from './types'

export interface NewGameConfig {
  decks: [DeckList, DeckList]
  seed: number
}

/** The six dice every player's fixer area starts with. */
export const FIXER_DICE: readonly DieSize[] = [4, 6, 8, 10, 12, 20]
export const OPENING_HAND_SIZE = 6
/** Start your turn with this many gig dice and you win outright. */
export const GIGS_TO_WIN = 7
/** Overtime begins once both players have completed this many turns. */
export const OVERTIME_AFTER_TURNS = 7

// ---------------------------------------------------------------------------
// newGame
// ---------------------------------------------------------------------------

interface Built {
  cards: Record<number, CardInstance>
  nextUid: number
}

function makeInstance(uid: number, defId: string, owner: PlayerId, faceUp: boolean): CardInstance {
  return { uid, defId, owner, ready: true, lag: false, faceUp, attachedGear: [], tempPower: 0 }
}

/**
 * Expands a deck list into card instances. Card ids are visited in sorted
 * order so instance creation (and therefore uid assignment) is independent of
 * JSON key order — determinism must not depend on how the deck file was
 * written.
 */
function buildPlayerCards(
  db: CardDb,
  deck: DeckList,
  owner: PlayerId,
  built: Built
): { deckUids: number[]; legendUids: number[] } {
  const legendUids: number[] = []
  for (const defId of deck.legends) {
    if (!db[defId]) throw new Error(`Deck "${deck.name}" references unknown legend "${defId}".`)
    const uid = built.nextUid++
    built.cards[uid] = makeInstance(uid, defId, owner, false)
    legendUids.push(uid)
  }

  const deckUids: number[] = []
  for (const defId of Object.keys(deck.cards).sort()) {
    if (!db[defId]) throw new Error(`Deck "${deck.name}" references unknown card "${defId}".`)
    const copies = deck.cards[defId]
    for (let i = 0; i < copies; i++) {
      const uid = built.nextUid++
      built.cards[uid] = makeInstance(uid, defId, owner, true)
      deckUids.push(uid)
    }
  }

  return { deckUids, legendUids }
}

function freshFixer(): GigDie[] {
  return FIXER_DICE.map((size) => ({ size, value: 0 }))
}

/** Rolls both players' d20 for play order, rerolling until the tie is broken. */
function rollForOrder(rng: RngState): [[number, number], RngState] {
  let state = rng
  for (;;) {
    const [r0, afterFirst] = rollDie(state, 20)
    const [r1, afterSecond] = rollDie(afterFirst, 20)
    state = afterSecond
    if (r0 !== r1) return [[r0, r1], state]
  }
}

export function newGame(db: CardDb, config: NewGameConfig): GameState {
  const built: Built = { cards: {}, nextUid: 1 }
  let rng = createRng(config.seed)

  const players: PlayerState[] = []
  for (const player of [0, 1] as const) {
    const { deckUids, legendUids } = buildPlayerCards(db, config.decks[player], player, built)
    const [shuffledDeck, afterDeck] = shuffle(rng, deckUids)
    const [shuffledLegends, afterLegends] = shuffle(afterDeck, legendUids)
    rng = afterLegends
    players.push({
      deck: shuffledDeck,
      hand: [],
      field: [],
      legends: shuffledLegends,
      eddies: [],
      trash: [],
      gigArea: [],
      fixer: freshFixer(),
      soldThisTurn: false,
      calledLegendThisTurn: false,
      mulliganDone: false,
    })
  }

  const [orderRolls, afterOrder] = rollForOrder(rng)
  rng = afterOrder
  // The higher roller decides who goes first (guide p9, setup step 02); they
  // are the acting player for the `choosePlayOrder` decision. `firstPlayer`
  // is a placeholder until that decision is taken.
  const rollWinner: PlayerId = orderRolls[0] > orderRolls[1] ? 0 : 1

  const events: GameEvent[] = [{ type: 'gameStarted', seed: config.seed, orderRolls }]

  return {
    players: [players[0], players[1]],
    cards: built.cards,
    nextUid: built.nextUid,
    turnNumber: 0,
    activePlayer: rollWinner,
    firstPlayer: rollWinner,
    phase: 'chooseOrder',
    pendingAttack: null,
    pendingSteal: null,
    winner: null,
    rng,
    events,
  }
}

// ---------------------------------------------------------------------------
// Draft state (copy-on-write for reducers)
// ---------------------------------------------------------------------------

function clonePlayer(player: PlayerState): PlayerState {
  return {
    ...player,
    deck: player.deck.slice(),
    hand: player.hand.slice(),
    field: player.field.slice(),
    legends: player.legends.slice(),
    eddies: player.eddies.slice(),
    trash: player.trash.slice(),
    gigArea: player.gigArea.map((die) => ({ ...die })),
    fixer: player.fixer.map((die) => ({ ...die })),
  }
}

/**
 * A mutable working copy of `state`. Every array, dice object, card instance
 * and the events log are freshly allocated, so a reducer can mutate the draft
 * freely without ever touching the caller's state.
 */
export function draftState(state: GameState): GameState {
  const cards: Record<number, CardInstance> = {}
  for (const key of Object.keys(state.cards)) {
    const uid = Number(key)
    const card = state.cards[uid]
    cards[uid] = { ...card, attachedGear: card.attachedGear.slice() }
  }
  return {
    ...state,
    players: [clonePlayer(state.players[0]), clonePlayer(state.players[1])],
    cards,
    pendingAttack: state.pendingAttack ? { ...state.pendingAttack } : null,
    pendingSteal: state.pendingSteal ? { ...state.pendingSteal } : null,
    events: state.events.slice(),
  }
}

// ---------------------------------------------------------------------------
// Shared mutations on a draft
// ---------------------------------------------------------------------------

export function endGame(
  draft: GameState,
  winner: PlayerId,
  reason: 'sevenGigs' | 'overtimeMajority' | 'deckout' | 'concede'
): void {
  draft.winner = winner
  draft.phase = 'gameOver'
  draft.events.push({ type: 'gameEnded', winner, reason })
}

/**
 * Draws `count` cards. Returns false as soon as the deck runs dry — the caller
 * decides what that means (for a required draw it is a deckout loss).
 */
export function drawCards(draft: GameState, player: PlayerId, count: number): boolean {
  const p = draft.players[player]
  for (let i = 0; i < count; i++) {
    const uid = p.deck.shift()
    if (uid === undefined) return false
    p.hand.push(uid)
    draft.events.push({ type: 'cardDrawn', player, uid })
  }
  return true
}

/**
 * Readies every spent card the player controls. Exception (guide p9, setup
 * step 02): the player going first spends their 2 leftmost legends and does
 * not ready them on their *first* turn only.
 */
function readySpentCards(draft: GameState, player: PlayerId, turnNumber: number): void {
  const p = draft.players[player]
  const penalised = new Set<number>()
  if (player === draft.firstPlayer && turnNumber === 1) {
    for (const uid of p.legends.slice(0, 2)) penalised.add(uid)
  }
  for (const uid of [...p.field, ...p.legends, ...p.eddies]) {
    if (penalised.has(uid)) continue
    draft.cards[uid].ready = true
  }
}

/**
 * Clears the once-per-turn flags and the until-end-of-turn card state.
 *
 * The two once-per-turn flags have deliberately different scopes, because the
 * actions they gate do (docs/rulings.md §26):
 *
 *   * `calledLegendThisTurn` is cleared for **both** players, because Call a
 *     Legend can be taken "during your main phase, **or as a reaction when a
 *     rival Unit attacks**" (glossary CALL A LEGEND) — so its "each turn"
 *     allowance has to refresh for the player who is about to *defend* as much
 *     as for the player whose turn is starting. Clearing only the active
 *     player's flag would let a main-phase call silently eat the reaction call
 *     that player was owed during the rival's next turn.
 *   * `soldThisTurn` is cleared for the **active player only**. Selling is a
 *     main-phase action with no reaction form, so a player can only ever sell
 *     on their own turn and resetting at their own turn start is exactly
 *     equivalent to resetting every turn. (If a future card ever allows selling
 *     at another time, this is the line to revisit.)
 */
function resetTurnState(draft: GameState, player: PlayerId): void {
  const p = draft.players[player]
  p.soldThisTurn = false
  draft.players[0].calledLegendThisTurn = false
  draft.players[1].calledLegendThisTurn = false
  for (const key of Object.keys(draft.cards)) {
    const card = draft.cards[Number(key)]
    if (card.owner !== player) continue
    card.lag = false
    card.tempPower = 0
  }
}

/**
 * The whole automatic start-of-turn sequence. In order:
 *   0. `turnStarted` event;
 *   1. win check — 7+ gig dice in the gig area wins before anything else
 *      happens (guide p3/p4: "at the start of their turn ... before taking one
 *      from the fixer area");
 *   2. ready spent cards;
 *   3. clear per-turn flags, lag and temporary power;
 *   4. draw 1 (empty deck = immediate loss);
 *   5. gain a gig — needs a `chooseGigDie` decision, so the turn stops in the
 *      `start` phase; when the fixer is empty (from turn 7 on) it goes
 *      straight to `main`.
 */
export function beginTurn(draft: GameState, player: PlayerId, turnNumber: number): void {
  draft.activePlayer = player
  draft.turnNumber = turnNumber
  draft.phase = 'start'
  draft.events.push({ type: 'turnStarted', player, turn: turnNumber })

  if (draft.players[player].gigArea.length >= GIGS_TO_WIN) {
    endGame(draft, player, 'sevenGigs')
    return
  }

  readySpentCards(draft, player, turnNumber)
  resetTurnState(draft, player)

  if (!drawCards(draft, player, 1)) {
    endGame(draft, opponentOf(player), 'deckout')
    return
  }

  draft.phase = draft.players[player].fixer.length > 0 ? 'start' : 'main'
}

// ---------------------------------------------------------------------------
// Overtime
// ---------------------------------------------------------------------------

/**
 * Overtime starts "after the last player's 7th turn" (guide p3) — i.e. once
 * BOTH players have completed 7 turns, which under this file's turn numbering
 * is `turnNumber >= 8`. See docs/rulings.md for the majority interpretation.
 */
export function isOvertime(state: GameState): boolean {
  return state.turnNumber > OVERTIME_AFTER_TURNS
}

/**
 * Sudden death: in overtime, the moment one player holds strictly more gig
 * dice than the other, they win. Called after every applied action.
 */
export function checkOvertimeWin(draft: GameState): void {
  if (draft.winner !== null) return
  if (!isOvertime(draft)) return
  const mine = draft.players[0].gigArea.length
  const theirs = draft.players[1].gigArea.length
  if (mine === theirs) return
  endGame(draft, mine > theirs ? 0 : 1, 'overtimeMajority')
}
