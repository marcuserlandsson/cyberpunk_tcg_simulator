import { describe, expect, it } from 'vitest'
import { db, startedGame, mintInto } from '../cards/fixtures'
import { conditionHolds, effectivePower, signedPower, streetCred, streetCredOrder } from '../../src/engine/query'
import { applyAction } from '../../src/engine/reduce'

describe('CR 2.10 and 5.11.4: numeric references', () => {
  it('an empty Gig area has null Street Cred, with neither parity nor numeric difference', () => {
    const state = startedGame(0)
    state.players[0].gigArea = []
    state.players[1].gigArea = [{ size: 20, value: 20 }]
    expect(streetCred(state, 0)).toBeNull()
    expect(conditionHolds(state, 0, { streetCredParity: 'even' })).toBe(false)
    expect(conditionHolds(state, 0, { streetCredParity: 'odd' })).toBe(false)
    expect(conditionHolds(state, 0, { streetCredAtLeast: 0 })).toBe(false)
    expect(conditionHolds(state, 0, { streetCredDiffAtLeast: 10 })).toBe(false)
    expect(conditionHolds(state, 0, { streetCredBehindRival: true })).toBe(true)
    expect(streetCredOrder(state, 0)).toBeLessThan(0)
  })

  it('negative power compares as zero while signed arithmetic is preserved', () => {
    const state = startedGame(0)
    const unit = mintInto(state, 0, 'field', 'animals-wrecker')
    state.cards[unit].tempPower = -(db['animals-wrecker'].power ?? 0) - 1
    expect(signedPower(db, state, unit)).toBe(-1)
    expect(effectivePower(db, state, unit)).toBe(0)
    state.cards[unit].tempPower += 2
    expect(effectivePower(db, state, unit)).toBe(1)
  })

  it('adds contextual fight modifiers before clamping the comparison', () => {
    const state = startedGame(0)
    const unit = mintInto(state, 0, 'field', 'animals-wrecker')
    const rival = mintInto(state, 1, 'field', 'animals-wrecker', { ready: false })
    state.cards[unit].tempPower = -(db['animals-wrecker'].power ?? 0) - 1
    state.cards[unit].fightPowerBonusThisTurn = 2
    state.cards[rival].tempPower = -(db['animals-wrecker'].power ?? 0) + 2
    const attack = applyAction(db, state, { type: 'attack', attacker: unit, target: rival })
    const next = applyAction(db, attack, { type: 'react', reaction: { type: 'pass' } })
    expect(next.players[0].trash).toContain(unit)
    expect(next.players[1].field).toContain(rival)
  })
})
