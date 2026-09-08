import { describe, expect, it } from 'vitest'
import { db, startedGame, mintInto } from '../cards/fixtures'
import { applyAction } from '../../src/engine/reduce'
import { controllerOf, effectivePower } from '../../src/engine/query'
import { fireCardTrigger } from '../../src/cards/effects'
import { flushPendingEffects } from '../../src/engine/resolution'
import { leaveField, defeatGear } from '../../src/engine/combat'
import type { CardDb } from '../../src/engine/types'

describe('CR 1.7 / 4.11: control and inherited Gear text', () => {
  it('an inherited self buff affects the host, not the Gear', () => {
    const state = startedGame(0)
    const host = mintInto(state, 0, 'field', 'animals-wrecker')
    const gear = mintInto(state, 0, 'hand', 'mantis-blades')
    state.players[0].hand = state.players[0].hand.filter(uid => uid !== gear)
    state.cards[host].attachedGear.push(gear)
    const cards: CardDb = { ...db, 'mantis-blades': { ...db['mantis-blades'], effects: [{ trigger: 'onAttack',
      effect: { kind: 'buffPower', target: 'self', amount: 2, duration: 'turn' } }] } }
    state.players[1].gigArea = [{ size: 6, value: 3 }]
    const next = applyAction(cards, state, { type: 'attack', attacker: host, target: 'gigArea' })
    expect(next.cards[host].tempPower).toBe(2)
    expect(next.cards[gear].tempPower).toBe(0)
  })

  it('uses the current controller for inherited statics, but the owner for the exit', () => {
    const state = startedGame(0)
    const host = mintInto(state, 1, 'field', 'animals-wrecker')
    state.players[1].field = state.players[1].field.filter(uid => uid !== host)
    state.players[0].field.push(host)
    const gear = mintInto(state, 1, 'hand', 'mantis-blades')
    state.players[1].hand = state.players[1].hand.filter(uid => uid !== gear)
    state.cards[host].attachedGear.push(gear)
    state.players[0].gigArea = [{ size: 20, value: 12 }]
    state.players[1].gigArea = []
    const cards: CardDb = { ...db, 'mantis-blades': { ...db['mantis-blades'], effects: [{ trigger: 'static',
      condition: { streetCredAtLeast: 10 }, effect: { kind: 'staticPower', amount: 3 } }] } }
    expect(controllerOf(state, host)).toBe(0)
    expect(controllerOf(state, gear)).toBe(0)
    expect(effectivePower(cards, state, host)).toBe((db['animals-wrecker'].power ?? 0) + (db['mantis-blades'].power ?? 0) + 3)
    leaveField(state, cards, host, 'hand')
    expect(state.players[0].field).not.toContain(host)
    expect(state.players[1].hand).toEqual(expect.arrayContaining([host, gear]))
  })

  it('defeating Gear does not trigger its inherited host Defeated text', () => {
    const state = startedGame(0)
    const host = mintInto(state, 0, 'field', 'animals-wrecker')
    const gear = mintInto(state, 0, 'hand', 'mantis-blades')
    state.players[0].hand = state.players[0].hand.filter(uid => uid !== gear)
    state.cards[host].attachedGear.push(gear)
    const cards: CardDb = { ...db, 'mantis-blades': { ...db['mantis-blades'], effects: [{ trigger: 'onDefeat', effect: { kind: 'draw', count: 2 } }] } }
    const before = state.players[0].deck.length
    defeatGear(state, cards, gear)
    expect(state.players[0].deck).toHaveLength(before)
    expect(state.players[0].trash).toContain(gear)
    expect(state.players[0].field).toContain(host)
  })
})


describe('remaining control and event snapshots', () => {
  it('protects the current controller in a fight even when the owner differs', () => {
    const state = startedGame(0)
    const host = mintInto(state, 1, 'field', 'animals-wrecker')
    state.players[1].field = []
    state.players[0].field.push(host)
    const foe = mintInto(state, 1, 'field', 'animals-wrecker', { ready: false })
    state.cards[foe].tempPower = 10
    state.floatingEffects.push({ kind: 'rivalFightNoDefeat', controller: 0, sourceDefId: 'reboot-optics', expiry: 'endOfTurn' })
    const attacking = applyAction(db, state, { type: 'attack', attacker: host, target: foe })
    const done = applyAction(db, attacking, { type: 'react', reaction: { type: 'pass' } })
    expect(done.players[0].field).toContain(host)
    expect(done.floatingEffects).toHaveLength(0)
  })
  it('records a defeated Legend entering trash before its mandatory removal', () => {
    const state = startedGame(0)
    const uid = state.players[0].legends[0]
    leaveField(state, db, uid, 'trash')
    expect(state.events.slice(-2)).toEqual([{ type: 'cardTrashed', uid }, { type: 'cardRemoved', uid }])
    expect(state.players[0].trash).not.toContain(uid)
    expect(state.players[0].removed).toContain(uid)
  })
  it('does not re-evaluate an established Gear stealer identity after re-equipping', () => {
    const state = startedGame(0)
    const first = mintInto(state, 0, 'field', 'animals-wrecker')
    const second = mintInto(state, 0, 'field', 'animals-wrecker')
    const gear = mintInto(state, 0, 'hand', 'mantis-blades')
    state.players[0].hand = state.players[0].hand.filter(uid => uid !== gear)
    state.cards[first].attachedGear.push(gear)
    const cards: CardDb = { ...db, 'mantis-blades': { ...db['mantis-blades'], effects: [{ trigger: 'onFriendlyStealDie', condition: { selfIsStealer: true }, effect: { kind: 'draw', count: 1 } }] } }
    state.effectQueue = []
    fireCardTrigger(cards, state, 'onFriendlyStealDie', gear, [], 0, { stealerUid: first })
    state.cards[first].attachedGear = []
    state.cards[second].attachedGear.push(gear)
    const before = state.players[0].hand.length
    flushPendingEffects(cards, state)
    expect(state.players[0].hand).toHaveLength(before + 1)
  })
})
