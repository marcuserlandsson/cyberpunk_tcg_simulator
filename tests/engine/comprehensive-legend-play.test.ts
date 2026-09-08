import { describe, expect, it } from 'vitest'
import { db, startedGame, mintInto } from '../cards/fixtures'
import { applyAction } from '../../src/engine/reduce'
import { legalActions } from '../../src/engine/legal'
import { effectiveCardCost, reducedCost } from '../../src/engine/query'
import type { CardDb } from '../../src/engine/types'

function fixture({ solo = true, cost = 1 as number | null, ready = true } = {}) {
  const state = startedGame(0)
  const id = 'v-streetkid'
  const cards: CardDb = { ...db, [id]: { ...db[id], type: 'legend', cost: cost ?? 0,
    printedCost: cost, sellTag: true, keywords: solo ? ['go-solo'] : [], effects: [] } }
  state.players[0].eddies.forEach(uid => { state.cards[uid].ready = false })
  state.players[0].legends.forEach(uid => { state.cards[uid].ready = false })
  const legend = mintInto(state, 0, 'legends', id, { faceUp: true, ready })
  return { state, cards, legend }
}

describe('CR 4.5 / 11.25: ordinary Legend play and Go Solo', () => {
  it('Go Solo may pay with its own Sell tag and enters ready without Lag', () => {
    const { state, cards, legend } = fixture()
    const next = applyAction(cards, state, { type: 'playCard', card: legend, payment: [legend], targets: [] })
    expect(next.players[0].field).toContain(legend)
    expect(next.cards[legend]).toMatchObject({ ready: true, lag: false, playedViaGoSolo: true })
  })

  it('a spent Go Solo Legend can enter ready after payment from elsewhere', () => {
    const { state, cards, legend } = fixture({ ready: false })
    const eddie = mintInto(state, 0, 'eddies', 'animals-wrecker', { ready: true, faceUp: false })
    const next = applyAction(cards, state, { type: 'playCard', card: legend, payment: [eddie], targets: [] })
    expect(next.cards[legend]).toMatchObject({ ready: true, lag: false })
  })

  it('ordinary play needs no Go Solo and keeps its post-payment spent orientation with Lag', () => {
    const { state, cards, legend } = fixture({ solo: false })
    const next = applyAction(cards, state, { type: 'playCard', card: legend, payment: [legend], targets: [], goSolo: false })
    expect(next.cards[legend]).toMatchObject({ ready: false, lag: true, playedViaGoSolo: false })
  })

  it('a Go Solo Legend may choose ordinary play to avoid the Go Solo tax', () => {
    const { state, cards, legend } = fixture()
    const host = mintInto(state, 1, 'field', 'animals-wrecker')
    const shield = mintInto(state, 1, 'hand', 'riot-shield')
    state.players[1].hand = state.players[1].hand.filter(uid => uid !== shield)
    state.cards[host].attachedGear.push(shield)
    const plays = legalActions(cards, state).filter(a => a.type === 'playCard' && a.card === legend)
    expect(plays).toEqual([{ type: 'playCard', card: legend, payment: [legend], targets: [], goSolo: false }])
  })

  it('a null-cost Legend cannot be played or have its payment reduced', () => {
    const { state, cards, legend } = fixture({ cost: null })
    expect(effectiveCardCost(cards, state, 0, legend)).toBe(Infinity)
    expect(legalActions(cards, state).some(a => a.type === 'playCard' && a.card === legend)).toBe(false)
  })

  it('payment reductions have a minimum of one even if old card metadata says zero', () => {
    const { state, cards } = fixture()
    state.players[0].gigArea = [{ size: 8, value: 8 }]
    expect(reducedCost(cards, state, 0, 2, { per: 'friendlyGigValueAtLeast', value: 8, amount: 5, minimum: 0 })).toBe(1)
  })
})
