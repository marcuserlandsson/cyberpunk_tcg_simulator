import { describe, expect, it } from 'vitest'
import { db, fixtureWithHand, mintInto, actionsOfType, resolveEffectChoices } from '../cards/fixtures'
import { applyAction } from '../../src/engine/reduce'
import type { CardDb } from '../../src/engine/types'

describe('payment decisions inside effects', () => {
  it('an activated ability can pay with a chosen Legend and Eddie without exposing hidden names', () => {
    const { state } = fixtureWithHand(0, [])
    const source = mintInto(state, 0, 'field', 'rogue-amendiares-queen-of-the-afterlife')
    mintInto(state, 1, 'field', 'animals-wrecker')
    const legend = state.players[0].legends[0]
    state.cards[legend].ready = true
    const eddie = state.players[0].eddies.at(-1)!
    const action = actionsOfType(db, state, 'activateAbility').find(a => a.card === source)!
    let next = applyAction(db, state, action)
    expect(next.pendingIntercept?.prompt).toContain('Choose payment 1 of 2')
    expect(next.pendingIntercept?.optionLabels?.[legend]).toBe('Face-down Legend 1')
    expect(next.pendingIntercept?.knownCards?.some(card => card.uid === legend)).toBe(false)
    next = applyAction(db, next, { type: 'answerIntercept', answer: legend })
    expect(next.pendingIntercept?.options).not.toContain(legend)
    next = applyAction(db, next, { type: 'answerIntercept', answer: eddie })
    expect(next.cards[legend].ready).toBe(false)
    expect(next.cards[eddie].ready).toBe(false)
    expect(next.cards[source].ready).toBe(false)
    expect(next.players[0].eddies.filter(uid => !next.cards[uid].ready)).toEqual([eddie])
  })

  it('an optional end trigger asks before paying and can be declined', () => {
    const { state } = fixtureWithHand(0, [])
    const source = mintInto(state, 0, 'field', 'animals-wrecker')
    const cards: CardDb = { ...db, 'animals-wrecker': { ...db['animals-wrecker'], effects: [{ trigger: 'onEndTurn', cost: { eddies: 1 }, effect: { kind: 'draw', count: 1 } }] } }
    const pending = applyAction(cards, state, { type: 'endTurn' })
    expect(pending.pendingIntercept?.prompt).toBe('Pay the optional triggered cost?')
    const declined = resolveEffectChoices(cards, applyAction(cards, pending, { type: 'answerIntercept', answer: -1 }))
    expect(declined.players[0].hand).toHaveLength(state.players[0].hand.length)
    const paid = applyAction(cards, pending, { type: 'answerIntercept', answer: 1 })
    expect(paid.pendingIntercept?.prompt).toContain('Choose payment')
    const eddie = state.players[0].eddies.at(-1)!
    const next = resolveEffectChoices(cards, applyAction(cards, paid, { type: 'answerIntercept', answer: eddie }))
    expect(next.players[0].hand).toHaveLength(state.players[0].hand.length + 1)
    expect(next.cards[eddie].ready).toBe(false)
    expect(next.cards[source].ready).toBe(true)
  })
})
