// Task 11: the AI-vs-AI simulation runner. Drives many complete games through
// the same legalActions -> agent.chooseAction -> applyAction loop the fuzz
// harness (tests/fuzz/invariants.test.ts) and the heuristic test suite
// (tests/ai/heuristic.test.ts) both use, and aggregates the results into a
// single SimResult: per-game outcomes, an overall win rate, average game
// length, and per-card play/win stats broken out per DECK (not per seat).
//
// SEAT-VS-DECK CONVENTION. `SimOptions.deckA`/`deckB` name the two decks; the
// engine itself only knows player 0/player 1 seats. Whichever seat is "player
// 0" can matter to the engine in small ways (e.g. the first-player legend
// penalty is keyed off `firstPlayer`, decided by a d20 roll that is itself
// seat-independent, but nothing rules out some future asymmetry), so a deck's
// measured win rate should not be allowed to quietly bake in a seat bias. To
// avoid that, deck A and deck B swap seats every game: deck A is seat 0 on
// EVEN game indices (0, 2, 4, ...) and seat 1 on ODD ones — see `deckASeatFor`.
// Every other output (`GameResult.winner`, `cardStatsA`/`cardStatsB`) is keyed
// by DECK, never by seat, so callers never need to know which seat played
// which deck in a given game.
//
// PER-GAME SEEDING. Game `i` (0-based) is seeded `opts.seed + i` (documented
// on `gameSeedFor`), and each game's two agents get their own rng streams
// derived from that game seed (`agentSeedsFor`) — independent of the game's
// own `state.rng`, the same separation `src/ai/random.ts` and the fuzz
// harness's `specFor` both rely on. Both derivations are pure functions of
// their inputs, so the whole run — and every individual game inside it — is
// exactly reproducible from `opts` alone.
//
// EXTENSION BEYOND THE BRIEF'S LITERAL SimResult SHAPE: `reasons`, a count of
// how each game ended (`sevenGigs`/`overtimeMajority`/`deckout`/`concede`),
// which the brief's task description asked for ("extend the brief's shape if
// needed — document") alongside the `turns`/`avgTurns` it already specified.

import { newGame } from '../engine/game'
import { legalActions } from '../engine/legal'
import { applyAction } from '../engine/reduce'
import { actingPlayer } from '../engine/query'
import { createRandomAgent, type Agent } from '../ai/random'
import { createHeuristicAgent } from '../ai/heuristic'
import type { DeckList } from '../engine/deck'
import type { CardDb, GameState, PlayerId } from '../engine/types'

export type AgentKind = 'heuristic' | 'random'

export interface SimOptions {
  deckA: DeckList
  deckB: DeckList
  games: number
  seed: number
  agentA: AgentKind
  agentB: AgentKind
}

export interface CardStat {
  defId: string
  timesPlayed: number
  gamesSeen: number
  winRateWhenPlayed: number
}

/** One completed game's outcome. `winner`/`seed` are keyed by DECK, not seat — see this file's header. */
export interface GameResult {
  winner: 0 | 1
  turns: number
  reason: string
  seed: number
}

export interface SimResult {
  games: GameResult[]
  winRateA: number
  avgTurns: number
  cardStatsA: CardStat[]
  cardStatsB: CardStat[]
  /** Extension beyond the brief's literal shape (see this file's header): how many games ended each way. */
  reasons: Record<string, number>
}

// ---------------------------------------------------------------------------
// Seeding / seat convention (pure, exported so callers and tests can
// reconstruct exactly which seat/seed a given game used without re-deriving
// the formulas by hand)
// ---------------------------------------------------------------------------

/** Which seat (PlayerId) deck A occupies in game `gameIndex` (0-based). See this file's header. */
export function deckASeatFor(gameIndex: number): PlayerId {
  return gameIndex % 2 === 0 ? 0 : 1
}

/** The game seed for game `gameIndex` (0-based) of a run seeded `seed`. */
export function gameSeedFor(seed: number, gameIndex: number): number {
  return seed + gameIndex
}

/**
 * The two agents' own rng seeds for one game, `[seatZeroSeed, seatOneSeed]`,
 * derived from the game's own seed but independent of `state.rng` (matching
 * `src/ai/random.ts`'s own header comment and the fuzz harness's `specFor`).
 */
export function agentSeedsFor(gameSeed: number): [number, number] {
  return [gameSeed * 2 + 1, gameSeed * 2 + 2]
}

function createAgent(kind: AgentKind, seed: number): Agent {
  return kind === 'random' ? createRandomAgent(seed) : createHeuristicAgent(seed)
}

// A real ceiling, not a guess: the heuristic test suite's own full-game loop
// (tests/ai/heuristic.test.ts) uses 600 for heuristic-vs-heuristic, since a
// heuristic plays out more of its hand per turn than a random agent does.
// This is a further margin over that, so a game hitting it is a genuine bug
// (an unbounded action loop), not an unlucky-but-legal long game.
const ACTION_CAP = 1000

// ---------------------------------------------------------------------------
// One game
// ---------------------------------------------------------------------------

interface CardTally {
  timesPlayed: number
  gamesSeen: number
  gamesWon: number
}

