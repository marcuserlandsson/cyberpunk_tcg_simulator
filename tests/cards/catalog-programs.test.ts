import { describe, expect, it } from 'vitest'
import { db, fixtureWithHand, mintInto, actionsOfType, resolveEffectChoices } from './fixtures'
import { applyAction } from '../../src/engine/reduce'
import { effectiveCardCost, effectivePower } from '../../src/engine/query'

describe('new catalog Programs', () => {
  it.each([0, 1, 2])('We Gotta Live Together can play %i distinct eligible Units from trash', count => {
    const { state } = fixtureWithHand(0, ['we-gotta-live-together'])
    const a = mintInto(state, 0, 'trash', 'corpo-security')
    const b = mintInto(state, 0, 'trash', 'corpo-security')
    const expensive = mintInto(state, 0, 'trash', 'animals-wrecker')
    const action = actionsOfType(db, state, 'playCard').find(a => state.cards[a.card].defId === 'we-gotta-live-together')!
    let next = applyAction(db, state, action)
    expect(next.pendingIntercept?.options).toEqual([a, b, -1])
    next = applyAction(db, next, { type: 'answerIntercept', answer: count > 0 ? a : -1 })
    if (count > 0) {
      expect(next.pendingIntercept?.options).toEqual([b, -1])
      next = applyAction(db, next, { type: 'answerIntercept', answer: count > 1 ? b : -1 })
    }
    next = resolveEffectChoices(db, next)
    expect(next.players[0].field.filter(uid => uid === a || uid === b)).toHaveLength(count)
    expect(next.players[0].trash).toContain(expensive)
    for (const uid of next.players[0].field) expect(next.cards[uid].lag).toBe(true)
  })

  it('We Gotta Live Together costs three only when the rival has at least two more Gigs', () => {
    const { state } = fixtureWithHand(0, ['we-gotta-live-together'])
    const card = state.players[0].hand[0]
    state.players[0].gigArea = []
    state.players[1].gigArea = [{ size: 6, value: 1 }]
    expect(effectiveCardCost(db, state, 0, card)).toBe(5)
    state.players[1].gigArea.push({ size: 8, value: 2 })
    expect(effectiveCardCost(db, state, 0, card)).toBe(3)
  })

  it.each([0, 1, 2])('Three Mouths One Desire permits %i extra cards with two min Gigs', extra => {
    const { state } = fixtureWithHand(0, ['three-mouths-one-desire'])
    state.players[0].gigArea = [{ size: 6, value: 1 }, { size: 8, value: 1 }]
    const top = state.players[0].deck.slice(0, 3)
    const action = actionsOfType(db, state, 'playCard').find(a => state.cards[a.card].defId === 'three-mouths-one-desire')!
    let next = applyAction(db, state, action)
    expect(next.pendingIntercept?.options).toEqual(top)
    expect(next.pendingIntercept?.options).not.toContain(-1)
    next = applyAction(db, next, { type: 'answerIntercept', answer: top[0] })
    next = applyAction(db, next, { type: 'answerIntercept', answer: extra > 0 ? top[1] : -1 })
    if (extra > 0) next = applyAction(db, next, { type: 'answerIntercept', answer: extra > 1 ? top[2] : -1 })
    expect(next.players[0].hand.filter(uid => top.includes(uid))).toHaveLength(1 + extra)
    const remaining = top.slice(1 + extra)
    if (remaining.length) expect(next.players[0].deck.slice(-remaining.length)).toEqual(expect.arrayContaining(remaining))
  })

  it.each([0, 1])('Towerfall can resolve only mode %i when not behind', mode => {
    const { state } = fixtureWithHand(0, ['towerfall'])
    state.players[0].gigArea = [{ size: 20, value: 20 }]
    state.players[1].gigArea = [{ size: 6, value: 1 }]
    const zero = mintInto(state, 1, 'field', 'secondhand-bombus')
    const strong = mintInto(state, 1, 'field', 'animals-wrecker')
    const action = actionsOfType(db, state, 'playCard').find(a => state.cards[a.card].defId === 'towerfall' && a.targets[0] === mode)!
    const next = applyAction(db, state, action)
    if (mode === 0) {
      expect(next.players[1].field).toContain(zero)
      expect(effectivePower(db, next, strong)).toBe(5)
    } else {
      expect(next.players[1].field).not.toContain(zero)
      expect(next.players[1].deck).toContain(zero)
      expect(effectivePower(db, next, strong)).toBe(10)
    }
  })

  it('Towerfall weakens then bottom-decks newly zero-power Units with their Gear when behind', () => {
    const { state } = fixtureWithHand(0, ['towerfall'])
    state.players[0].gigArea = [{ size: 6, value: 1 }]
    state.players[1].gigArea = [{ size: 8, value: 8 }]
    const weak = mintInto(state, 1, 'field', 'corpo-security')
    const gear = mintInto(state, 1, 'trash', 'mantis-blades')
    state.players[1].trash = state.players[1].trash.filter(uid => uid !== gear)
    state.cards[weak].attachedGear.push(gear)
    const strong = mintInto(state, 1, 'field', 'animals-wrecker')
    const action = actionsOfType(db, state, 'playCard').find(a => state.cards[a.card].defId === 'towerfall')!
    const next = applyAction(db, state, action)
    expect(next.players[1].field).not.toContain(weak)
    expect(next.players[1].deck.slice(-2)).toEqual(expect.arrayContaining([weak, gear]))
    expect(next.players[1].field).toContain(strong)
    expect(effectivePower(db, next, strong)).toBe(5)
  })
})
