import { describe, expect, it } from 'vitest'
import { db, startedGame, mintInto, resolveEffectChoices } from '../cards/fixtures'
import { applyAction } from '../../src/engine/reduce'
import type { GameState } from '../../src/engine/types'

function gear(state: GameState, host: number) {
  const uid = mintInto(state, 1, 'hand', 'deadman-transmitter')
  state.players[1].hand = state.players[1].hand.filter(card => card !== uid)
  state.cards[host].attachedGear.push(uid)
  return uid
}

function board() {
  const state = startedGame(0)
  const attacker = mintInto(state, 0, 'field', 'animals-wrecker')
  const victim = mintInto(state, 1, 'field', 'pacifica-netrunner', { ready: false })
  const jackie = mintInto(state, 1, 'field', 'jackie-welles-mama-s-favorite')
  return { state, attacker, victim, jackie }
}

describe('CR 10.28–10.29: replacement ordering and chains', () => {
  it('lets the affected controller choose among mandatory shields before optional Jackie', () => {
    const { state, attacker, victim, jackie } = board()
    const first = gear(state, victim)
    const second = gear(state, victim)
    let next = applyAction(db, state, { type: 'attack', attacker, target: victim })
    next = applyAction(db, next, { type: 'react', reaction: { type: 'pass' } })
    expect(next.pendingIntercept).toMatchObject({ kind: 'effectChoice', player: 1, options: [first, second] })
    next = resolveEffectChoices(db, applyAction(db, next, { type: 'answerIntercept', answer: second }))
    expect(next.players[1].trash).toContain(second)
    expect(next.cards[victim].attachedGear).toContain(first)
    expect(next.players[1].field).toEqual(expect.arrayContaining([victim, jackie]))
  })

  it('allows a replacement to be replaced, without reapplying the same effect', () => {
    const { state, attacker, victim, jackie } = board()
    const other = mintInto(state, 1, 'field', 'jackie-welles-mama-s-favorite')
    let next = applyAction(db, state, { type: 'attack', attacker, target: victim })
    next = applyAction(db, next, { type: 'react', reaction: { type: 'pass' } })
    expect(next.pendingIntercept?.options).toEqual([-1, jackie, other])
    next = applyAction(db, next, { type: 'answerIntercept', answer: jackie })
    expect(next.pendingIntercept?.options).toEqual([-1, other])
    next = resolveEffectChoices(db, applyAction(db, next, { type: 'answerIntercept', answer: other }))
    expect(next.players[1].field).toEqual(expect.arrayContaining([victim, jackie]))
    expect(next.players[1].removed).toContain(other)
    expect(next.pendingIntercept).toBeNull()
  })

  it('applies a mandatory shield to the substitute defeat', () => {
    const { state, attacker, victim, jackie } = board()
    const shield = gear(state, jackie)
    let next = applyAction(db, state, { type: 'attack', attacker, target: victim })
    next = applyAction(db, next, { type: 'react', reaction: { type: 'pass' } })
    next = resolveEffectChoices(db, applyAction(db, next, { type: 'answerIntercept', answer: jackie }))
    expect(next.players[1].trash).toContain(shield)
    expect(next.players[1].field).toEqual(expect.arrayContaining([victim, jackie]))
  })
})