function playOneGame(
  db: CardDb,
  opts: SimOptions,
  gameIndex: number
): { state: GameState; deckASeat: PlayerId } {
  const gameSeed = gameSeedFor(opts.seed, gameIndex)
  const deckASeat = deckASeatFor(gameIndex)

  const decks: [DeckList, DeckList] =
    deckASeat === 0 ? [opts.deckA, opts.deckB] : [opts.deckB, opts.deckA]

  // Seat 0 plays deck A (and gets opts.agentA) exactly when deckASeat === 0;
  // seat 1 always plays whichever deck seat 0 doesn't.
  const [seedSeat0, seedSeat1] = agentSeedsFor(gameSeed)
  const agents: [Agent, Agent] =
    deckASeat === 0
      ? [createAgent(opts.agentA, seedSeat0), createAgent(opts.agentB, seedSeat1)]
      : [createAgent(opts.agentB, seedSeat0), createAgent(opts.agentA, seedSeat1)]

  let state: GameState = newGame(db, { decks, seed: gameSeed })
  let steps = 0
  while (state.phase !== 'gameOver') {
    steps += 1
    if (steps > ACTION_CAP) {
      throw new Error(
        `sim: game ${gameIndex} (seed ${gameSeed}) exceeded ${ACTION_CAP} actions without reaching gameOver ` +
          `(phase is currently "${state.phase}") — this indicates an unbounded action loop, not a slow game.`
      )
    }
    const actions = legalActions(db, state)
    if (actions.length === 0) {
      throw new Error(
        `sim: game ${gameIndex} (seed ${gameSeed}) hit a dead end: phase "${state.phase}" is not gameOver but legalActions is empty.`
      )
    }
    const actor = actingPlayer(state)
    const chosen = agents[actor].chooseAction(db, state, actions)
    state = applyAction(db, state, chosen)
  }

  return { state, deckASeat }
}

// ---------------------------------------------------------------------------
// runGames
// ---------------------------------------------------------------------------

export function runGames(
  db: CardDb,
  opts: SimOptions,
  onProgress?: (done: number, total: number) => void
): SimResult {
  const games: GameResult[] = []
  const reasons: Record<string, number> = {}
  const cardStatsA = new Map<string, CardTally>()
  const cardStatsB = new Map<string, CardTally>()

  for (let i = 0; i < opts.games; i++) {
    const gameSeed = gameSeedFor(opts.seed, i)
    const { state, deckASeat } = playOneGame(db, opts, i)

    const seatWinner = state.winner
    if (seatWinner === null) {
      // Unreachable: the loop above only exits once phase === 'gameOver',
      // which game.ts's endGame() only sets alongside a non-null winner.
      throw new Error(`sim: game ${i} (seed ${gameSeed}) ended without a winner.`)
    }
    const deckWinner: 0 | 1 = seatWinner === deckASeat ? 0 : 1

    const lastEvent = state.events.at(-1)
    const reason = lastEvent !== undefined && lastEvent.type === 'gameEnded' ? lastEvent.reason : 'unknown'
    reasons[reason] = (reasons[reason] ?? 0) + 1

    games.push({ winner: deckWinner, turns: state.turnNumber, reason, seed: gameSeed })

    // Per-card stats: which defIds each seat's cardPlayed events named this
    // game, attributed to whichever DECK that seat was playing.
    const playedThisGame: [Set<string>, Set<string>] = [new Set(), new Set()]
    for (const event of state.events) {
      if (event.type !== 'cardPlayed') continue
      const seat = event.player
      const defId = state.cards[event.uid].defId
      playedThisGame[seat].add(defId)
      const statsMap = seat === deckASeat ? cardStatsA : cardStatsB
      const entry = statsMap.get(defId) ?? { timesPlayed: 0, gamesSeen: 0, gamesWon: 0 }
      entry.timesPlayed += 1
      statsMap.set(defId, entry)
    }

    for (const seat of [0, 1] as const) {
      const isDeckA = seat === deckASeat
      const statsMap = isDeckA ? cardStatsA : cardStatsB
      const deckWonThisGame = isDeckA ? deckWinner === 0 : deckWinner === 1
      for (const defId of playedThisGame[seat]) {
        const entry = statsMap.get(defId)
        if (entry === undefined) continue // unreachable: timesPlayed was just incremented above
        entry.gamesSeen += 1
        if (deckWonThisGame) entry.gamesWon += 1
      }
    }

    onProgress?.(i + 1, opts.games)
  }

  const winsA = games.filter((g) => g.winner === 0).length
  const winRateA = opts.games === 0 ? 0 : winsA / opts.games
  const avgTurns = opts.games === 0 ? 0 : games.reduce((sum, g) => sum + g.turns, 0) / opts.games

  const toCardStats = (map: Map<string, CardTally>): CardStat[] =>
    Array.from(map.entries()).map(([defId, tally]) => ({
      defId,
      timesPlayed: tally.timesPlayed,
      gamesSeen: tally.gamesSeen,
      winRateWhenPlayed: tally.gamesSeen === 0 ? 0 : tally.gamesWon / tally.gamesSeen,
    }))

  return {
    games,
    winRateA,
    avgTurns,
    cardStatsA: toCardStats(cardStatsA),
    cardStatsB: toCardStats(cardStatsB),
    reasons,
  }
}

// ---------------------------------------------------------------------------
// toCsv
// ---------------------------------------------------------------------------

/**
 * `result.games` as CSV: a header row, then one row per game — game index,
 * seed, winner (deck index, 0 or 1), turns, end reason. No trailing newline.
 */
export function toCsv(result: SimResult): string {
  const header = 'game,seed,winner,turns,reason'
  const rows = result.games.map((g, i) => `${i},${g.seed},${g.winner},${g.turns},${g.reason}`)
  return [header, ...rows].join('\n')
}
