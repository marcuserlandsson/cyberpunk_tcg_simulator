// Fuzz harness: plays many random-vs-random games to completion (or an
// action cap) and, after EVERY applied action, asserts a battery of
// structural invariants no legal sequence of actions should ever be able to
// break. This is the engine's "invariant net" — it does not know the rules of
// any one card, only the shape every GameState must keep no matter which
// cards fired.
//
// Scale: `FUZZ_SEEDS` seeds total (default 300; Task 16 raises this via the
// env var without touching this file). 2/3 of the seeds play the two bundled
// starter (`demo: true`) decks against each other; the remaining 1/3 play two
// freshly-generated, `validateDeck`-legal synthetic decks (tests/fuzz/deckGenerator.ts)
// against each other, so the harness exercises card combinations the two
// curated starter decks never put on the same board.
//
// On any failure — a thrown error, or a violated invariant — the assertion
// message carries everything needed to replay the exact game: which kind of
// matchup it was, the game seed, the two agents' own rng seeds, and the full
// action history in order. Feeding those same four things back through
// `buildGame`/`applyAction` reproduces the failure deterministically, because
// nothing in this harness (or the engine) touches `Math.random`/`Date.now`.

import { describe, it, expect } from 'vitest'
import { loadCardDb } from '../../src/engine/cardDb'
import { newGame } from '../../src/engine/game'
import { legalActions } from '../../src/engine/legal'
import { applyAction } from '../../src/engine/reduce'
import { actingPlayer } from '../../src/engine/query'
import { createRandomAgent, type Agent } from '../../src/ai/random'
import type { DeckList } from '../../src/engine/deck'
import type { Action, CardDb, GameState, PlayerId } from '../../src/engine/types'
import arasakaDeck from '../../data/decks/arasaka-embracing-power.json'
import mercsDeck from '../../data/decks/mercs-the-heist.json'
import { generateDeck } from './deckGenerator'

const db: CardDb = loadCardDb()
const arasaka = arasakaDeck as unknown as DeckList
const mercs = mercsDeck as unknown as DeckList

// ---------------------------------------------------------------------------
// Scale knobs
// ---------------------------------------------------------------------------

const FUZZ_SEEDS = (() => {
  const raw = Number(process.env.FUZZ_SEEDS)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 300
})()
// 2/3 starter-deck matchups, 1/3 synthetic-deck matchups — the brief's
// 200/100 split at the default scale of 300, kept proportional so Task 16 can
// crank FUZZ_SEEDS without editing this file.
const STARTER_SEEDS = Math.round((FUZZ_SEEDS * 2) / 3)
const SYNTHETIC_SEEDS = FUZZ_SEEDS - STARTER_SEEDS

// Measured (see task-9-report.md): random-vs-random games on both deck kinds
// finish in well under 150 actions even across thousands of sampled seeds, so
// 400 leaves a wide margin while still being a real ceiling against a genuine
// stalemate bug.
const ACTION_CAP = 400
const MAX_CAP_HIT_RATE = 0.05

// ---------------------------------------------------------------------------
// Game construction
// ---------------------------------------------------------------------------

interface GameSpec {
  kind: 'starter' | 'synthetic'
  seed: number
  agentSeeds: [number, number]
}

function decksFor(spec: GameSpec): [DeckList, DeckList] {
  if (spec.kind === 'starter') return [arasaka, mercs]
  return [
    generateDeck(db, spec.seed * 10 + 1, `synthetic-A-${spec.seed}`),
    generateDeck(db, spec.seed * 10 + 2, `synthetic-B-${spec.seed}`),
  ]
}

function buildGame(spec: GameSpec): { state: GameState; agents: [Agent, Agent] } {
  const decks = decksFor(spec)
  const state = newGame(db, { decks, seed: spec.seed })
  const agents: [Agent, Agent] = [createRandomAgent(spec.agentSeeds[0]), createRandomAgent(spec.agentSeeds[1])]
  return { state, agents }
}

// ---------------------------------------------------------------------------
// Invariant checks
// ---------------------------------------------------------------------------

