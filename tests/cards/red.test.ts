// Task 8 — Red cards, batch 1: the 19 Red cards assigned to this batch (the
// pool holds 37 Red cards in all; the rest belong to later batches).
//
// Every test here drives a REAL card definition from `data/cards.json` through
// the public engine API (`newGame` / `legalActions` / `applyAction`), using the
// shared fixtures in ./fixtures.ts. Nothing is asserted about a synthetic card:
// the point of this file is that the *data* is right, and that the engine reads
// it the way the printed text says.
//
// Cards covered, in card-id order:
//   6th-street-recruits, adam-smasher-ender-of-legends, all-is-lost,
//   animals-wrecker (vanilla/flavour), arasaka-emergency-radioport,
//   bonnie-and-clyde, carnage-at-the-colosseum, deadman-transmitter,
//   dexter-deshawn-off-the-grid, el-sombreron-la-venganza-lenta,
//   gunpoint-diplomacy, industrial-assembly, japantown-jonin,
//   johnny-silverhand-never-stop-fighting, johnny-silverhand-rocking-renegade,
//   kerry-eurodyne-the-last-rockerboy, la-llorona-ghost-of-the-past.
// Deferred (see the batch report): appetite-for-destruction, chrome-fang.

import { describe, expect, it } from 'vitest'
import { effectivePower, streetCred } from '../../src/engine/query'
import { applyAction } from '../../src/engine/reduce'
import {
  actionsOfType,
  activate,
  attackAndSteal,
  blockWith,
  db,
  endBothTurnsOnce,
  fieldCard,
  findFielded,
  findInHand,
  fixtureWithHand,
  gigValues,
  mintInto,
  passReact,
  playCardByDef,
  setGigs,
  startAttack,
} from './fixtures'

// ---------------------------------------------------------------------------
// 6th-street-recruits — "When a friendly Unit steals a d6, increase a Gig by
// up to 6."
// ---------------------------------------------------------------------------

describe('6th-street-recruits', () => {
  it('increases a friendly Gig when a friendly Unit steals a d6', () => {
    const { state } = fixtureWithHand(0, [])
    const thief = fieldCard(state, 0, '6th-street-recruits') // power 6 -> steals 1
    setGigs(state, 0, [{ size: 20, value: 1 }])
    setGigs(state, 1, [{ size: 6, value: 2 }])

    const next = attackAndSteal(db, state, thief, 'gigArea', [0])
    expect(next.players[0].gigArea).toHaveLength(2)
    // Street cred was 1, the stolen d6 adds 2, and the watcher adds up to 6 to
    // one of the two dice (which die is an auto-choice, docs/rulings.md §32):
    // the d20 1 -> 7, or the just-stolen d6 2 -> 6.
    expect([9, 7]).toContain(streetCred(next, 0))
    expect(streetCred(next, 0)).toBeGreaterThan(1 + 2)
  })

  it('does not fire for a die of another size', () => {
    const { state } = fixtureWithHand(0, [])
    const thief = fieldCard(state, 0, '6th-street-recruits')
    setGigs(state, 0, [{ size: 20, value: 1 }])
    setGigs(state, 1, [{ size: 8, value: 2 }])

    const next = attackAndSteal(db, state, thief, 'gigArea', [0])
    expect(gigValues(next, 0).sort((a, b) => a - b)).toEqual([1, 2])
  })
})

// ---------------------------------------------------------------------------
// adam-smasher-ender-of-legends — {Go Solo}, "{Play} Defeat a rival Unit."
// ---------------------------------------------------------------------------

