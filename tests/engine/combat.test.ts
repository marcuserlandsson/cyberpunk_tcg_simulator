import { describe, expect, it } from 'vitest'
import { stealCount } from '../../src/engine/combat'
import { canonicalPayment } from '../../src/engine/economy'
import { newGame } from '../../src/engine/game'
import { legalActions } from '../../src/engine/legal'
import { actingPlayer } from '../../src/engine/query'
import { applyAction, IllegalActionError } from '../../src/engine/reduce'
import type { Action, DieSize, GameState, GigDie, PlayerId, Reaction } from '../../src/engine/types'
import { db, decks, totalDice } from './gameHelpers'

// ---------------------------------------------------------------------------
// Scenario helpers
//
// Combat scenarios need precise control over both fields, so instead of hoping
// a seed deals the right cards these helpers *mint* fresh instances of real
// cards from the 141-card pool straight onto a field. `base()` first strips the
// incidental stuff (hands, gig dice, fixer dice) so `legalActions` in `main`
// contains nothing but attacks and `endTurn`.
//
// Cards used below (all vanilla, zero effects, so Task 7 can't change them):
//   psycho-squad             unit, power  6
//   delamain-cab             unit, power  4
//   minotaur                 unit, power  9
//   animals-wrecker          unit, power 10
//   pacifica-netrunner       unit, power  1
//   japantown-jonin          unit, power  0
//   valentino-street-racer   unit, power  3, {adrenaline}
//   corpo-security           unit, power  2, {blocker}
//   secondhand-bombus        unit, power  0, {blocker}
//   mantis-blades            gear
// ---------------------------------------------------------------------------

const PLAYERS: readonly PlayerId[] = [0, 1]

/** Player 0 active, turn 1, `main` phase, both fields/hands/gig areas empty. */
function base(seed = 201): GameState {
  let state = newGame(db, { decks, seed })
  const rollWinner = state.activePlayer
  state = applyAction(db, state, { type: 'choosePlayOrder', goFirst: rollWinner === 0 })
  state = applyAction(db, state, { type: 'keepHand' })
  state = applyAction(db, state, { type: 'keepHand' })
  state = applyAction(db, state, { type: 'chooseGigDie', size: 4 })

  const s = structuredClone(state)
  for (const player of PLAYERS) {
    const p = s.players[player]
    p.deck = [...p.deck, ...p.hand]
    p.hand = []
    p.gigArea = []
    p.fixer = []
  }
  return s
}

interface UnitOpts {
  ready?: boolean
  lag?: boolean
  tempPower?: number
}

/** Mints a fresh instance of `defId` onto `player`'s field. Mutates `state`. */
function putUnit(state: GameState, player: PlayerId, defId: string, opts: UnitOpts = {}): number {
  const uid = state.nextUid++
  state.cards[uid] = {
    uid,
    defId,
    owner: player,
    ready: opts.ready ?? true,
    lag: opts.lag ?? false,
    faceUp: true,
    attachedGear: [],
    tempPower: opts.tempPower ?? 0,
    permPower: 0,
  }
  state.players[player].field.push(uid)
  return uid
}

/** Mints a fresh gear instance attached to `host`. Mutates `state`. */
function attachGear(state: GameState, player: PlayerId, defId: string, host: number): number {
  const uid = state.nextUid++
  state.cards[uid] = {
    uid,
    defId,
    owner: player,
    ready: true,
    lag: false,
    faceUp: true,
    attachedGear: [],
    tempPower: 0,
    permPower: 0,
  }
  state.cards[host].attachedGear.push(uid)
  return uid
}

/** Gives `player` `count` fresh ready, face-down eddies from their deck. Mutates `state`. */
function putEddies(state: GameState, player: PlayerId, count: number): number[] {
  const p = state.players[player]
  const uids = p.deck.slice(0, count)
  p.deck = p.deck.slice(count)
  for (const uid of uids) {
    state.cards[uid].ready = true
    state.cards[uid].faceUp = false
  }
  p.eddies.push(...uids)
  return uids
}

function dice(...sizes: DieSize[]): GigDie[] {
  return sizes.map((size, i) => ({ size, value: (i % size) + 1 }))
}

function attackOptions(state: GameState): Extract<Action, { type: 'attack' }>[] {
  return legalActions(db, state).filter(
    (a): a is Extract<Action, { type: 'attack' }> => a.type === 'attack'
  )
}

function reactionOptions(state: GameState): Reaction[] {
  return legalActions(db, state).flatMap((a) => (a.type === 'react' ? [a.reaction] : []))
}

function gigOptions(state: GameState): number[] {
  return legalActions(db, state).flatMap((a) => (a.type === 'chooseGig' ? [a.dieIndex] : []))
}

function declare(state: GameState, attacker: number, target: number | 'gigArea'): GameState {
  return applyAction(db, state, { type: 'attack', attacker, target })
}

function react(state: GameState, reaction: Reaction): GameState {
  return applyAction(db, state, { type: 'react', reaction })
}

const passReaction: Reaction = { type: 'pass' }

// ---------------------------------------------------------------------------
// Who may attack
// ---------------------------------------------------------------------------