type ZoneName = 'deck' | 'hand' | 'field' | 'legends' | 'eddies' | 'trash' | 'removed'
const ZONE_NAMES: readonly ZoneName[] = ['deck', 'hand', 'field', 'legends', 'eddies', 'trash', 'removed']

/**
 * "Every card uid is in exactly one zone" — the 7 per-player arrays
 * enumerated in `types.ts`'s `PlayerState`, PLUS a card equipped as Gear
 * (which `playCardOnDraft`/`leaveField` never push onto `field` — it lives
 * only in its host's `attachedGear`, docs/rulings.md §8/§37). A uid must show
 * up in exactly one of those 8 places, and every key of `state.cards` must be
 * accounted for.
 */
function checkZones(state: GameState): string[] {
  const problems: string[] = []
  const location = new Map<number, string>()
  const record = (uid: number, where: string): void => {
    const prior = location.get(uid)
    if (prior !== undefined) {
      problems.push(`uid ${uid} is in both "${prior}" and "${where}"`)
      return
    }
    location.set(uid, where)
  }

  for (const player of [0, 1] as const) {
    const p = state.players[player]
    const zones: Record<ZoneName, number[]> = {
      deck: p.deck,
      hand: p.hand,
      field: p.field,
      legends: p.legends,
      eddies: p.eddies,
      trash: p.trash,
      removed: p.removed,
    }
    for (const zone of ZONE_NAMES) {
      for (const uid of zones[zone]) {
        if (state.cards[uid] === undefined) {
          problems.push(`player${player}.${zone} references unknown uid ${uid}`)
          continue
        }
        record(uid, `player${player}.${zone}`)
      }
    }
  }

  for (const key of Object.keys(state.cards)) {
    const hostUid = Number(key)
    for (const gearUid of state.cards[hostUid].attachedGear) {
      if (state.cards[gearUid] === undefined) {
        problems.push(`card ${hostUid}'s attachedGear references unknown uid ${gearUid}`)
        continue
      }
      record(gearUid, `attachedGear of ${hostUid}`)
    }
  }

  const allUids = Object.keys(state.cards).map(Number)
  for (const uid of allUids) {
    if (!location.has(uid)) problems.push(`uid ${uid} exists in state.cards but is in no zone at all`)
  }
  if (state.nextUid - 1 !== allUids.length) {
    problems.push(`nextUid is ${state.nextUid} but state.cards has ${allUids.length} entries`)
  }
  return problems
}

/** 12 dice total across all 4 dice zones; unrolled iff still in the fixer. */
function checkDice(state: GameState): string[] {
  const problems: string[] = []
  let total = 0
  for (const player of [0, 1] as const) {
    const p = state.players[player]
    total += p.fixer.length + p.gigArea.length
    for (const die of p.fixer) {
      if (die.value !== 0) problems.push(`player${player}.fixer has a d${die.size} showing ${die.value} (unrolled dice must show 0)`)
    }
    for (const die of p.gigArea) {
      if (die.value < 1 || die.value > die.size) {
        problems.push(`player${player}.gigArea has a d${die.size} showing ${die.value} (out of [1, ${die.size}])`)
      }
    }
  }
  if (total !== 12) problems.push(`total dice across both players is ${total}, expected 12`)
  return problems
}

/** These 4 "paused decision" fields must all be clear outside their own window. */
function checkPendingClearedInMainOrStart(state: GameState): string[] {
  if (state.phase !== 'main' && state.phase !== 'start') return []
  const problems: string[] = []
  if (state.pendingAttack !== null) problems.push(`phase is "${state.phase}" but pendingAttack is set`)
  if (state.pendingSteal !== null) problems.push(`phase is "${state.phase}" but pendingSteal is set`)
  if (state.pendingIntercept !== null) problems.push(`phase is "${state.phase}" but pendingIntercept is set`)
  if (state.pendingGigRoll !== null) problems.push(`phase is "${state.phase}" but pendingGigRoll is set`)
  return problems
}

