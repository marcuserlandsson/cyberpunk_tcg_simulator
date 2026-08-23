// Task 10: the heuristic AI opponent.
//
// Five things are asserted here, in the brief's own order:
//   (a) legality  — 50 seeded heuristic-vs-heuristic games run to completion
//       with zero `IllegalActionError` and every fuzz invariant intact (the
//       SAME battery Task 9's harness uses, imported from
//       tests/fuzz/invariantChecks.ts rather than re-implemented);
//   (b) strength   — the heuristic beats `createRandomAgent` in >= 90% of 200
//       games, 100 from each seat and 50 in each (seat x who-goes-first)
//       combination, so neither the seat nor the first-player advantage can
//       flatter it;
//   (c) hidden info — cloning a mid-game state and shuffling everything the
//       AI is not allowed to see (the rival's hand order, the rival's deck
//       order, the *identities* of the rival's face-down Legends, and its own
//       deck order) never changes the action it picks;
//   (d) determinism — same seeds, same action sequence, byte-for-byte;
//   (e) tactics     — two spot-checks the one-ply argmax has to get right: an
//       overtime steal that wins on the spot, and blocking a steal that would
//       otherwise hand the rival the overtime majority;
//   (f) speed       — a full heuristic-vs-heuristic game finishes well inside
//       2s (Task 11 runs a thousand of them).

import { describe, it, expect } from 'vitest'
import { loadCardDb } from '../../src/engine/cardDb'
import { draftState, newGame } from '../../src/engine/game'
import { legalActions } from '../../src/engine/legal'
import { applyAction } from '../../src/engine/reduce'
import { actingPlayer, opponentOf } from '../../src/engine/query'
import { createRng, shuffle } from '../../src/engine/rng'
import { createRandomAgent, type Agent } from '../../src/ai/random'
import { createHeuristicAgent } from '../../src/ai/heuristic'
import { evaluate } from '../../src/ai/evaluate'
import type { DeckList } from '../../src/engine/deck'
import type { Action, CardDb, GameState, PlayerId } from '../../src/engine/types'
import arasakaDeck from '../../data/decks/arasaka-embracing-power.json'
import mercsDeck from '../../data/decks/mercs-the-heist.json'
import { checkInvariants, checkLegalActionsSanity } from '../fuzz/invariantChecks'
import { generateDeck } from '../fuzz/deckGenerator'
import { fieldCard, fixtureWithHand, setGigs } from '../cards/fixtures'

const db: CardDb = loadCardDb()
const decks: [DeckList, DeckList] = [
  arasakaDeck as unknown as DeckList,
  mercsDeck as unknown as DeckList,
]

// Generous, but a real ceiling: random-vs-random games measurably finish in
// well under 150 actions (task-9-report.md), and a heuristic that plays out
// its whole hand every turn takes more actions per turn, not more turns.
const ACTION_CAP = 600

// ---------------------------------------------------------------------------
// Match driver
// ---------------------------------------------------------------------------

interface MatchOptions {
  /** Forced answer to `choosePlayOrder`, so first-player advantage can be balanced. */
  firstPlayer?: PlayerId
  /** Defaults to the two bundled starter decks. */
  decks?: [DeckList, DeckList]
  /** Every phase a decision was asked in, for coverage reporting. */
  phasesSeen?: Set<string>
  /** Assert the full invariant battery after every applied action. */
  checkEveryAction?: boolean
  /** Called with the state before each decision of `observeSeat`. */
  observe?: (state: GameState, actions: Action[]) => void
  observeSeat?: PlayerId
}

interface MatchResult {
  finalState: GameState
  history: Action[]
  decisions: number
  hitCap: boolean
}

