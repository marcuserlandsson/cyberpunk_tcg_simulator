import { describe, expect, it } from 'vitest'
import { db, startedGame, mintInto } from '../cards/fixtures'
import { applyAction } from '../../src/engine/reduce'
import { legalActions } from '../../src/engine/legal'
import { leaveField } from '../../src/engine/combat'
import type { CardDb } from '../../src/engine/types'

describe('comprehensive combat and Gear movement', () => {
  it('ends an attack when a Quick effect readies its target and it is no longer legal', () => {
    const rulesDb: CardDb = { ...db, 'take-control': { ...db['take-control'], effects: [
      { trigger: 'onPlay', effect: { kind: 'readyCard', target: 'friendlyUnit' } },
    ] } }
    let state = startedGame(0)
    const attacker = mintInto(state, 0, 'field', 'animals-wrecker')
    const target = mintInto(state, 1, 'field', 'animals-wrecker', { ready: false })
    const quick = mintInto(state, 1, 'hand', 'take-control')
    state = applyAction(rulesDb, state, { type: 'attack', attacker, target })
    const action = legalActions(rulesDb, state).find(action => action.type === 'react' && action.reaction.type === 'quick' && action.reaction.card === quick)
    expect(action).toBeDefined()
    state = applyAction(rulesDb, state, action!)
    expect(state.cards[target].ready).toBe(true)
    expect(state.pendingAttack).toBeNull()
    expect(state.phase).toBe('main')
    expect(state.players[1].field).toContain(target)
  })
  it('permits Blocker, Quick, another Blocker, then pass in one reaction window', () => {
    let state = startedGame(0)
    const attacker = mintInto(state, 0, 'field', 'animals-wrecker')
    const first = mintInto(state, 1, 'field', 'corpo-security')
    const second = mintInto(state, 1, 'field', 'secondhand-bombus')
    const quick = mintInto(state, 1, 'hand', 'take-control')
    state.players[1].gigArea = [{ size: 6, value: 3 }]
    state = applyAction(db, state, { type: 'attack', attacker, target: 'gigArea' })
    state = applyAction(db, state, { type: 'react', reaction: { type: 'block', blocker: first } })
    expect(state.phase).toBe('react')
    expect(state.players[1].field).toContain(first)
    const action = legalActions(db, state).find(action => action.type === 'react' && action.reaction.type === 'quick' && action.reaction.card === quick)
    expect(action).toBeDefined()
    state = applyAction(db, state, action!)
    state = applyAction(db, state, { type: 'react', reaction: { type: 'block', blocker: second } })
    expect(state.pendingAttack?.redirectedTo).toBe(second)
    state = applyAction(db, state, { type: 'react', reaction: { type: 'pass' } })
    expect(state.phase).toBe('main')
    expect(state.players[1].field).toContain(first)
    expect(state.players[1].trash).toContain(second)
    expect(state.players[1].gigArea).toHaveLength(1)
  })

  it.each(['hand', 'deckBottom'] as const)('moves a Legend’s Gear to %s while removing the Legend', exit => {
    const state = startedGame(0)
    const legend = mintInto(state, 0, 'field', 'goro-takemura-hands-unclean')
    const gear = mintInto(state, 0, 'hand', 'mantis-blades')
    state.players[0].hand = state.players[0].hand.filter(uid => uid !== gear)
    state.cards[legend].attachedGear.push(gear)
    leaveField(state, db, legend, exit)
    expect(state.players[0].removed).toContain(legend)
    expect(exit === 'hand' ? state.players[0].hand : state.players[0].deck).toContain(gear)
    expect(state.players[0].trash).not.toContain(gear)
    expect(state.cards[legend].attachedGear).toEqual([])
  })

  it('randomizes a bottom-decked Unit and its Gear together reproducibly', () => {
    const state = startedGame(0)
    const unit = mintInto(state, 0, 'field', 'animals-wrecker')
    const gear = mintInto(state, 0, 'hand', 'mantis-blades')
    state.players[0].hand = state.players[0].hand.filter(uid => uid !== gear)
    state.cards[unit].attachedGear.push(gear)
    const replay = structuredClone(state)
    const rngBefore = state.rng
    leaveField(state, db, unit, 'deckBottom')
    leaveField(replay, db, unit, 'deckBottom')
    expect(state.players[0].deck.slice(-2).sort()).toEqual([unit, gear].sort())
    expect(state.players[0].deck).toEqual(replay.players[0].deck)
    expect(state.rng).not.toEqual(rngBefore)
  })
})