const VALID_END_REASONS = new Set(['sevenGigs', 'overtimeMajority', 'deckout', 'concede'])

function checkGameOver(state: GameState): string[] {
  if (state.phase !== 'gameOver') return []
  const problems: string[] = []
  if (state.winner === null) problems.push('phase is gameOver but winner is null')
  if (legalActions(db, state).length !== 0) problems.push('phase is gameOver but legalActions is non-empty')
  const last = state.events.at(-1)
  if (last === undefined || last.type !== 'gameEnded') {
    problems.push('phase is gameOver but the last event is not gameEnded')
  } else {
    if (!VALID_END_REASONS.has(last.reason)) problems.push(`gameEnded reason "${last.reason}" is not a recognized reason`)
    if (last.winner !== state.winner) problems.push(`gameEnded.winner (${last.winner}) does not match state.winner (${state.winner})`)
  }
  return problems
}

function checkInvariants(state: GameState): string[] {
  return [
    ...checkDice(state),
    ...checkZones(state),
    ...checkPendingClearedInMainOrStart(state),
    ...checkGameOver(state),
  ]
}

/**
 * "Spent cards never in legalActions as attackers/payers" — a sanity check on
 * the ENUMERATOR itself, not just the state after applying a choice: a spent
 * card slipping into `legalActions` would let a random agent choose it and
 * only then blow up (or worse, silently succeed on a broken assumption
 * elsewhere), which would mask exactly which layer the bug is in.
 */
function checkLegalActionsSanity(state: GameState, actions: Action[]): string[] {
  const problems: string[] = []
  for (const action of actions) {
    if (action.type === 'attack' && !state.cards[action.attacker].ready) {
      problems.push(`legalActions offered an attack by spent card ${action.attacker}`)
    }
    if (action.type === 'playCard' || action.type === 'callLegend') {
      for (const uid of action.payment) {
        if (!state.cards[uid].ready) problems.push(`legalActions offered a payment using spent card ${uid}`)
      }
    }
  }
  return problems
}

// ---------------------------------------------------------------------------
// Failure repro
// ---------------------------------------------------------------------------

