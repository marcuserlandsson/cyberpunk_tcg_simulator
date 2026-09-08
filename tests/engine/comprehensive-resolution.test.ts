import { describe, expect, it } from 'vitest'
import { db, startedGame, mintInto as mintKnown, resolvePendingOrder } from '../cards/fixtures'
import { applyAction } from '../../src/engine/reduce'
import { legalActions } from '../../src/engine/legal'
import type { CardDb, EffectDef, GameState } from '../../src/engine/types'

function rulesDb(entries: Record<string, EffectDef[]>): CardDb {
  return Object.fromEntries(Object.entries(entries).map(([id, effects]) => [id, {
    ...db['animals-wrecker'], id, name: id, cost: 0, power: 4, effects,
  }]))
}
function pass(cards: CardDb, state: GameState): GameState {
  return applyAction(cards, state, { type: 'react', reaction: { type: 'pass' } })
}
function mintInto(...args: Parameters<typeof mintKnown>): number {
  const [state, player, zone, id, options] = args
  const uid = mintKnown(state, player, zone, db[id] ? id : 'animals-wrecker', options)
  state.cards[uid].defId = id
  return uid
}

describe('comprehensive rules: pending resolution', () => {
  it('offers a later target choice from cards revealed by the preceding instruction', () => {
    const cards = { ...db, ...rulesDb({ program: [{ trigger: 'onPlay', effect: { kind: 'sequence', effects: [
      { kind: 'trashFromDeck', whose: 'friendly', count: 2 },
      { kind: 'retrieveFromTrash', target: 'friendlyTrashCard' },
    ] } }] }) }
    cards.program = { ...cards.program, type: 'program', power: null }
    const state = startedGame(0)
    const program = mintInto(state, 0, 'hand', 'program')
    const [first, second] = state.players[0].deck
    const pending = applyAction(cards, state, { type: 'playCard', card: program, payment: [], targets: [] })
    expect(pending.pendingIntercept).toMatchObject({ kind: 'effectChoice', player: 0, options: [first, second] })
    const view = pending.pendingIntercept!.view!
    expect(view.players[0].trash).toEqual([first, second])
    expect(view.players[0].hand).not.toContain(program)
    expect(view.resolvingPrograms).toEqual([program])
    expect(view.pendingIntercept).toBeNull()
    expect(view.effectQueue).toBeUndefined()
    expect(pending.players[0].trash).toEqual(state.players[0].trash)
    expect(pending.players[0].hand).toContain(program)
    const next = applyAction(cards, pending, { type: 'answerIntercept', answer: second })
    expect(next.players[0].hand).toContain(second)
    expect(next.players[0].trash).toEqual([first, program])
  })
  it('cannot retrieve a resolving Program from the trash', () => {
    const cards = { ...db, ...rulesDb({ program: [
      { trigger: 'onPlay', effect: { kind: 'retrieveFromTrash', target: 'friendlyTrashCard' } },
    ] }) }
    cards.program = { ...cards.program, type: 'program', power: null }
    const state = startedGame(0)
    const program = mintInto(state, 0, 'hand', 'program')
    const next = applyAction(cards, state, { type: 'playCard', card: program, payment: [], targets: [] })
    expect(next.players[0].trash).toContain(program)
    expect(next.players[0].hand).not.toContain(program)
  })
  it('finishes a compound Program before its nested defeated trigger', () => {
    const cards = { ...db, ...rulesDb({
      victim: [{ trigger: 'onDefeat', effect: { kind: 'draw', count: 1 } }],
      program: [{ trigger: 'onPlay', effect: { kind: 'sequence', effects: [
        { kind: 'defeat', target: 'rivalUnit' }, { kind: 'draw', count: 1 },
      ] } }],
    }) }
    cards.program = { ...cards.program, type: 'program', power: null }
    const state = startedGame(0)
    const victim = mintInto(state, 1, 'field', 'victim')
    const program = mintInto(state, 0, 'hand', 'program')
    const next = applyAction(cards, state, { type: 'playCard', card: program, payment: [], targets: [victim] })
    const events = next.events.slice(state.events.length)
    expect(events.filter(e => e.type === 'cardDrawn').map(e => e.player)).toEqual([0, 1])
    const trashed = events.findIndex(e => e.type === 'cardTrashed' && e.uid === program)
    const ownDraw = events.findIndex(e => e.type === 'cardDrawn' && e.player === 0)
    const rivalDraw = events.findIndex(e => e.type === 'cardDrawn' && e.player === 1)
    expect(trashed).toBeGreaterThan(ownDraw)
    expect(trashed).toBeLessThan(rivalDraw)
    expect(next.effectQueue).toBeUndefined()
  })

  it('lets the controller choose ordering and deterministically replay that choice', () => {
    const cards = { ...db, ...rulesDb({
      a: [{ trigger: 'onEndTurn', effect: { kind: 'draw', count: 1 } }],
      b: [{ trigger: 'onEndTurn', effect: { kind: 'gainEddieFromTopDeck', count: 1 } }],
    }) }
    const state = startedGame(0)
    mintInto(state, 0, 'field', 'a')
    mintInto(state, 0, 'field', 'b')
    const [top, second] = state.players[0].deck
    const initial = structuredClone(state)
    const pending = applyAction(cards, state, { type: 'endTurn' })
    expect(pending.pendingIntercept).toMatchObject({ kind: 'effectOrder', player: 0 })
    expect(state).toEqual(initial)
    const answer = { type: 'answerIntercept' as const, answer: 1 }
    const next = applyAction(cards, pending, answer)
    expect(next.players[0].eddies).toContain(top)
    expect(next.players[0].hand).toContain(second)
    expect(applyAction(cards, pending, answer)).toEqual(next)
    expect(legalActions(cards, pending).every(a => a.type === 'answerIntercept')).toBe(true)
  })

  it('keeps pending effects from a source that an earlier pending effect removes', () => {
    const cards = { ...db, ...rulesDb({
      attacker: [{ trigger: 'onWinFight', effect: { kind: 'defeat', target: 'rivalUnit' } }],
      defender: [{ trigger: 'onLoseFight', effect: { kind: 'draw', count: 1 } }],
    }) }
    cards.attacker.power = 8
    const state = startedGame(0)
    const attacker = mintInto(state, 0, 'field', 'attacker')
    const defender = mintInto(state, 1, 'field', 'defender', { ready: false })
    const handBefore = state.players[1].hand.length
    const next = pass(cards, applyAction(cards, state, { type: 'attack', attacker, target: defender }))
    expect(next.players[1].trash).toContain(defender)
    expect(next.players[1].hand).toHaveLength(handBefore + 1)
    const recent = next.events.slice(state.events.length)
    expect(recent.findIndex(e => e.type === 'unitDefeated')).toBeLessThan(recent.findIndex(e => e.type === 'cardDrawn'))
  })

  it('resolves winner and loser effects before defeat and preserves outcomes through a shield', () => {
    const cards = { ...db, ...rulesDb({
      attacker: [{ trigger: 'onWinFight', effect: { kind: 'draw', count: 1 } }],
      defender: [{ trigger: 'onLoseFight', effect: { kind: 'draw', count: 1 } }],
    }) }
    cards.attacker.power = 8
    const state = startedGame(0)
    const attacker = mintInto(state, 0, 'field', 'attacker')
    const defender = mintInto(state, 1, 'field', 'defender', { ready: false })
    const shield = mintInto(state, 1, 'trash', 'deadman-transmitter')
    state.players[1].trash = state.players[1].trash.filter(uid => uid !== shield)
    state.cards[defender].attachedGear.push(shield)
    const next = resolvePendingOrder(cards, pass(cards, applyAction(cards, state, { type: 'attack', attacker, target: defender })))
    expect(next.players[1].field).toContain(defender)
    expect(next.players[1].trash).toContain(shield)
    const recent = next.events.slice(state.events.length)
    expect(recent.filter(e => e.type === 'cardDrawn').map(e => e.player)).toEqual([0, 1])
    expect(recent.findIndex(e => e.type === 'cardTrashed' && e.uid === shield)).toBeGreaterThan(Math.max(...recent.flatMap((e, index) => e.type === 'cardDrawn' ? [index] : [])))
  })
})
