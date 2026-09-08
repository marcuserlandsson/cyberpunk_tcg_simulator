import { describe, expect, it } from 'vitest'
import { db, startedGame, mintInto, resolveEffectChoices } from '../cards/fixtures'
import { applyAction } from '../../src/engine/reduce'
import { legalActions } from '../../src/engine/legal'
import type { CardDb } from '../../src/engine/types'

describe('comprehensive rules: simultaneous steals', () => {
  it('chooses the full batch before prevention and never offers a selected die twice', () => {
    const state = startedGame(0)
    const attacker = mintInto(state, 0, 'field', 'animals-wrecker')
    mintInto(state, 1, 'field', 'alt-cunningham-mother-of-daemons')
    state.players[1].trash.push(...state.players[1].hand)
    state.players[1].hand = []
    const discard = mintInto(state, 1, 'hand', 'valentino-street-racer')
    state.players[0].gigArea = []
    state.players[1].gigArea = [{ size: 6, value: 3 }, { size: 8, value: 4 }]
    let next = applyAction(db, state, { type: 'attack', attacker, target: 'gigArea' })
    next = applyAction(db, next, { type: 'react', reaction: { type: 'pass' } })
    next = applyAction(db, next, { type: 'chooseGig', dieIndex: 0 })
    expect(next.phase).toBe('chooseGig')
    expect(next.pendingIntercept).toBeNull()
    expect(next.players[1].gigArea).toHaveLength(2)
    expect(legalActions(db, next)).toEqual([{ type: 'chooseGig', dieIndex: 1 }])
    next = applyAction(db, next, { type: 'chooseGig', dieIndex: 1 })
    expect(next.pendingIntercept).toMatchObject({ kind: 'steal', player: 1, subject: 0 })
    next = applyAction(db, next, { type: 'answerIntercept', answer: discard })
    expect(next.players[0].gigArea.map(die => die.value)).toEqual([4])
    expect(next.players[1].gigArea.map(die => die.value)).toEqual([3])
    expect(next.phase).toBe('main')
  })

  it('per-die triggers see the completed transfer of both dice', () => {
    const cards: CardDb = { ...db, 'animals-wrecker': { ...db['animals-wrecker'], effects: [{
      trigger: 'onFriendlyStealDie', condition: { friendlyGigsAtLeastValueCount: { value: 1, count: 2 } },
      effect: { kind: 'draw', count: 1 },
    }] } }
    const state = startedGame(0)
    const attacker = mintInto(state, 0, 'field', 'animals-wrecker')
    state.players[0].gigArea = []
    state.players[1].gigArea = [{ size: 6, value: 3 }, { size: 8, value: 4 }]
    let next = applyAction(cards, state, { type: 'attack', attacker, target: 'gigArea' })
    next = applyAction(cards, next, { type: 'react', reaction: { type: 'pass' } })
    next = applyAction(cards, next, { type: 'chooseGig', dieIndex: 0 })
    next = resolveEffectChoices(cards, applyAction(cards, next, { type: 'chooseGig', dieIndex: 1 }))
    const recent = next.events.slice(state.events.length)
    const moves = recent.flatMap((e, index) => e.type === 'gigStolen' ? [index] : [])
    const draws = recent.flatMap((e, index) => e.type === 'cardDrawn' ? [index] : [])
    expect(moves).toHaveLength(2)
    expect(draws).toHaveLength(2)
    expect(Math.min(...draws)).toBeGreaterThan(Math.max(...moves))
  })

  it('an overtime-winning effect steal ends the game before its later draw can deck out', () => {
    const cards: CardDb = { ...db, 'floor-it': { ...db['floor-it'], cost: 0, effects: [{
      trigger: 'onPlay', effect: { kind: 'sequence', effects: [
        { kind: 'stealGig', count: 1 }, { kind: 'draw', count: 1 },
      ] },
    }] } }
    const state = startedGame(0)
    state.overtime = true
    state.players[0].gigArea = Array.from({ length: 6 }, () => ({ size: 6 as const, value: 1 }))
    state.players[1].gigArea = [{ size: 8, value: 3 }]
    state.players[0].trash.push(...state.players[0].deck)
    state.players[0].deck = []
    const program = mintInto(state, 0, 'hand', 'floor-it')
    const next = applyAction(cards, state, { type: 'playCard', card: program, payment: [], targets: [] })
    expect(next.winner).toBe(0)
    expect(next.events.at(-1)).toMatchObject({ type: 'gameEnded', reason: 'overtimeSevenGigs' })
    expect(next.players[0].trash).toContain(program)
  })
})
