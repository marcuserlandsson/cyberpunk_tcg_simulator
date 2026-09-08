import { describe, expect, it } from 'vitest'
import { db, fixtureWithHand, resolveEffectChoices } from '../cards/fixtures'
import { applyAction } from '../../src/engine/reduce'
import { legalActions } from '../../src/engine/legal'
import type { CardDb } from '../../src/engine/types'

function searchFixture(script: string) {
  const { state } = fixtureWithHand(0, ['all-is-lost'])
  const cards: CardDb = { ...db, 'all-is-lost': { ...db['all-is-lost'], effects: [{ trigger: 'onPlay', effect: { kind: 'scripted', name: script } }] } }
  const uid = state.players[0].hand[0]
  const action = legalActions(cards, state).find(a => a.type === 'playCard' && a.card === uid)!
  return { state, cards, action }
}

describe('search and public reveal visibility', () => {
  it('keeps searched cards counted until selection and public reveal finish', () => {
    const { state, cards, action } = searchFixture('hanako-arasaka-in-a-gilded-cage')
    const top = state.players[0].deck.slice(0, 4)
    const cost = db[state.cards[top[0]].defId].cost
    state.players[0].gigArea = [{ size: 12, value: cost }]
    let next = applyAction(cards, state, action)
    expect(next.pendingIntercept?.view?.players[0].deck).toEqual(state.players[0].deck)
    next = applyAction(cards, next, { type: 'answerIntercept', answer: top[0] })
    if (!next.pendingIntercept?.prompt?.startsWith('Public reveal')) {
      next = applyAction(cards, next, { type: 'answerIntercept', answer: -1 })
    }
    expect(next.pendingIntercept?.prompt).toContain('Public reveal')
    expect(next.pendingIntercept?.knownCards).toContainEqual({ uid: top[0], viewer: 'all' })
    expect(next.pendingIntercept?.view?.players[0].deck).toEqual(state.players[0].deck)
    const done = resolveEffectChoices(cards, next)
    expect(done.players[0].hand).toContain(top[0])
    expect(done.events).toContainEqual({ type: 'cardRevealed', player: 0, uid: top[0] })
  })

  it('keeps a private search in place and preserves the unselected order', () => {
    const { state, cards, action } = searchFixture('river-ward-detective-on-the-hunt:defeat-search')
    const before = [...state.players[0].deck]
    const pending = applyAction(cards, state, action)
    expect(pending.pendingIntercept?.view?.players[0].deck).toEqual(before)
    expect(pending.pendingIntercept?.knownCards).toContainEqual({ uid: before[0], viewer: 0 })
    expect(pending.pendingIntercept?.knownCards).not.toContainEqual({ uid: before[0], viewer: 'all' })
    const done = applyAction(cards, pending, { type: 'answerIntercept', answer: before[1] })
    expect(done.players[0].deck).toEqual(before.filter(uid => uid !== before[1]))
  })
})

