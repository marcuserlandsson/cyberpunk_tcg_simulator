// Task 10: the heuristic AI opponent.
//
// Seven things are asserted here, the first six in the brief's own order:
//   (a) legality  — 50 seeded heuristic-vs-heuristic games run to completion
//       with zero `IllegalActionError` and every fuzz invariant intact (the
//       SAME battery Task 9's harness uses, imported from
//       tests/fuzz/invariantChecks.ts rather than re-implemented), plus 30 more
//       on synthetic decks so the phases the starter decks never reach
//       (`intercept`, `gigReroll`) are exercised too;
//   (b) strength   — the heuristic beats `createRandomAgent` in >= 90% of 200
//       games, 100 from each seat and 50 in each (seat x who-goes-first)
//       combination, so neither the seat nor the first-player advantage can
//       flatter it;
//   (c) hidden info — cloning a mid-game state and shuffling everything the AI
//       is not allowed to see (the rival's hand order, the rival's deck order,
//       the *identities* of the rival's face-down Legends, and its own deck
//       order) never changes the action it picks. Run over the starter decks
//       AND over synthetic decks forced to contain `discardRandomRival` cards,
//       which is the sharpest case: the engine picks the discarded card by rng
//       INDEX into the rival's hand, so the same candidate action really does
//       produce different positions in the two clones. The suite requires that
//       divergence to happen and then requires it not to matter — plus one
//       deterministic `augmented-negotiators` fixture that pins it exactly;
//   (d) determinism — same seeds, same action sequence, byte-for-byte;
//   (e) tactics     — three spot-checks the search has to get right: an
//       overtime steal that wins on the spot, blocking a steal that would
//       otherwise hand the rival the overtime majority, and taking the most
//       valuable die of a steal;
//   (f) speed       — a full heuristic-vs-heuristic game finishes well inside
//       2s (Task 11 runs a thousand of them);
//   (g) tuning      — the three configuration decisions behind the shipped
//       defaults (go second, keep quiescence, keep the tuned weights) as
//       directional regression tests, so a later change cannot silently
//       invalidate the measurements they came from.

import { describe, it, expect } from 'vitest'
import { loadCardDb } from '../../src/engine/cardDb'
import { draftState, newGame } from '../../src/engine/game'
import { legalActions } from '../../src/engine/legal'
import { applyAction } from '../../src/engine/reduce'
import { actingPlayer, opponentOf } from '../../src/engine/query'
import { createRng, shuffle } from '../../src/engine/rng'
import { createRandomAgent, type Agent } from '../../src/ai/random'
import { createHeuristicAgent } from '../../src/ai/heuristic'
import { evaluate, type EvalWeights } from '../../src/ai/evaluate'
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

/**
 * Card ids carrying `discardRandomRival` — the sharpest test of the whole
 * discipline, because the engine picks the discarded card by rng INDEX into the
 * rival's hand (`effects.ts`), so a permutation of that hand makes the same
 * candidate action produce a genuinely different position. Neither bundled
 * starter deck contains one, which is why the synthetic harvest below forces
 * them in.
 */
const RIVAL_DISCARD_CARDS = [
  'augmented-negotiators',
  'caliber-totentanz-s-top-dog',
  'maelstrom-goons',
]

function harvestStates(
  seat: PlayerId,
  seeds: number[],
  options: { everyNth?: number; decks?: [DeckList, DeckList] } = {}
): GameState[] {
  const everyNth = options.everyNth ?? 3
  const harvested: GameState[] = []
  for (const seed of seeds) {
    let seen = 0
    runMatch(seed, [
      seat === 0 ? createHeuristicAgent(seed) : createRandomAgent(seed),
      seat === 1 ? createHeuristicAgent(seed) : createRandomAgent(seed),
    ], {
      decks: options.decks,
      observeSeat: seat,
      observe: (state, actions) => {
        seen += 1
        if (seen % everyNth === 0 && actions.length > 1) harvested.push(state)
      },
    })
  }
  return harvested
}

/** Zone contents as a SET, so a mere reordering does not read as a change. */
function multiset(uids: number[]): string {
  return [...uids].sort((a, b) => a - b).join(',')
}

/**
 * Did applying the same candidate to two hidden-info-different clones actually
 * produce MATERIALLY different positions — a different card discarded, or a
 * different card drawn — rather than just the reordering we injected? This is
 * the seam docs/rulings.md §150 documents, and asserting it is non-empty is
 * what stops the invariance test from passing vacuously.
 */
function materiallyDiverged(a: GameState, b: GameState): boolean {
  for (const player of [0, 1] as const) {
    if (multiset(a.players[player].hand) !== multiset(b.players[player].hand)) return true
    if (multiset(a.players[player].trash) !== multiset(b.players[player].trash)) return true
  }
  return false
}

