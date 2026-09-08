import { describe, expect, it } from 'vitest'
import { db, fixtureWithHand, mintInto, actionsOfType } from '../cards/fixtures'
import { applyAction } from '../../src/engine/reduce'
import { legalActions } from '../../src/engine/legal'
import { checkOvertimeWin, endGame, stillLive } from '../../src/engine/game'
import { evaluate } from '../../src/ai/evaluate'
import { toCsv } from '../../src/sim/runner'
import type { CardDb } from '../../src/engine/types'

describe('discard choices and exact optional draws', () => {
  it('Caliber compares the chosen discarded card cost, rather than its own cost', () => {
    const { state } = fixtureWithHand(1, ['floor-it', 'corpo-security', 'animals-wrecker'])
    const victim = mintInto(state, 0, 'field', 'caliber-totentanz-s-top-dog')
    const cheap = state.players[1].hand.find(uid => state.cards[uid].defId === 'corpo-security')!
    const expensive = state.players[1].hand.find(uid => state.cards[uid].defId === 'animals-wrecker')!
    state.players[0].gigArea = [{ size: 6, value: db['corpo-security'].cost }]
    const cards: CardDb = { ...db, 'floor-it': { ...db['floor-it'], cost: 0, effects: [{ trigger: 'onPlay', effect: { kind: 'defeat', target: 'rivalUnit' } }] } }
    const action = actionsOfType(cards, state, 'playCard').find(a => state.cards[a.card].defId === 'floor-it' && a.targets.includes(victim))!
    const pending = applyAction(cards, state, action)
    expect(pending.pendingIntercept).toMatchObject({ player: 1, options: [cheap, expensive] })
    const second = applyAction(cards, pending, { type: 'answerIntercept', answer: cheap })
    expect(second.players[1].trash).toEqual(expect.arrayContaining([cheap, expensive]))
    const single = applyAction(cards, pending, { type: 'answerIntercept', answer: expensive })
    expect(single.players[1].hand).toContain(cheap)
    expect(single.pendingIntercept).toBeNull()
  })

  it.each([0, 1] as const)('Shattered Memories asks the turn player (%i) first and both may decline', player => {
    const { state } = fixtureWithHand(player, ['shattered-memories'])
    state.players[player].gigArea = []
    const action = actionsOfType(db, state, 'playCard').find(a => state.cards[a.card].defId === 'shattered-memories')!
    const pending = applyAction(db, state, action)
    expect(pending.pendingIntercept?.player).toBe(player)
    const rival = player === 0 ? 1 : 0
    const next = applyAction(db, pending, { type: 'answerIntercept', answer: -1 })
    expect(next.pendingIntercept?.player).toBe(rival)
    const done = applyAction(db, next, { type: 'answerIntercept', answer: -1 })
    expect(done.players.map(p => p.hand.length)).toEqual([0, 0])
    expect(done.players.map(p => p.deck.length)).toEqual(state.players.map(p => p.deck.length))
  })

  it('accepting draw 5 with two cards loses at the first failed draw, before the rival acts', () => {
    const { state } = fixtureWithHand(0, ['shattered-memories'])
    state.players[0].deck = state.players[0].deck.slice(0, 2)
    const action = actionsOfType(db, state, 'playCard').find(a => state.cards[a.card].defId === 'shattered-memories')!
    const pending = applyAction(db, state, action)
    const next = applyAction(db, pending, { type: 'answerIntercept', answer: 1 })
    expect(next.winner).toBe(1)
    expect(next.players[0].hand).toHaveLength(2)
    expect(next.players[1].hand).toEqual(state.players[1].hand)
    expect(next.events.at(-1)).toMatchObject({ type: 'gameEnded', reason: 'deckout' })
  })
})

describe('terminal draws', () => {
  it('recognizes simultaneous overtime wins and remains terminal with no winner', () => {
    const { state } = fixtureWithHand(0, [])
    state.overtime = true
    for (const p of state.players) p.gigArea = Array.from({ length: 7 }, () => ({ size: 6, value: 1 }))
    checkOvertimeWin(state)
    expect(state.phase).toBe('gameOver')
    expect(state.winner).toBeNull()
    expect(stillLive(state)).toBe(false)
    expect(legalActions(db, state)).toEqual([])
    expect(evaluate(db, state, 0)).toBe(0)
    const events = state.events.length
    endGame(state, 1, 'deckout')
    expect(state.events).toHaveLength(events)
    expect(state.events.at(-1)).toMatchObject({ winner: null, reason: 'simultaneousWins' })
  })

  it('exports a draw distinctly from a win for either deck', () => {
    const csv = toCsv({ games: [{ winner: null, turns: 4, seed: 10, reason: 'simultaneousLosses' }], winRateA: 0, avgTurns: 4, cardStatsA: [], cardStatsB: [], reasons: { simultaneousLosses: 1 } })
    expect(csv).toContain('0,10,draw,4,simultaneousLosses')
  })
})
