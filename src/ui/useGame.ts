// The Play view's game driver: one hook that owns the whole human-vs-AI loop
// so the components below it only ever render state and dispatch actions.
//
// THE HUMAN IS ALWAYS PLAYER 0. Which seat is "yours" has to be fixed
// somewhere, and fixing it here means every component can say "player 0 is the
// bottom half of the playmat" without threading a seat id around.
//
// DRIVEN BY `actingPlayer`, NOT `activePlayer`. Both players take actions
// inside a single game turn: the defender answers a `react` window during the
// attacker's turn, an effect-driven `chooseGig` belongs to the effect's
// controller either way, and a would-be-defeated interception belongs to
// whoever printed it. So "is it my turn to click" is `actingPlayer(state) === 0`
// and nothing else. The AI loop below is the mirror image: it runs whenever
// `actingPlayer` is 1, whosever turn it is.
//
// THE AI RUNS IN AN EFFECT, NOT INSIDE `act`. An effect keyed on the game state
// re-fires after every state change, which makes the loop "AI acts, state
// changes, effect re-fires, AI acts again..." until `actingPlayer` comes back
// to the human. That covers the two cases a loop inside `act` would miss: the
// AI winning the opening d20 roll (so it must act before the human has done
// anything at all), and a loaded record that resumes on an AI decision.
//
// UNDO. `undo` rewinds the record with the engine's `undoToLastDecisionOf`,
// which lands on a state where `actingPlayer` is the human by construction — so
// the AI effect simply doesn't fire, and no "don't re-act after undo" flag is
// needed.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createHeuristicAgent } from '../ai/heuristic'
import { legalActions } from '../engine/legal'
import { actingPlayer } from '../engine/query'
import { applyAction } from '../engine/reduce'
import {
  actionOwners,
  agentSeedFor,
  replay,
  undoToLastDecisionOf,
  type GameRecord,
} from '../engine/replay'
import { saveGameRecord } from './storage'
import type { DeckList } from '../engine/deck'
import type { Action, CardDb, GameEvent, GameState, PlayerId } from '../engine/types'

/** The seat the person clicking always occupies. */
export const HUMAN: PlayerId = 0
/** The seat the heuristic agent always occupies. */
export const AI: PlayerId = 1

/** How long the AI "thinks" between its own consecutive actions, by default. */
export const DEFAULT_AI_DELAY_MS = 300

export interface LogLine {
  text: string
  turn: number
}

export interface UseGameOptions {
  /** Pacing delay between AI actions, in ms. 0 in tests and in E2E runs. */
  aiDelayMs?: number
}

export interface UseGameApi {
  state: GameState | null
  record: GameRecord | null
  /** The human's legal actions right now — `[]` while the AI is deciding. */
  legal: Action[]
  /** True while the AI owns the decision (drives the "Rival is thinking" hint). */
  aiThinking: boolean
  /** True when there is a human action `undo` would strip. */
  canUndo: boolean
  /**
   * Set when `start` or (far more commonly) `load` was handed a config/record
   * the engine can no longer replay — typically a save written before a rules
   * or card-data change, which now fails partway through `replay` with an
   * `IllegalActionError`. The game in progress, if any, is left untouched:
   * this is reported rather than thrown so a stale save can never take down
   * the click handler that tried to resume it. Cleared by a subsequent
   * successful `start`/`load`, or explicitly by `clearLoadError`.
   */
  loadError: string | null
  clearLoadError: () => void
  start: (humanDeck: DeckList, aiDeck: DeckList, seed?: number) => void
  act: (action: Action) => void
  undo: () => void
  save: (name: string) => void
  load: (record: GameRecord) => void
  eventsForLog: LogLine[]
}

/**
 * The message shown for a config/record `gameFromRecord` could not replay.
 * Every such failure is, from the player's point of view, the same story —
 * the save/matchup no longer matches what the engine now enforces — so the
 * underlying error (whatever `IllegalActionError` or other exception it was)
 * is deliberately not surfaced verbatim; it is still logged to the console
 * for anyone debugging.
 */
function describeLoadFailure(error: unknown): string {
  console.error('Game could not be resumed:', error)
  return "This save predates a rules change and can't be resumed."
}

/**
 * The live game plus its record and the per-action attribution.
 *
 * `owners` is carried alongside rather than recomputed on every render:
 * `actionOwners` costs a full replay, and `canUndo` is read every frame. It is
 * appended to at exactly the two places an action is applied, and truncated by
 * `undo` to the length the engine's own rewind chose — so it can never drift
 * from what a fresh `actionOwners(db, record)` would say.
 */
interface Game {
  record: GameRecord
  state: GameState
  owners: PlayerId[]
}

function applyOne(db: CardDb, game: Game, action: Action): Game {
  return {
    record: { config: game.record.config, actions: [...game.record.actions, action] },
    state: applyAction(db, game.state, action),
    owners: [...game.owners, actingPlayer(game.state)],
  }
}

