import { describe, expect, it } from 'vitest'
import { db, startedGame, mintInto } from '../cards/fixtures'
import { beginTurn, checkOvertimeWin } from '../../src/engine/game'
import { applyAction } from '../../src/engine/reduce'
import { canPayWith, canonicalPayment } from '../../src/engine/economy'

describe('comprehensive rules: turns, overtime and payment', () => {
  it('requires consecutive empty-fixer starts, independent of the round number', () => {
    const state = startedGame(0)
    state.players[0].fixer = []
    state.players[1].fixer = []
    beginTurn(state, 0, 2)
    expect(state.emptyFixerStarts).toBe(1)
    let next = applyAction(db, state, { type: 'endTurn' })
    expect(next.overtime).toBe(false)
    expect(next.emptyFixerStarts).toBe(2)
    next = applyAction(db, next, { type: 'endTurn' })
    expect(next.overtime).toBe(true)
  })

  it('breaks the consecutive-start sequence when a player begins with a fixer die', () => {
    const state = startedGame(0)
    state.emptyFixerStarts = 1
    beginTurn(state, 1, 19)
    expect(state.emptyFixerStarts).toBe(0)
    expect(state.overtime).toBe(false)
  })

  it('wins immediately with seven Gigs in overtime but not six', () => {
    const state = startedGame(0)
    state.overtime = true
    state.players[0].gigArea = Array.from({ length: 6 }, () => ({ size: 4 as const, value: 1 }))
    checkOvertimeWin(state)
    expect(state.winner).toBeNull()
    state.players[0].gigArea.push({ size: 6, value: 1 })
    checkOvertimeWin(state)
    expect(state.winner).toBe(0)
    expect(state.events.at(-1)).toMatchObject({ reason: 'overtimeSevenGigs' })
  })

  it('resolves start effects before ready and the mandatory draw', () => {
    const state = startedGame(0)
    const unit = mintInto(state, 1, 'field', 'animals-wrecker', { ready: false })
    const drawsBefore = state.players[1].hand.length
    beginTurn(state, 1, 2, () => {
      expect(state.cards[unit].ready).toBe(false)
      expect(state.players[1].hand).toHaveLength(drawsBefore)
    })
    expect(state.cards[unit].ready).toBe(true)
    expect(state.players[1].hand).toHaveLength(drawsBefore + 1)
  })

  it('resolves a start-triggered spend before the ready step through the public action API', () => {
    const state = startedGame(0)
    const unit = mintInto(state, 1, 'field', 'animals-wrecker', { ready: false })
    const rulesDb = { ...db, 'animals-wrecker': { ...db['animals-wrecker'], effects: [
      { trigger: 'onStartTurn' as const, effect: { kind: 'spendCard' as const, target: 'self' as const } },
    ] } }
    const next = applyAction(rulesDb, state, { type: 'endTurn' })
    expect(next.cards[unit].ready).toBe(true)
  })

  it('clears Lag and this-turn state for both players at every turn end', () => {
    const state = startedGame(0)
    const unit = mintInto(state, 0, 'field', 'animals-wrecker', { lag: true })
    state.cards[unit].playedThisTurn = true
    state.players[0].playedProgramThisTurn = true
    const next = applyAction(db, state, { type: 'endTurn' })
    expect(next.cards[unit].lag).toBe(false)
    expect(next.cards[unit].playedThisTurn).toBe(false)
    expect(next.players[0].playedProgramThisTurn).toBe(false)
  })

  it('lets a face-down Johnny pay, then excludes him after he is revealed', () => {
    const state = startedGame(0)
    state.players[0].legends.forEach(uid => { state.cards[uid].ready = false })
    const johnny = mintInto(state, 0, 'legends', 'johnny-silverhand-never-stop-fighting', { faceUp: false })
    expect(canPayWith(db, state, 0, [johnny], 1)).toBe(true)
    expect(canonicalPayment(db, state, 0, 1)).toEqual([johnny])
    state.cards[johnny].faceUp = true
    expect(canPayWith(db, state, 0, [johnny], 1)).toBe(false)
    expect(canonicalPayment(db, state, 0, 1)).toBeNull()
  })
})
