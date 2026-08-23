// The affordance projection (src/ui/playAffordances.ts) is the one place the
// Play view is allowed to decide what is clickable, so its selectors get their
// own tests rather than being covered only through the DOM.

import { describe, expect, it } from 'vitest'
import {
  abilityUids,
  attackerUids,
  attacksBy,
  findAction,
  firstDivergentSlot,
  fixerDieSizes,
  NO_TARGET,
  playableCards,
  playVariants,
  reactions,
  sellableCards,
  slotOptions,
  slotValue,
  stealableGigIndexes,
} from '../../src/ui/playAffordances'
import type { Action } from '../../src/engine/types'

const legal: Action[] = [
  { type: 'sellCard', card: 5 },
  { type: 'playCard', card: 7, payment: [1], targets: [11] },
  { type: 'playCard', card: 7, payment: [1], targets: [12] },
  { type: 'playCard', card: 8, payment: [1, 2], targets: [] },
  { type: 'activateAbility', card: 20, abilityIndex: 0, targets: [30] },
  { type: 'attack', attacker: 40, target: 'gigArea' },
  { type: 'attack', attacker: 40, target: 41 },
  { type: 'attack', attacker: 40, target: 41, payOptionalCosts: true },
  { type: 'chooseGigDie', size: 4 },
  { type: 'chooseGigDie', size: 6 },
  { type: 'chooseGig', dieIndex: 0 },
  { type: 'chooseGig', dieIndex: 3 },
  { type: 'react', reaction: { type: 'pass' } },
  { type: 'endTurn' },
]

describe('affordance selectors', () => {
  it('projects each action type onto the zone that renders it', () => {
    expect([...playableCards(legal)]).toEqual([7, 8])
    expect([...sellableCards(legal)]).toEqual([5])
    expect([...attackerUids(legal)]).toEqual([40])
    expect([...abilityUids(legal)]).toEqual([20])
    expect([...fixerDieSizes(legal)]).toEqual([4, 6])
    expect([...stealableGigIndexes(legal)]).toEqual([0, 3])
    expect(reactions(legal)).toHaveLength(1)
    expect(findAction(legal, 'endTurn')).toEqual({ type: 'endTurn' })
    expect(findAction(legal, 'mulligan')).toBeUndefined()
  })

  it('groups the variants of one card and one attacker', () => {
    expect(playVariants(legal, 7)).toHaveLength(2)
    expect(playVariants(legal, 8)).toHaveLength(1)
    expect(playVariants(legal, 99)).toEqual([])
    expect(attacksBy(legal, 40)).toHaveLength(3)
    // Both `payOptionalCosts` variants of the same target survive as separate
    // entries — that pair is exactly what the UI turns into two buttons.
    expect(attacksBy(legal, 40).filter((a) => a.target === 41)).toHaveLength(2)
  })
})

describe('progressive target disambiguation', () => {
  it('reports no divergence for a single variant', () => {
    expect(firstDivergentSlot([{ targets: [1, 2] }])).toBe(-1)
  })

  it('reports no divergence when every variant binds the same targets', () => {
    expect(firstDivergentSlot([{ targets: [1, 2] }, { targets: [1, 2] }])).toBe(-1)
  })

  it('finds the earliest slot the variants disagree on', () => {
    expect(firstDivergentSlot([{ targets: [1, 2] }, { targets: [1, 3] }])).toBe(1)
    expect(firstDivergentSlot([{ targets: [1, 2] }, { targets: [9, 2] }])).toBe(0)
  })

  it('treats a missing slot as its own option rather than a match', () => {
    // A `chooseOne` mode can bind fewer slots than its sibling; the shorter
    // tuple must still be reachable, as its own answer.
    expect(firstDivergentSlot([{ targets: [1] }, { targets: [1, 4] }])).toBe(1)
    expect(slotValue([1], 1)).toBe(NO_TARGET)
    expect(slotOptions([{ targets: [1] }, { targets: [1, 4] }], 1)).toEqual([NO_TARGET, 4])
  })

  it('lists a slot`s distinct options in first-seen order, without duplicates', () => {
    const variants = [{ targets: [5] }, { targets: [7] }, { targets: [5] }]
    expect(slotOptions(variants, 0)).toEqual([5, 7])
  })
})