function gameFromRecord(db: CardDb, record: GameRecord): Game {
  return { record, state: replay(db, record), owners: actionOwners(db, record) }
}

/** A fresh, arbitrary seed for a game the player didn't pin one on. */
function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff)
}

export function useGame(db: CardDb, options: UseGameOptions = {}): UseGameApi {
  const aiDelayMs = options.aiDelayMs ?? DEFAULT_AI_DELAY_MS
  const [game, setGame] = useState<Game | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  // `act` must not go stale between renders, so the reducer reads `db` through
  // a ref rather than closing over it.
  const dbRef = useRef(db)
  dbRef.current = db

  const start = useCallback((humanDeck: DeckList, aiDeck: DeckList, seed?: number) => {
    try {
      const next = gameFromRecord(dbRef.current, {
        config: { decks: [humanDeck, aiDeck], seed: seed ?? randomSeed() },
        actions: [],
      })
      setGame(next)
      setLoadError(null)
    } catch (error) {
      setLoadError(describeLoadFailure(error))
    }
  }, [])

  const load = useCallback((record: GameRecord) => {
    try {
      const next = gameFromRecord(dbRef.current, record)
      setGame(next)
      setLoadError(null)
    } catch (error) {
      setLoadError(describeLoadFailure(error))
    }
  }, [])

  const clearLoadError = useCallback(() => setLoadError(null), [])

  const act = useCallback((action: Action) => {
    setGame((current) => (current === null ? current : applyOne(dbRef.current, current, action)))
  }, [])

  const undo = useCallback(() => {
    setGame((current) => {
      if (current === null) return current
      const rewound = undoToLastDecisionOf(dbRef.current, current.record, HUMAN)
      if (rewound.actions.length === current.record.actions.length) return current
      return {
        record: rewound,
        state: replay(dbRef.current, rewound),
        owners: current.owners.slice(0, rewound.actions.length),
      }
    })
  }, [])

  const save = useCallback(
    (name: string) => {
      if (game === null) return
      saveGameRecord(name, game.record)
    },
    [game]
  )

  const acting = game === null ? null : actingPlayer(game.state)
  const over = game === null || game.state.phase === 'gameOver'
  const aiThinking = game !== null && !over && acting === AI

  // --- the AI loop -------------------------------------------------------
  useEffect(() => {
    if (game === null || game.state.phase === 'gameOver') return
    if (actingPlayer(game.state) !== AI) return

    const timer = setTimeout(() => {
      setGame((current) => {
        // A stale timer (a re-render, or React's development double-mount)
        // must never get a second action in: the identity check makes the
        // update a no-op unless it is still the very state this effect saw.
        if (current !== game) return current
        const actions = legalActions(dbRef.current, current.state)
        if (actions.length === 0) return current
        const agent = createHeuristicAgent(
          agentSeedFor(current.record.config.seed, current.record.actions.length)
        )
        return applyOne(
          dbRef.current,
          current,
          agent.chooseAction(dbRef.current, current.state, actions)
        )
      })
    }, aiDelayMs)

    return () => clearTimeout(timer)
  }, [game, aiDelayMs])

  const legal = useMemo(() => {
    if (game === null || over || acting !== HUMAN) return []
    return legalActions(db, game.state)
  }, [db, game, over, acting])

  const eventsForLog = useMemo(() => {
    if (game === null) return []
    return buildLog(db, game.state)
  }, [db, game])

  const canUndo = game !== null && game.owners.includes(HUMAN)

  return {
    state: game?.state ?? null,
    record: game?.record ?? null,
    legal,
    aiThinking,
    canUndo,
    loadError,
    clearLoadError,
    start,
    act,
    undo,
    save,
    load,
    eventsForLog,
  }
}

// ---------------------------------------------------------------------------
// Log rendering
// ---------------------------------------------------------------------------

/**
 * Turns a state's whole event list into log lines, tagging each with the game
 * turn it happened on (tracked from the `turnStarted` events; the setup events
 * before the first turn are turn 0).
 */
export function buildLog(db: CardDb, state: GameState): LogLine[] {
  let turn = 0
  const lines: LogLine[] = []
  for (const event of state.events) {
    if (event.type === 'turnStarted') turn = event.turn
    lines.push({ text: describeEvent(db, state, event), turn })
  }
  return lines
}

/** "You" / "Rival" — the log is always written from the human's seat. */
function who(player: PlayerId): string {
  return player === HUMAN ? 'You' : 'Rival'
}

/** "your" / "Rival's" — possessive, lowercase-safe mid-sentence. */
function whose(player: PlayerId): string {
  return player === HUMAN ? 'your' : "Rival's"
}

