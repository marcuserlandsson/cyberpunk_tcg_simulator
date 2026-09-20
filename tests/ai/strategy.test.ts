import { describe, expect, it } from 'vitest'
import { db, fixtureWithHand, mintInto, setGigs } from '../cards/fixtures'
import { applyAction } from '../../src/engine/reduce'
import { draftState } from '../../src/engine/game'
import { legalActions } from '../../src/engine/legal'
import { createHeuristicAgent, scoreAction } from '../../src/ai/heuristic'
import type { GameState } from '../../src/engine/types'

function board(hand: string[] = []): GameState {
  const { state } = fixtureWithHand(0, hand, { eddies: 8 })
  const legends = ['judy-a-lvarez-braindance-maestro', 'jackie-welles-pour-one-out-for-me', 'hanako-arasaka-daughter-of-the-emperor']
  state.players[0].legends.forEach((uid,i) => {
    state.cards[uid].defId = legends[i]
    state.cards[uid].faceUp = true
    state.cards[uid].ready = false
  })
  state.turnNumber = 5
  state.players[0].calledLegendThisTurn = true
  state.players[0].soldThisTurn = true
  setGigs(state, 0, [{ size: 4, value: 3 }])
  setGigs(state, 1, [{ size: 12, value: 6 }])
  return state
}
function choose(state: GameState, seed = 7) { return createHeuristicAgent(seed).chooseAction(db, state, legalActions(db, state)) }
function judy(state: GameState) {
  const uid = state.players[0].legends.find(u => state.cards[u].defId === 'judy-a-lvarez-braindance-maestro')!
  state.cards[uid].ready = true
  return uid
}

describe('strategic AI regressions', () => {
  it('always retrieves Judy’s already-revealed Program, with no new hidden-card access', () => {
    let state = board()
    const source = judy(state)
    const top = mintInto(state, 0, 'deck', 'towerfall')
    state.players[0].deck = [top, ...state.players[0].deck.filter(u => u !== top)]
    state = applyAction(db, state, legalActions(db, state).find(a => a.type === 'activateAbility' && a.card === source)!)
    expect(state.pendingIntercept?.prompt).toContain('trashed Program')
    expect(scoreAction(db, state, { type: 'answerIntercept', answer: 1 }, 0)).toBeGreaterThan(scoreAction(db, state, { type: 'answerIntercept', answer: -1 }, 0))
    for (let seed = 0; seed < 20; seed++) expect(choose(state, seed)).toEqual({ type: 'answerIntercept', answer: 1 })
    const shuffled = draftState(state)
    shuffled.players[0].deck = [top, ...state.players[0].deck.slice(1).reverse()]
    expect(choose(shuffled)).toEqual(choose(state))
  })

  it.each(['chrome-reverie', 'memory-relapse'])('uses %s to disable a dangerous ordinary attacker', id => {
    const state = board([id])
    mintInto(state, 1, 'field', 'animals-wrecker')
    const action = choose(state)
    expect(action.type).toBe('playCard')
    if (action.type === 'playCard') expect(state.cards[action.card].defId).toBe(id)
  })

  it('preserves Pyramid Song when its temporary debuff has no useful follow-up', () => {
    const state = board(['pyramid-song'])
    mintInto(state, 1, 'field', 'animals-wrecker')
    expect(choose(state)).toEqual({ type: 'endTurn' })
  })

  it('plans a debuff followed by a winning fight', () => {
    let state = board(['pyramid-song'])
    setGigs(state, 1, [])
    mintInto(state, 0, 'field', 'psycho-squad')
    const target = mintInto(state, 1, 'field', 'animals-wrecker', { ready: false })
    const first = choose(state)
    expect(first.type).toBe('playCard')
    state = applyAction(db, state, first)
    const next = choose(state)
    expect(next).toMatchObject({ type: 'attack', target })
  })

  it('gives Judy’s buff to the ready zero-power attacker', () => {
    let state = board(['industrial-assembly'])
    mintInto(state, 0, 'field', 'delamain-rideshare-ai', { ready: false })
    const ready = mintInto(state, 0, 'field', 'delamain-rideshare-ai')
    state = applyAction(db, state, legalActions(db, state).find(a => a.type === 'playCard')!)
    expect(state.pendingIntercept?.prompt).toContain('Judy')
    expect(choose(state)).toEqual({ type: 'answerIntercept', answer: ready })
  })

  it('evaluates Jackie’s draw and min-Gig choice after Delamain has drawn', () => {
    let state = board(['delamain-rideshare-ai', 'pyramid-song'])
    state = applyAction(db, state, legalActions(db, state).find(a => a.type === 'playCard' && state.cards[a.card].defId === 'delamain-rideshare-ai')!)
    for (let i=0; i<8 && !state.pendingIntercept?.prompt?.startsWith('Decrease'); i++) state = applyAction(db, state, choose(state))
    expect(state.pendingIntercept?.prompt).toContain('Decrease')
    expect(choose(state)).toEqual({ type: 'answerIntercept', answer: 2 })
  })

  it('opens with d4 for a deck that benefits from a min d4 and retains a rolled 1', () => {
    const state = board(['pyramid-song'])
    state.phase = 'start'
    state.players[0].fixer = [4,6,8,10,12,20].map(size => ({ size: size as 4|6|8|10|12|20, value: 0 }))
    expect(choose(state)).toEqual({ type: 'chooseGigDie', size: 4 })
    state.phase = 'gigReroll'
    state.pendingGigRoll = { player: 0, dieIndex: 0 }
    state.players[0].gigArea[0].value = 1
    expect(choose(state)).toEqual({ type: 'chooseGigReroll', reroll: false })
  })

  it('preserves a board wipe over a redundant sellable Program', () => {
    const state = board(['towerfall', 'trust-no-one', 'trust-no-one'])
    state.players[0].soldThisTurn = false
    mintInto(state, 1, 'field', 'animals-wrecker')
    const [wipe, spare] = state.players[0].hand
    expect(scoreAction(db,state,{type:'sellCard',card:spare},0)).toBeGreaterThan(scoreAction(db,state,{type:'sellCard',card:wipe},0))
  })

  it('does not consult the next actual draw or the rival’s unseen hand identities', () => {
    const state = board(['nocturne-op55-n1'])
    const other = draftState(state)
    other.players[0].deck.reverse()
    for (const uid of other.players[1].hand) other.cards[uid].defId = 'animals-wrecker'
    for (const action of legalActions(db,state)) expect(scoreAction(db,other,action,0)).toBe(scoreAction(db,state,action,0))
    expect(choose(other)).toEqual(choose(state))
  })

  it('mulligans an opening hand containing only cheap utility spells', () => {
    const state = board(['trust-no-one','trust-no-one','peace-offering','peace-offering','three-mouths-one-desire','three-mouths-one-desire'])
    state.phase = 'mulligan'
    state.players[0].mulliganDone = false
    expect(choose(state)).toEqual({ type: 'mulligan' })
  })
})
