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
// Overtime is tracked independently: CR 1.11 uses consecutive empty-fixer
// starts, which card effects can move earlier or later than the usual round 8.

import { createRng, rollDie, shuffle, type RngState } from './rng'
import type { DeckList } from './deck'
import { opponentOf } from './query'
import { stopAtHiddenInformation } from './preview'
import type {
  CardDb,
  CardInstance,
  DieSize,
  GameEvent,
  GameState,
  GigDie,
  PendingSteal,
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

// ---------------------------------------------------------------------------
// newGame
// ---------------------------------------------------------------------------

interface Built {
  cards: Record<number, CardInstance>
  nextUid: number
}

function makeInstance(uid: number, defId: string, owner: PlayerId, faceUp: boolean): CardInstance {
  return {
    uid,
    defId,
    owner,
    ready: true,
    lag: false,
    faceUp,
    attachedGear: [],
    tempPower: 0,
    permPower: 0,
    tempKeywords: [],
  }
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
  for (const deck of config.decks) for (const id of [...deck.legends, ...Object.keys(deck.cards)]) {
    if (db[id]?.implementation === 'pending') throw new Error(`Card "${id}" is awaiting simulator implementation.`)
  }
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
      removed: [],
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
    emptyFixerStarts: 0,
    overtime: false,
    players: [players[0], players[1]],
    cards: built.cards,
    nextUid: built.nextUid,
    turnNumber: 0,
    activePlayer: rollWinner,
    firstPlayer: rollWinner,
    phase: 'chooseOrder',
    pendingAttack: null,
    pendingSteal: null,
    oncePerTurnUsed: [],
    floatingEffects: [],
    pendingGigRoll: null,
    pendingIntercept: null,
    interceptAnswers: [],
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
    removed: player.removed.slice(),
    gigArea: player.gigArea.map((die) => ({ ...die })),
    fixer: player.fixer.map((die) => ({ ...die })),
  }
}

/**
 * A pending steal and every steal queued behind it. The queue must be copied
 * too, or a reducer's `queue.shift()` would reach back into the caller's state.
 */
function clonePendingSteal(steal: PendingSteal | null): PendingSteal | null {
  if (steal === null) return null
  const copy: PendingSteal = { ...steal }
  if (steal.selected) copy.selected = [...steal.selected]
  if (steal.queue !== undefined) copy.queue = steal.queue.map((queued) => ({ ...queued }))
  return copy
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
    cards[uid] = {
      ...card,
      attachedGear: card.attachedGear.slice(),
      tempKeywords: card.tempKeywords.slice(),
      ...(card.knownTo ? { knownTo: [...card.knownTo] } : {}),
    }
  }
  return {
    ...state,
    players: [clonePlayer(state.players[0]), clonePlayer(state.players[1])],
    cards,
    ...(state.lastKnownCards ? { lastKnownCards: structuredClone(state.lastKnownCards) } : {}),
    ...(state.pendingFight ? { pendingFight: { ...state.pendingFight } } : {}),
    ...(state.effectQueue ? { effectQueue: structuredClone(state.effectQueue) } : {}),
    pendingAttack: state.pendingAttack ? { ...state.pendingAttack } : null,
    pendingSteal: clonePendingSteal(state.pendingSteal),
    oncePerTurnUsed: state.oncePerTurnUsed.slice(),
    // Floating entries are mutable (`defeatIfActed.acted`) and are removed
    // one at a time by whoever consumes them, so each entry is copied, not
    // shared (docs/rulings.md §141).
    floatingEffects: state.floatingEffects.map((entry) => ({ ...entry })),
    pendingGigRoll: state.pendingGigRoll ? { ...state.pendingGigRoll } : null,
    pendingIntercept:
      state.pendingIntercept === null
        ? null
        : {
            ...state.pendingIntercept,
            options: state.pendingIntercept.options.slice(),
            answers: state.pendingIntercept.answers.slice(),
          },
    interceptAnswers: state.interceptAnswers.slice(),
    events: state.events.slice(),
  }
}