/** "Your" / "Rival's" — the sentence-initial form of `whose`. */
function possessiveCap(player: PlayerId): string {
  return player === HUMAN ? 'Your' : "Rival's"
}

/**
 * A card's printed name, resolved through the instance table. Falls back to a
 * uid marker for a uid the state has never heard of, so a log line can never
 * be the thing that throws.
 */
function nameOf(db: CardDb, state: GameState, uid: number): string {
  const instance = state.cards[uid]
  if (instance === undefined) return `card #${uid}`
  return db[instance.defId]?.name ?? instance.defId
}

function ownerOf(state: GameState, uid: number): PlayerId {
  return state.cards[uid]?.owner ?? HUMAN
}

/** "Your Mantis Blades" / "Rival's Mantis Blades". */
function ownedName(db: CardDb, state: GameState, uid: number): string {
  return `${possessiveCap(ownerOf(state, uid))} ${nameOf(db, state, uid)}`
}

function dieText(size: number, value: number): string {
  return `d${size} (${value})`
}

const END_REASONS: Record<string, string> = {
  sevenGigs: '7 Gigs at the start of a turn',
  overtimeMajority: 'Gig majority in overtime',
  deckout: 'ran out of cards',
  concede: 'conceded',
}

/**
 * One human-readable line per `GameEvent`, from the human player's point of
 * view.
 *
 * HIDDEN INFORMATION. The log is shown to the human, so a rival draw names no
 * card — the rest of the vocabulary describes things that are public on a real
 * table (a played card, a face-up Legend, a trashed card, a rolled die).
 *
 * An event type this function does not know produces `[type]` rather than
 * throwing: a future engine event must degrade the log, not break the view.
 */
export function describeEvent(db: CardDb, state: GameState, event: GameEvent): string {
  switch (event.type) {
    case 'gameStarted':
      return `Game started (seed ${event.seed}). Order roll: you ${event.orderRolls[0]}, Rival ${event.orderRolls[1]}.`
    case 'playOrderChosen':
      return event.first === HUMAN ? 'You go first.' : 'Rival goes first.'
    case 'mulliganTaken':
      return event.player === HUMAN ? 'You mulliganed.' : 'Rival mulliganed.'
    case 'handKept':
      return event.player === HUMAN ? 'You kept your hand.' : 'Rival kept their hand.'
    case 'turnStarted':
      return `Turn ${event.turn}: ${whose(event.player)} turn.`
    case 'cardDrawn':
      return event.player === HUMAN
        ? `You drew ${nameOf(db, state, event.uid)}.`
        : 'Rival drew a card.'
    case 'dieRolled':
      return `${who(event.player)} rolled a d${event.size}: ${event.value}.`
    case 'cardSold':
      return `${who(event.player)} sold ${nameOf(db, state, event.uid)} for an Eddie.`
    case 'cardPlayed':
      return `${who(event.player)} played ${nameOf(db, state, event.uid)}.`
    case 'legendCalled':
      return `${who(event.player)} called ${nameOf(db, state, event.uid)}.`
    case 'attackDeclared':
      return event.target === 'gigArea'
        ? `${ownedName(db, state, event.attacker)} attacks ${whose(
            ownerOf(state, event.attacker) === HUMAN ? AI : HUMAN
          )} Gig area.`
        : `${ownedName(db, state, event.attacker)} attacks ${nameOf(db, state, event.target)}.`
    case 'attackBlocked':
      return `${ownedName(db, state, event.blocker)} blocks.`
    case 'unitDefeated':
      return `${ownedName(db, state, event.uid)} is defeated.`
    case 'gigStolen':
      return event.from === HUMAN
        ? `Rival stole your ${dieText(event.die.size, event.die.value)}.`
        : `You stole Rival's ${dieText(event.die.size, event.die.value)}.`
    case 'effectResolved':
      return `${nameOf(db, state, event.sourceUid)}: ${event.description}.`
    case 'cardTrashed':
      return `${ownedName(db, state, event.uid)} goes to the trash.`
    case 'cardBottomDecked':
      return `${ownedName(db, state, event.uid)} goes to the bottom of the deck.`
    case 'cardRemoved':
      return `${ownedName(db, state, event.uid)} is removed from the game.`
    case 'abilityActivated':
      return `${who(event.player)} activated ${nameOf(db, state, event.uid)}.`
    case 'turnEnded':
      return event.player === HUMAN ? 'You ended your turn.' : 'Rival ended their turn.'
    case 'gameEnded': {
      const reason = END_REASONS[event.reason] ?? event.reason
      return event.winner === HUMAN
        ? `Game over: you win (${reason}).`
        : `Game over: Rival wins (${reason}).`
    }
    default:
      // Not reachable for any member of the union above; kept so an event kind
      // added by a later engine change degrades to a marker instead of
      // crashing the log panel.
      return `[${(event as { type: string }).type}]`
  }
}
