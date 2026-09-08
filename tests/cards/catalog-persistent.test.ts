import { describe, expect, it } from 'vitest'
import { db, fixtureWithHand, mintInto, actionsOfType, resolveEffectChoices } from './fixtures'
import { applyAction } from '../../src/engine/reduce'
import { effectiveCardCost, effectivePower, goSoloCost, cantAttack, hasKeyword } from '../../src/engine/query'
import { readyCardOnDraft, beginTurn, clearTurnBuffs } from '../../src/engine/game'
import { leaveField, stealableDieIndexes } from '../../src/engine/combat'
import { transferStolenGigs } from '../../src/engine/stealing'
import { goSoloPayment } from '../../src/cards/effects'

describe('new persistent restrictions and modifiers', () => {
  it('Memory Relapse prevents natural and effect readying until its controller’s next turn', () => {
    const { state } = fixtureWithHand(0, ['memory-relapse'])
    state.players[0].gigArea = [{ size: 6, value: 2 }]
    const target = mintInto(state, 1, 'field', 'animals-wrecker')
    const action = actionsOfType(db, state, 'playCard').find(a => state.cards[a.card].defId === 'memory-relapse' && a.targets.includes(target))!
    const next = resolveEffectChoices(db, applyAction(db, state, action))
    expect(next.players[0].deck).toHaveLength(state.players[0].deck.length - 1)
    expect(next.cards[target].ready).toBe(false)
    expect(readyCardOnDraft(next, target)).toBe(false)
    beginTurn(next, 1, next.turnNumber + 1)
    expect(next.cards[target].ready).toBe(false)
    beginTurn(next, 0, next.turnNumber + 1)
    expect(readyCardOnDraft(next, target)).toBe(true)
  })

  it('Memory Relapse’s even-Street-Cred draw still works without a rival Unit', () => {
    const { state } = fixtureWithHand(0, ['memory-relapse'])
    state.players[0].gigArea = [{ size: 6, value: 2 }]
    const action = actionsOfType(db, state, 'playCard').find(a => state.cards[a.card].defId === 'memory-relapse')!
    const next = applyAction(db, state, action)
    expect(next.players[0].deck).toHaveLength(state.players[0].deck.length - 1)
    expect(next.floatingEffects).toEqual([])
  })

  it('a field exit removes a readying restriction so a later entry is fresh', () => {
    const { state } = fixtureWithHand(0, [])
    const target = mintInto(state, 1, 'field', 'animals-wrecker', { ready: false })
    state.floatingEffects.push({ kind: 'unitCantReady', controller: 0, sourceDefId: 'memory-relapse', expiry: 'ownerNextTurnStart', unitUid: target })
    leaveField(state, db, target, 'hand')
    expect(state.floatingEffects).toEqual([])
  })

  it('Westbrook Netrunner prevents only rival Legends stealing below their current power', () => {
    const { state } = fixtureWithHand(0, ['westbrook-netrunner'])
    const action = actionsOfType(db, state, 'playCard').find(a => state.cards[a.card].defId === 'westbrook-netrunner')!
    const next = applyAction(db, state, action)
    next.players[0].gigArea = [{ size: 20, value: 1 }, { size: 20, value: 9 }, { size: 20, value: 20 }]
    const legend = mintInto(next, 1, 'field', 'goro-takemura-hands-unclean')
    next.cards[legend].tempPower = 9 - (db['goro-takemura-hands-unclean'].power ?? 0)
    const unit = mintInto(next, 1, 'field', 'animals-wrecker')
    expect(stealableDieIndexes(db, next, 1, legend)).toEqual([1, 2])
    expect(stealableDieIndexes(db, next, 1, unit)).toEqual([0, 1, 2])
    beginTurn(next, 0, next.turnNumber + 2)
    expect(stealableDieIndexes(db, next, 1, legend)).toEqual([0, 1, 2])
  })

  it('Nocturne costs one with an empty fixer and grants a temporary discounted Go Solo', () => {
    const { state } = fixtureWithHand(0, ['nocturne-op55-n1'])
    const card = state.players[0].hand[0]
    expect(effectiveCardCost(db, state, 0, card)).toBe(3)
    state.players[0].fixer = []
    expect(effectiveCardCost(db, state, 0, card)).toBe(1)
    const legend = mintInto(state, 0, 'legends', 'goro-takemura-hands-unclean', { faceUp: true })
    const cards = { ...db, 'goro-takemura-hands-unclean': { ...db['goro-takemura-hands-unclean'], keywords: [], cost: 1, printedCost: 1 } }
    expect(goSoloPayment(cards, state, 0, legend)).toBeNull()
    const action = actionsOfType(cards, state, 'playCard').find(a => a.card === card && a.targets[0] === 2)!
    const pending = applyAction(cards, state, action)
    const next = applyAction(cards, pending, { type: 'answerIntercept', answer: legend })
    expect(goSoloCost(cards, next, 0, legend)).toBe(1)
    expect(goSoloPayment(cards, next, 0, legend)).not.toBeNull()
    const solo = actionsOfType(cards, next, 'playCard').find(a => a.card === legend && a.goSolo !== false)!
    const played = applyAction(cards, next, solo)
    expect(played.cards[legend]).toMatchObject({ ready: true, lag: false, playedViaGoSolo: true })
    clearTurnBuffs(next)
    expect(hasKeyword(cards, next, legend, 'go-solo')).toBe(false)
  })

  it('Nocturne can target a face-down Legend without revealing its identity', () => {
    const { state } = fixtureWithHand(0, ['nocturne-op55-n1'])
    const action = actionsOfType(db, state, 'playCard').find(a => state.cards[a.card].defId === 'nocturne-op55-n1' && a.targets[0] === 2)!
    const pending = applyAction(db, state, action)
    const legend = state.players[0].legends[0]
    expect(pending.pendingIntercept?.optionLabels?.[legend]).toBe('Face-down Legend 1')
    expect(pending.pendingIntercept?.knownCards?.some(card => card.uid === legend)).toBe(false)
    const next = applyAction(db, pending, { type: 'answerIntercept', answer: legend })
    expect(next.cards[legend].faceUp).toBe(false)
    expect(next.cards[legend].tempKeywords).toContain('go-solo')
  })

  it.each([0, 1])('Nocturne resolves mode %i independently', mode => {
    const { state } = fixtureWithHand(0, ['nocturne-op55-n1'])
    const target = mintInto(state, 0, 'field', 'animals-wrecker')
    const action = actionsOfType(db, state, 'playCard').find(a => state.cards[a.card].defId === 'nocturne-op55-n1' && a.targets[0] === mode)!
    const next = applyAction(db, state, action)
    if (mode === 0) expect(next.players[0].deck).toHaveLength(state.players[0].deck.length - 2)
    else expect(cantAttack(db, next, target)).toBe(true)
  })

  it('Rogue only readies Eddies on the first qualifying steal by another Unit each turn', () => {
    const { state } = fixtureWithHand(0, [])
    const rogue = mintInto(state, 0, 'field', 'rogue-amendiares-queen-of-the-afterlife')
    const other = mintInto(state, 0, 'field', 'animals-wrecker')
    for (const uid of state.players[0].eddies) state.cards[uid].ready = false
    const ready = () => state.players[0].eddies.filter(uid => state.cards[uid].ready).length
    state.players[1].gigArea = [{ size: 20, value: 1 }, { size: 20, value: 10 }, { size: 20, value: 2 }, { size: 20, value: 3 }]
    transferStolenGigs(db, state, rogue, 0, [0])
    expect(ready()).toBe(0)
    transferStolenGigs(db, state, other, 0, [0]) // equal power does not qualify
    expect(ready()).toBe(0)
    transferStolenGigs(db, state, other, 0, [0])
    expect(ready()).toBe(2)
    for (const uid of state.players[0].eddies) state.cards[uid].ready = false
    transferStolenGigs(db, state, other, 0, [0])
    expect(ready()).toBe(0)
  })

  it('Rogue’s paid Spend ability uses its current power and only the ability is Quick', () => {
    const { state } = fixtureWithHand(0, [])
    const rogue = mintInto(state, 0, 'field', 'rogue-amendiares-queen-of-the-afterlife')
    const target = mintInto(state, 1, 'field', 'animals-wrecker')
    state.cards[rogue].tempPower = 3
    expect(db['rogue-amendiares-queen-of-the-afterlife'].keywords).not.toContain('quick')
    expect(db['rogue-amendiares-queen-of-the-afterlife'].effects[1].quick).toBe(true)
    const action = actionsOfType(db, state, 'activateAbility').find(a => a.card === rogue && a.targets.includes(target))!
    const next = resolveEffectChoices(db, applyAction(db, state, action))
    expect(effectivePower(db, next, target)).toBe(3)
    expect(next.cards[rogue].ready).toBe(false)
  })
})