interface InvarianceReport {
  states: number
  /** States where at least one candidate's OUTCOME materially diverged. */
  divergentStates: number
  /** Candidate actions whose outcome materially diverged. */
  divergentCandidates: number
}

/**
 * The whole invariance property, run over a batch of harvested states:
 *
 *   1. the shuffle does not change what the AI is *offered* (otherwise "same
 *      action" would be comparing two different questions);
 *   2. `evaluate` scores the two clones identically;
 *   3. applying each candidate to both clones may produce materially different
 *      positions — hidden cards really do move — but every such pair still
 *      scores identically;
 *   4. `chooseAction` returns the identical action.
 */
function checkInvarianceOver(
  states: GameState[],
  seat: PlayerId,
  seedBase: number
): InvarianceReport {
  const report: InvarianceReport = {
    states: states.length,
    divergentStates: 0,
    divergentCandidates: 0,
  }

  for (const [index, state] of states.entries()) {
    const shuffled = shuffleHiddenInfo(state, seat, seedBase + index)

    const before = legalActions(db, state)
    const after = legalActions(db, shuffled)
    expect(after).toEqual(before)

    expect(evaluate(db, shuffled, seat)).toBe(evaluate(db, state, seat))

    let divergedHere = false
    for (const action of before) {
      const outcomeA = applyAction(db, state, action)
      const outcomeB = applyAction(db, shuffled, action)
      if (materiallyDiverged(outcomeA, outcomeB)) {
        divergedHere = true
        report.divergentCandidates += 1
      }
      // The load-bearing assertion: a candidate whose simulation consumed
      // hidden-index randomness still scores the same, because `evaluate`
      // reads hand/deck by SIZE and never reads the trash at all.
      expect(evaluate(db, outcomeB, seat)).toBe(evaluate(db, outcomeA, seat))
    }
    if (divergedHere) report.divergentStates += 1

    const chosenBefore = createHeuristicAgent(4242).chooseAction(db, state, before)
    const chosenAfter = createHeuristicAgent(4242).chooseAction(db, shuffled, after)
    expect(chosenAfter).toEqual(chosenBefore)
  }

  return report
}

