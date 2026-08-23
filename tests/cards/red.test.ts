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
// The two batch-1 deferrals (appetite-for-destruction, chrome-fang) are now
// fully encoded via the floatingEffects zone (docs/rulings.md §141).

import { describe, expect, it } from 'vitest'
import { effectivePower, streetCred } from '../../src/engine/query'
import { applyAction } from '../../src/engine/reduce'
import {
  actionsOfType,
  activate,
  attackAndSteal,
  blockWith,
  chooseGig,
  db,
  endBothTurnsOnce,
  endTurnOnce,
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

  // Regression (found by the Task 9 fuzz harness, tests/fuzz/invariants.test.ts):
  // `reduce.ts`'s `callLegend` spends its payment BEFORE picking which
  // face-down Legend to flip. If the spent payment card is itself wearing
  // this Gear, spending it fires the Gear's OWN nested free Call first — and
  // when only one face-down Legend exists, that nested call already flips
  // it (and marks `calledLegendThisTurn`), leaving the explicit call's own
  // "pick a face-down Legend" step with none to pick, which crashed with
  // `Cannot set properties of undefined (setting 'faceUp')` instead of
  // fizzling like every other "the thing this was about to affect is
  // already gone" case in the engine (e.g. `resolveAttack`'s own comment on
  // a combatant vanishing mid-react).
  it('fizzles the explicit Call instead of crashing when its own payment card wears this Gear', () => {
    const fixture = fixtureWithHand(0, ['arasaka-emergency-radioport'])
    const state = fixture.state
    state.players[0].legends = []
    const target = mintInto(state, 0, 'legends', 'saburo-arasaka-stubborn-patriarch', {
      faceUp: false,
    })
    const host = mintInto(state, 0, 'legends', 'yorinobu-arasaka-embracing-destruction', {
      faceUp: true,
      ready: true,
    })

    let next = playCardByDef(db, state, 0, 'arasaka-emergency-radioport', { includes: host })
    expect(next.cards[host].attachedGear).toHaveLength(1)
    expect(next.cards[target].faceUp).toBe(false)
    expect(next.players[0].calledLegendThisTurn).toBe(false)

    // An explicit Call a Legend, paid for with `host` — legal right now
    // because `target` is still face-down and nothing has called yet.
    // Spending `host` fires its Gear's {Spend} trigger before this call's
    // own flip runs.
    next = applyAction(db, next, { type: 'callLegend', payment: [host] })

    // The nested free Call got there first: it flipped `target` and used up
    // the once-per-turn allowance.
    expect(next.cards[target].faceUp).toBe(true)
    expect(next.players[0].calledLegendThisTurn).toBe(true)
    // Exactly one `legendCalled` event — the explicit call fizzled instead
    // of reaching for a second Legend that no longer exists.
    expect(next.events.filter((e) => e.type === 'legendCalled')).toHaveLength(1)
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
// Task 8 — Red cards, batch 2: mantis-blades, meredith-stout-stone-cold-corpo,
// minotaur, octant, over-the-edge, royce-don-t-call-me-simon,
// royce-psycho-on-the-edge, ruthless-lowlife, satori-sword-of-saburo,
// screw-lovelorn-fool, shattered-memories, swordwise-huscle,
// v-roamer-of-the-badlands, v-streetkid, valentino-guerrera,
// yorinobu-arasaka-embracing-destruction, yorinobu-arasaka-steel-dragon.
// ---------------------------------------------------------------------------

describe('mantis-blades', () => {
  it('is a vanilla Gear that hands its printed +2 power to its host', () => {
    expect(db['mantis-blades'].effects).toEqual([])
    const { state } = fixtureWithHand(0, ['mantis-blades'])
    const host = fieldCard(state, 0, 'japantown-jonin') // power 0
    const next = playCardByDef(db, state, 0, 'mantis-blades', { targetDef: 'japantown-jonin' })
    expect(next.cards[host].attachedGear).toHaveLength(1)
    expect(effectivePower(db, next, host)).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// meredith-stout-stone-cold-corpo — "{Blocker}\nThis Unit has +2 power while
// fighting a Legend.\nWhen a Rival adjusts or swaps 1 or more friendly Gigs,
// you may add a card from your trash to your hand."
// ---------------------------------------------------------------------------

describe('meredith-stout-stone-cold-corpo', () => {
  it('gets +2 power only while fighting a Legend, enough to win a fight it would otherwise lose', () => {
    const { state } = fixtureWithHand(0, [])
    const meredith = fieldCard(state, 0, 'meredith-stout-stone-cold-corpo') // power 5
    const legendFoe = fieldCard(state, 1, 'royce-psycho-on-the-edge', { ready: false }) // power 6, a Legend
    const next = passReact(db, startAttack(db, state, meredith, legendFoe))
    // A fielded Legend that leaves the field is removed from the game, never
    // trashed (docs/rulings.md §31) — but it did lose the fight, which is the
    // point: 5 + 2 = 7 beats 6, where 5 vs 6 would have lost.
    expect(next.players[1].removed).toContain(legendFoe)
    expect(next.players[0].field).toContain(meredith)
  })

  it('gets no bonus fighting a non-Legend Unit', () => {
    const { state } = fixtureWithHand(0, [])
    const meredith = fieldCard(state, 0, 'meredith-stout-stone-cold-corpo') // power 5
    const unitFoe = fieldCard(state, 1, 'kerry-eurodyne-the-last-rockerboy', { ready: false }) // power 5
    const next = passReact(db, startAttack(db, state, meredith, unitFoe))
    // Equal power with no bonus: a tie defeats both.
    expect(next.players[1].trash).toContain(unitFoe)
    expect(next.players[0].trash).toContain(meredith)
  })

  it('may retrieve a trashed card when a Rival adjusts a friendly Gig', () => {
    const { state } = fixtureWithHand(1, [])
    fieldCard(state, 0, 'meredith-stout-stone-cold-corpo')
    const trashed = mintInto(state, 0, 'trash', 'animals-wrecker')
    setGigs(state, 0, [{ size: 10, value: 3 }])
    setGigs(state, 1, []) // player 1's own Gig area is empty
    state.players[1].legends = []
    const dexter = mintInto(state, 1, 'legends', 'dexter-deshawn-off-the-grid')

    // anyGigDie with player 1's own area empty: index 0 is player 0's die.
    const next = activate(db, state, dexter, 1, { targets: [0] })
    expect(gigValues(next, 0)).toEqual([5])
    expect(next.players[0].hand).toContain(trashed)
    expect(next.players[0].trash).not.toContain(trashed)
  })
})

// ---------------------------------------------------------------------------
// minotaur — "{Play} If you have more ☆ (Street Cred) than a Rival, defeat a
// rival Unit with power 5 or less."
// ---------------------------------------------------------------------------

describe('minotaur', () => {
  it('only defeats a rival Unit of power 5 or less while ahead on Street Cred', () => {
    const { state } = fixtureWithHand(0, ['minotaur'])
    const weak = fieldCard(state, 1, 'la-llorona-ghost-of-the-past') // power 3
    const tough = fieldCard(state, 1, 'animals-wrecker') // power 10
    setGigs(state, 0, [{ size: 6, value: 1 }])
    setGigs(state, 1, [{ size: 6, value: 5 }]) // not ahead
    const next = playCardByDef(db, state, 0, 'minotaur')
    expect(next.players[1].field).toContain(weak)
    expect(next.players[1].field).toContain(tough)
  })

  it('defeats the weak target while ahead on Street Cred', () => {
    const { state } = fixtureWithHand(0, ['minotaur'])
    const weak = fieldCard(state, 1, 'la-llorona-ghost-of-the-past') // power 3
    const tough = fieldCard(state, 1, 'animals-wrecker') // power 10
    setGigs(state, 0, [{ size: 6, value: 5 }])
    setGigs(state, 1, [{ size: 6, value: 1 }]) // ahead
    const next = playCardByDef(db, state, 0, 'minotaur')
    expect(next.players[1].trash).toContain(weak)
    expect(next.players[1].field).toContain(tough) // power 10 is out of range
  })
})

// ---------------------------------------------------------------------------
// octant — "Play this Unit for -1 €$ for each friendly Gig with 8+ value, to
// a minimum of 1 €$."
// ---------------------------------------------------------------------------

describe('octant', () => {
  it('costs 1 €$ less per friendly Gig with 8+ value, never below 1 €$', () => {
    const { state } = fixtureWithHand(0, ['octant'])
    const card = findInHand(state, 0, 'octant')

    setGigs(state, 0, [{ size: 10, value: 3 }])
    expect(actionsOfType(db, state, 'playCard').find((a) => a.card === card)!.payment).toHaveLength(7)

    setGigs(state, 0, Array.from({ length: 8 }, () => ({ size: 10 as const, value: 10 })))
    expect(actionsOfType(db, state, 'playCard').find((a) => a.card === card)!.payment).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// over-the-edge — "Defeat a Unit with power equal to or less than the value
// of a friendly d20."
// ---------------------------------------------------------------------------

describe('over-the-edge', () => {
  it('defeats a Unit (either side) at or below the friendly d20 value', () => {
    const { state } = fixtureWithHand(0, ['over-the-edge'])
    setGigs(state, 0, [{ size: 20, value: 5 }])
    const weak = fieldCard(state, 1, 'la-llorona-ghost-of-the-past') // power 3
    const tough = fieldCard(state, 1, 'animals-wrecker') // power 10
    const next = playCardByDef(db, state, 0, 'over-the-edge', { targets: [weak] })
    expect(next.players[1].trash).toContain(weak)
    expect(next.players[1].field).toContain(tough)
  })

  it('never offers a target above the friendly d20 value, including its own side', () => {
    const { state } = fixtureWithHand(0, ['over-the-edge'])
    setGigs(state, 0, [{ size: 20, value: 2 }])
    const mine = fieldCard(state, 0, 'la-llorona-ghost-of-the-past') // power 3 > 2
    const card = findInHand(state, 0, 'over-the-edge')
    const plays = actionsOfType(db, state, 'playCard').filter((a) => a.card === card)
    expect(plays.every((a) => !a.targets.includes(mine))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// royce-don-t-call-me-simon — "{Play} Defeat a rival Unit with power 2 or
// less. If you have more ☆ (Street Cred) than a Rival, defeat a rival Unit
// with power 3 or less instead."
// ---------------------------------------------------------------------------

describe('royce-don-t-call-me-simon', () => {
  it('caps at power 2 while not ahead, and at power 3 (replacing, not adding) while ahead', () => {
    const { state } = fixtureWithHand(0, ['royce-don-t-call-me-simon'])
    const p2 = fieldCard(state, 1, 'corpo-security') // power 2
    const p3 = fieldCard(state, 1, 'la-llorona-ghost-of-the-past') // power 3
    setGigs(state, 0, [{ size: 6, value: 1 }])
    setGigs(state, 1, [{ size: 6, value: 5 }]) // not ahead
    const card = findInHand(state, 0, 'royce-don-t-call-me-simon')
    const notAhead = actionsOfType(db, state, 'playCard').filter((a) => a.card === card)
    expect(notAhead.map((a) => a.targets)).toEqual([[p2]])

    setGigs(state, 0, [{ size: 6, value: 5 }])
    setGigs(state, 1, [{ size: 6, value: 1 }]) // ahead
    const ahead = actionsOfType(db, state, 'playCard').filter((a) => a.card === card)
    const targetedAhead = new Set(ahead.flatMap((a) => a.targets))
    expect([...targetedAhead].sort()).toEqual([p2, p3].sort())

    const next = playCardByDef(db, state, 0, 'royce-don-t-call-me-simon', { targets: [p3] })
    expect(next.players[1].trash).toContain(p3)
    expect(next.players[1].field).toContain(p2) // exactly one defeat, not both
  })
})

// ---------------------------------------------------------------------------
// royce-psycho-on-the-edge — "{Go Solo} ...\nDuring your turn, this Legend
// has +2 power for each of its equipped Gear."
// ---------------------------------------------------------------------------

describe('royce-psycho-on-the-edge', () => {
  it('gains +2 power per equipped Gear only during its controller’s own turn', () => {
    const { state } = fixtureWithHand(0, ['mantis-blades'])
    const royce = fieldCard(state, 0, 'royce-psycho-on-the-edge') // power 6
    let next = playCardByDef(db, state, 0, 'mantis-blades', { targetDef: 'royce-psycho-on-the-edge' })
    // 6 (own) + 2 (Gear's printed power bonus, §29) + 2*1 (the new static, own turn)
    expect(effectivePower(db, next, royce)).toBe(10)

    next = applyAction(db, next, { type: 'endTurn' })
    if (next.phase === 'start') {
      next = applyAction(db, next, actionsOfType(db, next, 'chooseGigDie')[0])
    }
    // It's the rival's turn now: the static bonus is gone, the Gear bonus stays.
    expect(effectivePower(db, next, royce)).toBe(8)
  })
})

// ---------------------------------------------------------------------------
// ruthless-lowlife — "This Unit can only attack rival Units. (It can't attack
// Gig areas.)"
// ---------------------------------------------------------------------------

describe('ruthless-lowlife', () => {
  it('never offers the rival Gig area as an attack target', () => {
    const { state } = fixtureWithHand(0, [])
    const lowlife = fieldCard(state, 0, 'ruthless-lowlife')
    const victim = fieldCard(state, 1, 'japantown-jonin', { ready: false })
    setGigs(state, 1, [{ size: 6, value: 3 }]) // otherwise a legal attack target
    const attacks = actionsOfType(db, state, 'attack').filter((a) => a.attacker === lowlife)
    expect(attacks.map((a) => a.target)).toEqual([victim])
  })
})

// ---------------------------------------------------------------------------
// satori-sword-of-saburo — "(Equip to a friendly Unit or face-up Legend.)
// When this Unit wins a fight against a rival Unit, draw 1."
// ---------------------------------------------------------------------------

describe('satori-sword-of-saburo', () => {
  it('draws 1 for its host winning a fight', () => {
    const { state } = fixtureWithHand(0, ['satori-sword-of-saburo'])
    const host = fieldCard(state, 0, 'la-llorona-ghost-of-the-past') // power 3
    let next = playCardByDef(db, state, 0, 'satori-sword-of-saburo', {
      targetDef: 'la-llorona-ghost-of-the-past',
    })
    const victim = fieldCard(next, 1, 'japantown-jonin', { ready: false }) // power 0
    const handBefore = next.players[0].hand.length
    next = passReact(db, startAttack(db, next, host, victim))
    expect(next.players[1].trash).toContain(victim)
    expect(next.players[0].hand).toHaveLength(handBefore + 1)
  })
})

// ---------------------------------------------------------------------------
// screw-lovelorn-fool — "{Defeated} Add another Unit from your trash to your
// hand."
// ---------------------------------------------------------------------------

describe('screw-lovelorn-fool', () => {
  it('retrieves another Unit from the trash when defeated', () => {
    const { state } = fixtureWithHand(1, []) // player 1 attacks, player 0's Screw defends
    const screw = fieldCard(state, 0, 'screw-lovelorn-fool', { ready: false }) // power 7
    const retrievable = mintInto(state, 0, 'trash', 'japantown-jonin')
    const attacker = fieldCard(state, 1, 'animals-wrecker') // power 10
    const next = passReact(db, startAttack(db, state, attacker, screw))
    expect(next.players[0].trash).toContain(screw)
    expect(next.players[0].hand).toContain(retrievable)
    expect(next.players[0].trash).not.toContain(retrievable)
  })

  it('never retrieves itself when no other Unit is in the trash', () => {
    const { state } = fixtureWithHand(1, [])
    const screw = fieldCard(state, 0, 'screw-lovelorn-fool', { ready: false })
    const attacker = fieldCard(state, 1, 'animals-wrecker')
    const next = passReact(db, startAttack(db, state, attacker, screw))
    expect(next.players[0].trash).toContain(screw)
    expect(next.players[0].hand).not.toContain(screw)
  })
})

// ---------------------------------------------------------------------------
// shattered-memories — "Each player discards their hand and may draw 5. If
// the total number of discarded cards equals the value of a friendly Gig,
// draw 2."
// ---------------------------------------------------------------------------

describe('shattered-memories', () => {
  function stage(): ReturnType<typeof fixtureWithHand> {
    const fixture = fixtureWithHand(0, ['shattered-memories', 'animals-wrecker', 'animals-wrecker'])
    const state = fixture.state
    // [surgery] a known, empty-then-refilled hand for player 1 too.
    state.players[1].deck = [...state.players[1].deck, ...state.players[1].hand]
    state.players[1].hand = []
    mintInto(state, 1, 'hand', 'japantown-jonin')
    mintInto(state, 1, 'hand', 'japantown-jonin')
    return fixture
  }

  it('discards and redraws up to 5 for both players, skipping the bonus draw', () => {
    const { state } = stage()
    // Playing the card removes it from hand first, leaving 2 discards for
    // player 0 and 2 for player 1 -> total 4, which this Gig does not match.
    setGigs(state, 0, [{ size: 10, value: 3 }])
    const next = playCardByDef(db, state, 0, 'shattered-memories')
    expect(next.players[0].hand).toHaveLength(5)
    expect(next.players[1].hand).toHaveLength(5)
  })

  it('draws 2 more when the total discarded matches the value of a friendly Gig', () => {
    const { state } = stage()
    setGigs(state, 0, [{ size: 10, value: 4 }]) // matches the 2+2 total discarded
    const next = playCardByDef(db, state, 0, 'shattered-memories')
    expect(next.players[0].hand).toHaveLength(5 + 2)
    expect(next.players[1].hand).toHaveLength(5)
  })
})

// ---------------------------------------------------------------------------
// swordwise-huscle — "{Attack} If this Unit has power 5+, draw 1."
// ---------------------------------------------------------------------------

describe('swordwise-huscle', () => {
  it('draws 1 when it attacks with power 5 or more', () => {
    const { state } = fixtureWithHand(0, ['swordwise-huscle', 'mantis-blades'])
    let next = playCardByDef(db, state, 0, 'swordwise-huscle')
    next = endBothTurnsOnce(db, next)
    next = playCardByDef(db, next, 0, 'mantis-blades', { targetDef: 'swordwise-huscle' })
    const huscle = findFielded(next, 0, 'swordwise-huscle')
    expect(effectivePower(db, next, huscle)).toBe(5)
    setGigs(next, 1, [{ size: 6, value: 2 }])
    const handBefore = next.players[0].hand.length
    const attacked = startAttack(db, next, huscle, 'gigArea')
    expect(attacked.players[0].hand).toHaveLength(handBefore + 1)
  })

  it('does not draw while under power 5', () => {
    const { state } = fixtureWithHand(0, ['swordwise-huscle'])
    let next = playCardByDef(db, state, 0, 'swordwise-huscle')
    next = endBothTurnsOnce(db, next)
    const huscle = findFielded(next, 0, 'swordwise-huscle')
    setGigs(next, 1, [{ size: 6, value: 2 }])
    const handBefore = next.players[0].hand.length
    const attacked = startAttack(db, next, huscle, 'gigArea')
    expect(attacked.players[0].hand).toHaveLength(handBefore)
  })
})

// ---------------------------------------------------------------------------
// v-roamer-of-the-badlands — "When this Unit steals a Gig, increase it by up
// to 5.\nAt the end of your turn, if you control 2 or more Gigs with 8+
// value, draw 1."
// ---------------------------------------------------------------------------

describe('v-roamer-of-the-badlands', () => {
  it('increases the just-stolen die by up to 5', () => {
    const { state } = fixtureWithHand(0, [])
    const roamer = fieldCard(state, 0, 'v-roamer-of-the-badlands') // power 6
    setGigs(state, 0, [{ size: 20, value: 1 }])
    setGigs(state, 1, [{ size: 8, value: 3 }])
    const next = attackAndSteal(db, state, roamer, 'gigArea', [0])
    expect(gigValues(next, 0).sort((a, b) => a - b)).toEqual([1, 8]) // 3 + 5, clamped to the d8's 8 faces
  })

  it('does not boost a die stolen by a different friendly Unit', () => {
    const { state } = fixtureWithHand(0, [])
    fieldCard(state, 0, 'v-roamer-of-the-badlands')
    const other = fieldCard(state, 0, 'animals-wrecker') // power 10
    setGigs(state, 0, [])
    setGigs(state, 1, [{ size: 8, value: 3 }])
    const next = attackAndSteal(db, state, other, 'gigArea', [0])
    expect(gigValues(next, 0)).toEqual([3])
  })

  it('draws at the end of its controller’s turn while controlling 2+ Gigs at 8+', () => {
    const { state } = fixtureWithHand(0, [])
    fieldCard(state, 0, 'v-roamer-of-the-badlands')
    setGigs(state, 0, [
      { size: 10, value: 8 },
      { size: 10, value: 9 },
    ])
    const handBefore = state.players[0].hand.length
    // endBothTurnsOnce ends player 0's turn (firing the bonus draw), then
    // player 1's, then returns to player 0's next main phase (a normal
    // start-of-turn draw on top).
    const next = endBothTurnsOnce(db, state)
    expect(next.players[0].hand).toHaveLength(handBefore + 2)
  })
})

// ---------------------------------------------------------------------------
// v-streetkid — "{Call} Trash 3. Then, add 1 BRAINDANCE Program from your
// trash to your hand."
// ---------------------------------------------------------------------------

describe('v-streetkid', () => {
  it('trashes 3 and retrieves a BRAINDANCE Program among them when Called', () => {
    const { state } = fixtureWithHand(0, [], { eddies: 3 })
    state.players[0].legends = []
    const v = mintInto(state, 0, 'legends', 'v-streetkid', { faceUp: false })
    // [surgery] a known top-of-deck: one BRAINDANCE Program, two non-BRAINDANCE
    // fillers (Units, so they can never compete for the retrieval slot).
    const bd = mintInto(state, 0, 'deck', 'shattered-memories')
    const f1 = mintInto(state, 0, 'deck', 'japantown-jonin')
    const f2 = mintInto(state, 0, 'deck', 'japantown-jonin')
    const rest = state.players[0].deck.filter((uid) => ![bd, f1, f2].includes(uid))
    state.players[0].deck = [bd, f1, f2, ...rest]

    const next = applyAction(db, state, {
      type: 'callLegend',
      payment: [state.players[0].eddies[0]],
    })
    expect(next.cards[v].faceUp).toBe(true)
    expect(next.players[0].hand).toContain(bd)
    expect(next.players[0].trash).toContain(f1)
    expect(next.players[0].trash).toContain(f2)
    expect(next.players[0].trash).not.toContain(bd)
  })
})

// ---------------------------------------------------------------------------
// valentino-guerrera — "If you have more ☆ (Street Cred) than a Rival, this
// Unit can attack ready Units with {Blocker}."
// ---------------------------------------------------------------------------

describe('valentino-guerrera', () => {
  it('may attack a ready {Blocker} Unit only while ahead on Street Cred', () => {
    const { state } = fixtureWithHand(0, [])
    const valentino = fieldCard(state, 0, 'valentino-guerrera')
    const readyBlocker = fieldCard(state, 1, 'la-llorona-ghost-of-the-past', { ready: true })
    setGigs(state, 0, [{ size: 6, value: 5 }])
    setGigs(state, 1, [{ size: 6, value: 1 }]) // ahead
    const attacksAhead = actionsOfType(db, state, 'attack').filter((a) => a.attacker === valentino)
    expect(attacksAhead.some((a) => a.target === readyBlocker)).toBe(true)

    setGigs(state, 0, [{ size: 6, value: 1 }])
    setGigs(state, 1, [{ size: 6, value: 5 }]) // not ahead
    const attacksBehind = actionsOfType(db, state, 'attack').filter((a) => a.attacker === valentino)
    expect(attacksBehind.some((a) => a.target === readyBlocker)).toBe(false)
  })

  it('still cannot attack a ready non-{Blocker} Unit while ahead', () => {
    const { state } = fixtureWithHand(0, [])
    const valentino = fieldCard(state, 0, 'valentino-guerrera')
    const readyNonBlocker = fieldCard(state, 1, 'japantown-jonin', { ready: true })
    setGigs(state, 0, [{ size: 6, value: 5 }])
    setGigs(state, 1, [{ size: 6, value: 1 }])
    const attacks = actionsOfType(db, state, 'attack').filter((a) => a.attacker === valentino)
    expect(attacks.some((a) => a.target === readyNonBlocker)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// yorinobu-arasaka-embracing-destruction — "The first time a friendly ARASAKA
// Unit attacks each turn, draw 1. Then, if you have less than 20 ☆ (Street
// Cred), discard 1."
// ---------------------------------------------------------------------------

describe('yorinobu-arasaka-embracing-destruction', () => {
  it('draws the first time a friendly ARASAKA Unit attacks each turn, and no more', () => {
    const { state } = fixtureWithHand(0, [])
    state.players[0].legends = []
    mintInto(state, 0, 'legends', 'yorinobu-arasaka-embracing-destruction')
    const m1 = fieldCard(state, 0, 'minotaur')
    const m2 = fieldCard(state, 0, 'minotaur')
    const v1 = fieldCard(state, 1, 'japantown-jonin', { ready: false })
    const v2 = fieldCard(state, 1, 'japantown-jonin', { ready: false })
    setGigs(state, 0, [{ size: 20, value: 20 }]) // 20 ☆: the discard clause is inert
    const handBefore = state.players[0].hand.length

    let next = passReact(db, startAttack(db, state, m1, v1))
    expect(next.players[0].hand).toHaveLength(handBefore + 1)

    next = passReact(db, startAttack(db, next, m2, v2))
    expect(next.players[0].hand).toHaveLength(handBefore + 1) // no second draw
  })

  it('draws AND discards together at the first qualifying attack when already under 20 Street Cred', () => {
    const { state } = fixtureWithHand(0, [])
    state.players[0].legends = []
    mintInto(state, 0, 'legends', 'yorinobu-arasaka-embracing-destruction')
    mintInto(state, 0, 'hand', 'animals-wrecker')
    const minotaurUid = fieldCard(state, 0, 'minotaur')
    const victim = fieldCard(state, 1, 'japantown-jonin', { ready: false })
    setGigs(state, 0, [{ size: 20, value: 5 }]) // 5 ☆ < 20 already
    const deckBefore = state.players[0].deck.length
    const trashBefore = state.players[0].trash.length

    const next = passReact(db, startAttack(db, state, minotaurUid, victim))
    expect(next.players[0].deck).toHaveLength(deckBefore - 1) // drew 1
    expect(next.players[0].trash).toHaveLength(trashBefore + 1) // discarded 1
  })

  it('does not fire for a non-ARASAKA attacker', () => {
    const { state } = fixtureWithHand(0, [])
    state.players[0].legends = []
    mintInto(state, 0, 'legends', 'yorinobu-arasaka-embracing-destruction')
    const attacker = fieldCard(state, 0, 'animals-wrecker') // no faction tag
    const victim = fieldCard(state, 1, 'japantown-jonin', { ready: false })
    const handBefore = state.players[0].hand.length

    const next = passReact(db, startAttack(db, state, attacker, victim))
    expect(next.players[0].hand).toHaveLength(handBefore)
  })

  // Fix round 1 (docs/rulings.md §67): the printed text is ONE compound event
  // — draw 1, then (at that SAME moment) check Street Cred for the discard —
  // evaluated once at the first qualifying attack each turn. Before the
  // `onceKey` fix, the draw and discard were two independently-gated
  // `oncePerTurn` defs: if Street Cred was 20+ at the first ARASAKA attack
  // (no discard, and the discard def's own allowance was never marked used),
  // then dropped below 20 before a SECOND ARASAKA attack the same turn, the
  // discard would incorrectly fire on that second attack.
  it('never re-opens the compound event later the same turn, even if Street Cred then drops below 20', () => {
    const { state } = fixtureWithHand(0, [])
    state.players[0].legends = []
    mintInto(state, 0, 'legends', 'yorinobu-arasaka-embracing-destruction')
    mintInto(state, 0, 'hand', 'animals-wrecker')
    const m1 = fieldCard(state, 0, 'minotaur')
    const m2 = fieldCard(state, 0, 'minotaur')
    const v1 = fieldCard(state, 1, 'japantown-jonin', { ready: false })
    const v2 = fieldCard(state, 1, 'japantown-jonin', { ready: false })
    setGigs(state, 0, [{ size: 20, value: 20 }]) // 20 ☆: no discard at the first attack
    const deckBefore = state.players[0].deck.length
    const trashBefore = state.players[0].trash.length

    let next = passReact(db, startAttack(db, state, m1, v1))
    expect(next.players[0].deck).toHaveLength(deckBefore - 1) // the draw fired
    expect(next.players[0].trash).toHaveLength(trashBefore) // no discard yet — SC was 20+

    // Street Cred drops below 20 before the second ARASAKA attack this turn.
    setGigs(next, 0, [{ size: 20, value: 5 }])
    next = passReact(db, startAttack(db, next, m2, v2))
    // The compound event already happened once this turn: nothing fires the
    // second time, even though the discard's own condition now holds.
    expect(next.players[0].deck).toHaveLength(deckBefore - 1) // no second draw
    expect(next.players[0].trash).toHaveLength(trashBefore) // still no discard
  })
})

// ---------------------------------------------------------------------------
// yorinobu-arasaka-steel-dragon — "{Play} You may play a Unit with cost 4 or
// less from your hand or trash for free. It can attack rival Units this
// turn.\nThe first time an ARASAKA Unit is defeated each turn, draw 1."
// ---------------------------------------------------------------------------

describe('yorinobu-arasaka-steel-dragon', () => {
  it('plays a cheap Unit from hand for free and lets it attack immediately', () => {
    const { state } = fixtureWithHand(0, ['yorinobu-arasaka-steel-dragon', 'japantown-jonin'])
    setGigs(state, 1, [{ size: 6, value: 2 }])
    const jonin = findInHand(state, 0, 'japantown-jonin')

    const next = playCardByDef(db, state, 0, 'yorinobu-arasaka-steel-dragon', { targets: [jonin] })
    expect(next.players[0].field).toContain(jonin)
    expect(next.cards[jonin].tempKeywords).toContain('adrenaline')
    expect(actionsOfType(db, next, 'attack').some((a) => a.attacker === jonin)).toBe(true)
  })

  it('can also free-play a Unit sitting in the trash', () => {
    const { state } = fixtureWithHand(0, ['yorinobu-arasaka-steel-dragon'])
    const trashedUnit = mintInto(state, 0, 'trash', 'japantown-jonin')
    setGigs(state, 1, [{ size: 6, value: 2 }])

    const next = playCardByDef(db, state, 0, 'yorinobu-arasaka-steel-dragon', {
      targets: [trashedUnit],
    })
    expect(next.players[0].field).toContain(trashedUnit)
    expect(next.players[0].trash).not.toContain(trashedUnit)
    expect(next.cards[trashedUnit].tempKeywords).toContain('adrenaline')
  })

  it('never offers a free play for a Unit costing more than 4', () => {
    const { state } = fixtureWithHand(0, ['yorinobu-arasaka-steel-dragon', 'animals-wrecker'])
    const wrecker = findInHand(state, 0, 'animals-wrecker') // cost 6
    const card = findInHand(state, 0, 'yorinobu-arasaka-steel-dragon')
    const plays = actionsOfType(db, state, 'playCard').filter((a) => a.card === card)
    expect(plays.every((a) => !a.targets.includes(wrecker))).toBe(true)
  })

  it('draws the first time any ARASAKA Unit is defeated each turn, on either side', () => {
    const { state } = fixtureWithHand(0, [])
    fieldCard(state, 0, 'yorinobu-arasaka-steel-dragon')
    const attackerA = fieldCard(state, 0, 'animals-wrecker')
    const attackerB = fieldCard(state, 0, 'animals-wrecker')
    const nonArasakaVictim = fieldCard(state, 1, 'japantown-jonin', { ready: false })
    const arasakaVictim = fieldCard(state, 1, 'minotaur', { ready: false })
    const handBefore = state.players[0].hand.length

    let next = passReact(db, startAttack(db, state, attackerA, nonArasakaVictim))
    expect(next.players[1].trash).toContain(nonArasakaVictim)
    expect(next.players[0].hand).toHaveLength(handBefore)

    next = passReact(db, startAttack(db, next, attackerB, arasakaVictim))
    expect(next.players[1].trash).toContain(arasakaVictim)
    expect(next.players[0].hand).toHaveLength(handBefore + 1)
  })
})

// ---------------------------------------------------------------------------
// The two batch-1 deferrals, finished by the floating-effects zone
// (docs/rulings.md §141).
//
// chrome-fang — "{Play} Until your next turn, rival Units can't steal friendly
// Gigs with value higher than their power."
// ---------------------------------------------------------------------------

describe('chrome-fang', () => {
  it("caps which friendly Gigs a rival Unit may steal at the thief's own power", () => {
    const { state } = fixtureWithHand(0, ['chrome-fang'])
    // A rival power-3 Unit, ready and waiting for its own turn.
    const thief = fieldCard(state, 1, 'valentino-street-racer') // power 3
    let next = playCardByDef(db, state, 0, 'chrome-fang')
    setGigs(next, 0, [
      { size: 6, value: 2 },
      { size: 6, value: 5 },
      { size: 6, value: 3 },
    ])
    next = endTurnOnce(db, next) // the rival's turn: the restriction is live

    next = passReact(db, startAttack(db, next, thief, 'gigArea'))
    // Only the value-2 and value-3 dice are within reach of power 3.
    expect(actionsOfType(db, next, 'chooseGig').map((a) => a.dieIndex)).toEqual([0, 2])
  })

  it('lapses at the start of its own controller next turn', () => {
    const { state } = fixtureWithHand(0, ['chrome-fang'])
    const thief = fieldCard(state, 1, 'valentino-street-racer')
    let next = playCardByDef(db, state, 0, 'chrome-fang')
    expect(next.floatingEffects).toHaveLength(1)
    setGigs(next, 0, [{ size: 6, value: 5 }])

    next = endBothTurnsOnce(db, next) // rival turn, then player 0's next turn
    expect(next.floatingEffects).toEqual([])
    next = endTurnOnce(db, next) // the rival's turn again, unrestricted now
    next = passReact(db, startAttack(db, next, thief, 'gigArea'))
    // Every friendly die is on the table again, whatever its value — including
    // the value-5 one the lapsed restriction had put out of a power-3 reach.
    expect(actionsOfType(db, next, 'chooseGig')).toHaveLength(
      next.players[0].gigArea.length
    )
    expect(gigValues(next, 0)).toContain(5)
  })
})

// ---------------------------------------------------------------------------
// appetite-for-destruction — "The next time a friendly Unit wins a fight by 3+
// power this turn, it also steals a Gig."
// ---------------------------------------------------------------------------

describe('appetite-for-destruction', () => {
  it('gives the winner of a 3+ margin fight a bonus Gig steal, once', () => {
    const { state } = fixtureWithHand(0, ['appetite-for-destruction'])
    const attacker = fieldCard(state, 0, 'animals-wrecker') // power 10
    const victim = fieldCard(state, 1, 'japantown-jonin', { ready: false }) // power 0
    setGigs(state, 1, [{ size: 6, value: 4 }])

    let next = playCardByDef(db, state, 0, 'appetite-for-destruction')
    expect(next.floatingEffects).toHaveLength(1)

    next = passReact(db, startAttack(db, next, attacker, victim))
    // The fight is won by 10, so the delayed steal fires and asks for a die.
    expect(next.phase).toBe('chooseGig')
    expect(next.floatingEffects).toEqual([]) // one-shot: consumed
    next = chooseGig(db, next, 0)
    expect(gigValues(next, 0)).toContain(4)
  })

  it('does not fire on a narrower win', () => {
    const { state } = fixtureWithHand(0, ['appetite-for-destruction'])
    const attacker = fieldCard(state, 0, 'valentino-street-racer') // power 3
    const victim = fieldCard(state, 1, 'corpo-security', { ready: false }) // power 2
    setGigs(state, 1, [{ size: 6, value: 4 }])

    let next = playCardByDef(db, state, 0, 'appetite-for-destruction')
    next = passReact(db, startAttack(db, next, attacker, victim))
    expect(next.phase).toBe('main') // margin 1: no steal
    expect(next.floatingEffects).toHaveLength(1) // still waiting for a real win
  })
})