// ---------------------------------------------------------------------------
// Shared mutations on a draft
// ---------------------------------------------------------------------------

/** A drawn game is terminal even though neither player is its winner. */
export function stillLive(state: GameState): boolean {
  return state.winner === null && state.phase !== 'gameOver'
}

/**
 * Idempotent by construction: a second call (e.g. a scripted card's own
 * post-`defeatGear`/`defeatUnit` deckout check re-running after that call's
 * OWN chained trigger already ended the game) is a silent no-op rather than
 * overwriting `winner`/`reason` or pushing a second `gameEnded` event. This
 * is the single root choke point every ending (`sevenGigs`, `deckout`,
 * `overtimeMajority`, `concede`) funnels through, so guarding it here is the
 * one change that makes every OTHER "did this already end the game?" check
 * in the engine a belt-and-suspenders nice-to-have rather than a
 * correctness requirement (docs/rulings.md §147 — Task 9 fuzz harness, fix
 * round 2).
 */
export function endGame(
  draft: GameState,
  winner: PlayerId | null,
  reason: Extract<GameEvent, { type: 'gameEnded' }>['reason']
): void {
  if (!stillLive(draft)) return
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
  // The number drawn is knowable; their identities must not affect lookahead.
  if (count > 0) stopAtHiddenInformation(draft)
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
    // "Can't ready until your next turn" (pacifica-netrunner, docs/rulings.md
    // §92 ff.) — a one-shot flag, consumed (never re-applied) the first time
    // it would otherwise block this exact ready step, the same shape as the
    // hardcoded first-player-legend penalty above but per card instance.
    if (draft.cards[uid].skipNextReady === true) {
      draft.cards[uid].skipNextReady = false
      continue
    }
    readyCardOnDraft(draft, uid)
  }
}

/**
 * Clears every card's until-end-of-turn power buff, for BOTH players, at the
 * end of the game turn (docs/rulings.md §20). "Until end of turn" on card text
 * means the ongoing *game* turn: a buff a defender grants during a react window
 * must not survive into that defender's own next turn, which is what clearing
 * `tempPower` at the owner's turn start would do. `permPower` (duration
 * 'permanent') is deliberately untouched.
 */
export function clearTurnBuffs(draft: GameState): void {
  for (const player of draft.players) player.playedProgramThisTurn = false
  for (const key of Object.keys(draft.cards)) {
    draft.cards[Number(key)].lag = false
    draft.cards[Number(key)].playedThisTurn = false
    draft.cards[Number(key)].tempPower = 0
    // Granted keywords have exactly the same lifetime as a turn power buff
    // (docs/rulings.md §43), and "the first time ... each turn" allowances
    // refresh with them (docs/rulings.md §40).
    draft.cards[Number(key)].tempKeywords = []
    // Batch 6 additions (docs/rulings.md §107 ff.): the same until-end-of-
    // game-turn lifetime as `tempPower`.
    draft.cards[Number(key)].fightPowerBonusThisTurn = 0
    draft.cards[Number(key)].stealReduction = 0
    // Batch 7 addition (docs/rulings.md §120 ff.): the same until-end-of-
    // game-turn lifetime as `tempPower` — set mid-turn by a steal, read by
    // `onEndTurn` before this clear runs (`reduce.ts`'s `endTurn` fires the
    // watcher first).
    draft.cards[Number(key)].stoleGigThisTurn = false
  }
  draft.oncePerTurnUsed = []
  // "... this turn" floating entries have exactly the same lifetime as a turn
  // power buff (docs/rulings.md §141). Their *consequences* have already run:
  // `reduce.ts`'s `endTurn` resolves the end-of-turn ones (cyberpsychosis)
  // before calling this, in the same way it fires `onEndTurn` first.
  draft.floatingEffects = draft.floatingEffects.filter((entry) => entry.expiry !== 'endOfTurn')
}

