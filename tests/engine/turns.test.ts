import { describe, expect, it } from 'vitest'
import { legalActions } from '../../src/engine/legal'
import { applyAction, IllegalActionError } from '../../src/engine/reduce'
import { actingPlayer, effectivePower, streetCred } from '../../src/engine/query'
import type { DieSize, GameState, GigDie, PlayerId } from '../../src/engine/types'
import { db, DECK_CARDS, drive, gigDieActions, startedGame, totalDice } from './gameHelpers'

const ALL_SIZES: DieSize[] = [4, 6, 8, 10, 12, 20]

function other(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0
}

function dice(count: number, rolled: boolean): GigDie[] {
  return Array.from({ length: count }, (_, i) => {
    const size = ALL_SIZES[i % ALL_SIZES.length]
    return { size, value: rolled ? size : 0 }
  })
}

/**
 * Test-only surgery: replaces both players' dice with the given counts (a
 * stand-in for the steal/return effects that arrive in later tasks). Asserts
 * the 12-dice invariant so a bad fixture can't silently create a fake win.
 */
function withDice(
  state: GameState,
  counts: { gig: [number, number]; fixer: [number, number] }
): GameState {
  const next = structuredClone(state)
  for (const p of [0, 1] as const) {
    next.players[p].gigArea = dice(counts.gig[p], true)
    next.players[p].fixer = dice(counts.fixer[p], false)
  }
  if (totalDice(next) !== 12) throw new Error('fixture must conserve 12 dice')
  return next
}

/** Advances the skeleton game to the given player's main phase on turn `turn`. */
function atMainPhase(state: GameState, player: PlayerId, turn: number): GameState {
  return drive(
    state,
    (s) => s.phase === 'main' && s.activePlayer === player && s.turnNumber === turn
  )
}

describe('gain a gig', () => {
  it('offers every fixer die except the d20 while other dice remain', () => {
    const state = startedGame(21)
    expect(state.phase).toBe('start')
    expect(gigDieActions(legalActions(db, state))).toEqual([4, 6, 8, 10, 12])
  })

  it('offers only the d20 once it is the last die left', () => {
    const state = startedGame(21)
    const first = state.firstPlayer
    // Five turns each strips every die but the d20.
    const later = drive(
      state,
      (s) => s.activePlayer === first && s.turnNumber === 6 && s.phase === 'start'
    )
    expect(later.players[first].fixer.map((d) => d.size)).toEqual([20])
    expect(gigDieActions(legalActions(db, later))).toEqual([20])
  })

  it('rolls the chosen die into the gig area and moves to the main phase', () => {
    const before = startedGame(21)
    const player = before.activePlayer
    const state = applyAction(db, before, { type: 'chooseGigDie', size: 8 })
    expect(state.players[player].fixer.map((d) => d.size)).toEqual([4, 6, 10, 12, 20])
    expect(state.players[player].gigArea).toHaveLength(1)
    const die = state.players[player].gigArea[0]
    expect(die.size).toBe(8)
    expect(die.value).toBeGreaterThanOrEqual(1)
    expect(die.value).toBeLessThanOrEqual(8)
    expect(state.phase).toBe('main')
    const rolled = state.events.filter((e) => e.type === 'dieRolled')
    expect(rolled).toHaveLength(1)
    expect(rolled[0]).toEqual({ type: 'dieRolled', player, size: 8, value: die.value })
  })

  it('every rolled die lands within 1..size across a full skeleton game', () => {
    let state = startedGame(31)
    for (let i = 0; i < 60 && state.phase !== 'gameOver'; i++) {
      const actions = legalActions(db, state)
      if (actions.length === 0) break
      state = applyAction(db, state, actions[0])
      expect(totalDice(state)).toBe(12)
      for (const p of [0, 1] as const) {
        for (const die of state.players[p].gigArea) {
          expect(die.value).toBeGreaterThanOrEqual(1)
          expect(die.value).toBeLessThanOrEqual(die.size)
        }
      }
    }
  })

  it('skips straight to the main phase once the fixer is empty', () => {
    const state = startedGame(21)
    const first = state.firstPlayer
    const turn7 = drive(state, (s) => s.activePlayer === first && s.turnNumber === 7)
    expect(turn7.players[first].fixer).toEqual([])
    expect(turn7.players[first].gigArea).toHaveLength(6)
    expect(turn7.phase).toBe('main')
    const turn7Actions = legalActions(db, turn7)
    expect(gigDieActions(turn7Actions)).toEqual([])
    // No more gig-die choices leak into main phase; endTurn is always legal
    // there. (Since Task 5, main phase can also legally offer
    // sellCard/playCard/callLegend once affordable — exercised in
    // tests/engine/economy.test.ts, not asserted here.)
    expect(turn7Actions).toContainEqual({ type: 'endTurn' })
  })
})

