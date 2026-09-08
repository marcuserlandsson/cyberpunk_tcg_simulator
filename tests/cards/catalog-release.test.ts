import { describe, expect, it } from 'vitest'
import { db, fixtureWithHand, mintInto, actionsOfType, resolveEffectChoices } from './fixtures'
import { applyAction } from '../../src/engine/reduce'
import { legalActions } from '../../src/engine/legal'
import { effectiveCardCost } from '../../src/engine/query'

describe('new catalog gameplay: Detonate, Tyger’s Whisper and MaxTac Heavy', () => {
  it('Detonate only offers rival Gear with power 2 or less and leaves the host in play', () => {
    const { state } = fixtureWithHand(0, ['detonate'])
    const friendly = mintInto(state, 0, 'field', 'animals-wrecker')
    const rival = mintInto(state, 1, 'field', 'animals-wrecker')
    const small = mintInto(state, 1, 'trash', 'mantis-blades')
    const large = mintInto(state, 1, 'trash', 'gorilla-arms')
    const own = mintInto(state, 0, 'trash', 'mantis-blades')
    state.players[1].trash = state.players[1].trash.filter(uid => uid !== small && uid !== large)
    state.players[0].trash = state.players[0].trash.filter(uid => uid !== own)
    state.cards[rival].attachedGear.push(small, large)
    state.cards[friendly].attachedGear.push(own)
    const cards = { ...db, 'gorilla-arms': { ...db['gorilla-arms'], power: 3 } }
    const actions = actionsOfType(cards, state, 'playCard').filter(a => state.cards[a.card].defId === 'detonate')
    expect(actions).toHaveLength(1)
    expect(actions[0].targets).toEqual([small])
    const next = applyAction(cards, state, actions[0])
    expect(next.players[1].trash).toContain(small)
    expect(next.cards[rival].attachedGear).toEqual([large])
    expect(next.players[1].field).toContain(rival)
    expect(next.cards[friendly].attachedGear).toEqual([own])
  })

  it('Detonate is available as a Quick reaction', () => {
    const { state } = fixtureWithHand(1, ['detonate'])
    state.activePlayer = 0
    const attacker = mintInto(state, 0, 'field', 'animals-wrecker')
    const victim = mintInto(state, 1, 'field', 'animals-wrecker', { ready: false })
    const gear = mintInto(state, 0, 'trash', 'mantis-blades')
    state.players[0].trash = state.players[0].trash.filter(uid => uid !== gear)
    state.cards[attacker].attachedGear.push(gear)
    const pending = applyAction(db, state, { type: 'attack', attacker, target: victim })
    const quick = legalActions(db, pending).find(a => a.type === 'react' && a.reaction.type === 'quick' && state.cards[a.reaction.card].defId === 'detonate')!
    expect(quick).toBeDefined()
    const next = applyAction(db, pending, quick)
    expect(next.players[0].trash).toContain(gear)
    expect(next.phase).toBe('react')
  })

  it('Tyger’s Whisper can decline or Call a chosen face-down Legend for free', () => {
    const { state } = fixtureWithHand(0, ["tyger-s-whisper"])
    const action = actionsOfType(db, state, 'playCard').find(a => state.cards[a.card].defId === "tyger-s-whisper")!
    const pending = applyAction(db, state, action)
    expect(pending.pendingIntercept?.options).toContain(-1)
    const declined = applyAction(db, pending, { type: 'answerIntercept', answer: -1 })
    expect(declined.players[0].calledLegendThisTurn).toBe(false)
    const legend = state.players[0].legends[1]
    const accepted = resolveEffectChoices(db, applyAction(db, pending, { type: 'answerIntercept', answer: legend }))
    expect(accepted.cards[legend].faceUp).toBe(true)
    expect(accepted.players[0].calledLegendThisTurn).toBe(true)
  })

  it('Tyger’s Whisper respects the already-used Call allowance', () => {
    const { state } = fixtureWithHand(0, ["tyger-s-whisper"])
    state.players[0].calledLegendThisTurn = true
    const action = actionsOfType(db, state, 'playCard').find(a => state.cards[a.card].defId === "tyger-s-whisper")!
    const next = applyAction(db, state, action)
    expect(next.pendingIntercept).toBeNull()
    expect(next.players[0].legends.every(uid => !next.cards[uid].faceUp)).toBe(true)
  })

  it('MaxTac Heavy counts rival field Units and reduces its cost to a minimum of one', () => {
    const { state } = fixtureWithHand(0, ['maxtac-heavy'])
    const heavy = state.players[0].hand[0]
    expect(effectiveCardCost(db, state, 0, heavy)).toBe(7)
    mintInto(state, 0, 'field', 'animals-wrecker')
    mintInto(state, 1, 'legends', 'goro-takemura-hands-unclean', { faceUp: true })
    expect(effectiveCardCost(db, state, 0, heavy)).toBe(7)
    mintInto(state, 1, 'field', 'animals-wrecker')
    expect(effectiveCardCost(db, state, 0, heavy)).toBe(6)
    for (let i = 0; i < 8; i++) mintInto(state, 1, 'field', 'animals-wrecker')
    expect(effectiveCardCost(db, state, 0, heavy)).toBe(1)
  })
})