function formatRepro(spec: GameSpec, history: Action[]): string {
  return [
    `--- fuzz repro (paste into a scratch script alongside buildGame/checkInvariants from tests/fuzz/invariants.test.ts) ---`,
    `spec = ${JSON.stringify(spec)}`,
    `history = ${JSON.stringify(history)}`,
    `let { state } = buildGame(spec)`,
    `for (const action of history) state = applyAction(db, state, action)`,
    `--- end repro ---`,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// One game
// ---------------------------------------------------------------------------

interface RunResult {
  finalState: GameState
  history: Action[]
  hitCap: boolean
}

/**
 * Drives one random-vs-random game from `spec` to completion (or
 * `ACTION_CAP`), asserting `checkInvariants` after EVERY applied action.
 * Throws with a full repro (seed, agent seeds, action history) the moment
 * anything — a thrown engine error or a violated invariant — goes wrong.
 */
function runGame(spec: GameSpec): RunResult {
  const { state: initial, agents } = buildGame(spec)
  let state = initial
  const history: Action[] = []

  for (let i = 0; i < ACTION_CAP; i++) {
    if (state.phase === 'gameOver') break

    const actions = legalActions(db, state)
    if (actions.length === 0) {
      throw new Error(
        `Dead end: phase "${state.phase}" is not gameOver but legalActions is empty.\n${formatRepro(spec, history)}`
      )
    }

    const sanityProblems = checkLegalActionsSanity(state, actions)
    if (sanityProblems.length > 0) {
      throw new Error(
        `legalActions sanity check failed after ${history.length} action(s):\n${sanityProblems.join('\n')}\n${formatRepro(spec, history)}`
      )
    }

    const actor: PlayerId = actingPlayer(state)
    const agent = agents[actor]

    let chosen: Action
    try {
      chosen = agent.chooseAction(db, state, actions)
    } catch (err) {
      throw new Error(
        `Agent for player ${actor} threw choosing among ${actions.length} legal action(s): ${String(err)}\n` +
          formatRepro(spec, history)
      )
    }

    history.push(chosen)
    const eventsBefore = state.events.length

    let next: GameState
    try {
      next = applyAction(db, state, chosen)
    } catch (err) {
      throw new Error(
        `applyAction threw on a chosen action (this must never happen — chooseAction only sees legalActions' own output): ` +
          `${String(err)}\n${formatRepro(spec, history)}`
      )
    }

    if (next.events.length < eventsBefore) {
      throw new Error(
        `Event log shrank from ${eventsBefore} to ${next.events.length} entries after action ${JSON.stringify(chosen)}.\n` +
          formatRepro(spec, history)
      )
    }

    const problems = checkInvariants(next)
    if (problems.length > 0) {
      throw new Error(
        `Invariant violated after ${history.length} action(s):\n${problems.join('\n')}\n${formatRepro(spec, history)}`
      )
    }

    state = next
  }

  return { finalState: state, history, hitCap: state.phase !== 'gameOver' }
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

interface SweepStats {
  total: number
  capHit: number
  reasons: Record<string, number>
}

const stats: SweepStats = { total: 0, capHit: 0, reasons: {} }

function recordResult(result: RunResult): void {
  stats.total += 1
  if (result.hitCap) {
    stats.capHit += 1
    return
  }
  const last = result.finalState.events.at(-1)
  const reason = last !== undefined && last.type === 'gameEnded' ? last.reason : 'unknown'
  stats.reasons[reason] = (stats.reasons[reason] ?? 0) + 1
}

function specFor(kind: 'starter' | 'synthetic', i: number): GameSpec {
  // Distinct agent-seed streams per matchup, and distinct from the game seed
  // itself, so the agents' own randomness is never a disguised copy of the
  // game's shuffle/roll rng (docs/rulings.md-style separation of concerns —
  // see src/ai/random.ts's own header comment on why this matters).
  const seed = kind === 'starter' ? i : 500_000 + i
  return { kind, seed, agentSeeds: [seed * 2 + 1, seed * 2 + 2] }
}

describe('fuzz: random-vs-random invariant sweep', () => {
  it.each(Array.from({ length: STARTER_SEEDS }, (_, i) => i + 1))(
    'starter deck vs starter deck (seed %i) keeps every invariant',
    (i) => {
      const result = runGame(specFor('starter', i))
      recordResult(result)
      expect(result.hitCap).toBe(false)
    }
  )

  it.each(Array.from({ length: SYNTHETIC_SEEDS }, (_, i) => i + 1))(
    'synthetic deck vs synthetic deck (seed %i) keeps every invariant',
    (i) => {
      const result = runGame(specFor('synthetic', i))
      recordResult(result)
      expect(result.hitCap).toBe(false)
    }
  )

  it('fewer than 5% of games hit the action cap, and every completed game ends with a valid reason', () => {
    expect(stats.total).toBe(FUZZ_SEEDS)
    const rate = stats.total === 0 ? 0 : stats.capHit / stats.total
    // eslint-disable-next-line no-console
    console.log(
      `[fuzz] seeds=${stats.total} capHit=${stats.capHit} (${(rate * 100).toFixed(2)}%) ` +
        `reasons=${JSON.stringify(stats.reasons)}`
    )
    expect(rate).toBeLessThan(MAX_CAP_HIT_RATE)
    for (const reason of Object.keys(stats.reasons)) {
      expect(VALID_END_REASONS.has(reason)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// Determinism spot-check
// ---------------------------------------------------------------------------

describe('fuzz: determinism spot-check', () => {
  it.each(Array.from({ length: 10 }, (_, i) => i + 1))(
    'replaying starter-deck seed %i produces a deep-equal final state',
    (i) => {
      const spec = specFor('starter', 1000 + i)
      const first = runGame(spec)
      const second = runGame(spec)
      expect(second.finalState).toEqual(first.finalState)
      expect(second.history).toEqual(first.history)
    }
  )
})
