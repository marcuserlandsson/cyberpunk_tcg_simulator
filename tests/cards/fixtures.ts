// Shared fixtures for the per-colour card suites (tests/cards/*.test.ts).
//
// Every card test drives the REAL card definitions from `data/cards.json`
// through the REAL public engine API — `newGame` / `legalActions` /
// `applyAction`. These helpers only exist to reach an interesting board
// position quickly; they never re-implement a rule.
//
// State surgery is confined to the four things the public API cannot reach
// (each marked `[surgery]` below), because there is no legal action that puts a
// chosen card in your hand or a chosen value on a die:
//   1. putting specific cards in a player's hand,
//   2. minting face-down €$ so a card is affordable,
//   3. setting Gig-die sizes/values (street cred, "8+ value" conditions),
//   4. moving a card straight onto the field / legends zone.
// Everything else — playing, attacking, blocking, ending turns, choosing dice —
// goes through `applyAction`, so the assertions are about the engine, not about
// the fixture.
//
// Not a *.test.ts file, so vitest does not collect it as a suite.

import { loadCardDb } from '../../src/engine/cardDb'
import type { DeckList } from '../../src/engine/deck'
import { newGame } from '../../src/engine/game'
import { legalActions } from '../../src/engine/legal'
import { applyAction } from '../../src/engine/reduce'
import { draftState } from '../../src/engine/game'
import type {
  Action,
  CardDb,
  CardInstance,
  DieSize,
  GameState,
  PlayerId,
} from '../../src/engine/types'
import arasakaDeck from '../../data/decks/arasaka-embracing-power.json'
import mercsDeck from '../../data/decks/mercs-the-heist.json'

export const db: CardDb = loadCardDb()

const decks: [DeckList, DeckList] = [
  arasakaDeck as unknown as DeckList,
  mercsDeck as unknown as DeckList,
]

/** A vanilla card with no rules text, used as an inert face-down €$ token. */
const EDDIE_DEF = 'animals-wrecker'

/** How many face-down €$ a fixture hands the player unless told otherwise. */
const DEFAULT_EDDIES = 12

export interface Fixture {
  db: CardDb
  state: GameState
}

// ---------------------------------------------------------------------------
// Reaching the main phase (public API only)
// ---------------------------------------------------------------------------

/** Applies the one legal action of `type`, or throws with the legal list. */
function applyOfType(db: CardDb, state: GameState, type: Action['type']): GameState {
  const actions = legalActions(db, state)
  const action = actions.find((candidate) => candidate.type === type)
  if (action === undefined) {
    throw new Error(
      `No legal "${type}" action in phase "${state.phase}" (legal: ${JSON.stringify(actions)}).`
    )
  }
  return applyAction(db, state, action)
}

/**
 * newGame -> `player` goes first -> both keep -> the opening Gig die is taken,
 * so the returned state is `player`'s `main` phase on turn 1.
 */
export function startedGame(player: PlayerId, seed = 1): GameState {
  let state = newGame(db, { decks, seed })
  // The roll winner decides; steer the decision so `player` ends up first.
  const goFirst = state.activePlayer === player
  state = applyAction(db, state, { type: 'choosePlayOrder', goFirst })
  state = applyOfType(db, state, 'keepHand')
  state = applyOfType(db, state, 'keepHand')
  if (state.phase === 'start') state = applyOfType(db, state, 'chooseGigDie')
  if (state.activePlayer !== player || state.phase !== 'main') {
    throw new Error(`startedGame could not reach player ${player}'s main phase.`)
  }
  return state
}

// ---------------------------------------------------------------------------
// Surgery primitives
// ---------------------------------------------------------------------------

function instance(state: GameState, defId: string, owner: PlayerId): CardInstance {
  const uid = state.nextUid++
  const card: CardInstance = {
    uid,
    defId,
    owner,
    ready: true,
    lag: false,
    faceUp: true,
    attachedGear: [],
    tempPower: 0,
    permPower: 0,
    tempKeywords: [],
  }
  state.cards[uid] = card
  return card
}

/**
 * [surgery] Mints a fresh instance of `defId` into a zone of a *copied* state.
 * Returns the new uid. `hand`/`field`/`legends`/`eddies`/`deck` only.
 */
