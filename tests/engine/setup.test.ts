import { describe, expect, it } from 'vitest'
import { newGame } from '../../src/engine/game'
import { legalActions } from '../../src/engine/legal'
import { applyAction, IllegalActionError } from '../../src/engine/reduce'
import { actingPlayer } from '../../src/engine/query'
import type { Action, GameState, PlayerId } from '../../src/engine/types'
import { db, decks, DECK_CARDS, freshGame, startedGame, totalDice } from './gameHelpers'

const FIXER_SIZES = [4, 6, 8, 10, 12, 20]

function other(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0
}

/** newGame -> the roll winner chooses to go first (no draws or mulligans yet). */
function afterOrder(seed = 1): GameState {
  return applyAction(db, freshGame(seed), { type: 'choosePlayOrder', goFirst: true })
}

describe('newGame', () => {
  const state = freshGame(7)

  it('starts in the chooseOrder phase with no winner', () => {
    expect(state.phase).toBe('chooseOrder')
    expect(state.winner).toBeNull()
    expect(state.turnNumber).toBe(0)
  })

  it('gives each player a shuffled deck of every non-legend card in their list', () => {
    expect(DECK_CARDS).toBe(27) // the bundled demo decks
    for (const player of [0, 1] as const) {
      expect(state.players[player].deck).toHaveLength(DECK_CARDS)
      expect(state.players[player].hand).toEqual([])
      expect(state.players[player].field).toEqual([])
      expect(state.players[player].eddies).toEqual([])
      expect(state.players[player].trash).toEqual([])
    }
    // Decks are shuffled, not in card-list order: the two players' decks are
    // distinct and at least one deck is not sorted by defId.
    const p0Ids = state.players[0].deck.map((uid) => state.cards[uid].defId)
    const sorted = [...p0Ids].sort()
    expect(p0Ids).not.toEqual(sorted)
  })

  it('gives each player 3 face-down legends', () => {
    for (const player of [0, 1] as const) {
      const legends = state.players[player].legends
      expect(legends).toHaveLength(3)
      for (const uid of legends) {
        const card = state.cards[uid]
        expect(card.faceUp).toBe(false)
        expect(card.ready).toBe(true)
        expect(db[card.defId].type).toBe('legend')
        expect(card.owner).toBe(player)
      }
    }
  })

  it('shuffles the legends into a random order (not always the deck-list order)', () => {
    const orders = new Set<string>()
    for (let seed = 0; seed < 40; seed++) {
      const s = newGame(db, { decks, seed })
      orders.add(s.players[0].legends.map((uid) => s.cards[uid].defId).join(','))
    }
    expect(orders.size).toBeGreaterThan(1)
  })

  it('fills both fixer areas with the 6 unrolled dice', () => {
    for (const player of [0, 1] as const) {
      const fixer = state.players[player].fixer
      expect(fixer.map((d) => d.size)).toEqual(FIXER_SIZES)
      expect(fixer.every((d) => d.value === 0)).toBe(true)
      expect(state.players[player].gigArea).toEqual([])
    }
    expect(totalDice(state)).toBe(12)
  })

  it('records the d20 play-order rolls in a gameStarted event', () => {
    const started = state.events.filter((e) => e.type === 'gameStarted')
    expect(started).toHaveLength(1)
    const event = started[0]
    if (event.type !== 'gameStarted') throw new Error('unreachable')
    expect(event.seed).toBe(7)
    expect(event.orderRolls).toHaveLength(2)
    for (const roll of event.orderRolls) {
      expect(roll).toBeGreaterThanOrEqual(1)
      expect(roll).toBeLessThanOrEqual(20)
    }
  })

  it('rerolls ties, so the recorded order rolls are never equal', () => {
    for (let seed = 0; seed < 300; seed++) {
      const s = newGame(db, { decks, seed })
      const event = s.events[0]
      if (event.type !== 'gameStarted') throw new Error('expected gameStarted first')
      expect(event.orderRolls[0]).not.toBe(event.orderRolls[1])
    }
  })

  it('hands the choosePlayOrder decision to the higher roller', () => {
    for (let seed = 0; seed < 50; seed++) {
      const s = newGame(db, { decks, seed })
      const event = s.events[0]
      if (event.type !== 'gameStarted') throw new Error('expected gameStarted first')
      const [r0, r1] = event.orderRolls
      expect(s.activePlayer).toBe(r0 > r1 ? 0 : 1)
      expect(actingPlayer(s)).toBe(s.activePlayer)
    }
  })

  it('offers exactly the two choosePlayOrder actions', () => {
    expect(legalActions(db, state)).toEqual([
      { type: 'choosePlayOrder', goFirst: true },
      { type: 'choosePlayOrder', goFirst: false },
    ])
  })

  it('is deterministic: the same seed produces a deep-equal state', () => {
    expect(newGame(db, { decks, seed: 12345 })).toEqual(newGame(db, { decks, seed: 12345 }))
    expect(newGame(db, { decks, seed: 12345 })).not.toEqual(newGame(db, { decks, seed: 12346 }))
  })
})