describe('streetCred', () => {
  it('is 0 with an empty gig area and sums the gig dice values otherwise', () => {
    const state = startedGame(5)
    expect(streetCred(state, 0)).toBe(0)
    const withGigs = withDice(state, { gig: [3, 2], fixer: [3, 4] })
    // dice(3, true) => d4:4, d6:6, d8:8 ; dice(2, true) => d4:4, d6:6
    expect(streetCred(withGigs, 0)).toBe(18)
    expect(streetCred(withGigs, 1)).toBe(10)
  })

  it('counts a real rolled die after gaining a gig', () => {
    const before = startedGame(5)
    const player = before.activePlayer
    const state = applyAction(db, before, { type: 'chooseGigDie', size: 12 })
    expect(streetCred(state, player)).toBe(state.players[player].gigArea[0].value)
  })
})

describe('start-of-turn ready step', () => {
  it("does not ready the first player's 2 spent legends on their first turn", () => {
    let state = startedGame(13)
    const first = state.firstPlayer
    const [l0, l1, l2] = state.players[first].legends
    expect(state.cards[l0].ready).toBe(false)
    expect(state.cards[l1].ready).toBe(false)
    expect(state.cards[l2].ready).toBe(true)

    // Rival's turn 1: still spent.
    state = applyAction(db, state, { type: 'chooseGigDie', size: 4 })
    state = applyAction(db, state, { type: 'endTurn' })
    expect(state.activePlayer).toBe(other(first))
    expect(state.cards[l0].ready).toBe(false)
    expect(state.cards[l1].ready).toBe(false)
  })

  it("readies those legends on the first player's second turn", () => {
    const start = startedGame(13)
    const first = start.firstPlayer
    const later = atMainPhase(start, first, 2)
    expect(later.turnNumber).toBe(2)
    for (const uid of later.players[first].legends) {
      expect(later.cards[uid].ready).toBe(true)
    }
  })

  it('readies spent cards and clears lag, tempPower and the once-per-turn flags', () => {
    const base = applyAction(db, startedGame(17), { type: 'chooseGigDie', size: 4 })
    const rival = other(base.activePlayer)
    const staged = structuredClone(base)
    const uid = staged.players[rival].hand[0]
    staged.players[rival].field = [uid]
    staged.players[rival].hand = staged.players[rival].hand.slice(1)
    staged.cards[uid].ready = false
    staged.cards[uid].lag = true
    staged.cards[uid].tempPower = 4
    staged.players[rival].soldThisTurn = true
    staged.players[rival].calledLegendThisTurn = true

    const state = applyAction(db, staged, { type: 'endTurn' })
    expect(state.activePlayer).toBe(rival)
    expect(state.cards[uid].ready).toBe(true)
    expect(state.cards[uid].lag).toBe(false)
    expect(state.cards[uid].tempPower).toBe(0)
    expect(state.players[rival].soldThisTurn).toBe(false)
    expect(state.players[rival].calledLegendThisTurn).toBe(false)
  })
})

