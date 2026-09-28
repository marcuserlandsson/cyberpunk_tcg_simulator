// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { loadCardDb } from '../../src/engine/cardDb'
import type { DeckList } from '../../src/engine/deck'
import { loadPrintings } from '../../src/ui/printings'
import { deckRequirements } from '../../src/ui/acquisitionPlan'
import { pendingSplit, surplusPlan, type SurplusOptions } from '../../src/ui/surplus'

const db = loadCardDb(), printings = loadPrintings()
const deck = (cards: Record<string, number>, legends: [string, string, string] = ['', '', '']): DeckList => ({ name: 'T', legends, cards })
const none: SurplusOptions = { mode: 'shared', keepBinderArt: false, keepPlayset: false }
const ia = { 'arasakademodeck/006': 2, 'welcometonightcityretail/033': 1, 'welcometonightcitybeta/β033': 1 }
const row = (decks: DeckList[], counts: Record<string, number>, opts: Partial<SurplusOptions>, id: string) =>
  surplusPlan(db, decks, printings, counts, { ...none, ...opts }).find(r => r.id === id)!

describe('deckRequirements', () => {
  it('takes the max across decks when shared and the sum when kept', () => {
    const decks = [deck({ 'industrial-assembly': 3 }), deck({ 'industrial-assembly': 2 })]
    expect([...deckRequirements(db, decks, 'shared').values()].find(r => r.id === 'industrial-assembly')!.count).toBe(3)
    expect([...deckRequirements(db, decks, 'assembled').values()].find(r => r.id === 'industrial-assembly')!.count).toBe(5)
  })
})

describe('surplusPlan', () => {
  it('sells everything with no decks and no holds, most-duplicated printing first', () => {
    expect(row([], ia, {}, 'industrial-assembly')).toMatchObject({ owned: 4, keep: 0, surplus: 4, split: [
      { key: 'arasakademodeck/006', count: 2 }, { key: 'welcometonightcityretail/033', count: 1 }, { key: 'welcometonightcitybeta/β033', count: 1 },
    ] })
  })
  it('keeps what shared or kept-in-every-deck decks need', () => {
    const decks = [deck({ 'industrial-assembly': 3 }), deck({ 'industrial-assembly': 2 })]
    expect(row(decks, ia, {}, 'industrial-assembly')).toMatchObject({ deckNeed: 3, keep: 3, surplus: 1, split: [{ key: 'arasakademodeck/006', count: 1 }] })
    expect(row(decks, ia, { mode: 'assembled' }, 'industrial-assembly')).toMatchObject({ deckNeed: 5, keep: 4, surplus: 0, split: [] })
  })
  it('adds one binder copy per held artwork on top of deck need', () => {
    expect(row([deck({ 'industrial-assembly': 2 })], ia, { keepBinderArt: true }, 'industrial-assembly')).toMatchObject({ binderHold: 1, keep: 3, surplus: 1 })
  })
  it('lets deck copies count toward the playset hold', () => {
    expect(row([], ia, { keepPlayset: true }, 'industrial-assembly')).toMatchObject({ playsetHold: 3, keep: 3, surplus: 1 })
    expect(row([deck({ 'industrial-assembly': 2 })], ia, { keepPlayset: true }, 'industrial-assembly')).toMatchObject({ keep: 3, surplus: 1 })
  })
  it('sells a collection-only printing, but only after playable duplicates', () => {
    expect(row([], { 'PRM01/005': 2 }, { keepBinderArt: true }, 'rebecca-having-a-moment')).toMatchObject({ owned: 2, binderHold: 1, keep: 1, surplus: 1, split: [{ key: 'PRM01/005', count: 1 }] })
    const adam = { 'PRM01/008': 1, 'welcometonightcityretail/001': 2 }
    expect(row([], adam, { keepPlayset: true }, 'adam-smasher-ender-of-legends').split).toEqual([{ key: 'welcometonightcityretail/001', count: 2 }])
  })
  it('never sells the last playable copy a deck needs', () => {
    const adam = { 'PRM01/008': 1, 'welcometonightcityretail/001': 1 }
    const r = row([deck({}, ['adam-smasher-ender-of-legends', '', ''])], adam, {}, 'adam-smasher-ender-of-legends')
    expect(r).toMatchObject({ deckNeed: 1, keep: 1, surplus: 1, split: [{ key: 'PRM01/008', count: 1 }] })
  })
  it('keeps two printings of one card in one set distinct', () => {
    const counts = { 'welcometonightcitybeta/β005a': 1, 'welcometonightcitybeta/β005b': 1, 'welcometonightcityretail/005a': 1 }
    expect(row([], counts, { keepBinderArt: true }, 'v-streetkid')).toMatchObject({ binderHold: 2, surplus: 1, split: [{ key: 'welcometonightcityretail/005a', count: 1 }] })
  })
  it('breaks ties by selling retail before beta', () => {
    const counts = { 'welcometonightcitybeta/β033': 1, 'welcometonightcityretail/033': 1 }
    expect(row([deck({ 'industrial-assembly': 1 })], counts, {}, 'industrial-assembly').split).toEqual([{ key: 'welcometonightcityretail/033', count: 1 }])
  })
  it('ignores deck entries that are not in the card db', () => {
    expect(row([deck({ 'not-a-card': 2 })], ia, {}, 'industrial-assembly').surplus).toBe(4)
  })
})

describe('pendingSplit', () => {
  const split = [{ key: 'a', count: 2 }, { key: 'b', count: 1 }]
  it('subtracts copies already listed and stops at the wanted amount', () => {
    expect(pendingSplit(split, {}, 3)).toEqual(split)
    expect(pendingSplit(split, { a: 1 }, 2)).toEqual([{ key: 'a', count: 1 }, { key: 'b', count: 1 }])
    expect(pendingSplit(split, { a: 2, b: 1 }, 3)).toEqual([])
    expect(pendingSplit(split, {}, 1)).toEqual([{ key: 'a', count: 1 }])
  })
})