describe('choosePlayOrder', () => {
  it('lets the roll winner take the first turn', () => {
    const before = freshGame(3)
    const state = applyAction(db, before, { type: 'choosePlayOrder', goFirst: true })
    expect(state.firstPlayer).toBe(before.activePlayer)
    expect(state.events.some((e) => e.type === 'playOrderChosen')).toBe(true)
  })

  it('lets the roll winner pass the first turn to their rival', () => {
    const before = freshGame(3)
    const state = applyAction(db, before, { type: 'choosePlayOrder', goFirst: false })
    expect(state.firstPlayer).toBe(other(before.activePlayer))
  })

  it('draws 6 for both players, leaving the rest of the deck', () => {
    const state = afterOrder(3)
    for (const player of [0, 1] as const) {
      expect(state.players[player].hand).toHaveLength(6)
      expect(state.players[player].deck).toHaveLength(DECK_CARDS - 6)
    }
    expect(state.events.filter((e) => e.type === 'cardDrawn')).toHaveLength(12)
  })

  it('leaves the 6 unrolled dice and 3 face-down legends untouched', () => {
    const state = afterOrder(3)
    for (const player of [0, 1] as const) {
      expect(state.players[player].fixer).toHaveLength(6)
      expect(state.players[player].gigArea).toEqual([])
      expect(state.players[player].legends).toHaveLength(3)
      expect(state.players[player].legends.every((uid) => !state.cards[uid].faceUp)).toBe(true)
    }
    expect(totalDice(state)).toBe(12)
  })

  it("spends the first player's 2 leftmost legends only", () => {
    const state = afterOrder(3)
    const first = state.firstPlayer
    const firstLegends = state.players[first].legends
    expect(state.cards[firstLegends[0]].ready).toBe(false)
    expect(state.cards[firstLegends[1]].ready).toBe(false)
    expect(state.cards[firstLegends[2]].ready).toBe(true)
    for (const uid of state.players[other(first)].legends) {
      expect(state.cards[uid].ready).toBe(true)
    }
  })

  it('moves to the mulligan phase with the first player deciding', () => {
    const state = afterOrder(3)
    expect(state.phase).toBe('mulligan')
    expect(state.activePlayer).toBe(state.firstPlayer)
    expect(legalActions(db, state)).toEqual([{ type: 'mulligan' }, { type: 'keepHand' }])
  })

  it('cannot be taken twice', () => {
    const state = afterOrder(3)
    expect(() => applyAction(db, state, { type: 'choosePlayOrder', goFirst: true })).toThrow(
      IllegalActionError
    )
  })
})

describe('mulligan', () => {
  it('shuffles the hand back and draws 6 new cards', () => {
    const before = afterOrder(5)
    const player = before.activePlayer
    const state = applyAction(db, before, { type: 'mulligan' })
    expect(state.players[player].hand).toHaveLength(6)
    expect(state.players[player].deck).toHaveLength(DECK_CARDS - 6)
    // Every card is still accounted for, and the new hand is a different draw.
    const allBefore = [...before.players[player].deck, ...before.players[player].hand].sort()
    const allAfter = [...state.players[player].deck, ...state.players[player].hand].sort()
    expect(allAfter).toEqual(allBefore)
    expect(state.players[player].hand).not.toEqual(before.players[player].hand)
    expect(state.events.some((e) => e.type === 'mulliganTaken')).toBe(true)
  })

  it('does not touch the rival hand', () => {
    const before = afterOrder(5)
    const rival = other(before.activePlayer)
    const state = applyAction(db, before, { type: 'mulligan' })
    expect(state.players[rival].hand).toEqual(before.players[rival].hand)
    expect(state.players[rival].deck).toEqual(before.players[rival].deck)
  })

  it('is once per player: only keepHand remains afterwards', () => {
    const state = applyAction(db, afterOrder(5), { type: 'mulligan' })
    expect(state.players[state.activePlayer].mulliganDone).toBe(true)
    expect(legalActions(db, state)).toEqual([{ type: 'keepHand' }])
    expect(() => applyAction(db, state, { type: 'mulligan' })).toThrow(IllegalActionError)
  })

  it('is still available to the rival after the first player mulligans and keeps', () => {
    let state = applyAction(db, afterOrder(5), { type: 'mulligan' })
    state = applyAction(db, state, { type: 'keepHand' })
    expect(state.phase).toBe('mulligan')
    expect(state.activePlayer).toBe(other(state.firstPlayer))
    expect(legalActions(db, state)).toEqual([{ type: 'mulligan' }, { type: 'keepHand' }])
  })
})

