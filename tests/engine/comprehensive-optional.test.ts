import { describe, expect, it } from 'vitest'
import { db, fixtureWithHand, mintInto, actionsOfType, resolveEffectChoices } from '../cards/fixtures'
import { applyAction } from '../../src/engine/reduce'

describe('optional instructions and filtered hidden searches', () => {
  it.each([
    ['yorinobu-arasaka-steel-dragon', 'corpo-security'],
    ['lizzy-wizzy-delicate-weapon', 'floor-it'],
  ])('lets %s decline its free play', (id, targetId) => {
    const { state } = fixtureWithHand(0, [id, targetId])
    const target = state.players[0].hand.find(uid => state.cards[uid].defId === targetId)!
    const action = actionsOfType(db, state, 'playCard').find(a => state.cards[a.card].defId === id && a.targets.includes(target))!
    const pending = applyAction(db, state, action)
    expect(pending.pendingIntercept).toMatchObject({ kind: 'effectChoice', player: 0, options: [1, -1] })
    const next = resolveEffectChoices(db, applyAction(db, pending, { type: 'answerIntercept', answer: -1 }))
    expect(next.players[0].hand).toContain(target)
    expect(next.players[0].field).toContain(action.card)
    expect(next.players[0].field).not.toContain(target)
  })

  it('declining Peace Offering still draws for an existing value-pair', () => {
    const { state } = fixtureWithHand(0, ['peace-offering'])
    state.players[0].gigArea = [{ size: 6, value: 3 }, { size: 8, value: 3 }]
    const action = actionsOfType(db, state, 'playCard').find(a => state.cards[a.card].defId === 'peace-offering')!
    const pending = applyAction(db, state, action)
    const next = applyAction(db, pending, { type: 'answerIntercept', answer: -1 })
    expect(next.players[0].gigArea.map(die => die.value)).toEqual([3, 3])
    expect(next.players[0].hand).toHaveLength(state.players[0].hand.length)
    expect(next.players[0].deck).toHaveLength(state.players[0].deck.length - 1)
  })

  it('Judy may leave a trashed Program in trash after paying the Spend cost', () => {
    const { state } = fixtureWithHand(0, [])
    const judy = mintInto(state, 0, 'legends', 'judy-a-lvarez-braindance-maestro', { faceUp: true })
    const top = mintInto(state, 0, 'deck', 'floor-it')
    state.players[0].deck = [top, ...state.players[0].deck.filter(uid => uid !== top)]
    const action = actionsOfType(db, state, 'activateAbility').find(a => a.card === judy)!
    const pending = applyAction(db, state, action)
    expect(pending.pendingIntercept?.prompt).toContain('trashed Program')
    const next = applyAction(db, pending, { type: 'answerIntercept', answer: -1 })
    expect(next.players[0].trash).toContain(top)
    expect(next.players[0].hand).not.toContain(top)
    expect(next.cards[judy].ready).toBe(false)
  })

  it('The Heist can add qualifying Gear to hand instead of playing it', () => {
    const { state } = fixtureWithHand(0, ['the-heist'])
    state.players[0].gigArea = [{ size: 6, value: 1 }]
    const gear = mintInto(state, 0, 'deck', 'mantis-blades')
    const fillers = Array.from({ length: 3 }, () => mintInto(state, 0, 'deck', 'animals-wrecker'))
    const top = [gear, ...fillers]
    state.players[0].deck = [...top, ...state.players[0].deck.filter(uid => !top.includes(uid))]
    const host = mintInto(state, 0, 'field', 'animals-wrecker')
    const action = actionsOfType(db, state, 'playCard').find(a => state.cards[a.card].defId === 'the-heist')!
    const pending = applyAction(db, state, action)
    expect(pending.pendingIntercept?.prompt).toContain('instead of adding')
    const next = applyAction(db, pending, { type: 'answerIntercept', answer: -1 })
    expect(next.players[0].hand).toContain(gear)
    expect(next.cards[host].attachedGear).toEqual([])
  })

  it('allows a filtered hidden search to find no Gear even when one is present', () => {
    const { state } = fixtureWithHand(0, [])
    const source = mintInto(state, 0, 'field', 'sketchy-ripper')
    const gear = mintInto(state, 0, 'deck', 'mantis-blades')
    const fillers = Array.from({ length: 2 }, () => mintInto(state, 0, 'deck', 'animals-wrecker'))
    const top = [gear, ...fillers]
    state.players[0].deck = [...top, ...state.players[0].deck.filter(uid => !top.includes(uid))]
    state.players[1].gigArea = [{ size: 6, value: 3 }]
    const pending = applyAction(db, state, { type: 'attack', attacker: source, target: 'gigArea' })
    expect(pending.pendingIntercept?.options).toEqual([gear, -1])
    const next = applyAction(db, pending, { type: 'answerIntercept', answer: -1 })
    expect(next.players[0].hand).not.toContain(gear)
    expect(next.players[0].deck.slice(-3)).toEqual(expect.arrayContaining(top))
  })
  it.each(['gilded-mato-n', 'heywood-ripperdoc'])('%s may decline defeating Gear', id => {
    const { state } = fixtureWithHand(0, [id])
    const host = mintInto(state, 0, 'field', 'animals-wrecker')
    const gear = mintInto(state, 0, 'trash', 'mantis-blades')
    state.players[0].trash = state.players[0].trash.filter(uid => uid !== gear)
    state.cards[host].attachedGear.push(gear)
    const action = actionsOfType(db, state, 'playCard').find(a => state.cards[a.card].defId === id && a.targets.includes(gear))!
    const pending = applyAction(db, state, action)
    const next = resolveEffectChoices(db, applyAction(db, pending, { type: 'answerIntercept', answer: -1 }))
    expect(next.cards[host].attachedGear).toContain(gear)
  })

  it('Bonnie and Clyde can defeat only one Unit while two are allowed', () => {
    const { state } = fixtureWithHand(0, ['bonnie-and-clyde'])
    state.players[0].gigArea = []
    state.players[1].gigArea = [{ size: 6, value: 1 }, { size: 8, value: 2 }]
    const a = mintInto(state, 1, 'field', 'corpo-security')
    const b = mintInto(state, 1, 'field', 'corpo-security')
    const action = actionsOfType(db, state, 'playCard').find(action => state.cards[action.card].defId === 'bonnie-and-clyde' && action.targets[0] === a)!
    const pending = applyAction(db, state, action)
    expect(pending.pendingIntercept?.prompt).toContain('second rival Unit')
    const next = applyAction(db, pending, { type: 'answerIntercept', answer: -1 })
    expect(next.players[1].trash).toContain(a)
    expect(next.players[1].field).toContain(b)
  })

})