function runMatch(
  seed: number,
  agents: [Agent, Agent],
  options: MatchOptions = {}
): MatchResult {
  let state = newGame(db, { decks: options.decks ?? decks, seed })
  const history: Action[] = []
  let decisions = 0

  for (let i = 0; i < ACTION_CAP; i++) {
    if (state.phase === 'gameOver') break
    const actions = legalActions(db, state)
    expect(actions.length).toBeGreaterThan(0)
    options.phasesSeen?.add(state.phase)

    if (options.checkEveryAction === true) {
      expect(checkLegalActionsSanity(state, actions)).toEqual([])
    }

    const actor = actingPlayer(state)
    if (options.observe !== undefined && options.observeSeat === actor) {
      options.observe(state, actions)
    }

    let chosen: Action
    if (state.phase === 'chooseOrder' && options.firstPlayer !== undefined) {
      chosen = { type: 'choosePlayOrder', goFirst: state.activePlayer === options.firstPlayer }
    } else {
      chosen = agents[actor].chooseAction(db, state, actions)
      // The agent may only ever return one of the actions it was handed.
      expect(actions.some((candidate) => deepEqual(candidate, chosen))).toBe(true)
    }

    history.push(chosen)
    decisions += 1
    state = applyAction(db, state, chosen)

    if (options.checkEveryAction === true) {
      const problems = checkInvariants(db, state)
      if (problems.length > 0) {
        throw new Error(
          `Invariant violated after ${history.length} action(s) of seed ${seed}:\n` +
            `${problems.join('\n')}\nhistory = ${JSON.stringify(history)}`
        )
      }
    }
  }

  return { finalState: state, history, decisions, hitCap: state.phase !== 'gameOver' }
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// ---------------------------------------------------------------------------
// (a) Legality + invariants, heuristic vs heuristic
// ---------------------------------------------------------------------------

describe('heuristic AI: legality', () => {
  it.each(Array.from({ length: 50 }, (_, i) => i + 1))(
    'heuristic-vs-heuristic seed %i completes with no illegal action and no broken invariant',
    (seed) => {
      const result = runMatch(
        seed,
        [createHeuristicAgent(seed * 7 + 1), createHeuristicAgent(seed * 7 + 2)],
        { checkEveryAction: true }
      )
      expect(result.hitCap).toBe(false)
      expect(result.finalState.winner).not.toBeNull()
    }
  )
})

// The two bundled starter decks contain none of the cards that open the
// engine's exotic decision phases — no `intercept` (jackie-welles-mama-s-
// favorite, alt-cunningham-mother-of-daemons), no `gigReroll`
// (kerry-eurodyne-axe-attitude-audience), no forced attack (mox-inciters,
// evelyn-parker-beautiful-enigma, which can make `endTurn` illegal). Those
// phases are just more `legalActions` lists to the heuristic, but "just" is
// exactly the kind of claim that needs a test, so the legality sweep is
// repeated over freshly-generated, `validateDeck`-legal synthetic decks drawn
// from the whole 141-card pool — the same trick Task 9's fuzz harness uses.
describe('heuristic AI: legality on synthetic decks', () => {
  const phasesSeen = new Set<string>()

  it.each(Array.from({ length: 30 }, (_, i) => i + 1))(
    'heuristic-vs-heuristic on synthetic decks (seed %i) completes with no illegal action and no broken invariant',
    (seed) => {
      const synthetic: [DeckList, DeckList] = [
        generateDeck(db, seed * 10 + 1, `ai-synthetic-A-${seed}`),
        generateDeck(db, seed * 10 + 2, `ai-synthetic-B-${seed}`),
      ]
      const result = runMatch(
        600_000 + seed,
        [createHeuristicAgent(seed * 13 + 1), createHeuristicAgent(seed * 13 + 2)],
        { checkEveryAction: true, decks: synthetic, phasesSeen }
      )
      expect(result.hitCap).toBe(false)
      expect(result.finalState.winner).not.toBeNull()
    }
  )

  it('exercised the decision phases the starter decks never reach', () => {
    // eslint-disable-next-line no-console
    console.log(`[ai] synthetic-deck phases exercised: ${[...phasesSeen].sort().join(', ')}`)
    // These four are reachable in every game; the exotic ones are card-
    // dependent, so they are reported rather than required.
    for (const phase of ['chooseOrder', 'mulligan', 'start', 'main']) {
      expect(phasesSeen.has(phase)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// (b) Strength vs the random baseline
// ---------------------------------------------------------------------------

const STRENGTH_GAMES = 200
/** The brief's bar. It may only drop to 0.85, with the reason documented. */
const MIN_WIN_RATE = 0.9

describe('heuristic AI: strength vs createRandomAgent', () => {
  it(`wins at least ${MIN_WIN_RATE * 100}% of ${STRENGTH_GAMES} games (both seats, both first-player assignments)`, () => {
    let wins = 0
    const bySeat: [number, number] = [0, 0]
    const gamesPerSeat: [number, number] = [0, 0]
    let decisions = 0
    const started = Date.now()

    for (let i = 0; i < STRENGTH_GAMES; i++) {
      const heuristicSeat: PlayerId = (i % 2) as PlayerId
      const randomSeat = opponentOf(heuristicSeat)
      // 50 games in each of the four (seat x who-goes-first) combinations.
      const firstPlayer: PlayerId =
        Math.floor(i / 2) % 2 === 0 ? heuristicSeat : randomSeat
      const seed = 10_000 + i
      const agents: [Agent, Agent] = [
        heuristicSeat === 0 ? createHeuristicAgent(seed) : createRandomAgent(seed),
        heuristicSeat === 1 ? createHeuristicAgent(seed) : createRandomAgent(seed),
      ]
      const result = runMatch(seed, agents, { firstPlayer })
      expect(result.hitCap).toBe(false)
      decisions += result.decisions
      gamesPerSeat[heuristicSeat] += 1
      if (result.finalState.winner === heuristicSeat) {
        wins += 1
        bySeat[heuristicSeat] += 1
      }
    }

    const elapsed = (Date.now() - started) / 1000
    // eslint-disable-next-line no-console
    console.log(
      `[ai] heuristic vs random: ${wins}/${STRENGTH_GAMES} = ${((wins / STRENGTH_GAMES) * 100).toFixed(1)}% ` +
        `(as p0 ${bySeat[0]}/${gamesPerSeat[0]}, as p1 ${bySeat[1]}/${gamesPerSeat[1]}); ` +
        `${elapsed.toFixed(1)}s for ${STRENGTH_GAMES} games = ${(STRENGTH_GAMES / elapsed).toFixed(1)} games/s, ` +
        `${(decisions / STRENGTH_GAMES).toFixed(0)} decisions/game`
    )
    expect(wins / STRENGTH_GAMES).toBeGreaterThanOrEqual(MIN_WIN_RATE)
  })
})

// ---------------------------------------------------------------------------
// (c) Hidden-information invariance
// ---------------------------------------------------------------------------

/**
 * Everything the AI is forbidden to look at, permuted: the rival's hand order,
 * the rival's deck order, the rival's own deck's face-down Legend *identities*
 * (their `defId`s swapped around among themselves), and — a strictly stronger
 * check than the brief asks for — the perspective player's OWN deck order,
 * which is just as hidden from them as the rival's is.
 *
 * Permutations, not replacements, so every *public* fact is preserved exactly:
 * zone sizes, which cards are face-up, the dice, and (for the rival's hand) the
 * multiset of cards it holds — so even engine reads that legitimately depend on
 * the rival's hand as a SET (alt-cunningham's steal interception offering "a
 * card with cost equal to that Gig's value") behave identically. Anything the
 * AI's own scoring peeks at, though, moves.
 */
function shuffleHiddenInfo(state: GameState, perspective: PlayerId, seed: number): GameState {
  const next = draftState(state)
  const rival = opponentOf(perspective)
  let rng = createRng(seed)

  const [hand, afterHand] = shuffle(rng, next.players[rival].hand)
  next.players[rival].hand = hand
  rng = afterHand

  const [rivalDeck, afterRivalDeck] = shuffle(rng, next.players[rival].deck)
  next.players[rival].deck = rivalDeck
  rng = afterRivalDeck

  const [ownDeck, afterOwnDeck] = shuffle(rng, next.players[perspective].deck)
  next.players[perspective].deck = ownDeck
  rng = afterOwnDeck

  const faceDown = next.players[rival].legends.filter((uid) => !next.cards[uid].faceUp)
  const [permuted] = shuffle(rng, faceDown.map((uid) => next.cards[uid].defId))
  faceDown.forEach((uid, index) => {
    next.cards[uid] = { ...next.cards[uid], defId: permuted[index] }
  })

  return next
}

function harvestStates(seat: PlayerId, seeds: number[], everyNth = 3): GameState[] {
  const harvested: GameState[] = []
  for (const seed of seeds) {
    let seen = 0
    runMatch(seed, [
      seat === 0 ? createHeuristicAgent(seed) : createRandomAgent(seed),
      seat === 1 ? createHeuristicAgent(seed) : createRandomAgent(seed),
    ], {
      observeSeat: seat,
      observe: (state, actions) => {
        seen += 1
        if (seen % everyNth === 0 && actions.length > 1) harvested.push(state)
      },
    })
  }
  return harvested
}

describe('heuristic AI: hidden-information invariance', () => {
  it('picks the same action after the rival hand/deck order, rival face-down Legend identities and its own deck order are shuffled', () => {
    const seat: PlayerId = 0
    const states = harvestStates(seat, [31, 32, 33, 34, 35, 36, 37, 38, 39, 40])
    expect(states.length).toBeGreaterThan(40)

    let actuallyPerturbed = 0
    for (const [index, state] of states.entries()) {
      const shuffled = shuffleHiddenInfo(state, seat, 900 + index)
      if (
        JSON.stringify(shuffled.players[opponentOf(seat)].hand) !==
          JSON.stringify(state.players[opponentOf(seat)].hand) ||
        JSON.stringify(shuffled.players[opponentOf(seat)].deck) !==
          JSON.stringify(state.players[opponentOf(seat)].deck)
      ) {
        actuallyPerturbed += 1
      }

      const before = legalActions(db, state)
      const after = legalActions(db, shuffled)
      // The shuffle must not even change what the AI is offered — otherwise
      // "same action" would be comparing two different questions.
      expect(after).toEqual(before)

      const chosenBefore = createHeuristicAgent(4242).chooseAction(db, state, before)
      const chosenAfter = createHeuristicAgent(4242).chooseAction(db, shuffled, after)
      expect(chosenAfter).toEqual(chosenBefore)
    }
    expect(actuallyPerturbed).toBeGreaterThan(states.length / 2)
  })

  it('evaluate() scores a state and its hidden-info-shuffled clone identically', () => {
    const seat: PlayerId = 1
    const states = harvestStates(seat, [41, 42, 43])
    expect(states.length).toBeGreaterThan(15)
    for (const [index, state] of states.entries()) {
      const shuffled = shuffleHiddenInfo(state, seat, 700 + index)
      expect(evaluate(db, shuffled, seat)).toBe(evaluate(db, state, seat))
    }
  })
})

// ---------------------------------------------------------------------------
// (d) Determinism
// ---------------------------------------------------------------------------

describe('heuristic AI: determinism', () => {
  it.each([101, 102, 103, 104, 105])('seed %i replays to an identical action sequence', (seed) => {
    const first = runMatch(seed, [createHeuristicAgent(seed), createHeuristicAgent(seed + 1)])
    const second = runMatch(seed, [createHeuristicAgent(seed), createHeuristicAgent(seed + 1)])
    expect(second.history).toEqual(first.history)
    expect(second.finalState).toEqual(first.finalState)
  })

  it('two agents built from the same seed answer the same question the same way', () => {
    const state = newGame(db, { decks, seed: 5 })
    const actions = legalActions(db, state)
    const a = createHeuristicAgent(77).chooseAction(db, state, actions)
    const b = createHeuristicAgent(77).chooseAction(db, state, actions)
    expect(b).toEqual(a)
  })
})

// ---------------------------------------------------------------------------
// (e) Tactical spot-checks
// ---------------------------------------------------------------------------

/** A cleared, overtime board: `active` is in their main phase, 6 Gigs each. */
function overtimeBoard(active: PlayerId): GameState {
  const state = draftState(fixtureWithHand(active, [], { eddies: 0 }).state)
  state.turnNumber = 9
  for (const player of [0, 1] as const) {
    state.players[player].fixer = []
    setGigs(state, player, [
      { size: 4, value: 2 },
      { size: 6, value: 3 },
      { size: 8, value: 4 },
      { size: 10, value: 5 },
      { size: 12, value: 6 },
      { size: 20, value: 7 },
    ])
  }
  return state
}

describe('heuristic AI: tactical spot-checks', () => {
  it('attacks the Gig area when the steal wins the game on the spot (overtime, 6 Gigs each)', () => {
    const state = overtimeBoard(0)
    const attacker = fieldCard(state, 0, 'psycho-squad')
    // A perfectly good alternative target, so "attack the Gig area" is a real
    // choice rather than the only attack on the list.
    const decoy = fieldCard(state, 1, 'psycho-squad', { ready: false })

    const offered = legalActions(db, state)
    expect(offered).toContainEqual({ type: 'attack', attacker, target: 'gigArea' })
    expect(offered).toContainEqual({ type: 'attack', attacker, target: decoy })

    const chosen = createHeuristicAgent(1).chooseAction(db, state, offered)
    expect(chosen).toEqual({ type: 'attack', attacker, target: 'gigArea' })
  })

  it('blocks a Gig-area attack that would otherwise hand the rival the overtime majority', () => {
    const state = overtimeBoard(1)
    const attacker = fieldCard(state, 1, 'psycho-squad')
    const blocker = fieldCard(state, 0, 'secondhand-bombus')

    const attacked = applyAction(db, state, { type: 'attack', attacker, target: 'gigArea' })
    expect(attacked.phase).toBe('react')
    expect(actingPlayer(attacked)).toBe(0)

    const offered = legalActions(db, attacked)
    expect(offered).toContainEqual({ type: 'react', reaction: { type: 'block', blocker } })

    const chosen = createHeuristicAgent(2).chooseAction(db, attacked, offered)
    expect(chosen).toEqual({ type: 'react', reaction: { type: 'block', blocker } })
  })

  it('takes the highest-value die it is offered during a steal', () => {
    const state = overtimeBoard(0)
    setGigs(state, 1, [
      { size: 6, value: 2 },
      { size: 20, value: 19 },
      { size: 8, value: 5 },
    ])
    setGigs(state, 0, [{ size: 4, value: 1 }])
    // Out of overtime (so no sudden-death win short-circuits the comparison),
    // and a power-6 attacker so the steal is exactly ONE die — a power-10+ body
    // would take two and the two orders of taking them would tie by construction.
    state.turnNumber = 3
    const attacker = fieldCard(state, 0, 'psycho-squad')

    let next = applyAction(db, state, { type: 'attack', attacker, target: 'gigArea' })
    next = applyAction(db, next, { type: 'react', reaction: { type: 'pass' } })
    expect(next.phase).toBe('chooseGig')

    const offered = legalActions(db, next)
    const chosen = createHeuristicAgent(3).chooseAction(db, next, offered)
    expect(chosen).toEqual({ type: 'chooseGig', dieIndex: 1 })
  })
})

// ---------------------------------------------------------------------------
// (f) Speed sanity
// ---------------------------------------------------------------------------

describe('heuristic AI: speed', () => {
  it('plays a full heuristic-vs-heuristic game in well under 2 seconds', () => {
    const timings: number[] = []
    for (const seed of [201, 202, 203, 204, 205]) {
      const started = Date.now()
      const result = runMatch(seed, [createHeuristicAgent(seed), createHeuristicAgent(seed + 1)])
      timings.push(Date.now() - started)
      expect(result.hitCap).toBe(false)
    }
    const worst = Math.max(...timings)
    const total = timings.reduce((a, b) => a + b, 0)
    // eslint-disable-next-line no-console
    console.log(
      `[ai] heuristic-vs-heuristic: ${timings.length} games in ${total}ms ` +
        `(worst ${worst}ms, ${((timings.length * 1000) / Math.max(total, 1)).toFixed(1)} games/s)`
    )
    expect(worst).toBeLessThan(2000)
  })
})