describe('heuristic AI: hidden-information invariance', () => {
  it('picks the same action on the starter decks after every hidden zone is shuffled', () => {
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
    }
    // Non-vacuity: the clone really is different from the original.
    expect(actuallyPerturbed).toBeGreaterThan(states.length / 2)

    const report = checkInvarianceOver(states, seat, 900)
    // eslint-disable-next-line no-console
    console.log(
      `[ai] hidden-info (starter decks): ${report.states} states, ` +
        `${report.divergentCandidates} candidate outcome(s) materially diverged across ` +
        `${report.divergentStates} state(s) — none changed a score or the chosen action`
    )
  })

  it('picks the same action on synthetic decks that carry discardRandomRival cards', () => {
    const seat: PlayerId = 0
    const syntheticSeeds = [51, 52, 53, 54, 55, 56, 57, 58]
    let totalDiverged = 0
    let totalStates = 0

    for (const seed of syntheticSeeds) {
      // Both decks carry the discard cards, so the seam is reachable whichever
      // side is doing the blocking/dying/stealing that fires them.
      const synthetic: [DeckList, DeckList] = [
        generateDeck(db, seed * 100 + 1, `ai-discard-A-${seed}`, RIVAL_DISCARD_CARDS),
        generateDeck(db, seed * 100 + 2, `ai-discard-B-${seed}`, RIVAL_DISCARD_CARDS),
      ]
      for (const id of RIVAL_DISCARD_CARDS) {
        expect(synthetic[0].cards[id]).toBeGreaterThan(0)
        expect(synthetic[1].cards[id]).toBeGreaterThan(0)
      }
      const states = harvestStates(seat, [seed], { decks: synthetic, everyNth: 2 })
      const report = checkInvarianceOver(states, seat, 5_000 + seed * 100)
      totalStates += report.states
      totalDiverged += report.divergentCandidates
    }

    // eslint-disable-next-line no-console
    console.log(
      `[ai] hidden-info (synthetic decks with discardRandomRival): ${totalStates} states, ` +
        `${totalDiverged} candidate outcome(s) materially diverged — none changed a score or the chosen action`
    )
    expect(totalStates).toBeGreaterThan(40)
    // The empirical answer to the review's question: the seam IS live (hidden
    // cards move inside candidates the AI merely scores) and invariance holds
    // anyway. If this ever drops to 0, the test has stopped testing anything.
    expect(totalDiverged).toBeGreaterThan(0)
  })

  /**
   * The seam, pinned deterministically rather than sampled: `augmented-
   * negotiators` prints "When this Unit uses {Blocker}, a Rival discards 1", so
   * the AI's own `block` candidate is what fires `discardRandomRival`. With the
   * rival's four-card hand reversed, the rng index lands on a different uid
   * whichever position it picks, so the two clones provably discard different
   * cards.
   */
  it('scores a block that discards a DIFFERENT rival card identically in each clone', () => {
    const base = draftState(
      fixtureWithHand(
        1,
        ['psycho-squad', 'animals-wrecker', 'secondhand-bombus', 'emergency-atlus'],
        { eddies: 0 }
      ).state
    )
    const attacker = fieldCard(base, 1, 'psycho-squad')
    const blocker = fieldCard(base, 0, 'augmented-negotiators')
    // Player 0 has not had a turn yet in this fixture, so their Gig area is
    // empty and there would be nothing to attack (docs/rulings.md §24).
    setGigs(base, 0, [
      { size: 6, value: 3 },
      { size: 8, value: 5 },
      { size: 10, value: 7 },
    ])
    const attacked = applyAction(db, base, { type: 'attack', attacker, target: 'gigArea' })
    expect(actingPlayer(attacked)).toBe(0)

    // The rival's hand reversed: a 4-element reversal has no fixed point, so
    // whichever index the rng picks, it picks a different card.
    const reversed = draftState(attacked)
    reversed.players[1].hand = [...attacked.players[1].hand].reverse()
    expect(reversed.players[1].hand).not.toEqual(attacked.players[1].hand)

    const block: Action = { type: 'react', reaction: { type: 'block', blocker } }
    const offered = legalActions(db, attacked)
    expect(offered).toContainEqual(block)
    expect(legalActions(db, reversed)).toEqual(offered)

    const outcomeA = applyAction(db, attacked, block)
    const outcomeB = applyAction(db, reversed, block)
    const discardedA = outcomeA.players[1].trash.filter(
      (uid) => !attacked.players[1].trash.includes(uid)
    )
    const discardedB = outcomeB.players[1].trash.filter(
      (uid) => !reversed.players[1].trash.includes(uid)
    )
    // The seam is real: one card discarded on each side, and not the same one.
    expect(discardedA).toHaveLength(1)
    expect(discardedB).toHaveLength(1)
    expect(discardedB).not.toEqual(discardedA)

    // ... and yet the AI cannot tell the two apart.
    expect(evaluate(db, outcomeB, 0)).toBe(evaluate(db, outcomeA, 0))
    expect(
      createHeuristicAgent(9).chooseAction(db, reversed, legalActions(db, reversed))
    ).toEqual(createHeuristicAgent(9).chooseAction(db, attacked, offered))
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

// ---------------------------------------------------------------------------
// (g) Tuning regressions
// ---------------------------------------------------------------------------
//
// Two of the shipped configuration's decisions — "go second" and "quiescence is
// worth having" — were originally settled by one-off probe scripts, which means
// nothing would have noticed if a later weight change or engine fix quietly
// invalidated them. They live here instead, as small, seeded, DIRECTIONAL
// checks: they assert the sign of the comparison the decision rests on, never
// the exact percentage the probe happened to measure, so a normal shift in
// strength cannot flake them while a genuine reversal fails loudly.
//
// `createHeuristicAgent`'s `options` argument exists for exactly this: the
// alternatives are constructed from the same code path as the default, not from
// a forked copy of it.

/** The weight set the brief proposed, kept as the baseline the tuning beat. */
const BRIEF_STARTING_WEIGHTS: EvalWeights = {
  gig: 1000,
  sevenGigs: 0,
  overtimeMajority: 5_000,
  streetCred: 10,
  friendlyPower: 15,
  rivalPower: 12,
  handCard: 20,
  eddie: 0,
  readyPayer: 15,
  faceUpLegend: 25,
  deckCard: 1,
  deckoutAversion: 50,
  terminal: 1_000_000_000,
}

/**
 * `games` games between two agent configurations, alternating both the seat and
 * who moves first, so neither advantage can decide the result.
 */
function headToHead(
  games: number,
  seedBase: number,
  makeA: (seed: number) => Agent,
  makeB: (seed: number) => Agent
): { aWins: number; bWins: number } {
  let aWins = 0
  let bWins = 0
  for (let i = 0; i < games; i++) {
    const aSeat: PlayerId = (i % 2) as PlayerId
    const bSeat = opponentOf(aSeat)
    const firstPlayer: PlayerId = Math.floor(i / 2) % 2 === 0 ? aSeat : bSeat
    const seed = seedBase + i
    const agents: [Agent, Agent] = [
      aSeat === 0 ? makeA(seed) : makeB(seed),
      aSeat === 1 ? makeA(seed) : makeB(seed),
    ]
    const winner = runMatch(seed, agents, { firstPlayer }).finalState.winner
    if (winner === aSeat) aWins += 1
    else if (winner === bSeat) bWins += 1
  }
  return { aWins, bWins }
}

describe('heuristic AI: tuning regressions', () => {
  // NOTE ON EFFECT SIZE: the second-player edge is real but *small* — 218/400
  // (54.5%) over the widest sample taken, and 51.7%-56.7% across six different
  // 120-game seed ranges, directional in every one. 200 games is the smallest
  // sample that resolves it cleanly here (93 vs 107). If a future weight change
  // flips this, the right response is to re-measure at 400+ games and move the
  // policy constant, not to loosen the assertion.
  it('going second beats going first in a heuristic mirror, which is what the play-order policy encodes', () => {
    let firstWins = 0
    let secondWins = 0
    for (let i = 0; i < 200; i++) {
      const first: PlayerId = (i % 2) as PlayerId
      const seed = 70_000 + i
      const winner = runMatch(
        seed,
        [createHeuristicAgent(seed), createHeuristicAgent(seed + 5_000)],
        { firstPlayer: first }
      ).finalState.winner
      if (winner === first) firstWins += 1
      else if (winner !== null) secondWins += 1
    }
    // eslint-disable-next-line no-console
    console.log(`[ai] mirror seat preference: first ${firstWins} vs second ${secondWins} of 200`)
    expect(secondWins).toBeGreaterThan(firstWins)

    // ...and the agent's own `choosePlayOrder` answer agrees with the
    // measurement, so the policy constant cannot drift away from its evidence.
    const fresh = newGame(db, { decks, seed: 12 })
    expect(fresh.phase).toBe('chooseOrder')
    expect(createHeuristicAgent(1).chooseAction(db, fresh, legalActions(db, fresh))).toEqual({
      type: 'choosePlayOrder',
      goFirst: false,
    })
    // 200 heuristic-vs-heuristic games is ~13s, well past vitest's 5s default.
  }, 60_000)

  it('the quiescence layer is worth having: quiescence-on beats quiescence-off head to head', () => {
    const { aWins, bWins } = headToHead(
      40,
      75_000,
      (seed) => createHeuristicAgent(seed),
      (seed) => createHeuristicAgent(seed, { quiescenceSteps: 0 })
    )
    // eslint-disable-next-line no-console
    console.log(`[ai] quiescence ablation: on ${aWins} vs off ${bWins} of 40`)
    expect(aWins).toBeGreaterThan(bWins)
  })

  it('the tuned weights beat the brief\'s starting set head to head', () => {
    const { aWins, bWins } = headToHead(
      40,
      80_000,
      (seed) => createHeuristicAgent(seed),
      (seed) => createHeuristicAgent(seed, { weights: BRIEF_STARTING_WEIGHTS })
    )
    // eslint-disable-next-line no-console
    console.log(`[ai] weight tuning: tuned ${aWins} vs brief-set ${bWins} of 40`)
    expect(aWins).toBeGreaterThan(bWins)
  })

  it('quiescence is what makes the tactical spot-checks work at all', () => {
    // The same overtime board as the spot-check above: without the layer, the
    // two candidate attacks are literally indistinguishable positions, so the
    // AI can only guess. This pins WHY layer 2 exists, not just that it helps.
    const state = overtimeBoard(0)
    const attacker = fieldCard(state, 0, 'psycho-squad')
    fieldCard(state, 1, 'psycho-squad', { ready: false })
    const offered = legalActions(db, state)

    const withLayer = createHeuristicAgent(1).chooseAction(db, state, offered)
    expect(withLayer).toEqual({ type: 'attack', attacker, target: 'gigArea' })

    // Blind, the winning attack is invisible: with no window played forward,
    // `attack -> gigArea` and `attack -> the rival Unit` leave *identical*
    // scoreable positions (both merely spend the attacker and open a react
    // window), so the layer-0/1 score cannot separate them and something else
    // entirely wins the argmax. Ten different tie-break seeds, and not one of
    // them finds it.
    const blindChoices = Array.from({ length: 10 }, (_, i) =>
      createHeuristicAgent(i + 1, { quiescenceSteps: 0 }).chooseAction(db, state, offered)
    )
    for (const blind of blindChoices) {
      expect(blind).not.toEqual(withLayer)
    }
  })
})
