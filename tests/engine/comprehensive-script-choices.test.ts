import { describe, expect, it } from 'vitest'
import { db, fixtureWithHand, mintInto, actionsOfType, resolveEffectChoices } from '../cards/fixtures'
import { applyAction } from '../../src/engine/reduce'

describe('scripted effects use player choices', () => {
  it('lets the controller select which newly trashed Unit to retrieve', () => {
    const { state } = fixtureWithHand(0, ['all-is-lost'])
    const first = mintInto(state, 0, 'deck', 'animals-wrecker')
    const second = mintInto(state, 0, 'deck', 'corpo-security')
    const third = mintInto(state, 0, 'deck', 'floor-it')
    state.players[0].deck = [first, second, third, ...state.players[0].deck.filter(uid => ![first, second, third].includes(uid))]
    const action = actionsOfType(db, state, 'playCard').find(a => state.cards[a.card].defId === 'all-is-lost')!
    const pending = applyAction(db, state, action)
    expect(pending.pendingIntercept).toMatchObject({ player: 0, options: [first, second] })
    const next = applyAction(db, pending, { type: 'answerIntercept', answer: second })
    expect(next.players[0].hand).toContain(second)
    expect(next.players[0].trash).toEqual(expect.arrayContaining([first, third]))
  })

  it('gives the rival the destination decision and discloses both revealed cards', () => {
    const { state } = fixtureWithHand(0, ['fool-on-the-hill'])
    const top = state.players[0].deck.slice(0, 2)
    const action = actionsOfType(db, state, 'playCard').find(a => state.cards[a.card].defId === 'fool-on-the-hill')!
    const pending = applyAction(db, state, action)
    expect(pending.pendingIntercept).toMatchObject({ player: 1, options: [0, 1] })
    expect(pending.pendingIntercept?.knownCards).toEqual(expect.arrayContaining(top.map(uid => ({ uid, viewer: 'all' }))))
    const next = applyAction(db, pending, { type: 'answerIntercept', answer: 1 })
    expect(next.players[0].trash).toEqual(expect.arrayContaining(top))
    expect(next.players[0].deck).toHaveLength(state.players[0].deck.length - 4)
  })

  it('allows zero or one of up to three readied Units', () => {
    const { state } = fixtureWithHand(0, [])
    mintInto(state, 0, 'legends', 'saul-bright-stormrider', { faceUp: true })
    const a = mintInto(state, 0, 'field', 'animals-wrecker', { ready: false })
    const b = mintInto(state, 0, 'field', 'corpo-security', { ready: false })
    const pending = applyAction(db, state, { type: 'endTurn' })
    expect(pending.pendingIntercept?.options).toEqual([a, b, -1])
    const none = resolveEffectChoices(db, applyAction(db, pending, { type: 'answerIntercept', answer: -1 }))
    expect(none.cards[a].ready).toBe(false)
    expect(none.cards[b].ready).toBe(false)
    const one = applyAction(db, pending, { type: 'answerIntercept', answer: b })
    const next = resolveEffectChoices(db, applyAction(db, one, { type: 'answerIntercept', answer: -1 }))
    expect(next.cards[a].ready).toBe(false)
    expect(next.cards[b].ready).toBe(true)
  })
})