/**
 * Clears the once-per-turn flags and the lag of the player whose turn is
 * starting.
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
  // "unless you played a Program this turn" (jacked-in-voodoo-boy,
  // docs/rulings.md §120 ff.) — same own-turn-only scope as `soldThisTurn`.
  p.playedProgramThisTurn = false
  draft.players[0].calledLegendThisTurn = false
  draft.players[1].calledLegendThisTurn = false
  for (const key of Object.keys(draft.cards)) {
    const card = draft.cards[Number(key)]
    if (card.owner !== player) continue
    card.lag = false
    // `playedThisTurn` (docs/rulings.md §106 fix round 2) clears at exactly
    // the same turn boundary Lag does — it exists only to answer "entered
    // the field this turn" for a {Go Solo} Legend, which never has Lag to
    // clear in the first place.
    card.playedThisTurn = false
  }
}

/**
 * The whole automatic start-of-turn sequence. In order:
 *   0. `turnStarted` event;
 *   1. win check — 7+ gig dice in the gig area wins before anything else
 *      happens (guide p3/p4: "at the start of their turn ... before taking one
 *      from the fixer area");
 *   2. ready spent cards;
 *   3. clear per-turn flags and lag (turn buffs are cleared by `endTurn`
 *      instead — see `clearTurnBuffs` and docs/rulings.md §20);
 *   4. draw 1 (empty deck = immediate loss);
 *   5. gain a gig — needs a `chooseGigDie` decision, so the turn stops in the
 *      `start` phase; when the fixer is empty (from turn 7 on) it goes
 *      straight to `main`.
 */
export function beginTurn(draft: GameState, player: PlayerId, turnNumber: number, beforeReady?: () => void): void {
  draft.activePlayer = player
  draft.turnNumber = turnNumber
  draft.phase = 'start'
  draft.events.push({ type: 'turnStarted', player, turn: turnNumber })
  draft.emptyFixerStarts = draft.players[player].fixer.length === 0 ? (draft.emptyFixerStarts ?? 0) + 1 : 0

  if (draft.players[player].gigArea.length >= GIGS_TO_WIN) {
    endGame(draft, player, 'sevenGigs')
    return
  }

  const expiring = new Set(draft.floatingEffects.filter(
    entry => entry.expiry === 'ownerNextTurnStart' && entry.controller === player
  ))
  resetTurnState(draft, player)
  beforeReady?.()
  if (!stillLive(draft)) return
  // CR 10.23.1: existing durations end after this boundary's pending effects.
  // Preserve effects newly created by those start-of-turn resolutions.
  draft.floatingEffects = draft.floatingEffects.filter(entry => !expiring.has(entry))
  readySpentCards(draft, player, turnNumber)

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
 * CR 1.11 and 8.17: enter overtime at the end of the second consecutive turn
 * that began with an empty fixer. Once entered, overtime does not end.
 */
export function isOvertime(state: GameState): boolean {
  return state.overtime === true
}

/**
 * CR 1.11: in overtime, seven or more Gigs wins immediately.
 */
export function checkOvertimeWin(draft: GameState): void {
  if (!stillLive(draft)) return
  if (!isOvertime(draft)) return
  const mine = draft.players[0].gigArea.length
  const theirs = draft.players[1].gigArea.length
  if (mine < GIGS_TO_WIN && theirs < GIGS_TO_WIN) return
  if (mine >= GIGS_TO_WIN && theirs >= GIGS_TO_WIN) {
    endGame(draft, null, 'simultaneousWins')
    return
  }
  endGame(draft, mine >= GIGS_TO_WIN ? 0 : 1, 'overtimeSevenGigs')
}

/** Restrictions on readying apply to natural ready steps and card effects alike. */
export function readyCardOnDraft(state: GameState, uid: number): boolean {
  if (!state.cards[uid] || state.floatingEffects.some(entry => entry.kind === 'unitCantReady' && entry.unitUid === uid)) return false
  state.cards[uid].ready = true
  return true
}