describe('attack legality: the attacker', () => {
  it('offers a ready, non-lagged friendly unit', () => {
    const s = base()
    const attacker = putUnit(s, 0, 'psycho-squad')
    putUnit(s, 1, 'delamain-cab', { ready: false })
    expect(attackOptions(s).map((a) => a.attacker)).toEqual([attacker])
  })

  it('does not offer a spent friendly unit', () => {
    const s = base()
    const spent = putUnit(s, 0, 'psycho-squad', { ready: false })
    const target = putUnit(s, 1, 'delamain-cab', { ready: false })
    expect(attackOptions(s)).toEqual([])
    expect(() => declare(s, spent, target)).toThrow(IllegalActionError)
  })

  it('does not offer a lagged friendly unit', () => {
    const s = base()
    const lagged = putUnit(s, 0, 'psycho-squad', { lag: true })
    const target = putUnit(s, 1, 'delamain-cab', { ready: false })
    expect(attackOptions(s)).toEqual([])
    expect(() => declare(s, lagged, target)).toThrow(IllegalActionError)
  })

  it('offers a lagged unit with {adrenaline} (it can attack the turn it was played)', () => {
    const s = base()
    const rusher = putUnit(s, 0, 'valentino-street-racer', { lag: true })
    const target = putUnit(s, 1, 'delamain-cab', { ready: false })
    expect(attackOptions(s).map((a) => a.attacker)).toEqual([rusher])
    expect(declare(s, rusher, target).pendingAttack).toEqual({ attacker: rusher, target })
  })

  it('still does not offer a spent {adrenaline} unit', () => {
    const s = base()
    putUnit(s, 0, 'valentino-street-racer', { ready: false, lag: true })
    putUnit(s, 1, 'delamain-cab', { ready: false })
    expect(attackOptions(s)).toEqual([])
  })

  it('does not offer a rival unit as the attacker', () => {
    const s = base()
    putUnit(s, 0, 'delamain-cab', { ready: false })
    const rivalReady = putUnit(s, 1, 'psycho-squad')
    expect(attackOptions(s)).toEqual([])
    expect(() => declare(s, rivalReady, 'gigArea')).toThrow(IllegalActionError)
  })
})

// ---------------------------------------------------------------------------
// What may be attacked
// ---------------------------------------------------------------------------

describe('attack legality: the target', () => {
  it('is exactly every spent rival unit plus a non-empty gig area', () => {
    const s = base()
    const attacker = putUnit(s, 0, 'psycho-squad')
    const spentA = putUnit(s, 1, 'delamain-cab', { ready: false })
    const spentB = putUnit(s, 1, 'minotaur', { ready: false })
    const readyRival = putUnit(s, 1, 'animals-wrecker')
    const friendlySpent = putUnit(s, 0, 'japantown-jonin', { ready: false })
    s.players[1].gigArea = dice(6)

    const targets = attackOptions(s)
      .filter((a) => a.attacker === attacker)
      .map((a) => a.target)
    expect(new Set(targets)).toEqual(new Set<number | 'gigArea'>([spentA, spentB, 'gigArea']))
    expect(targets).not.toContain(readyRival)
    expect(targets).not.toContain(friendlySpent)
  })

  it('never offers a ready rival unit, and applyAction rejects one', () => {
    const s = base()
    const attacker = putUnit(s, 0, 'psycho-squad')
    const readyRival = putUnit(s, 1, 'delamain-cab')
    expect(attackOptions(s)).toEqual([])
    expect(() => declare(s, attacker, readyRival)).toThrow(IllegalActionError)
  })

  it('does not offer an empty rival gig area (docs/rulings.md §24)', () => {
    const s = base()
    const attacker = putUnit(s, 0, 'psycho-squad')
    expect(s.players[1].gigArea).toEqual([])
    expect(attackOptions(s)).toEqual([])
    expect(() => declare(s, attacker, 'gigArea')).toThrow(IllegalActionError)
  })

  it('offers the gig area as soon as the rival holds one die', () => {
    const s = base()
    const attacker = putUnit(s, 0, 'psycho-squad')
    s.players[1].gigArea = dice(8)
    expect(attackOptions(s)).toEqual([{ type: 'attack', attacker, target: 'gigArea' }])
  })
})

// ---------------------------------------------------------------------------
// Declaring the attack
// ---------------------------------------------------------------------------

describe('declaring an attack', () => {
  it('spends the attacker, sets pendingAttack, opens the react window for the defender', () => {
    const s = base()
    const attacker = putUnit(s, 0, 'psycho-squad')
    const target = putUnit(s, 1, 'delamain-cab', { ready: false })

    const next = declare(s, attacker, target)
    expect(next.cards[attacker].ready).toBe(false)
    expect(next.pendingAttack).toEqual({ attacker, target })
    expect(next.pendingSteal).toBeNull()
    expect(next.phase).toBe('react')
    expect(next.activePlayer).toBe(0)
    expect(actingPlayer(next)).toBe(1)
    expect(next.events.at(-1)).toEqual({ type: 'attackDeclared', attacker, target })
    // The input state is untouched (draft pattern).
    expect(s.cards[attacker].ready).toBe(true)
    expect(s.phase).toBe('main')
  })

  it('makes attacking and every other main-phase action illegal inside the react window', () => {
    const s = base()
    const attacker = putUnit(s, 0, 'psycho-squad')
    const second = putUnit(s, 0, 'minotaur')
    const target = putUnit(s, 1, 'delamain-cab', { ready: false })

    const next = declare(s, attacker, target)
    expect(legalActions(db, next).every((a) => a.type === 'react')).toBe(true)
    expect(() => declare(next, second, target)).toThrow(IllegalActionError)
    expect(() => applyAction(db, next, { type: 'endTurn' })).toThrow(IllegalActionError)
  })

  it('rejects a react action while still in the main phase', () => {
    const s = base()
    putUnit(s, 0, 'psycho-squad')
    putUnit(s, 1, 'delamain-cab', { ready: false })
    expect(() => react(s, passReaction)).toThrow(IllegalActionError)
  })
})