export function mintInto(
  state: GameState,
  player: PlayerId,
  zone: 'deck' | 'hand' | 'field' | 'legends' | 'eddies' | 'trash',
  defId: string,
  opts: { ready?: boolean; lag?: boolean; faceUp?: boolean } = {}
): number {
  if (db[defId] === undefined) throw new Error(`Unknown card id "${defId}".`)
  const card = instance(state, defId, player)
  if (opts.ready !== undefined) card.ready = opts.ready
  if (opts.lag !== undefined) card.lag = opts.lag
  if (opts.faceUp !== undefined) card.faceUp = opts.faceUp
  state.players[player][zone].push(card.uid)
  return card.uid
}

/**
 * The heart of every card test: `player`'s main phase, with exactly `defIds` in
 * their hand (in order) and enough face-down €$ to pay for all of them.
 *
 * [surgery] The cards the opening draw dealt are tucked under the deck rather
 * than trashed, so deck-size and draw effects stay meaningful.
 */
export function fixtureWithHand(
  player: PlayerId,
  defIds: string[],
  opts: { eddies?: number; seed?: number } = {}
): Fixture {
  const state = draftState(startedGame(player, opts.seed ?? 1))
  const p = state.players[player]
  p.deck = [...p.deck, ...p.hand]
  p.hand = []
  for (const defId of defIds) mintInto(state, player, 'hand', defId)
  for (let i = 0; i < (opts.eddies ?? DEFAULT_EDDIES); i++) {
    mintInto(state, player, 'eddies', EDDIE_DEF, { faceUp: false })
  }
  return { db, state }
}

/** [surgery] Puts a card of `defId` straight onto `player`'s field, ready. */
export function fieldCard(
  state: GameState,
  player: PlayerId,
  defId: string,
  opts: { ready?: boolean; lag?: boolean } = {}
): number {
  return mintInto(state, player, 'field', defId, { ready: opts.ready ?? true, lag: opts.lag })
}

/** [surgery] Replaces a player's Gig area with dice of the given sizes/values. */
export function setGigs(
  state: GameState,
  player: PlayerId,
  dice: { size: DieSize; value: number }[]
): void {
  state.players[player].gigArea = dice.map((die) => ({ ...die }))
}

/**
 * [surgery] Forces `player`'s street cred to exactly `value` — a single d20 Gig
 * die showing it (0 clears the Gig area). Returns a new state; the input is
 * untouched.
 */
export function forceStreetCred(state: GameState, player: PlayerId, value: number): GameState {
  const next = draftState(state)
  next.players[player].gigArea = value <= 0 ? [] : [{ size: 20, value }]
  return next
}

// ---------------------------------------------------------------------------
// Driving the engine
// ---------------------------------------------------------------------------

/** The first uid of `defId` in `zone`, or throw. */
function uidIn(
  state: GameState,
  player: PlayerId,
  zone: 'hand' | 'field' | 'legends' | 'trash',
  defId: string
): number {
  const uid = state.players[player][zone].find((candidate) => state.cards[candidate].defId === defId)
  if (uid === undefined) {
    throw new Error(`No "${defId}" in player ${player}'s ${zone}.`)
  }
  return uid
}

/** The uid of the fielded copy of `defId` (the card a test wants to inspect). */
export function findFielded(state: GameState, player: PlayerId, defId: string): number {
  return uidIn(state, player, 'field', defId)
}

/** The uid of `defId` in hand — handy for building an action by hand. */
export function findInHand(state: GameState, player: PlayerId, defId: string): number {
  return uidIn(state, player, 'hand', defId)
}

export interface PlayOpts {
  /** Pick the entry whose targets are exactly these uids/indexes. */
  targets?: number[]
  /** Pick the entry that targets the fielded copy of this card id. */
  targetDef?: string
  /** Pick the nth matching entry (default: the first). */
  index?: number
}

/**
 * Plays `defId` from `player`'s hand (or their legends zone, for a {go-solo}
 * Legend) through `legalActions` + `applyAction`, so the play is legal by the
 * engine's own reckoning — targets included.
 */
