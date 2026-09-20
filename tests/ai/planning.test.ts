import { REFERENCE_ARCHETYPES } from '../../src/ai/archetypes'
import { validateDeck, type DeckList } from '../../src/engine/deck'
import { describe, expect, it } from 'vitest'
import { db, fixtureWithHand, mintInto, setGigs, startedGame } from '../cards/fixtures'
import openingDeckJson from '../../data/decks/arasaka-embracing-power.json'
import { actingPlayer } from '../../src/engine/query'
import { newGame, draftState } from '../../src/engine/game'
import { sampleHiddenState } from '../../src/ai/belief'
import { createPlanningAgent, rolloutPlanningLine } from '../../src/ai/planner'
import { createHeuristicAgent } from '../../src/ai/heuristic'
import { createAgent } from '../../src/ai/agents'
import { legalActions } from '../../src/engine/legal'
import { applyAction } from '../../src/engine/reduce'
import type { Action } from '../../src/engine/types'
import judyDeck from './fixtures/bbg-judy-user.json'
import starterDeck from '../../data/decks/embracing-power-starter.json'
import wipePrefix from './fixtures/judy-wipe-actions.json'

describe('planning knowledge', () => {
  it('sells alternative removal to fund Towerfall instead of spending the wipe as income', () => {
    // Captured legal decisions from a losing game, independent of current AI
    // choices. Both Legends and the opponent's hidden cards remain unknown.
    let state = newGame(db, { decks: [judyDeck, starterDeck] as unknown as [DeckList, DeckList], seed: 52001 })
    for (const action of wipePrefix as Action[]) state = applyAction(db, state, action)
    expect(state.players[1].field).toHaveLength(3)
    const agent = createPlanningAgent(123)
    const sale = agent.chooseAction(db, state, legalActions(db, state))
    expect(sale.type).toBe('sellCard')
    if (sale.type !== 'sellCard') throw new Error('Expected a setup sale')
    expect(state.cards[sale.card].defId).toBe('les-e-le-mens')
    state = applyAction(db, state, sale)
    const wipe = agent.chooseAction(db, state, legalActions(db, state))
    expect(wipe.type).toBe('playCard')
    if (wipe.type !== 'playCard') throw new Error('Expected the funded board wipe')
    expect(state.cards[wipe.card].defId).toBe('towerfall')
    state = applyAction(db, state, wipe)
    expect(state.players[1].field).toHaveLength(0)
  })
  it('conditions reference archetypes on public cards without consulting hidden identities', () => {
    const deck = REFERENCE_ARCHETYPES.find(deck => deck.name === 'BBG Judy')!
    const state = newGame(db, { decks: [deck, deck], seed: 42 })
    const other = draftState(state)
    other.players[1].deck.reverse()
    other.players[1].hand.reverse()
    other.rng = 999
    for (const uid of [...other.players[1].deck, ...other.players[1].hand, ...other.players[1].eddies]) other.cards[uid].defId = 'towerfall'
    for (const uid of other.players[1].legends) other.cards[uid].defId = 'judy-a-lvarez-braindance-maestro'
    let matches = 0
    for (let seed = 1; seed <= 20; seed++) {
      const sample = sampleHiddenState(db, state, 0, seed, [deck])
      expect(sampleHiddenState(db, other, 0, seed, [deck])).toEqual(sample)
      const counts: Record<string, number> = {}
      for (const uid of [...sample.players[1].deck, ...sample.players[1].hand]) {
        const id = sample.cards[uid].defId
        counts[id] = (counts[id] ?? 0) + 1
      }
      if (Object.entries(deck.cards).every(([id, count]) => counts[id] === count)) matches++
    }
    expect(matches).toBeGreaterThan(0)
    expect(matches).toBeLessThan(20)
    const uid = state.players[1].deck.pop()!
    state.cards[uid].defId = 'animals-wrecker'
    state.players[1].field.push(uid)
    expect(sampleHiddenState(db, state, 0, 42, [deck])).toEqual(sampleHiddenState(db, state, 0, 42))
  })

  it('compares both play-order choices after both players have played two turns', () => {
    const deck = openingDeckJson as unknown as DeckList
    const state = newGame(db, { decks: [deck, deck], seed: 42 })
    const sample = sampleHiddenState(db, state, actingPlayer(state), 42)
    for (const goFirst of [true, false]) {
      const next = rolloutPlanningLine(db, sample, { type: 'choosePlayOrder', goFirst }, 42, { left: 30_000 })
      expect(next.phase).not.toBe('gameOver')
      expect(next.turnNumber).toBe(3)
      expect(next.activePlayer).toBe(next.firstPlayer)
    }
    const progress: unknown[] = []
    const options = { samples: 2, transitions: 30_000, searchOpening: true }
    const offered = legalActions(db, state)
    const plain = createPlanningAgent(17, options).chooseAction(db, state, offered)
    const observed = createPlanningAgent(17, { ...options, onProgress: action => progress.push(action) }).chooseAction(db, state, offered)
    expect(observed).toEqual(plain)
    expect(progress.length).toBeGreaterThan(1)
    for (const action of progress) expect(offered).toContainEqual(action)
  })

  it('samples unique Legends and main cards that fit their RAM limits and copy limits', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const sample = sampleHiddenState(db, startedGame(0), 0, seed)
      const rival = sample.players[1]
      const cards: Record<string, number> = {}
      for (const uid of [...rival.deck, ...rival.hand, ...rival.eddies, ...rival.field, ...rival.trash]) {
        const id = sample.cards[uid].defId
        cards[id] = (cards[id] ?? 0) + 1
      }
      const deck: DeckList = { name: 'Hypothesis', demo: true, cards,
        legends: rival.legends.map(uid => sample.cards[uid].defId) as [string, string, string] }
      expect(validateDeck(db, deck)).toEqual([])
    }
  })

  it('ends a passing line at our next turn, without granting pass an extra turn', () => {
    const state = startedGame(0)
    const sample = sampleHiddenState(db, state, 0, 42)
    const next = rolloutPlanningLine(db, sample, { type: 'endTurn' }, 42, { left: 20_000 })
    expect(next.phase).not.toBe('gameOver')
    expect(next.activePlayer).toBe(0)
    expect(next.turnNumber).toBe(2)
  })

  it('retains a legal tactical move when the search budget cannot complete a comparison', () => {
    const { state } = fixtureWithHand(0, ['pyramid-song'])
    const offered = legalActions(db, state)
    const stats: { transitions: number; samples: number }[] = []
    const actual = createPlanningAgent(42, { transitions: 0, onDecision: value => stats.push(value) }).chooseAction(db, state, offered)
    expect(actual).toEqual(createHeuristicAgent(42).chooseAction(db, state, offered))
    expect(stats).toEqual([{ transitions: 0, samples: 0 }])
  })

  it('keeps legacy Heuristic identical to Medium', () => {
    const { state } = fixtureWithHand(0, ['pyramid-song'])
    const offered = legalActions(db, state)
    expect(createAgent('heuristic', 17).chooseAction(db, state, offered))
      .toEqual(createAgent('medium', 17).chooseAction(db, state, offered))
  })

  it('uses the same hypotheses after unseen identities, positions, and future RNG change', () => {
    const { state } = fixtureWithHand(0, ['pyramid-song'])
    const other = draftState(state)
    other.players[0].deck.reverse()
    other.players[1].deck.reverse()
    other.players[1].hand.reverse()
    for (const uid of [...other.players[1].deck, ...other.players[1].hand, ...other.players[1].eddies]) other.cards[uid].defId = 'towerfall'
    for (const uid of other.players[1].legends) if (!other.cards[uid].faceUp) other.cards[uid].defId = 'judy-a-lvarez-braindance-maestro'
    other.rng = 999999
    const before = structuredClone(state)
    expect(sampleHiddenState(db, other, 0, 42)).toEqual(sampleHiddenState(db, state, 0, 42))
    expect(state).toEqual(before)
  })

  it('chooses the same move after hidden state and the real RNG are replaced', () => {
    const { state } = fixtureWithHand(0, ['peace-offering'])
    const other = draftState(state)
    other.players[0].deck.reverse()
    other.players[1].deck.reverse()
    other.rng = 1234567
    for (const uid of [...other.players[1].deck, ...other.players[1].hand]) other.cards[uid].defId = 'towerfall'
    const samples: number[] = []
    const options = { samples: 2, candidates: 3, transitions: 20_000, onDecision: (stats: { samples: number }) => samples.push(stats.samples) }
    const a = createPlanningAgent(42, options).chooseAction(db, state, legalActions(db, state))
    const b = createPlanningAgent(42, options).chooseAction(db, other, legalActions(db, other))
    expect(a).toEqual(b)
    expect(samples).toEqual([2, 2])
  })

  it('retains known cards and known deck positions while varying unknown futures', () => {
    const { state } = fixtureWithHand(0, ['memory-relapse'])
    const uid = state.players[0].deck[1]
    state.cards[uid].knownTo = [0]
    const sample = sampleHiddenState(db, state, 0, 27)
    expect(sample.players[0].deck[1]).toBe(uid)
    expect(sample.cards[uid].defId).toBe(state.cards[uid].defId)
    expect(sample.players[0].hand).toEqual(state.players[0].hand)
    for (const card of state.players[0].hand) expect(sample.cards[card]).toEqual(state.cards[card])
    expect(sampleHiddenState(db,state,0,28)).not.toEqual(sample)
  })

  it('selects a legal, deterministic winning attack without mutating the game', () => {
    const { state } = fixtureWithHand(0, [])
    state.turnNumber = 8
    state.overtime = true
    state.players[0].calledLegendThisTurn = true
    setGigs(state, 0, [4,6,8,10,12,20].map(size => ({ size: size as 4|6|8|10|12|20, value: 1 })))
    setGigs(state, 1, [{ size: 4, value: 1 }])
    const attacker = mintInto(state, 0, 'field', 'animals-wrecker')
    const snapshot = structuredClone(state)
    const offered = legalActions(db,state)
    const a = createPlanningAgent(3, { candidates: 4, samples: 2, rolloutActions: 30 }).chooseAction(db,state,offered)
    const b = createPlanningAgent(3, { candidates: 4, samples: 2, rolloutActions: 30 }).chooseAction(db,state,offered)
    expect(a).toEqual(b)
    expect(a).toEqual({ type: 'attack', attacker, target: 'gigArea' })
    expect(state).toEqual(snapshot)
  })
})