// ---------------------------------------------------------------------------
// Fights
// ---------------------------------------------------------------------------

describe('fights', () => {
  it('the strictly higher power unit defeats the other', () => {
    const s = base()
    const attacker = putUnit(s, 0, 'psycho-squad') // power 6
    const target = putUnit(s, 1, 'delamain-cab', { ready: false }) // power 4

    const next = react(declare(s, attacker, target), passReaction)
    expect(next.players[1].field).not.toContain(target)
    expect(next.players[1].trash).toContain(target)
    expect(next.players[0].field).toContain(attacker)
    expect(next.cards[attacker].ready).toBe(false) // stays spent
    expect(next.events.filter((e) => e.type === 'unitDefeated')).toEqual([
      { type: 'unitDefeated', uid: target },
    ])
    expect(next.phase).toBe('main')
    expect(next.pendingAttack).toBeNull()
    expect(next.pendingSteal).toBeNull()
  })

  it('a weaker attacker dies and the defender survives', () => {
    const s = base()
    const attacker = putUnit(s, 0, 'delamain-cab') // power 4
    const target = putUnit(s, 1, 'minotaur', { ready: false }) // power 9

    const next = react(declare(s, attacker, target), passReaction)
    expect(next.players[0].trash).toContain(attacker)
    expect(next.players[0].field).not.toContain(attacker)
    expect(next.players[1].field).toContain(target)
    expect(next.cards[target].ready).toBe(false) // untouched by the fight
  })

  it('on a tie both units are defeated', () => {
    const s = base()
    const attacker = putUnit(s, 0, 'delamain-cab') // power 4
    const target = putUnit(s, 1, 'goro-takemura-losing-his-way', { ready: false }) // power 4

    const next = react(declare(s, attacker, target), passReaction)
    expect(next.players[0].trash).toContain(attacker)
    expect(next.players[1].trash).toContain(target)
    expect(next.players[0].field).not.toContain(attacker)
    expect(next.players[1].field).not.toContain(target)
    expect(next.events.filter((e) => e.type === 'unitDefeated')).toHaveLength(2)
  })

  it('uses effectivePower, so a temporary buff can win a fight', () => {
    const s = base()
    const attacker = putUnit(s, 0, 'delamain-cab', { tempPower: 6 }) // 4 + 6 = 10
    const target = putUnit(s, 1, 'minotaur', { ready: false }) // power 9

    const next = react(declare(s, attacker, target), passReaction)
    expect(next.players[1].trash).toContain(target)
    expect(next.players[0].field).toContain(attacker)
  })

  it('sends a defeated unit\'s attached gear to the trash with it', () => {
    const s = base()
    const attacker = putUnit(s, 0, 'psycho-squad') // power 6
    const target = putUnit(s, 1, 'delamain-cab', { ready: false }) // power 4
    const gearA = attachGear(s, 1, 'mantis-blades', target)
    const gearB = attachGear(s, 1, 'kiroshi-optics', target)
    const survivorGear = attachGear(s, 0, 'mantis-blades', attacker)

    const next = react(declare(s, attacker, target), passReaction)
    expect(next.players[1].trash).toContain(target)
    expect(next.players[1].trash).toContain(gearA)
    expect(next.players[1].trash).toContain(gearB)
    expect(next.cards[target].attachedGear).toEqual([])
    // The winner keeps its own gear.
    expect(next.cards[attacker].attachedGear).toEqual([survivorGear])
    expect(next.players[0].trash).not.toContain(survivorGear)
    for (const gear of [gearA, gearB]) {
      expect(next.events.some((e) => e.type === 'cardTrashed' && e.uid === gear)).toBe(true)
    }
  })

  it('a 0-power unit attacking a 0-power unit defeats it (and dies) — a 0-0 tie', () => {
    const s = base()
    const attacker = putUnit(s, 0, 'japantown-jonin') // power 0
    const target = putUnit(s, 1, 'evelyn-parker-scheming-siren', { ready: false }) // power 0

    const next = react(declare(s, attacker, target), passReaction)
    expect(next.players[0].trash).toContain(attacker)
    expect(next.players[1].trash).toContain(target)
  })
})

// ---------------------------------------------------------------------------
// Stealing gigs
// ---------------------------------------------------------------------------

