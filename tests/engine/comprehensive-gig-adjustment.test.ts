import { describe, expect, it } from 'vitest'
import { db, startedGame, mintInto } from '../cards/fixtures'
import { applyAction } from '../../src/engine/reduce'
import type { CardDb, EffectNode } from '../../src/engine/types'

function adjust(effect: EffectNode, targets: number[]) {
  const state = startedGame(0)
  const cards: CardDb = { ...db, 'floor-it': { ...db['floor-it'], cost: 0,
    effects: [{ trigger: 'onPlay', effect }] } }
  const program = mintInto(state, 0, 'hand', 'floor-it')
  mintInto(state, 1, 'field', 'meredith-stout-stone-cold-corpo')
  const trash = mintInto(state, 1, 'trash', 'animals-wrecker')
  state.players[0].gigArea = [{ size: 10, value: 9 }]
  state.players[1].gigArea = [{ size: 6, value: 2 }]
  const next = applyAction(cards, state, { type: 'playCard', card: program, payment: [], targets })
  return { next, trash }
}

describe('CR 6.4: Gig adjustments', () => {
  it.each([0, -2, 6])('an unsuccessful exact change of %s does not fire adjustment watchers', amount => {
    const { next, trash } = adjust({ kind: 'changeGig', target: 'rivalGigDie', amount }, [0])
    expect(next.players[1].gigArea[0].value).toBe(2)
    expect(next.players[1].trash).toContain(trash)
    expect(next.pendingIntercept).toBeNull()
  })

  it('setting a d6 to 9 fails instead of setting it to 6', () => {
    const { next, trash } = adjust({ kind: 'matchGig' }, [1, 0])
    expect(next.players[1].gigArea[0].value).toBe(2)
    expect(next.players[1].trash).toContain(trash)
  })

  it('an up-to instruction permits both a partial change and zero', () => {
    const effect: EffectNode = { kind: 'changeGig', target: 'friendlyGigDie', amount: -3, upTo: true }
    expect(adjust(effect, [0, 1]).next.players[0].gigArea[0].value).toBe(7)
    expect(adjust(effect, [0, 3]).next.players[0].gigArea[0].value).toBe(9)
  })

  it('a successful rival adjustment fires the watcher', () => {
    const { next, trash } = adjust({ kind: 'changeGig', target: 'rivalGigDie', amount: 1 }, [0])
    expect(next.players[1].gigArea[0].value).toBe(3)
    expect(next.players[1].hand).toContain(trash)
  })
})