describe('after both players keep', () => {
  const state = startedGame(9)

  it("begins the first player's first turn", () => {
    expect(state.activePlayer).toBe(state.firstPlayer)
    expect(state.turnNumber).toBe(1)
    expect(state.events.some((e) => e.type === 'turnStarted' && e.turn === 1)).toBe(true)
    expect(state.events.filter((e) => e.type === 'handKept')).toHaveLength(2)
  })

  it('runs the start-of-turn draw but not the gig gain (which needs a choice)', () => {
    const first = state.firstPlayer
    expect(state.players[first].hand).toHaveLength(7)
    expect(state.players[first].deck).toHaveLength(DECK_CARDS - 7)
    expect(state.players[other(first)].hand).toHaveLength(6)
    expect(state.phase).toBe('start')
    expect(state.players[first].fixer).toHaveLength(6)
    expect(state.players[first].gigArea).toEqual([])
  })

  it('is deterministic through the whole setup sequence', () => {
    expect(startedGame(4242)).toEqual(startedGame(4242))
  })

  it('logs the setup in order (draws elided)', () => {
    let s = freshGame(99)
    const first = s.activePlayer
    const second = other(first)
    s = applyAction(db, s, { type: 'choosePlayOrder', goFirst: true })
    s = applyAction(db, s, { type: 'mulligan' })
    s = applyAction(db, s, { type: 'keepHand' })
    s = applyAction(db, s, { type: 'mulligan' })
    s = applyAction(db, s, { type: 'keepHand' })
    const log = s.events.filter((e) => e.type !== 'cardDrawn').map((e) => e.type)
    expect(log).toEqual([
      'gameStarted',
      'playOrderChosen',
      'mulliganTaken',
      'handKept',
      'mulliganTaken',
      'handKept',
      'turnStarted',
    ])
    const kept = s.events.filter((e) => e.type === 'handKept')
    expect(kept).toEqual([
      { type: 'handKept', player: first },
      { type: 'handKept', player: second },
    ])
    expect(s.turnNumber).toBe(1)
    expect(s.players[0].mulliganDone).toBe(true)
    expect(s.players[1].mulliganDone).toBe(true)
  })
})

describe('applyAction contract', () => {
  it('throws IllegalActionError for actions not yet implemented in this task', () => {
    const state = startedGame(2)
    const notYet: Action[] = [
      { type: 'sellCard', card: state.players[state.activePlayer].hand[0] },
      { type: 'callLegend', payment: [] },
      { type: 'attack', attacker: 1, target: 'gigArea' },
      { type: 'chooseGig', dieIndex: 0 },
      { type: 'react', reaction: { type: 'pass' } },
    ]
    for (const action of notYet) {
      expect(() => applyAction(db, state, action)).toThrow(IllegalActionError)
    }
  })

  it('rejects a chooseGigDie for a die that is not in the fixer', () => {
    let state = startedGame(2)
    state = applyAction(db, state, { type: 'chooseGigDie', size: 4 })
    state = applyAction(db, state, { type: 'endTurn' })
    state = applyAction(db, state, { type: 'chooseGigDie', size: 4 })
    state = applyAction(db, state, { type: 'endTurn' })
    // Back to the first player, whose d4 is already gone.
    expect(() => applyAction(db, state, { type: 'chooseGigDie', size: 4 })).toThrow(
      IllegalActionError
    )
  })

  it('never mutates the state it is given', () => {
    const state = startedGame(11)
    const clone = structuredClone(state)
    applyAction(db, state, { type: 'chooseGigDie', size: 6 })
    expect(state).toEqual(clone)
  })
})