describe('stealCount thresholds (guide p11)', () => {
  it('is 0 at power 0, 1 from power 1, +1 per 10 power', () => {
    expect(stealCount(0)).toBe(0)
    expect(stealCount(1)).toBe(1)
    expect(stealCount(9)).toBe(1)
    expect(stealCount(10)).toBe(2)
    expect(stealCount(19)).toBe(2)
    expect(stealCount(20)).toBe(3)
    expect(stealCount(-3)).toBe(0) // a debuffed unit steals nothing
  })
})

describe('gig-area attacks', () => {
  const cases: { defId: string; temp: number; power: number; steals: number }[] = [
    { defId: 'pacifica-netrunner', temp: 0, power: 1, steals: 1 },
    { defId: 'minotaur', temp: 0, power: 9, steals: 1 },
    { defId: 'animals-wrecker', temp: 0, power: 10, steals: 2 },
    { defId: 'animals-wrecker', temp: 10, power: 20, steals: 3 },
  ]

  for (const { defId, temp, power, steals } of cases) {
    it(`power ${power} steals ${steals} die/dice`, () => {
      const s = base()
      const attacker = putUnit(s, 0, defId, { tempPower: temp })
      s.players[1].gigArea = dice(4, 6, 8, 10)

      let next = react(declare(s, attacker, 'gigArea'), passReaction)
      expect(next.phase).toBe('chooseGig')
      expect(next.pendingSteal).toEqual({ attacker, remaining: steals })

      for (let taken = 0; taken < steals; taken++) {
        expect(next.phase).toBe('chooseGig')
        expect(actingPlayer(next)).toBe(0) // the attacker picks
        next = applyAction(db, next, { type: 'chooseGig', dieIndex: 0 })
      }
      expect(next.phase).toBe('main')
      expect(next.pendingAttack).toBeNull()
      expect(next.pendingSteal).toBeNull()
      expect(next.players[0].gigArea).toHaveLength(steals)
      expect(next.players[1].gigArea).toHaveLength(4 - steals)
      expect(next.events.filter((e) => e.type === 'gigStolen')).toHaveLength(steals)
    })
  }

  it('a 0-power unit steals nothing and never enters chooseGig (docs/rulings.md §25)', () => {
    const s = base()
    const attacker = putUnit(s, 0, 'japantown-jonin') // power 0
    s.players[1].gigArea = dice(4, 6)

    const next = react(declare(s, attacker, 'gigArea'), passReaction)
    expect(next.phase).toBe('main')
    expect(next.pendingAttack).toBeNull()
    expect(next.pendingSteal).toBeNull()
    expect(next.players[0].gigArea).toEqual([])
    expect(next.players[1].gigArea).toHaveLength(2)
    expect(next.events.some((e) => e.type === 'gigStolen')).toBe(false)
    expect(next.cards[attacker].ready).toBe(false) // still spent for nothing
  })

  it('caps the steal at the rival gig area size', () => {
    const s = base()
    const attacker = putUnit(s, 0, 'animals-wrecker', { tempPower: 10 }) // power 20 -> 3
    s.players[1].gigArea = dice(4)

    let next = react(declare(s, attacker, 'gigArea'), passReaction)
    expect(next.pendingSteal).toEqual({ attacker, remaining: 1 })
    next = applyAction(db, next, { type: 'chooseGig', dieIndex: 0 })
    expect(next.phase).toBe('main')
    expect(next.players[0].gigArea).toHaveLength(1)
    expect(next.players[1].gigArea).toEqual([])
  })

  it('lets the attacker choose which die to take, one at a time', () => {
    const s = base()
    const attacker = putUnit(s, 0, 'animals-wrecker') // power 10 -> 2 steals
    s.players[1].gigArea = [
      { size: 4, value: 1 },
      { size: 6, value: 5 },
      { size: 8, value: 8 },
    ]

    let next = react(declare(s, attacker, 'gigArea'), passReaction)
    expect(gigOptions(next)).toEqual([0, 1, 2]) // one entry per rival die

    // Take the d8 first, then the d4 — order and identity must be respected.
    next = applyAction(db, next, { type: 'chooseGig', dieIndex: 2 })
    expect(next.players[0].gigArea).toEqual([{ size: 8, value: 8 }])
    expect(next.players[1].gigArea).toEqual([
      { size: 4, value: 1 },
      { size: 6, value: 5 },
    ])
    expect(next.pendingSteal).toEqual({ attacker, remaining: 1 })
    expect(gigOptions(next)).toEqual([0, 1])
    expect(next.events.at(-1)).toEqual({ type: 'gigStolen', from: 1, die: { size: 8, value: 8 } })

    next = applyAction(db, next, { type: 'chooseGig', dieIndex: 0 })
    expect(next.players[0].gigArea).toEqual([
      { size: 8, value: 8 },
      { size: 4, value: 1 },
    ])
    expect(next.players[1].gigArea).toEqual([{ size: 6, value: 5 }])
    expect(next.phase).toBe('main')
  })

  it('rejects an out-of-range or negative dieIndex', () => {
    const s = base()
    const attacker = putUnit(s, 0, 'animals-wrecker')
    s.players[1].gigArea = dice(4, 6)
    const stealing = react(declare(s, attacker, 'gigArea'), passReaction)

    expect(() => applyAction(db, stealing, { type: 'chooseGig', dieIndex: 2 })).toThrow(
      IllegalActionError
    )
    expect(() => applyAction(db, stealing, { type: 'chooseGig', dieIndex: -1 })).toThrow(
      IllegalActionError
    )
  })

  it('allows a second attack after the steal resolves', () => {
    const s = base()
    const first = putUnit(s, 0, 'pacifica-netrunner') // power 1 -> 1 steal
    const second = putUnit(s, 0, 'minotaur')
    s.players[1].gigArea = dice(4, 6)

    let next = react(declare(s, first, 'gigArea'), passReaction)
    next = applyAction(db, next, { type: 'chooseGig', dieIndex: 0 })
    expect(next.phase).toBe('main')
    expect(attackOptions(next).map((a) => a.attacker)).toEqual([second])
    next = react(declare(next, second, 'gigArea'), passReaction)
    next = applyAction(db, next, { type: 'chooseGig', dieIndex: 0 })
    expect(next.players[0].gigArea).toHaveLength(2)
    expect(next.players[1].gigArea).toEqual([])
  })

  it('conserves all 12 gig dice across a multi-die steal', () => {
    const s = base()
    const attacker = putUnit(s, 0, 'animals-wrecker', { tempPower: 10 }) // 3 steals
    s.players[0].gigArea = dice(4, 6, 8, 10, 12, 20)
    s.players[1].gigArea = dice(4, 6, 8, 10, 12, 20)
    expect(totalDice(s)).toBe(12)

    let next = react(declare(s, attacker, 'gigArea'), passReaction)
    while (next.phase === 'chooseGig') {
      expect(totalDice(next)).toBe(12)
      next = applyAction(db, next, { type: 'chooseGig', dieIndex: 0 })
    }
    expect(totalDice(next)).toBe(12)
    expect(next.players[0].gigArea).toHaveLength(9)
    expect(next.players[1].gigArea).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// Blockers
// ---------------------------------------------------------------------------

describe('blocker reactions', () => {
  it('offers one block per ready {blocker} unit, and nothing for other units', () => {
    const s = base()
    const attacker = putUnit(s, 0, 'psycho-squad')
    const blocker = putUnit(s, 1, 'corpo-security') // ready {blocker}
    putUnit(s, 1, 'secondhand-bombus', { ready: false }) // {blocker} but spent
    putUnit(s, 1, 'delamain-cab') // ready, no {blocker}
    s.players[1].gigArea = dice(6)

    const reactions = reactionOptions(declare(s, attacker, 'gigArea'))
    expect(reactions.filter((r) => r.type === 'block')).toEqual([{ type: 'block', blocker }])
  })

  it('redirects the attack: a fight against the blocker and NO steal even on a win', () => {
    const s = base()
    const attacker = putUnit(s, 0, 'psycho-squad') // power 6
    const blocker = putUnit(s, 1, 'corpo-security') // power 2, {blocker}
    s.players[1].gigArea = dice(4, 6)

    const next = react(declare(s, attacker, 'gigArea'), { type: 'block', blocker })
    expect(next.events.some((e) => e.type === 'attackBlocked' && e.blocker === blocker)).toBe(true)
    expect(next.players[1].trash).toContain(blocker) // lost the fight
    expect(next.players[0].field).toContain(attacker)
    // Guide p11: a redirected direct attack steals nothing.
    expect(next.players[0].gigArea).toEqual([])
    expect(next.players[1].gigArea).toHaveLength(2)
    expect(next.events.some((e) => e.type === 'gigStolen')).toBe(false)
    expect(next.phase).toBe('main') // the block resolves the attack immediately
    expect(next.pendingAttack).toBeNull()
    expect(next.pendingSteal).toBeNull()
  })

  it('spends the blocker, and a 0-power blocker still absorbs the attack', () => {
    const s = base()
    const attacker = putUnit(s, 0, 'pacifica-netrunner') // power 1
    const blocker = putUnit(s, 1, 'secondhand-bombus') // power 0, {blocker}
    s.players[1].gigArea = dice(4)

    const next = react(declare(s, attacker, 'gigArea'), { type: 'block', blocker })
    expect(next.cards[blocker].ready).toBe(false)
    expect(next.players[1].trash).toContain(blocker)
    expect(next.players[1].gigArea).toHaveLength(1) // nothing stolen
    expect(next.players[0].gigArea).toEqual([])
  })

  it('can redirect a unit-vs-unit attack too, sparing the original target', () => {
    const s = base()
    const attacker = putUnit(s, 0, 'psycho-squad') // power 6
    const target = putUnit(s, 1, 'delamain-cab', { ready: false }) // power 4
    const blocker = putUnit(s, 1, 'corpo-security') // power 2, {blocker}

    const next = react(declare(s, attacker, target), { type: 'block', blocker })
    expect(next.pendingAttack).toBeNull()
    expect(next.players[1].field).toContain(target) // untouched
    expect(next.players[1].trash).toContain(blocker)
  })

  it('a blocker that outpowers the attacker kills it (and survives)', () => {
    const s = base()
    const attacker = putUnit(s, 0, 'pacifica-netrunner') // power 1
    const blocker = putUnit(s, 1, 'corpo-security') // power 2, {blocker}
    s.players[1].gigArea = dice(4)

    const next = react(declare(s, attacker, 'gigArea'), { type: 'block', blocker })
    expect(next.players[0].trash).toContain(attacker)
    expect(next.players[1].field).toContain(blocker)
    expect(next.cards[blocker].ready).toBe(false)
  })

  it('rejects blocking with a spent blocker, a non-blocker, or a friendly unit', () => {
    const s = base()
    const attacker = putUnit(s, 0, 'psycho-squad')
    const spentBlocker = putUnit(s, 1, 'corpo-security', { ready: false })
    const nonBlocker = putUnit(s, 1, 'delamain-cab')
    const ownBlocker = putUnit(s, 0, 'corpo-security')
    s.players[1].gigArea = dice(6)

    const window = declare(s, attacker, 'gigArea')
    expect(reactionOptions(window).some((r) => r.type === 'block')).toBe(false)
    for (const blocker of [spentBlocker, nonBlocker, ownBlocker]) {
      expect(() => react(window, { type: 'block', blocker })).toThrow(IllegalActionError)
    }
  })
})

// ---------------------------------------------------------------------------
// Call a Legend as a reaction
// ---------------------------------------------------------------------------

describe('callLegend as a reaction', () => {
  it('flips a legend, keeps the react window open, and consumes the shared once-per-turn call', () => {
    const s = base()
    const attacker = putUnit(s, 0, 'psycho-squad')
    s.players[1].gigArea = dice(6)

    const window = declare(s, attacker, 'gigArea')
    expect(window.players[1].calledLegendThisTurn).toBe(false)
    const call = reactionOptions(window).find(
      (r): r is Extract<Reaction, { type: 'callLegend' }> => r.type === 'callLegend'
    )
    expect(call).toBeDefined()
    expect(call!.payment).toHaveLength(1)

    const called = react(window, call!)
    expect(called.players[1].calledLegendThisTurn).toBe(true)
    expect(called.players[1].legends.filter((u) => called.cards[u].faceUp)).toHaveLength(1)
    expect(called.events.some((e) => e.type === 'legendCalled')).toBe(true)
    // The window is still open, and the call is gone from it.
    expect(called.phase).toBe('react')
    expect(called.pendingAttack).toEqual({ attacker, target: 'gigArea' })
    expect(reactionOptions(called).some((r) => r.type === 'callLegend')).toBe(false)
    expect(() => react(called, call!)).toThrow(IllegalActionError)
  })

  it('is not offered when the defender already used this turn\'s call', () => {
    // The allowance is per game turn (docs/rulings.md §26), so a defender who
    // already called earlier *in this same turn* — reacting to an earlier
    // attack — gets no second call.
    const s = base()
    const attacker = putUnit(s, 0, 'psycho-squad')
    s.players[1].gigArea = dice(6)
    s.players[1].calledLegendThisTurn = true

    const window = declare(s, attacker, 'gigArea')
    expect(reactionOptions(window).some((r) => r.type === 'callLegend')).toBe(false)
  })

  it('accepts any valid payment, not just the canonical one', () => {
    const s = base()
    const attacker = putUnit(s, 0, 'psycho-squad')
    s.players[1].gigArea = dice(6)
    const window = declare(s, attacker, 'gigArea')

    const readyLegends = window.players[1].legends.filter((u) => window.cards[u].ready)
    expect(readyLegends.length).toBeGreaterThan(1)
    const nonCanonical = readyLegends[readyLegends.length - 1]
    const called = react(window, { type: 'callLegend', payment: [nonCanonical] })
    expect(called.cards[nonCanonical].ready).toBe(false)
    expect(called.cards[readyLegends[0]].ready).toBe(true)

    // …but not an invalid one.
    expect(() => react(window, { type: 'callLegend', payment: [] })).toThrow(IllegalActionError)
    expect(() =>
      react(window, { type: 'callLegend', payment: [nonCanonical, readyLegends[0]] })
    ).toThrow(IllegalActionError)
  })

  it('lets the defender block after calling a legend', () => {
    const s = base()
    const attacker = putUnit(s, 0, 'psycho-squad') // power 6
    const blocker = putUnit(s, 1, 'corpo-security') // power 2, {blocker}
    s.players[1].gigArea = dice(6)

    const window = declare(s, attacker, 'gigArea')
    const call = reactionOptions(window).find((r) => r.type === 'callLegend')!
    const called = react(window, call)
    expect(reactionOptions(called).some((r) => r.type === 'block')).toBe(true)

    const blocked = react(called, { type: 'block', blocker })
    expect(blocked.players[1].trash).toContain(blocker)
    expect(blocked.players[0].gigArea).toEqual([])
    expect(blocked.phase).toBe('main')
  })

  it('is illegal when the defender cannot pay or has no face-down legend', () => {
    const s = base()
    const attacker = putUnit(s, 0, 'psycho-squad')
    s.players[1].gigArea = dice(6)

    const broke = structuredClone(s)
    for (const uid of broke.players[1].legends) broke.cards[uid].ready = false
    expect(reactionOptions(declare(broke, attacker, 'gigArea')).some((r) => r.type === 'callLegend')).toBe(false)

    const allUp = structuredClone(s)
    for (const uid of allUp.players[1].legends) allUp.cards[uid].faceUp = true
    expect(reactionOptions(declare(allUp, attacker, 'gigArea')).some((r) => r.type === 'callLegend')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The Call-a-Legend allowance across turns (docs/rulings.md §26)
//
// "Each turn, you may spend 1 €$ to flip a Legend face-up. You can do this
// during your main phase, or as a reaction when a rival Unit attacks."
// (glossary CALL A LEGEND). "Each turn" is each *game* turn, for each player:
// every turn start refreshes BOTH players' allowance, so a main-phase call
// never eats the reaction call you would have had on the rival's next turn.
// Within one and the same game turn, though, nobody gets two calls.
// ---------------------------------------------------------------------------

describe('the Call-a-Legend allowance refreshes every game turn', () => {
  it("a main-phase call does not block that player's reaction call on the rival's next turn", () => {
    const s = base()
    putEddies(s, 0, 1) // so the main-phase call cannot exhaust player 0's payments
    s.players[0].gigArea = dice(6) // something for player 1 to raid
    const raider = putUnit(s, 1, 'psycho-squad')

    // Player 0 calls a legend during their own main phase.
    const mainCall = legalActions(db, s).find((a) => a.type === 'callLegend')
    expect(mainCall).toBeDefined()
    let next = applyAction(db, s, mainCall!)
    expect(next.players[0].calledLegendThisTurn).toBe(true)

    // Player 1's turn begins: the allowance refreshes for BOTH players.
    next = applyAction(db, next, { type: 'endTurn' })
    expect(next.activePlayer).toBe(1)
    expect(next.phase).toBe('main')
    expect(next.players[0].calledLegendThisTurn).toBe(false)
    expect(next.players[1].calledLegendThisTurn).toBe(false)

    // Player 1 attacks, and player 0 may call again — as a reaction this time.
    const window = declare(next, raider, 'gigArea')
    expect(canonicalPayment(window, 0, 1)).not.toBeNull() // affordability is not the question
    const reaction = reactionOptions(window).find(
      (r): r is Extract<Reaction, { type: 'callLegend' }> => r.type === 'callLegend'
    )
    expect(reaction).toBeDefined()

    const called = react(window, reaction!)
    expect(called.players[0].calledLegendThisTurn).toBe(true)
    expect(called.players[0].legends.filter((u) => called.cards[u].faceUp)).toHaveLength(2)
    expect(called.phase).toBe('react') // the window is still open
  })

  it("a reaction call does not block that player's main-phase call on their own next turn", () => {
    const s = base()
    const victim = putUnit(s, 0, 'japantown-jonin', { ready: false }) // power 0, a free kill
    const raider = putUnit(s, 1, 'psycho-squad')

    let next = applyAction(db, s, { type: 'endTurn' }) // player 1's turn 1
    const window = declare(next, raider, victim)
    const reaction = reactionOptions(window).find((r) => r.type === 'callLegend')
    expect(reaction).toBeDefined()
    next = react(window, reaction!)
    expect(next.players[0].calledLegendThisTurn).toBe(true)
    next = react(next, passReaction)
    expect(next.phase).toBe('main')

    // Player 0's turn 2 begins: they may call again.
    next = applyAction(db, next, { type: 'endTurn' })
    expect(next.activePlayer).toBe(0)
    expect(next.turnNumber).toBe(2)
    expect(next.players[0].calledLegendThisTurn).toBe(false)
    expect(next.players[0].legends.filter((u) => !next.cards[u].faceUp)).toHaveLength(2)
    expect(legalActions(db, next).some((a) => a.type === 'callLegend')).toBe(true)
  })

  it('nobody may call twice within the same game turn', () => {
    const s = base()
    putEddies(s, 0, 3) // player 0 can always pay, so only the gate can stop them
    const victimA = putUnit(s, 0, 'japantown-jonin', { ready: false })
    const victimB = putUnit(s, 0, 'evelyn-parker-scheming-siren', { ready: false })
    const raiderA = putUnit(s, 1, 'psycho-squad')
    const raiderB = putUnit(s, 1, 'minotaur')

    let next = applyAction(db, s, { type: 'endTurn' }) // player 1's turn 1

    // Attack 1: the defender reacts with a call, then passes.
    let window = declare(next, raiderA, victimA)
    const call = reactionOptions(window).find((r) => r.type === 'callLegend')
    expect(call).toBeDefined()
    next = react(react(window, call!), passReaction)
    expect(next.players[0].calledLegendThisTurn).toBe(true)

    // Attack 2, same turn: still affordable, but the allowance is used up.
    window = declare(next, raiderB, victimB)
    expect(canonicalPayment(window, 0, 1)).not.toBeNull()
    expect(reactionOptions(window).some((r) => r.type === 'callLegend')).toBe(false)
    expect(() => react(window, call!)).toThrow(IllegalActionError)
    next = react(window, passReaction)

    // The attacker's own allowance is equally single-use inside their turn.
    expect(next.phase).toBe('main')
    const ownCall = legalActions(db, next).find((a) => a.type === 'callLegend')
    expect(ownCall).toBeDefined()
    next = applyAction(db, next, ownCall!)
    expect(next.players[1].calledLegendThisTurn).toBe(true)
    expect(legalActions(db, next).some((a) => a.type === 'callLegend')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The react window itself
// ---------------------------------------------------------------------------

describe('the react window', () => {
  it('always offers pass, and pass with no other reaction resolves the attack', () => {
    const s = base()
    const attacker = putUnit(s, 0, 'psycho-squad')
    const target = putUnit(s, 1, 'delamain-cab', { ready: false })

    const window = declare(s, attacker, target)
    expect(reactionOptions(window).some((r) => r.type === 'pass')).toBe(true)
    const resolved = react(window, passReaction)
    expect(resolved.phase).toBe('main')
    expect(resolved.players[1].trash).toContain(target)
  })

  it('offers pass + callLegend only, until a {quick} card gives the defender more (Task 7)', () => {
    const s = base()
    const attacker = putUnit(s, 0, 'psycho-squad')
    s.players[1].gigArea = dice(6)

    const bare = reactionOptions(declare(s, attacker, 'gigArea'))
    expect(bare.some((r) => r.type === 'quick' || r.type === 'quickAbility')).toBe(false)
    expect(bare.map((r) => r.type).sort()).toEqual(['callLegend', 'pass'])

    // `floor-it` is a cost-1 {quick} Program; the defender's ready legends can
    // pay for it, so it shows up as a `quick` reaction (Task 7, effects.test.ts
    // covers the mechanics).
    const withQuick = structuredClone(s)
    const quickUid = withQuick.nextUid++
    withQuick.cards[quickUid] = {
      uid: quickUid,
      defId: 'floor-it',
      owner: 1,
      ready: true,
      lag: false,
      faceUp: true,
      attachedGear: [],
      tempPower: 0,
      permPower: 0,
    }
    withQuick.players[1].hand.push(quickUid)

    const reactions = reactionOptions(declare(withQuick, attacker, 'gigArea'))
    expect(reactions.some((r) => r.type === 'quick' && r.card === quickUid)).toBe(true)
  })

  it('is closed to the attacker: only react actions, chosen by the defender, are legal', () => {
    const s = base()
    const attacker = putUnit(s, 0, 'psycho-squad')
    s.players[1].gigArea = dice(6)
    const window = declare(s, attacker, 'gigArea')

    expect(actingPlayer(window)).toBe(1)
    expect(legalActions(db, window).every((a) => a.type === 'react')).toBe(true)
    expect(() => applyAction(db, window, { type: 'chooseGig', dieIndex: 0 })).toThrow(
      IllegalActionError
    )
  })
})

// ---------------------------------------------------------------------------
// Win conditions interacting with combat
// ---------------------------------------------------------------------------

describe('win conditions', () => {
  it('reaching 7 gig dice mid-turn does not win instantly (the check is at turn start)', () => {
    const s = base()
    const attacker = putUnit(s, 0, 'pacifica-netrunner') // power 1 -> 1 steal
    s.players[0].gigArea = dice(4, 6, 8, 10, 12, 20)
    s.players[1].gigArea = dice(4, 6, 8, 10, 12, 20)
    s.turnNumber = 3 // not overtime

    let next = react(declare(s, attacker, 'gigArea'), passReaction)
    next = applyAction(db, next, { type: 'chooseGig', dieIndex: 0 })
    expect(next.players[0].gigArea).toHaveLength(7)
    expect(next.winner).toBeNull()
    expect(next.phase).toBe('main')

    // …and it does win once player 0's next turn starts.
    next = applyAction(db, next, { type: 'endTurn' })
    next = applyAction(db, next, { type: 'endTurn' })
    expect(next.winner).toBe(0)
    expect(next.events.some((e) => e.type === 'gameEnded' && e.reason === 'sevenGigs')).toBe(true)
  })

  it('overtime sudden death fires the moment a steal breaks the tie', () => {
    const s = base()
    const attacker = putUnit(s, 0, 'pacifica-netrunner')
    s.players[0].gigArea = dice(4, 6, 8, 10, 12, 20)
    s.players[1].gigArea = dice(4, 6, 8, 10, 12, 20)
    s.turnNumber = 8 // overtime (both players have completed 7 turns)

    let next = react(declare(s, attacker, 'gigArea'), passReaction)
    expect(next.winner).toBeNull() // 6-6 is still a tie
    next = applyAction(db, next, { type: 'chooseGig', dieIndex: 0 })
    expect(next.winner).toBe(0)
    expect(next.phase).toBe('gameOver')
    expect(next.events.some((e) => e.type === 'gameEnded' && e.reason === 'overtimeMajority')).toBe(
      true
    )
    expect(legalActions(db, next)).toEqual([])
  })

  it('a defeated unit does not end the game or leak dice', () => {
    const s = base()
    const attacker = putUnit(s, 0, 'psycho-squad')
    const target = putUnit(s, 1, 'delamain-cab', { ready: false })
    s.players[0].gigArea = dice(4, 6)
    s.players[1].gigArea = dice(4, 6)

    const next = react(declare(s, attacker, target), passReaction)
    expect(next.winner).toBeNull()
    expect(totalDice(next)).toBe(4)
  })
})