describe('endTurn', () => {
  it('is always legal in main phase (alongside Task 5 economy actions) and alternates the active player', () => {
    const first = startedGame(23).firstPlayer
    let state = applyAction(db, startedGame(23), { type: 'chooseGigDie', size: 4 })
    // Task 5 may also legally offer sellCard/playCard/callLegend here
    // (tests/engine/economy.test.ts covers those); endTurn itself must
    // always remain among the choices.
    expect(legalActions(db, state)).toContainEqual({ type: 'endTurn' })
    state = applyAction(db, state, { type: 'endTurn' })
    expect(state.activePlayer).toBe(other(first))
    expect(state.events.some((e) => e.type === 'turnEnded' && e.player === first)).toBe(true)
    state = applyAction(db, state, { type: 'chooseGigDie', size: 4 })
    state = applyAction(db, state, { type: 'endTurn' })
    expect(state.activePlayer).toBe(first)
  })

  it('is illegal outside the main phase', () => {
    const state = startedGame(23)
    expect(state.phase).toBe('start')
    expect(() => applyAction(db, state, { type: 'endTurn' })).toThrow(IllegalActionError)
  })

  it('counts turns per player: both players share turn N', () => {
    let state = startedGame(23)
    const first = state.firstPlayer
    const seen: Array<[PlayerId, number]> = []
    for (let i = 0; i < 8; i++) {
      seen.push([state.activePlayer, state.turnNumber])
      state = drive(state, (s) => s.phase === 'main')
      state = applyAction(db, state, { type: 'endTurn' })
    }
    expect(seen).toEqual([
      [first, 1],
      [other(first), 1],
      [first, 2],
      [other(first), 2],
      [first, 3],
      [other(first), 3],
      [first, 4],
      [other(first), 4],
    ])
  })
})

describe('win conditions', () => {
  it('wins at the start of your own turn with 7 gig dice, before drawing', () => {
    const base = applyAction(db, startedGame(29), { type: 'chooseGigDie', size: 4 })
    const rival = other(base.activePlayer)
    const staged = withDice(base, {
      gig: rival === 0 ? [7, 0] : [0, 7],
      fixer: rival === 0 ? [0, 5] : [5, 0],
    })
    const handBefore = staged.players[rival].hand.length
    const state = applyAction(db, staged, { type: 'endTurn' })
    expect(state.winner).toBe(rival)
    expect(state.phase).toBe('gameOver')
    expect(state.events.at(-1)).toEqual({ type: 'gameEnded', winner: rival, reason: 'sevenGigs' })
    // The win check precedes the ready/draw/gain steps.
    expect(state.players[rival].hand).toHaveLength(handBefore)
    expect(legalActions(db, state)).toEqual([])
  })

  it('does not win with 6 gig dice at the start of a turn', () => {
    const base = applyAction(db, startedGame(29), { type: 'chooseGigDie', size: 4 })
    const rival = other(base.activePlayer)
    const staged = withDice(base, {
      gig: rival === 0 ? [6, 0] : [0, 6],
      fixer: rival === 0 ? [0, 6] : [6, 0],
    })
    const state = applyAction(db, staged, { type: 'endTurn' })
    expect(state.winner).toBeNull()
  })

  it('gives the rival the win when a player must draw from an empty deck', () => {
    const base = applyAction(db, startedGame(29), { type: 'chooseGigDie', size: 4 })
    const ending = base.activePlayer
    const rival = other(ending)
    const staged = structuredClone(base)
    staged.players[rival].deck = []
    const state = applyAction(db, staged, { type: 'endTurn' })
    expect(state.winner).toBe(ending)
    expect(state.phase).toBe('gameOver')
    expect(state.events.at(-1)).toEqual({ type: 'gameEnded', winner: ending, reason: 'deckout' })
  })

  it('decks out naturally at the end of a long skeleton game', () => {
    const state = drive(startedGame(29), (s) => s.phase === 'gameOver', 400)
    expect(state.phase).toBe('gameOver')
    const last = state.events.at(-1)
    expect(last?.type).toBe('gameEnded')
    if (last?.type !== 'gameEnded') throw new Error('unreachable')
    expect(last.reason).toBe('deckout')
    // 6 opening cards + 1 per turn exhausts a 27-card deck on turn 22.
    expect(state.turnNumber).toBe(DECK_CARDS - 6 + 1)
  })
})

