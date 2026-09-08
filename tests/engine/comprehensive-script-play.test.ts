import { describe, expect, it } from 'vitest'
import { db, fixtureWithHand, mintInto, playCardByDef } from '../cards/fixtures'
import { bottomDeckCards } from '../../src/engine/combat'
import { shuffle } from '../../src/engine/rng'
import { scriptedCards } from '../../src/cards/scripted/index'
import type { CardDb } from '../../src/engine/types'

describe('scripted play and movement share engine rules', () => {
  it('a Program played by Lizzy is outside trash, records Program play, and triggers play watchers', () => {
    const { state } = fixtureWithHand(0, ['lizzy-wizzy-delicate-weapon', 'floor-it'])
    const program = state.players[0].hand.find(uid => state.cards[uid].defId === 'floor-it')!
    mintInto(state, 0, 'field', 'animals-wrecker')
    const cards: CardDb = { ...db,
      'floor-it': { ...db['floor-it'], effects: [{ trigger: 'onPlay', effect: { kind: 'retrieveFromTrash', target: 'friendlyTrashCard' } }] },
      'animals-wrecker': { ...db['animals-wrecker'], effects: [{ trigger: 'onFriendlyCardPlayed', condition: { playedCardType: 'program' }, effect: { kind: 'draw', count: 1 } }] },
    }
    const before = state.players[0].deck.length
    const next = playCardByDef(cards, state, 0, 'lizzy-wizzy-delicate-weapon', { includes: program })
    expect(next.players[0].playedProgramThisTurn).toBe(true)
    expect(next.players[0].trash).not.toContain(program)
    expect(next.players[0].hand).not.toContain(program)
    expect(next.players[0].deck.at(-1)).toBe(program)
    expect(next.players[0].deck).toHaveLength(before) // bottom-deck one, watcher draws one
  })

  it('scripted bottom-decking carries Gear to the same destination', () => {
    const { state } = fixtureWithHand(0, [])
    const host = mintInto(state, 0, 'field', 'animals-wrecker')
    const gear = mintInto(state, 0, 'hand', 'mantis-blades')
    state.players[0].hand = state.players[0].hand.filter(uid => uid !== gear)
    state.cards[host].attachedGear.push(gear)
    const rival = mintInto(state, 1, 'field', 'corpo-security', { ready: false })
    scriptedCards['unlikely-bond'](db, state, { player: 0, sourceUid: host, targets: [host, rival] })
    expect(state.players[0].deck.slice(-2)).toEqual(expect.arrayContaining([host, gear]))
    expect(state.cards[host].attachedGear).toEqual([])
    expect(state.players[0].trash).not.toContain(gear)
  })

  it('randomizes several hosts and their Gear as one combined bottom-deck group', () => {
    const { state } = fixtureWithHand(0, [])
    const a = mintInto(state, 0, 'field', 'animals-wrecker')
    const b = mintInto(state, 0, 'field', 'corpo-security')
    const gear = mintInto(state, 0, 'hand', 'mantis-blades')
    state.players[0].hand = state.players[0].hand.filter(uid => uid !== gear)
    state.cards[a].attachedGear.push(gear)
    const [expected, rng] = shuffle(state.rng, [a, gear, b])
    bottomDeckCards(state, db, [a, b])
    expect(state.players[0].deck.slice(-3)).toEqual(expected)
    expect(state.rng).toEqual(rng)
    expect(state.players[0].field).not.toEqual(expect.arrayContaining([a, b]))
  })
})
