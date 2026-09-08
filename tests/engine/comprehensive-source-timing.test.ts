import { describe, expect, it } from 'vitest'
import { db, startedGame, mintInto, resolveEffectChoices } from '../cards/fixtures'
import { applyAction } from '../../src/engine/reduce'
import { effectivePower, cantAttack } from '../../src/engine/query'
import { beginTurn } from '../../src/engine/game'
import type { CardDb, EffectDef } from '../../src/engine/types'

const withEffects = (id: string, effects: EffectDef[]): CardDb => ({ ...db, [id]: { ...db[id], effects } })

describe('CR 10.10/10.15: source information and resolution conditions', () => {
  it.each([2, -2])('checks power after an earlier ordered attack effect changes it by %i', amount => {
    const cards = withEffects('swordwise-huscle', [
      { trigger: 'onAttack', condition: { sourcePowerAtLeast: 5 }, effect: { kind: 'draw', count: 1 } },
      { trigger: 'onAttack', effect: { kind: 'buffPower', target: 'self', amount, duration: 'turn' } },
    ])
    cards['swordwise-huscle'] = { ...cards['swordwise-huscle'], power: amount > 0 ? 4 : 5 }
    const state = startedGame(0)
    state.players[1].gigArea = [{ size: 6, value: 3 }]
    const attacker = mintInto(state, 0, 'field', 'swordwise-huscle')
    const before = state.players[0].hand.length
    const pending = applyAction(cards, state, { type: 'attack', attacker, target: 'gigArea' })
    expect(pending.pendingIntercept).toMatchObject({ kind: 'effectOrder', options: [0, 1] })
    const next = applyAction(cards, pending, { type: 'answerIntercept', answer: 1 })
    expect(next.players[0].hand).toHaveLength(before + (amount > 0 ? 1 : 0))
  })

  it('refreshes an inner conditional after the preceding instruction buffs the source', () => {
    const cards = withEffects('animals-wrecker', [{ trigger: 'onAttack', effect: { kind: 'sequence', effects: [
      { kind: 'buffPower', target: 'self', amount: 10, duration: 'turn' },
      { kind: 'conditionalEffect', condition: { sourcePowerAtLeast: 10 }, effect: { kind: 'draw', count: 1 } },
    ] } }])
    const state = startedGame(0)
    state.players[1].gigArea = [{ size: 6, value: 3 }]
    const attacker = mintInto(state, 0, 'field', 'animals-wrecker')
    const next = applyAction(cards, state, { type: 'attack', attacker, target: 'gigArea' })
    expect(next.players[0].hand).toHaveLength(state.players[0].hand.length + 1)
  })

  it('retains the removed source equipped state and count for its pending effect', () => {
    const cards = withEffects('animals-wrecker', [
      { trigger: 'onAttack', effect: { kind: 'defeat', target: 'self' } },
      { trigger: 'onAttack', condition: { sourceEquipped: true }, effect: { kind: 'draw', count: { perEquippedGear: 1 } } },
    ])
    const state = startedGame(0)
    state.players[1].gigArea = [{ size: 6, value: 3 }]
    const attacker = mintInto(state, 0, 'field', 'animals-wrecker')
    const gear = mintInto(state, 0, 'trash', 'dying-night-v-s-pistol')
    state.players[0].trash = state.players[0].trash.filter(uid => uid !== gear)
    state.cards[attacker].attachedGear.push(gear)
    const pending = applyAction(cards, state, { type: 'attack', attacker, target: 'gigArea' })
    const next = resolveEffectChoices(cards, applyAction(cards, pending, { type: 'answerIntercept', answer: 0 }))
    expect(next.players[0].trash).toEqual(expect.arrayContaining([attacker, gear]))
    expect(next.players[0].hand).toHaveLength(state.players[0].hand.length + 1)
    expect(next.lastKnownCards).toBeUndefined()
  })

  it('exposes attack power through pending effects and clears the context after the attack', () => {
    const cards = withEffects('animals-wrecker', [{ trigger: 'static', effect: { kind: 'attackPowerBonus', amount: 2 } }])
    const state = startedGame(0)
    state.players[1].gigArea = [{ size: 6, value: 3 }]
    const attacker = mintInto(state, 0, 'field', 'animals-wrecker')
    const defender = mintInto(state, 1, 'field', 'animals-wrecker', { ready: false })
    const base = effectivePower(cards, state, attacker)
    const attack = applyAction(cards, state, { type: 'attack', attacker, target: defender })
    expect(effectivePower(cards, attack, attacker)).toBe(base + 2)
    const next = resolveEffectChoices(cards, applyAction(cards, attack, { type: 'react', reaction: { type: 'pass' } }))
    expect(effectivePower(cards, next, attacker)).toBe(base)
    expect(next.pendingFight).toBeUndefined()
  })

  it('keeps expiring durations through start effects and preserves newly created durations', () => {
    const state = startedGame(0)
    state.players[1].gigArea = [{ size: 6, value: 3 }]
    const target = mintInto(state, 1, 'field', 'animals-wrecker')
    const entry = { kind: 'unitCantAttack' as const, unitUid: target, sourceUid: target, sourceDefId: 'animals-wrecker', controller: 0 as const, expiry: 'ownerNextTurnStart' as const }
    state.floatingEffects.push(entry)
    beginTurn(state, 0, state.turnNumber + 2, () => {
      expect(cantAttack(db, state, target)).toBe(true)
      state.floatingEffects.push({ ...entry })
    })
    expect(state.floatingEffects).toHaveLength(1)
    expect(state.floatingEffects[0]).not.toBe(entry)
  })
  it('adjusts the same stolen die after an earlier instruction removes another die', () => {
    const id = 'v-roamer-of-the-badlands'
    const cards = withEffects(id, [db[id].effects[0], { trigger: 'onAttack', effect: { kind: 'sequence', effects: [
      { kind: 'stealGig', count: 2 }, { kind: 'returnGig', count: 1 },
    ] } }])
    const state = startedGame(0)
    state.players[0].gigArea = []
    state.players[1].gigArea = [{ size: 8, value: 1 }, { size: 10, value: 2 }]
    const attacker = mintInto(state, 0, 'field', id)
    let next = applyAction(cards, state, { type: 'attack', attacker, target: 'gigArea' })
    expect(next.pendingIntercept?.prompt).toContain('Choose Gig 1')
    next = applyAction(cards, next, { type: 'answerIntercept', answer: 0 })
    expect(next.pendingIntercept?.prompt).toContain('return to the fixer')
    next = applyAction(cards, next, { type: 'answerIntercept', answer: 0 })
    next = resolveEffectChoices(cards, next)
    expect(next.players[0].gigArea).toMatchObject([{ size: 10, value: 7 }])
    const returned = next.players[0].fixer.find(die => die.size === 8 && die.value === 0 && die.id !== undefined)
    expect(returned).toBeDefined()
    expect(returned?.id).not.toBe(next.players[0].gigArea[0].id)
  })

})