describe('overtime', () => {
  it('is not active before both players have completed 7 turns', () => {
    const start = startedGame(37)
    const base = atMainPhase(start, start.firstPlayer, 3)
    const staged = withDice(base, { gig: [4, 2], fixer: [3, 3] })
    const state = applyAction(db, staged, { type: 'endTurn' })
    expect(state.winner).toBeNull()
  })

  it('is still not active on the second player\'s own 7th turn', () => {
    const first = startedGame(37).firstPlayer
    const base = atMainPhase(startedGame(37), first, 7)
    const staged = withDice(base, { gig: [4, 2], fixer: [3, 3] })
    // First player's 7th turn ends -> second player's 7th turn begins. The
    // second player has not completed 7 turns yet, so no sudden death.
    const state = applyAction(db, staged, { type: 'endTurn' })
    expect(state.turnNumber).toBe(7)
    expect(state.winner).toBeNull()
  })

  it('starts the moment the second player finishes their 7th turn', () => {
    const first = startedGame(37).firstPlayer
    const second = other(first)
    const base = atMainPhase(startedGame(37), second, 7)
    const staged = withDice(base, {
      gig: first === 0 ? [6, 5] : [5, 6],
      fixer: first === 0 ? [0, 1] : [1, 0],
    })
    const state = applyAction(db, staged, { type: 'endTurn' })
    expect(state.turnNumber).toBe(8)
    expect(state.winner).toBe(first)
    expect(state.events.at(-1)).toEqual({
      type: 'gameEnded',
      winner: first,
      reason: 'overtimeMajority',
    })
  })

  it('does not fire while the gig dice are tied in overtime', () => {
    const first = startedGame(37).firstPlayer
    const base = atMainPhase(startedGame(37), first, 8)
    expect(base.turnNumber).toBe(8)
    expect(base.players[0].gigArea).toHaveLength(6)
    expect(base.players[1].gigArea).toHaveLength(6)
    expect(base.winner).toBeNull()
    const state = applyAction(db, base, { type: 'endTurn' })
    expect(state.winner).toBeNull()
  })

  it('fires immediately after the action that breaks the tie', () => {
    const start = startedGame(37)
    const base = atMainPhase(start, start.firstPlayer, 9)
    // 6 vs 5 (not 7) so this can only be an overtime win, never sevenGigs.
    const staged = withDice(base, { gig: [6, 5], fixer: [1, 0] })
    const state = applyAction(db, staged, { type: 'endTurn' })
    expect(state.winner).toBe(0)
    expect(state.events.at(-1)).toEqual({
      type: 'gameEnded',
      winner: 0,
      reason: 'overtimeMajority',
    })
  })
})

describe('query helpers', () => {
  it('effectivePower is base power plus tempPower', () => {
    const state = startedGame(41)
    const uid = state.players[0].hand.find((u) => db[state.cards[u].defId].power !== null)
    if (uid === undefined) throw new Error('expected a card with printed power in hand')
    const base = db[state.cards[uid].defId].power ?? 0
    expect(effectivePower(db, state, uid)).toBe(base)
    const buffed = structuredClone(state)
    buffed.cards[uid].tempPower = 3
    expect(effectivePower(db, buffed, uid)).toBe(base + 3)
  })

  it('effectivePower treats a null printed power as 0', () => {
    const state = startedGame(41)
    const legendUid = state.players[0].legends.find(
      (u) => db[state.cards[u].defId].power === null
    )
    if (legendUid === undefined) throw new Error('expected a legend with null power')
    expect(effectivePower(db, state, legendUid)).toBe(0)
  })

  it('actingPlayer is the active player, or the defender during react', () => {
    const state = startedGame(41)
    expect(actingPlayer(state)).toBe(state.activePlayer)
    const reacting = structuredClone(state)
    reacting.phase = 'react'
    expect(actingPlayer(reacting)).toBe(other(state.activePlayer))
  })
})

describe('immutability', () => {
  it('leaves the input state deep-equal to a pre-call clone for every action', () => {
    let state = startedGame(43)
    for (let i = 0; i < 20 && state.phase !== 'gameOver'; i++) {
      const actions = legalActions(db, state)
      if (actions.length === 0) break
      const clone = structuredClone(state)
      const next = applyAction(db, state, actions[0])
      expect(state).toEqual(clone)
      expect(next).not.toBe(state)
      state = next
    }
  })
})