export function playCardByDef(
  db: CardDb,
  state: GameState,
  player: PlayerId,
  defId: string,
  opts: PlayOpts = {}
): GameState {
  const zone = state.players[player].hand.some((uid) => state.cards[uid].defId === defId)
    ? 'hand'
    : 'legends'
  const uid = uidIn(state, player, zone, defId)
  const wanted =
    opts.targetDef === undefined ? undefined : findFielded(state, player, opts.targetDef)
  const candidates = legalActions(db, state).filter(
    (action): action is Extract<Action, { type: 'playCard' }> =>
      action.type === 'playCard' &&
      action.card === uid &&
      (opts.targets === undefined ||
        JSON.stringify(action.targets) === JSON.stringify(opts.targets)) &&
      (wanted === undefined || action.targets.includes(wanted))
  )
  const action = candidates[opts.index ?? 0]
  if (action === undefined) {
    throw new Error(
      `No legal play of "${defId}" (${JSON.stringify(opts)}) — legal plays: ` +
        JSON.stringify(
          legalActions(db, state).filter((a) => a.type === 'playCard')
        )
    )
  }
  return applyAction(db, state, action)
}

/** Activates the `abilityIndex`th EffectDef of a card in play. */
export function activate(
  db: CardDb,
  state: GameState,
  cardUid: number,
  abilityIndex: number,
  opts: { targets?: number[]; index?: number } = {}
): GameState {
  const candidates = legalActions(db, state).filter(
    (action): action is Extract<Action, { type: 'activateAbility' }> =>
      action.type === 'activateAbility' &&
      action.card === cardUid &&
      action.abilityIndex === abilityIndex &&
      (opts.targets === undefined ||
        JSON.stringify(action.targets) === JSON.stringify(opts.targets))
  )
  const action = candidates[opts.index ?? 0]
  if (action === undefined) {
    throw new Error(
      `Ability ${abilityIndex} of card ${cardUid} is not activatable — legal: ` +
        JSON.stringify(legalActions(db, state).filter((a) => a.type === 'activateAbility'))
    )
  }
  return applyAction(db, state, action)
}

/**
 * Ends the active player's turn and the rival's, taking each start-of-turn Gig
 * die as it comes, so the original player is back in their `main` phase with
 * Lag cleared and turn buffs gone.
 */
export function endBothTurnsOnce(db: CardDb, state: GameState): GameState {
  const owner = state.activePlayer
  let next = state
  for (let i = 0; i < 2; i++) {
    next = applyOfType(db, next, 'endTurn')
    if (next.phase === 'start') next = applyOfType(db, next, 'chooseGigDie')
  }
  if (next.activePlayer !== owner) {
    throw new Error(`endBothTurnsOnce did not return to player ${owner}.`)
  }
  return next
}

/** Declares an attack; the react window is left open for the defender. */
export function startAttack(
  db: CardDb,
  state: GameState,
  attackerUid: number,
  target: number | 'gigArea'
): GameState {
  return applyAction(db, state, { type: 'attack', attacker: attackerUid, target })
}

/** The defender passes, resolving the attack (fight, or the Gig-steal window). */
export function passReact(db: CardDb, state: GameState): GameState {
  return applyAction(db, state, { type: 'react', reaction: { type: 'pass' } })
}

/** The defender blocks with `blockerUid`, which resolves the attack at once. */
export function blockWith(db: CardDb, state: GameState, blockerUid: number): GameState {
  return applyAction(db, state, { type: 'react', reaction: { type: 'block', blocker: blockerUid } })
}

/** Takes the Gig die at `dieIndex` of a pending steal. */
export function chooseGig(db: CardDb, state: GameState, dieIndex: number): GameState {
  return applyAction(db, state, { type: 'chooseGig', dieIndex })
}

/** An un-blocked attack driven all the way through: declare, pass, take dice. */
export function attackAndSteal(
  db: CardDb,
  state: GameState,
  attackerUid: number,
  target: number | 'gigArea',
  dieIndexes: number[] = [0]
): GameState {
  let next = passReact(db, startAttack(db, state, attackerUid, target))
  for (const dieIndex of dieIndexes) {
    if (next.phase !== 'chooseGig') break
    next = chooseGig(db, next, dieIndex)
  }
  return next
}

/** Every legal action of one type, for assertions about what is offered. */
export function actionsOfType<T extends Action['type']>(
  db: CardDb,
  state: GameState,
  type: T
): Extract<Action, { type: T }>[] {
  return legalActions(db, state).filter(
    (action): action is Extract<Action, { type: T }> => action.type === type
  )
}

/** The Gig dice of a player as `value` numbers, for compact assertions. */
export function gigValues(state: GameState, player: PlayerId): number[] {
  return state.players[player].gigArea.map((die) => die.value)
}