describe('adam-smasher-ender-of-legends', () => {
  it('goes solo for 9 and defeats a rival Unit as it lands', () => {
    const { state } = fixtureWithHand(0, [], { eddies: 12 })
    state.players[0].legends = []
    const smasher = mintInto(state, 0, 'legends', 'adam-smasher-ender-of-legends')
    const victim = fieldCard(state, 1, 'animals-wrecker', { ready: false })

    const play = actionsOfType(db, state, 'playCard').find((a) => a.card === smasher)
    expect(play).toBeDefined()
    expect(play!.payment).toHaveLength(9) // its printed cost
    expect(play!.targets).toEqual([victim])

    const next = applyAction(db, state, play!)
    expect(next.players[1].trash).toContain(victim)
    expect(next.players[0].field).toContain(smasher)
    // {Go Solo}: on the field, ready, no Lag — it can attack at once.
    expect(next.cards[smasher].lag).toBe(false)
    setGigs(next, 1, [{ size: 6, value: 3 }])
    expect(
      actionsOfType(db, next, 'attack').some((a) => a.attacker === smasher)
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// all-is-lost — "Trash 3. Add a Unit from among them to your hand."
// ---------------------------------------------------------------------------

describe('all-is-lost', () => {
  it('trashes the top 3 and returns the Unit among them to hand', () => {
    const { state } = fixtureWithHand(0, ['all-is-lost'])
    // [surgery] a known top-of-deck: program, unit, program.
    const progA = mintInto(state, 0, 'deck', 'industrial-assembly')
    const unit = mintInto(state, 0, 'deck', 'animals-wrecker')
    const progB = mintInto(state, 0, 'deck', 'industrial-assembly')
    const rest = state.players[0].deck.filter((uid) => ![progA, unit, progB].includes(uid))
    state.players[0].deck = [progA, unit, progB, ...rest]
    const deckBefore = state.players[0].deck.length

    const next = playCardByDef(db, state, 0, 'all-is-lost')
    expect(next.players[0].deck).toHaveLength(deckBefore - 3)
    expect(next.players[0].hand).toContain(unit) // the Unit came back
    expect(next.players[0].trash).toContain(progA)
    expect(next.players[0].trash).toContain(progB)
    expect(next.players[0].trash).not.toContain(unit)
  })

  it('trashes 3 and keeps nothing when none of them is a Unit', () => {
    const { state } = fixtureWithHand(0, ['all-is-lost'])
    const programs = [0, 1, 2].map(() => mintInto(state, 0, 'deck', 'industrial-assembly'))
    const rest = state.players[0].deck.filter((uid) => !programs.includes(uid))
    state.players[0].deck = [...programs, ...rest]

    const next = playCardByDef(db, state, 0, 'all-is-lost')
    for (const uid of programs) expect(next.players[0].trash).toContain(uid)
    expect(next.players[0].hand.some((uid) => programs.includes(uid))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// animals-wrecker — no rules text (the printed line is flavour, rulings §51)
// ---------------------------------------------------------------------------

describe('animals-wrecker', () => {
  it('is a vanilla 6-cost 10-power Ganger that simply wins its fights', () => {
    const def = db['animals-wrecker']
    expect(def.effects).toEqual([])
    expect([def.cost, def.power]).toEqual([6, 10])
    expect(def.keywords).toEqual(['animal', 'ganger'])

    const { state } = fixtureWithHand(0, ['animals-wrecker'])
    let next = playCardByDef(db, state, 0, 'animals-wrecker')
    const wrecker = findFielded(next, 0, 'animals-wrecker')
    expect(next.cards[wrecker].lag).toBe(true) // a freshly played Unit has Lag
    expect(effectivePower(db, next, wrecker)).toBe(10)

    next = endBothTurnsOnce(db, next)
    const victim = fieldCard(next, 1, 'kerry-eurodyne-the-last-rockerboy', { ready: false })
    next = passReact(db, startAttack(db, next, wrecker, victim))
    expect(next.players[1].trash).toContain(victim)
    expect(next.players[0].field).toContain(wrecker)
  })
})

// ---------------------------------------------------------------------------
// arasaka-emergency-radioport — "When this Unit or Legend is spent, you may
// look at a friendly face-down Legend. If that Legend is ARASAKA or has
// {Go Solo}, you may Call it for free."
// ---------------------------------------------------------------------------

describe('arasaka-emergency-radioport', () => {
  function stage(legendId: string): ReturnType<typeof fixtureWithHand> {
    const fixture = fixtureWithHand(0, ['arasaka-emergency-radioport'])
    const state = fixture.state
    state.players[0].legends = []
    mintInto(state, 0, 'legends', legendId, { faceUp: false })
    fieldCard(state, 0, 'japantown-jonin') // the host, ready and Lag-free
    setGigs(state, 1, [{ size: 6, value: 3 }]) // something to attack
    return fixture
  }

  it('Calls a face-down ARASAKA Legend for free when its host is spent', () => {
    const { state } = stage('saburo-arasaka-stubborn-patriarch')
    let next = playCardByDef(db, state, 0, 'arasaka-emergency-radioport', {
      targetDef: 'japantown-jonin',
    })
    const host = findFielded(next, 0, 'japantown-jonin')
    expect(next.cards[host].attachedGear).toHaveLength(1)
    const legend = next.players[0].legends[0]
    expect(next.cards[legend].faceUp).toBe(false)

    // Attacking spends the host, which fires the Gear's {Spend} trigger.
    next = startAttack(db, next, host, 'gigArea')
    expect(next.cards[legend].faceUp).toBe(true)
    expect(next.players[0].calledLegendThisTurn).toBe(true)
    expect(next.events.some((e) => e.type === 'legendCalled' && e.uid === legend)).toBe(true)
  })

  it('leaves a Legend that is neither ARASAKA nor {Go Solo} face-down', () => {
    const { state } = stage('alt-cunningham-soulkiller-architect')
    let next = playCardByDef(db, state, 0, 'arasaka-emergency-radioport', {
      targetDef: 'japantown-jonin',
    })
    const host = findFielded(next, 0, 'japantown-jonin')
    const legend = next.players[0].legends[0]

    next = startAttack(db, next, host, 'gigArea')
    expect(next.cards[legend].faceUp).toBe(false)
    expect(next.players[0].calledLegendThisTurn).toBe(false)
  })

  it('respects the once-per-turn Call gate', () => {
    const { state } = stage('saburo-arasaka-stubborn-patriarch')
    let next = playCardByDef(db, state, 0, 'arasaka-emergency-radioport', {
      targetDef: 'japantown-jonin',
    })
    next.players[0].calledLegendThisTurn = true
    const host = findFielded(next, 0, 'japantown-jonin')
    const legend = next.players[0].legends[0]

    next = startAttack(db, next, host, 'gigArea')
    expect(next.cards[legend].faceUp).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// bonnie-and-clyde — "Defeat a rival Unit with power 4 or less. You may defeat
// 2 instead if a Rival controls at least 2 Gigs more than you."
// ---------------------------------------------------------------------------

describe('bonnie-and-clyde', () => {
  function stage(): { state: ReturnType<typeof fixtureWithHand>['state']; weak: number[]; tough: number } {
    const { state } = fixtureWithHand(0, ['bonnie-and-clyde'])
    const a = fieldCard(state, 1, 'japantown-jonin') // power 0
    const b = fieldCard(state, 1, 'la-llorona-ghost-of-the-past') // power 3
    const tough = fieldCard(state, 1, 'animals-wrecker') // power 10 — out of range
    return { state, weak: [a, b], tough }
  }

  it('only ever targets rival Units of power 4 or less', () => {
    const { state, weak, tough } = stage()
    const card = findInHand(state, 0, 'bonnie-and-clyde')
    const plays = actionsOfType(db, state, 'playCard').filter((a) => a.card === card)
    const targeted = new Set(plays.flatMap((a) => a.targets))
    expect([...targeted].sort()).toEqual([...weak].sort())
    expect(targeted.has(tough)).toBe(false)
  })

  it('defeats one without the Gig deficit, and two with it', () => {
    const { state, weak } = stage()
    setGigs(state, 0, [{ size: 6, value: 1 }])
    setGigs(state, 1, [{ size: 6, value: 1 }, { size: 6, value: 2 }]) // lead of 1

    const one = playCardByDef(db, state, 0, 'bonnie-and-clyde', { targets: weak })
    expect(one.players[1].trash).toEqual([weak[0]])
    expect(one.players[1].field).toContain(weak[1])

    setGigs(state, 1, [
      { size: 6, value: 1 },
      { size: 6, value: 2 },
      { size: 6, value: 3 },
    ]) // lead of 2
    const two = playCardByDef(db, state, 0, 'bonnie-and-clyde', { targets: weak })
    expect(two.players[1].trash.sort()).toEqual([...weak].sort())
  })
})

// ---------------------------------------------------------------------------
// carnage-at-the-colosseum — "Play this Program for -1 €$ for each friendly Gig
// with 8+ value, to a minimum of 1 €$. Defeat a rival Unit with less power than
// a friendly Unit."
// ---------------------------------------------------------------------------

describe('carnage-at-the-colosseum', () => {
  it('costs 1 €$ less per friendly Gig with 8+ value, never below 1', () => {
    const { state } = fixtureWithHand(0, ['carnage-at-the-colosseum'])
    fieldCard(state, 0, 'animals-wrecker') // power 10, so the effect has a target
    fieldCard(state, 1, 'japantown-jonin')
    const card = findInHand(state, 0, 'carnage-at-the-colosseum')

    setGigs(state, 0, [{ size: 10, value: 3 }])
    expect(actionsOfType(db, state, 'playCard').find((a) => a.card === card)!.payment).toHaveLength(6)

    setGigs(state, 0, [
      { size: 10, value: 9 },
      { size: 10, value: 8 },
      { size: 10, value: 3 },
    ])
    const discounted = actionsOfType(db, state, 'playCard').find((a) => a.card === card)!
    expect(discounted.payment).toHaveLength(4)

    setGigs(state, 0, Array.from({ length: 6 }, () => ({ size: 10 as const, value: 10 })))
    expect(actionsOfType(db, state, 'playCard').find((a) => a.card === card)!.payment).toHaveLength(1)

    const next = applyAction(db, state, actionsOfType(db, state, 'playCard').find((a) => a.card === card)!)
    expect(next.players[0].eddies.filter((uid) => !next.cards[uid].ready)).toHaveLength(1)
  })

  it('defeats only a rival Unit weaker than one of your own', () => {
    const { state } = fixtureWithHand(0, ['carnage-at-the-colosseum'])
    fieldCard(state, 0, 'la-llorona-ghost-of-the-past') // friendly power 3
    const weaker = fieldCard(state, 1, 'japantown-jonin') // 0 < 3: legal
    const equal = fieldCard(state, 1, 'la-llorona-ghost-of-the-past') // 3 is not < 3
    const card = findInHand(state, 0, 'carnage-at-the-colosseum')

    const plays = actionsOfType(db, state, 'playCard').filter((a) => a.card === card)
    expect(plays.map((a) => a.targets)).toEqual([[weaker]])

    const next = applyAction(db, state, plays[0])
    expect(next.players[1].trash).toEqual([weaker])
    expect(next.players[1].field).toEqual([equal])
  })
})

// ---------------------------------------------------------------------------
// deadman-transmitter — "If this Unit would be defeated, defeat its DEADMAN
// TRANSMITTER instead."
// ---------------------------------------------------------------------------

describe('deadman-transmitter', () => {
  it('is trashed in its host place, once', () => {
    const { state } = fixtureWithHand(0, ['deadman-transmitter'])
    fieldCard(state, 0, 'japantown-jonin')
    const brute = fieldCard(state, 1, 'animals-wrecker', { ready: false }) // power 10

    let next = playCardByDef(db, state, 0, 'deadman-transmitter', {
      targetDef: 'japantown-jonin',
    })
    const host = findFielded(next, 0, 'japantown-jonin')
    const gear = next.cards[host].attachedGear[0]
    expect(effectivePower(db, next, host)).toBe(1) // 0 + the gear's printed 1

    next = passReact(db, startAttack(db, next, host, brute))
    expect(next.players[0].field).toContain(host) // shielded
    expect(next.players[0].trash).toContain(gear)
    expect(next.cards[host].attachedGear).toEqual([])
    expect(next.events.some((e) => e.type === 'unitDefeated' && e.uid === host)).toBe(false)

    // Second hit, no shield left: the Unit dies. (The brute readied at its
    // owner's turn start, so [surgery] spend it again to make it attackable.)
    next = endBothTurnsOnce(db, next)
    next.cards[brute].ready = false
    next = passReact(db, startAttack(db, next, host, brute))
    expect(next.players[0].trash).toContain(host)
  })
})

// ---------------------------------------------------------------------------
// dexter-deshawn-off-the-grid — "{Call} Choose one effect. Give a friendly Unit
// +2 power this turn. // Draw 1. // {Spend}: Increase a Gig by up to 2."
// ---------------------------------------------------------------------------

describe('dexter-deshawn-off-the-grid', () => {
  it('resolves one of its two {Call} modes when it flips face-up', () => {
    const { state } = fixtureWithHand(0, [], { eddies: 3 })
    state.players[0].legends = []
    const dexter = mintInto(state, 0, 'legends', 'dexter-deshawn-off-the-grid', { faceUp: false })
    const unit = fieldCard(state, 0, 'japantown-jonin')
    const handBefore = state.players[0].hand.length

    const next = applyAction(db, state, {
      type: 'callLegend',
      payment: [state.players[0].eddies[0]],
    })
    expect(next.cards[dexter].faceUp).toBe(true)
    const buffed = next.cards[unit].tempPower === 2
    const drew = next.players[0].hand.length === handBefore + 1
    expect(buffed !== drew).toBe(true) // exactly one mode, auto-chosen (§32/§45)
  })

  it('spends itself to increase a friendly Gig by up to 2', () => {
    const { state } = fixtureWithHand(0, [])
    state.players[0].legends = []
    const dexter = mintInto(state, 0, 'legends', 'dexter-deshawn-off-the-grid')
    setGigs(state, 0, [{ size: 10, value: 5 }, { size: 4, value: 4 }])

    const next = activate(db, state, dexter, 1, { targets: [0] })
    expect(gigValues(next, 0)).toEqual([7, 4])
    expect(next.cards[dexter].ready).toBe(false)
    // A d4 already showing 4 cannot go higher.
    const capped = activate(db, state, dexter, 1, { targets: [1] })
    expect(gigValues(capped, 0)).toEqual([5, 4])
  })
})

// ---------------------------------------------------------------------------
// el-sombreron-la-venganza-lenta — "{Attack} You may pay 2 €$. If you do, this
// Unit gains power equal to a friendly max Gig this turn."
// ---------------------------------------------------------------------------

describe('el-sombreron-la-venganza-lenta', () => {
  it('offers paying the 2 €$ as a real decision, and pays it on request', () => {
    const { state } = fixtureWithHand(0, [], { eddies: 2 })
    state.players[0].legends = [] // a ready Legend is €$ too; keep the count exact
    const sombreron = fieldCard(state, 0, 'el-sombrero-n-la-venganza-lenta') // power 4
    setGigs(state, 0, [{ size: 10, value: 9 }, { size: 6, value: 2 }])
    setGigs(state, 1, [{ size: 6, value: 1 }, { size: 6, value: 2 }])

    // Both branches are enumerated (docs/rulings.md §49).
    const attacks = actionsOfType(db, state, 'attack').filter((a) => a.attacker === sombreron)
    expect(attacks).toEqual([
      { type: 'attack', attacker: sombreron, target: 'gigArea' },
      { type: 'attack', attacker: sombreron, target: 'gigArea', payOptionalCosts: true },
    ])

    const next = applyAction(db, state, attacks[1])
    expect(next.cards[sombreron].tempPower).toBe(9)
    expect(effectivePower(db, next, sombreron)).toBe(13)
    expect(next.players[0].eddies.filter((uid) => next.cards[uid].ready)).toEqual([])
    // Power 13 steals two Gigs (guide p11), which the buff paid for.
    const stolen = passReact(db, next)
    expect(stolen.pendingSteal?.remaining).toBe(2)
  })

  it('keeps the €$ and the effect when the attacker declines', () => {
    const { state } = fixtureWithHand(0, [], { eddies: 2 })
    state.players[0].legends = []
    const sombreron = fieldCard(state, 0, 'el-sombrero-n-la-venganza-lenta')
    setGigs(state, 0, [{ size: 10, value: 9 }])
    setGigs(state, 1, [{ size: 6, value: 1 }])

    const next = startAttack(db, state, sombreron, 'gigArea') // the plain variant declines
    expect(next.cards[sombreron].tempPower).toBe(0)
    expect(effectivePower(db, next, sombreron)).toBe(4)
    expect(next.players[0].eddies.every((uid) => next.cards[uid].ready)).toBe(true)
  })

  it('is not even offered the choice when the 2 €$ cannot be paid', () => {
    const { state } = fixtureWithHand(0, [], { eddies: 1 })
    // A ready Legend is worth 1 €$ too, so clear the legends zone to make the
    // 2 €$ genuinely unaffordable.
    state.players[0].legends = []
    const sombreron = fieldCard(state, 0, 'el-sombrero-n-la-venganza-lenta')
    setGigs(state, 0, [{ size: 10, value: 9 }])
    setGigs(state, 1, [{ size: 6, value: 1 }])

    expect(
      actionsOfType(db, state, 'attack').filter((a) => a.attacker === sombreron)
    ).toEqual([{ type: 'attack', attacker: sombreron, target: 'gigArea' }])

    const next = startAttack(db, state, sombreron, 'gigArea')
    expect(next.cards[sombreron].tempPower).toBe(0)
    expect(next.cards[next.players[0].eddies[0]].ready).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// gunpoint-diplomacy — "Give a friendly Unit these effects. If you have less ☆
// than a Rival, they instead choose one effect for you. [may attack ready
// Units] // [+3 power this turn]"
// ---------------------------------------------------------------------------

describe('gunpoint-diplomacy', () => {
  it('gives ONE friendly Unit BOTH effects while you are not behind on street cred', () => {
    const { state } = fixtureWithHand(0, ['gunpoint-diplomacy'])
    const mine = fieldCard(state, 0, 'la-llorona-ghost-of-the-past') // power 3
    const other = fieldCard(state, 0, 'japantown-jonin')
    const readyRival = fieldCard(state, 1, 'animals-wrecker', { ready: true })
    setGigs(state, 0, [{ size: 20, value: 10 }])
    setGigs(state, 1, [])
    const card = findInHand(state, 0, 'gunpoint-diplomacy')

    // One decision only: which friendly Unit receives the effects.
    const plays = actionsOfType(db, state, 'playCard').filter((a) => a.card === card)
    expect(plays.map((a) => a.targets)).toEqual([[mine], [other]])

    expect(actionsOfType(db, state, 'attack').some((a) => a.target === readyRival)).toBe(false)
    const next = applyAction(db, state, plays[0])

    // Both clauses, on the same Unit: +3 power AND may attack ready Units.
    expect(effectivePower(db, next, mine)).toBe(6)
    expect(next.cards[mine].tempKeywords).toContain('attack-ready')
    expect(
      actionsOfType(db, next, 'attack').some(
        (a) => a.attacker === mine && a.target === readyRival
      )
    ).toBe(true)
    // ... and nothing at all for the Unit that was not chosen.
    expect(next.cards[other].tempPower).toBe(0)
    expect(next.cards[other].tempKeywords).toEqual([])
    expect(
      actionsOfType(db, next, 'attack').some(
        (a) => a.attacker === other && a.target === readyRival
      )
    ).toBe(false)
  })

  it('is cut to one rival-chosen effect while you have less street cred', () => {
    const { state } = fixtureWithHand(0, ['gunpoint-diplomacy'])
    const mine = fieldCard(state, 0, 'la-llorona-ghost-of-the-past')
    setGigs(state, 0, [{ size: 6, value: 1 }])
    setGigs(state, 1, [{ size: 20, value: 20 }])
    const card = findInHand(state, 0, 'gunpoint-diplomacy')

    const plays = actionsOfType(db, state, 'playCard').filter((a) => a.card === card)
    expect(plays.map((a) => a.targets)).toEqual([[mine]]) // still only the Unit

    const next = applyAction(db, state, plays[0])
    const granted = next.cards[mine].tempKeywords.includes('attack-ready')
    const buffed = next.cards[mine].tempPower === 3
    expect(granted !== buffed).toBe(true) // exactly one effect, the rival's pick
  })
})

// ---------------------------------------------------------------------------
// industrial-assembly — "Increase a Gig by up to 4. If you control a Gig with
// 8+ value, draw 1."
// ---------------------------------------------------------------------------

describe('industrial-assembly', () => {
  it('increases the chosen Gig, then draws when that puts a Gig at 8+', () => {
    const { state } = fixtureWithHand(0, ['industrial-assembly'])
    setGigs(state, 0, [{ size: 10, value: 5 }, { size: 10, value: 1 }])
    const handBefore = state.players[0].hand.length

    const next = playCardByDef(db, state, 0, 'industrial-assembly', { targets: [0] })
    expect(gigValues(next, 0)).toEqual([9, 1])
    expect(next.players[0].hand).toHaveLength(handBefore - 1 + 1) // played one, drew one
  })

  it('does not draw when no Gig reaches 8', () => {
    const { state } = fixtureWithHand(0, ['industrial-assembly'])
    setGigs(state, 0, [{ size: 10, value: 2 }])
    const handBefore = state.players[0].hand.length

    const next = playCardByDef(db, state, 0, 'industrial-assembly', { targets: [0] })
    expect(gigValues(next, 0)).toEqual([6])
    expect(next.players[0].hand).toHaveLength(handBefore - 1)
  })
})

// ---------------------------------------------------------------------------
// japantown-jonin — "{Play} Give a friendly Unit +2 power this turn."
// ---------------------------------------------------------------------------

describe('japantown-jonin', () => {
  it('can give the +2 to itself (docs/rulings.md §34)', () => {
    const { state } = fixtureWithHand(0, ['japantown-jonin'])
    const card = findInHand(state, 0, 'japantown-jonin')
    const plays = actionsOfType(db, state, 'playCard').filter((a) => a.card === card)
    expect(plays.map((a) => a.targets)).toEqual([[card]])

    const next = applyAction(db, state, plays[0])
    expect(next.cards[card].tempPower).toBe(2)
    expect(effectivePower(db, next, card)).toBe(2) // printed power 0 + 2
  })

  it('can give the +2 to another friendly Unit instead, until end of turn', () => {
    const { state } = fixtureWithHand(0, ['japantown-jonin'])
    const mate = fieldCard(state, 0, 'la-llorona-ghost-of-the-past')

    let next = playCardByDef(db, state, 0, 'japantown-jonin', {
      targetDef: 'la-llorona-ghost-of-the-past',
    })
    expect(effectivePower(db, next, mate)).toBe(5)
    next = endBothTurnsOnce(db, next)
    expect(effectivePower(db, next, mate)).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// johnny-silverhand-never-stop-fighting — "The first time this Unit wins a
// fight each turn, ready it. This Unit wins all fights against CORPO Units."
// ---------------------------------------------------------------------------

describe('johnny-silverhand-never-stop-fighting', () => {
  it('readies itself the first time it wins a fight, but only once a turn', () => {
    const { state } = fixtureWithHand(0, [])
    const johnny = fieldCard(state, 0, 'johnny-silverhand-never-stop-fighting') // power 8
    const a = fieldCard(state, 1, 'la-llorona-ghost-of-the-past', { ready: false })
    const b = fieldCard(state, 1, 'la-llorona-ghost-of-the-past', { ready: false })

    let next = passReact(db, startAttack(db, state, johnny, a))
    expect(next.players[1].trash).toContain(a)
    expect(next.cards[johnny].ready).toBe(true) // readied by its own trigger

    next = passReact(db, startAttack(db, next, johnny, b))
    expect(next.players[1].trash).toContain(b)
    expect(next.cards[johnny].ready).toBe(false) // the once-per-turn ready is used
  })

  it('wins against a CORPO Unit of higher power', () => {
    const { state } = fixtureWithHand(0, [])
    const johnny = fieldCard(state, 0, 'johnny-silverhand-never-stop-fighting') // 8
    const suit = fieldCard(state, 1, 'yorinobu-arasaka-steel-dragon', { ready: false }) // 9, CORPO

    const next = passReact(db, startAttack(db, state, johnny, suit))
    expect(next.players[1].trash).toContain(suit)
    expect(next.players[0].field).toContain(johnny)
  })

  it('still loses to a bigger non-CORPO Unit', () => {
    const { state } = fixtureWithHand(0, [])
    const johnny = fieldCard(state, 0, 'johnny-silverhand-never-stop-fighting') // 8
    const brute = fieldCard(state, 1, 'animals-wrecker', { ready: false }) // 10, no CORPO tag

    const next = passReact(db, startAttack(db, state, johnny, brute))
    expect(next.players[0].trash).toContain(johnny)
    expect(next.players[1].field).toContain(brute)
  })
})

// ---------------------------------------------------------------------------
// johnny-silverhand-rocking-renegade — "2 €$, {Spend} A friendly Unit can
// attack spent rival Units the turn it's played. If it's a ROCKER Unit, also
// give it +2 power this turn. This effect costs -1 €$ for each friendly Gig
// with 8+ value."
// ---------------------------------------------------------------------------

describe('johnny-silverhand-rocking-renegade', () => {
  it('lets a lagged ROCKER attack this turn and gives it +2 power', () => {
    const { state } = fixtureWithHand(0, [], { eddies: 2 })
    state.players[0].legends = []
    const johnny = mintInto(state, 0, 'legends', 'johnny-silverhand-rocking-renegade')
    const kerry = fieldCard(state, 0, 'kerry-eurodyne-the-last-rockerboy', { lag: true }) // ROCKER, 5
    const victim = fieldCard(state, 1, 'japantown-jonin', { ready: false })

    expect(actionsOfType(db, state, 'attack')).toEqual([]) // Lag
    const next = activate(db, state, johnny, 0, { targets: [kerry] })
    expect(effectivePower(db, next, kerry)).toBe(7)
    expect(next.cards[johnny].ready).toBe(false) // {Spend}
    expect(next.players[0].eddies.filter((uid) => next.cards[uid].ready)).toEqual([]) // 2 €$
    expect(
      actionsOfType(db, next, 'attack').some((a) => a.attacker === kerry && a.target === victim)
    ).toBe(true)
  })

  it('gives a non-ROCKER Unit the attack permission but no power', () => {
    const { state } = fixtureWithHand(0, [], { eddies: 2 })
    state.players[0].legends = []
    const johnny = mintInto(state, 0, 'legends', 'johnny-silverhand-rocking-renegade')
    const jonin = fieldCard(state, 0, 'japantown-jonin', { lag: true })

    const next = activate(db, state, johnny, 0, { targets: [jonin] })
    expect(next.cards[jonin].tempPower).toBe(0)
    expect(next.cards[jonin].tempKeywords).toContain('adrenaline')
  })

  it('costs 1 €$ less for each friendly Gig with 8+ value', () => {
    const { state } = fixtureWithHand(0, [], { eddies: 1 })
    state.players[0].legends = []
    const johnny = mintInto(state, 0, 'legends', 'johnny-silverhand-rocking-renegade')
    fieldCard(state, 0, 'kerry-eurodyne-the-last-rockerboy')
    setGigs(state, 0, [{ size: 10, value: 7 }])

    // 2 €$ with only 1 €$ banked: not activatable.
    expect(actionsOfType(db, state, 'activateAbility').some((a) => a.card === johnny)).toBe(false)

    setGigs(state, 0, [{ size: 10, value: 8 }])
    expect(actionsOfType(db, state, 'activateAbility').some((a) => a.card === johnny)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// kerry-eurodyne-the-last-rockerboy — "{Spend} If you control a Gig with 8+
// value, draw 2."
// ---------------------------------------------------------------------------

describe('kerry-eurodyne-the-last-rockerboy', () => {
  it('draws 2 for a spend, but only with a Gig at 8+', () => {
    const { state } = fixtureWithHand(0, [])
    const kerry = fieldCard(state, 0, 'kerry-eurodyne-the-last-rockerboy')
    setGigs(state, 0, [{ size: 10, value: 7 }])
    expect(actionsOfType(db, state, 'activateAbility')).toEqual([])

    setGigs(state, 0, [{ size: 10, value: 8 }])
    const handBefore = state.players[0].hand.length
    const next = activate(db, state, kerry, 0)
    expect(next.players[0].hand).toHaveLength(handBefore + 2)
    expect(next.cards[kerry].ready).toBe(false)
    expect(actionsOfType(db, next, 'activateAbility')).toEqual([]) // spent
  })
})

// ---------------------------------------------------------------------------
// la-llorona-ghost-of-the-past — "{Blocker} ... When this Unit uses {Blocker},
// increase a Gig by up to 3."
// ---------------------------------------------------------------------------

describe('la-llorona-ghost-of-the-past', () => {
  it('increases a friendly Gig when it blocks', () => {
    // Player 1 is the attacker, so player 0's la-llorona gets to block.
    const { state } = fixtureWithHand(1, [])
    const llorona = fieldCard(state, 0, 'la-llorona-ghost-of-the-past') // power 3, {blocker}
    const attacker = fieldCard(state, 1, 'japantown-jonin') // power 0
    setGigs(state, 0, [{ size: 12, value: 2 }])
    // The card says bare "a Gig", so either player's die is a candidate
    // (docs/rulings.md §39); with the attacker holding none, the blocker's own
    // die is the only one the auto-target can pick.
    setGigs(state, 1, [])

    let next = startAttack(db, state, attacker, 'gigArea')
    expect(
      actionsOfType(db, next, 'react').some(
        (a) => a.reaction.type === 'block' && a.reaction.blocker === llorona
      )
    ).toBe(true)

    next = blockWith(db, next, llorona)
    expect(gigValues(next, 0)).toEqual([5]) // 2 + up to 3
    expect(next.cards[llorona].ready).toBe(false) // spent to block
    expect(next.players[1].trash).toContain(attacker) // 3 beats 0
    expect(next.players[0].gigArea).toHaveLength(1) // a block steals nothing
  })
})

// ---------------------------------------------------------------------------
// Batch bookkeeping: the two cards this batch could not encode.
// ---------------------------------------------------------------------------

describe('deferred cards (see the batch-1 report)', () => {
  it('appetite-for-destruction and chrome-fang still carry no effects', () => {
    // Both need a floating "until <later>" effect zone on GameState, which is a
    // bigger engine change than a vocabulary extension. Recorded here so the
    // completeness test at the end of Task 8 has a single place to look.
    expect(db['appetite-for-destruction'].effects).toEqual([])
    expect(db['chrome-fang'].effects).toEqual([])
  })
})
