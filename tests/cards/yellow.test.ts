// Task 8 — Yellow cards, batch 3: the first 19 Yellow cards assigned to this
// batch.
//
// Every test here drives a REAL card definition from `data/cards.json`
// through the public engine API (`newGame` / `legalActions` / `applyAction`),
// using the shared fixtures in ./fixtures.ts, exactly like tests/cards/red.test.ts.
//
// Cards covered, in card-id order:
//   adam-smasher-metal-over-meat, adrenaline-converter, afterparty-at-lizzie-s,
//   alt-cunningham-mother-of-daemons, augmented-negotiators,
//   bootleg-black-sapphire-show, caliber-totentanz-s-top-dog,
//   dexter-deshawn-one-last-chance, dum-dum-maelstrom-triggerman,
//   gilded-mato-n, gorilla-arms, hanako-arasaka-in-a-gilded-cage,
//   heywood-ripperdoc, jackie-welles-ride-or-die-choom, kiroshi-optics,
//   live-with-the-aftermath, maelstrom-goons.
// Deferred (see the batch report): cyberpsychosis, kerry-eurodyne-axe-attitude-audience.

import { describe, expect, it } from 'vitest'
import { applyAction } from '../../src/engine/reduce'
import type { GameState } from '../../src/engine/types'
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

/**
 * [surgery] Attaches a freshly-minted Gear card directly to `hostUid`,
 * bypassing the normal equip flow — used to give a UNIT'S OWNER's own
 * side (or the rival's) a specific Gear to target, without spending a turn
 * on the ordinary play-and-equip sequence.
 */
function attachGear(state: GameState, hostUid: number, gearDefId: string): number {
  const owner = state.cards[hostUid].owner
  const gearUid = mintInto(state, owner, 'trash', gearDefId)
  state.cards[hostUid].attachedGear.push(gearUid)
  state.players[owner].trash = state.players[owner].trash.filter((uid) => uid !== gearUid)
  return gearUid
}

// ---------------------------------------------------------------------------
// adam-smasher-metal-over-meat — "{Play} Defeat all other Units."
// ---------------------------------------------------------------------------

describe('adam-smasher-metal-over-meat', () => {
  it('defeats every other Unit on both sides when played, sparing itself', () => {
    const { state } = fixtureWithHand(0, ['adam-smasher-metal-over-meat'])
    const ally = fieldCard(state, 0, 'japantown-jonin')
    const foeA = fieldCard(state, 1, 'japantown-jonin')
    const foeB = fieldCard(state, 1, 'animals-wrecker')

    const next = playCardByDef(db, state, 0, 'adam-smasher-metal-over-meat')
    const smasher = findFielded(next, 0, 'adam-smasher-metal-over-meat')
    expect(next.players[0].field).toEqual([smasher])
    expect(next.players[1].field).toEqual([])
    expect(next.players[0].trash).toContain(ally)
    expect(next.players[1].trash).toEqual(expect.arrayContaining([foeA, foeB]))
  })
})

// ---------------------------------------------------------------------------
// adrenaline-converter — "If a Rival controls at least 2 more Gigs than you,
// this Unit has {Adrenaline}."
// ---------------------------------------------------------------------------

describe('adrenaline-converter', () => {
  it('lets a lagged host attack only while a Rival leads by 2+ Gigs', () => {
    const { state } = fixtureWithHand(0, ['japantown-jonin', 'adrenaline-converter'])
    let next = playCardByDef(db, state, 0, 'japantown-jonin')
    next = playCardByDef(db, next, 0, 'adrenaline-converter', { targetDef: 'japantown-jonin' })
    const host = findFielded(next, 0, 'japantown-jonin')
    expect(next.cards[host].lag).toBe(true)
    expect(actionsOfType(db, next, 'attack').some((a) => a.attacker === host)).toBe(false)

    setGigs(next, 0, [])
    setGigs(next, 1, [
      { size: 6, value: 3 },
      { size: 6, value: 4 },
    ])
    expect(actionsOfType(db, next, 'attack').some((a) => a.attacker === host)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// afterparty-at-lizzie-s — "Adjust a Gig by up to 1. If you control 2 or more
// Gigs with different values, draw 1."
// ---------------------------------------------------------------------------

describe('afterparty-at-lizzie-s', () => {
  it('adjusts a Gig by 1 and draws when it creates 2+ distinct Gig values', () => {
    const { state } = fixtureWithHand(0, ['afterparty-at-lizzie-s'])
    setGigs(state, 0, [
      { size: 6, value: 3 },
      { size: 6, value: 3 },
    ])
    const next = playCardByDef(db, state, 0, 'afterparty-at-lizzie-s', { targets: [0, 1] }) // die 0, +1
    expect(gigValues(next, 0).sort((a, b) => a - b)).toEqual([3, 4])
    expect(next.players[0].hand).toHaveLength(1) // the drawn card
  })

  it('does not draw when every friendly Gig still shares one value', () => {
    const { state } = fixtureWithHand(0, ['afterparty-at-lizzie-s'])
    setGigs(state, 0, [{ size: 6, value: 3 }])
    const next = playCardByDef(db, state, 0, 'afterparty-at-lizzie-s', { targets: [0, 0] }) // die 0, -1
    expect(gigValues(next, 0)).toEqual([2])
    expect(next.players[0].hand).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// alt-cunningham-mother-of-daemons — "When a friendly equipped Unit or
// Legend is spent, draw 1."
// ---------------------------------------------------------------------------

describe('alt-cunningham-mother-of-daemons', () => {
  it('draws when a friendly equipped Unit is spent, including herself', () => {
    const { state } = fixtureWithHand(0, ['mantis-blades'])
    const alt = fieldCard(state, 0, 'alt-cunningham-mother-of-daemons')
    let next = playCardByDef(db, state, 0, 'mantis-blades', {
      targetDef: 'alt-cunningham-mother-of-daemons',
    })
    const victim = fieldCard(next, 1, 'japantown-jonin', { ready: false })
    const handBefore = next.players[0].hand.length
    const attacked = startAttack(db, next, alt, victim)
    expect(attacked.players[0].hand).toHaveLength(handBefore + 1)
  })

  it('does not fire while unequipped', () => {
    const { state } = fixtureWithHand(0, [])
    const alt = fieldCard(state, 0, 'alt-cunningham-mother-of-daemons')
    const victim = fieldCard(state, 1, 'japantown-jonin', { ready: false })
    const handBefore = state.players[0].hand.length
    const attacked = startAttack(db, state, alt, victim)
    expect(attacked.players[0].hand).toHaveLength(handBefore)
  })
})

// ---------------------------------------------------------------------------
// augmented-negotiators — "When this Unit uses {Blocker}, a Rival discards 1."
// ---------------------------------------------------------------------------

describe('augmented-negotiators', () => {
  it('makes a Rival discard 1 when it blocks', () => {
    const { state } = fixtureWithHand(1, ['japantown-jonin'])
    const blocker = fieldCard(state, 0, 'augmented-negotiators')
    const attacker = fieldCard(state, 1, 'animals-wrecker')
    setGigs(state, 0, [{ size: 6, value: 3 }]) // a legal attack target (gigArea)
    const before = state.players[1].hand.length
    const next = blockWith(db, startAttack(db, state, attacker, 'gigArea'), blocker)
    expect(next.players[1].hand).toHaveLength(before - 1)
  })
})

// ---------------------------------------------------------------------------
// bootleg-black-sapphire-show — "Sell the top card of your deck. If you
// control a Gig with an even value and a Gig with an odd value, draw 2."
// ---------------------------------------------------------------------------

describe('bootleg-black-sapphire-show', () => {
  it('sells the top card of the deck and draws 2 with an even+odd Gig pair', () => {
    const { state } = fixtureWithHand(0, ['bootleg-black-sapphire-show'])
    setGigs(state, 0, [
      { size: 6, value: 4 },
      { size: 6, value: 3 },
    ])
    const eddiesBefore = state.players[0].eddies.length
    const deckBefore = state.players[0].deck.length
    const next = playCardByDef(db, state, 0, 'bootleg-black-sapphire-show')
    expect(next.players[0].eddies).toHaveLength(eddiesBefore + 1)
    expect(next.players[0].deck).toHaveLength(deckBefore - 1 - 2) // sold 1, then drew 2
    expect(next.players[0].hand).toHaveLength(2)
  })

  it('does not draw without both an even and an odd Gig', () => {
    const { state } = fixtureWithHand(0, ['bootleg-black-sapphire-show'])
    setGigs(state, 0, [
      { size: 6, value: 4 },
      { size: 6, value: 2 },
    ])
    const next = playCardByDef(db, state, 0, 'bootleg-black-sapphire-show')
    expect(next.players[0].hand).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// caliber-totentanz-s-top-dog — "{Play} Defeat a rival Unit with cost 2 or
// less. {Defeated} A Rival discards 1. If the card's cost equals the value
// of a friendly Gig, that Rival discards 1 more."
// ---------------------------------------------------------------------------

describe('caliber-totentanz-s-top-dog', () => {
  it('defeats a cheap rival Unit on play, sparing a tougher one', () => {
    const { state } = fixtureWithHand(0, ['caliber-totentanz-s-top-dog'])
    const cheap = fieldCard(state, 1, 'japantown-jonin') // cost 2
    const tough = fieldCard(state, 1, 'animals-wrecker') // cost 6
    const next = playCardByDef(db, state, 0, 'caliber-totentanz-s-top-dog')
    expect(next.players[1].trash).toContain(cheap)
    expect(next.players[1].field).toContain(tough)
  })

  it('discards 1 on its own defeat, or 2 when its own cost matches a friendly Gig', () => {
    const { state } = fixtureWithHand(1, ['japantown-jonin'])
    const caliber = fieldCard(state, 0, 'caliber-totentanz-s-top-dog', { ready: false }) // cost 5
    const brute = fieldCard(state, 1, 'animals-wrecker')
    setGigs(state, 0, []) // no matching Gig
    const handBefore = state.players[1].hand.length
    const next = passReact(db, startAttack(db, state, brute, caliber))
    expect(next.players[0].trash).toContain(caliber)
    expect(next.players[1].hand).toHaveLength(handBefore - 1)
  })

  it('discards an extra card when a friendly Gig equals its own cost (5)', () => {
    const { state } = fixtureWithHand(1, ['japantown-jonin', 'japantown-jonin'])
    const caliber = fieldCard(state, 0, 'caliber-totentanz-s-top-dog', { ready: false })
    const brute = fieldCard(state, 1, 'animals-wrecker')
    setGigs(state, 0, [{ size: 10, value: 5 }])
    const handBefore = state.players[1].hand.length
    const next = passReact(db, startAttack(db, state, brute, caliber))
    expect(next.players[0].trash).toContain(caliber)
    expect(next.players[1].hand).toHaveLength(handBefore - 2)
  })
})

// ---------------------------------------------------------------------------
// dexter-deshawn-one-last-chance — "{Play} {Attack} Adjust a Gig by up to 1.
// {Defeated} If your ☆ differs from a Rival's by 10+, draw 2."
// ---------------------------------------------------------------------------

describe('dexter-deshawn-one-last-chance', () => {
  it('adjusts a Gig by up to 1 on play', () => {
    const { state } = fixtureWithHand(0, ['dexter-deshawn-one-last-chance'])
    setGigs(state, 0, [{ size: 6, value: 3 }])
    const next = playCardByDef(db, state, 0, 'dexter-deshawn-one-last-chance', { targets: [0, 1] })
    expect(gigValues(next, 0)).toEqual([4])
  })

  it('adjusts a Gig by up to 1 on attack too (auto-picked)', () => {
    const { state } = fixtureWithHand(0, [])
    const dexter = fieldCard(state, 0, 'dexter-deshawn-one-last-chance')
    const victim = fieldCard(state, 1, 'japantown-jonin', { ready: false })
    setGigs(state, 0, [{ size: 10, value: 4 }])
    const attacked = startAttack(db, state, dexter, victim)
    expect([3, 5]).toContain(gigValues(attacked, 0)[0])
  })

  it('draws 2 on defeat when Street Cred differs from a Rival by 10+', () => {
    const { state } = fixtureWithHand(1, [])
    const dexter = fieldCard(state, 0, 'dexter-deshawn-one-last-chance', { ready: false })
    const brute = fieldCard(state, 1, 'animals-wrecker')
    setGigs(state, 0, [{ size: 20, value: 1 }])
    setGigs(state, 1, [{ size: 20, value: 15 }]) // diff = 14
    const handBefore = state.players[0].hand.length
    const next = passReact(db, startAttack(db, state, brute, dexter))
    expect(next.players[0].trash).toContain(dexter)
    expect(next.players[0].hand).toHaveLength(handBefore + 2)
  })

  it('does not draw when Street Cred is close', () => {
    const { state } = fixtureWithHand(1, [])
    const dexter = fieldCard(state, 0, 'dexter-deshawn-one-last-chance', { ready: false })
    const brute = fieldCard(state, 1, 'animals-wrecker')
    setGigs(state, 0, [{ size: 20, value: 5 }])
    setGigs(state, 1, [{ size: 20, value: 8 }]) // diff = 3
    const handBefore = state.players[0].hand.length
    const next = passReact(db, startAttack(db, state, brute, dexter))
    expect(next.players[0].hand).toHaveLength(handBefore)
  })
})

// ---------------------------------------------------------------------------
// dum-dum-maelstrom-triggerman — "{Call} You may defeat a friendly Gear. If
// you do, draw 2. Otherwise, draw 1. {Quick} 1 €$, {Spend} Give a friendly
// Unit +1 power this turn for each of its equipped Gear."
// ---------------------------------------------------------------------------

describe('dum-dum-maelstrom-triggerman', () => {
  it('defeats a friendly Gear and draws 2 when Called, with one available', () => {
    const { state } = fixtureWithHand(0, ['mantis-blades'], { eddies: 3 })
    state.players[0].legends = []
    const dumdum = mintInto(state, 0, 'legends', 'dum-dum-maelstrom-triggerman', { faceUp: false })
    const host = fieldCard(state, 0, 'japantown-jonin')
    const afterEquip = playCardByDef(db, state, 0, 'mantis-blades', { targetDef: 'japantown-jonin' })
    const gear = afterEquip.cards[host].attachedGear[0]
    const deckBefore = afterEquip.players[0].deck.length

    const call = actionsOfType(db, afterEquip, 'callLegend')[0]
    const next = applyAction(db, afterEquip, call)
    expect(next.cards[dumdum].faceUp).toBe(true)
    expect(next.players[0].trash).toContain(gear)
    expect(next.players[0].deck).toHaveLength(deckBefore - 2)
  })

  it('draws only 1 when Called with no friendly Gear to defeat', () => {
    const { state } = fixtureWithHand(0, [], { eddies: 3 })
    state.players[0].legends = []
    mintInto(state, 0, 'legends', 'dum-dum-maelstrom-triggerman', { faceUp: false })
    const deckBefore = state.players[0].deck.length
    const call = actionsOfType(db, state, 'callLegend')[0]
    const next = applyAction(db, state, call)
    expect(next.players[0].deck).toHaveLength(deckBefore - 1)
  })

  it('activated ability buffs a friendly Unit by 1 power per its equipped Gear, spending itself', () => {
    const { state } = fixtureWithHand(0, ['mantis-blades'], { eddies: 5 })
    state.players[0].legends = []
    const dumdum = mintInto(state, 0, 'legends', 'dum-dum-maelstrom-triggerman')
    const host = fieldCard(state, 0, 'japantown-jonin')
    const afterEquip = playCardByDef(db, state, 0, 'mantis-blades', { targetDef: 'japantown-jonin' })

    const next = activate(db, afterEquip, dumdum, 1, { targets: [host] })
    expect(next.cards[host].tempPower).toBe(1) // 1 equipped Gear * 1 power
    expect(next.cards[dumdum].ready).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// gilded-mato-n — "{Play} You may defeat a friendly Gear. If you do, defeat
// a rival Unit with cost 3 or less."
// ---------------------------------------------------------------------------

describe('gilded-mato-n', () => {
  it('offers each friendly Gear as a real, enumerated choice', () => {
    const { state } = fixtureWithHand(0, ['mantis-blades', 'satori-sword-of-saburo', 'gilded-mato-n'])
    const host = fieldCard(state, 0, 'japantown-jonin')
    let next = playCardByDef(db, state, 0, 'mantis-blades', { targetDef: 'japantown-jonin' })
    next = playCardByDef(db, next, 0, 'satori-sword-of-saburo', { targetDef: 'japantown-jonin' })
    const [gearA, gearB] = next.cards[host].attachedGear
    const card = findInHand(next, 0, 'gilded-mato-n')
    const offered = actionsOfType(db, next, 'playCard')
      .filter((a) => a.card === card)
      .map((a) => a.targets[0])
    expect(offered).toEqual(expect.arrayContaining([gearA, gearB]))
  })

  it('defeats the chosen friendly Gear and a cheap rival Unit together', () => {
    const { state } = fixtureWithHand(0, ['mantis-blades', 'gilded-mato-n'])
    const host = fieldCard(state, 0, 'japantown-jonin')
    let next = playCardByDef(db, state, 0, 'mantis-blades', { targetDef: 'japantown-jonin' })
    const gear = next.cards[host].attachedGear[0]
    const cheap = fieldCard(next, 1, 'japantown-jonin') // cost 2
    next = playCardByDef(db, next, 0, 'gilded-mato-n', { targets: [gear] })
    expect(next.players[0].trash).toContain(gear)
    expect(next.players[1].trash).toContain(cheap)
  })

  it('does nothing when there is no friendly Gear', () => {
    const { state } = fixtureWithHand(0, ['gilded-mato-n'])
    const cheap = fieldCard(state, 1, 'japantown-jonin')
    const next = playCardByDef(db, state, 0, 'gilded-mato-n')
    expect(next.players[1].field).toContain(cheap)
  })
})

// ---------------------------------------------------------------------------
// gorilla-arms — "The first time this Unit steals 1 or more Gigs each turn,
// steal a rival Gig with a value not shared by a friendly Gig."
// ---------------------------------------------------------------------------

describe('gorilla-arms', () => {
  it('adds a distinct-value bonus steal the first time its host steals each turn', () => {
    const { state } = fixtureWithHand(0, ['gorilla-arms'])
    const host = fieldCard(state, 0, 'japantown-jonin') // power 0 + Gear's printed 3 = 3
    let next = playCardByDef(db, state, 0, 'gorilla-arms', { targetDef: 'japantown-jonin' })
    setGigs(next, 0, [{ size: 6, value: 2 }])
    setGigs(next, 1, [
      { size: 20, value: 9 },
      { size: 6, value: 2 },
      { size: 8, value: 5 },
    ])

    let after = passReact(db, startAttack(db, next, host, 'gigArea'))
    after = applyAction(db, after, actionsOfType(db, after, 'chooseGig')[0])
    expect(after.phase).toBe('chooseGig') // the bonus die is still owed
    after = applyAction(db, after, actionsOfType(db, after, 'chooseGig')[0])
    expect(after.phase).toBe('main')
    expect(after.players[0].gigArea).toHaveLength(3) // the original + 2 stolen dice
  })
})

// ---------------------------------------------------------------------------
// hanako-arasaka-in-a-gilded-cage — "{Play} Search the top 4 cards of your
// deck. Reveal any number of cards with cost equal to any friendly Gig
// values and add them to your hand. Bottom-deck the rest."
// ---------------------------------------------------------------------------

describe('hanako-arasaka-in-a-gilded-cage', () => {
  it('adds matching-cost cards from the top 4 to hand, bottom-decking the rest', () => {
    const { state } = fixtureWithHand(0, ['hanako-arasaka-in-a-gilded-cage'])
    setGigs(state, 0, [{ size: 6, value: 2 }])
    // [surgery] a known top-of-deck: one matching cost (2), three not.
    const match = mintInto(state, 0, 'deck', 'japantown-jonin') // cost 2
    const f1 = mintInto(state, 0, 'deck', 'animals-wrecker') // cost 6
    const f2 = mintInto(state, 0, 'deck', 'animals-wrecker')
    const f3 = mintInto(state, 0, 'deck', 'animals-wrecker')
    const rest = state.players[0].deck.filter((uid) => ![match, f1, f2, f3].includes(uid))
    state.players[0].deck = [match, f1, f2, f3, ...rest]
    const deckBefore = state.players[0].deck.length

    const next = playCardByDef(db, state, 0, 'hanako-arasaka-in-a-gilded-cage')
    expect(next.players[0].hand).toContain(match)
    expect(next.players[0].deck).toHaveLength(deckBefore - 4 + 3) // 4 looked at, 3 bottom-decked
    expect(next.players[0].deck).toContain(f1)
  })
})

// ---------------------------------------------------------------------------
// heywood-ripperdoc — "{Play} You may defeat a Gear. If its cost equals the
// value of a friendly Gig, draw 1."
// ---------------------------------------------------------------------------

describe('heywood-ripperdoc', () => {
  it('offers every Gear on both sides as a real, enumerated choice', () => {
    const { state } = fixtureWithHand(0, ['mantis-blades', 'heywood-ripperdoc'])
    const host = fieldCard(state, 0, 'japantown-jonin')
    let next = playCardByDef(db, state, 0, 'mantis-blades', { targetDef: 'japantown-jonin' })
    const ownGear = next.cards[host].attachedGear[0]
    const rivalHost = fieldCard(next, 1, 'japantown-jonin')
    const rivalGear = attachGear(next, rivalHost, 'satori-sword-of-saburo')

    const card = findInHand(next, 0, 'heywood-ripperdoc')
    const offered = actionsOfType(db, next, 'playCard')
      .filter((a) => a.card === card)
      .map((a) => a.targets[0])
    expect(offered).toEqual(expect.arrayContaining([ownGear, rivalGear]))
  })

  it('can choose to defeat its own equipped Gear and draws when its cost matches a friendly Gig', () => {
    const { state } = fixtureWithHand(0, ['mantis-blades', 'heywood-ripperdoc'])
    const host = fieldCard(state, 0, 'japantown-jonin')
    let next = playCardByDef(db, state, 0, 'mantis-blades', { targetDef: 'japantown-jonin' })
    const gear = next.cards[host].attachedGear[0]
    setGigs(next, 0, [{ size: 6, value: 1 }]) // matches mantis-blades' cost 1
    const handBefore = next.players[0].hand.length
    next = playCardByDef(db, next, 0, 'heywood-ripperdoc', { targets: [gear] })
    expect(next.players[0].trash).toContain(gear)
    expect(next.players[0].hand).toHaveLength(handBefore) // heywood left, 1 drawn: net 0
  })

  it('can choose to defeat a rival Gear instead of its own, without drawing on a cost mismatch', () => {
    const { state } = fixtureWithHand(0, ['mantis-blades', 'heywood-ripperdoc'])
    const host = fieldCard(state, 0, 'japantown-jonin')
    let next = playCardByDef(db, state, 0, 'mantis-blades', { targetDef: 'japantown-jonin' })
    const ownGear = next.cards[host].attachedGear[0]
    const rivalHost = fieldCard(next, 1, 'japantown-jonin')
    const rivalGear = attachGear(next, rivalHost, 'satori-sword-of-saburo') // cost 2
    setGigs(next, 0, [{ size: 6, value: 4 }]) // does not match the rival Gear's cost
    const handBefore = next.players[0].hand.length

    next = playCardByDef(db, next, 0, 'heywood-ripperdoc', { targets: [rivalGear] })
    expect(next.players[1].trash).toContain(rivalGear)
    expect(next.cards[host].attachedGear).toEqual([ownGear]) // the own Gear is untouched
    expect(next.players[0].hand).toHaveLength(handBefore - 1) // heywood left, no draw
  })
})

// ---------------------------------------------------------------------------
// jackie-welles-ride-or-die-choom — "{Attack} Give this Unit +2 power this
// turn for each friendly Gig with an even value. {Defeated} Draw 1 for each
// friendly Gig with an odd value."
// ---------------------------------------------------------------------------

describe('jackie-welles-ride-or-die-choom', () => {
  it('gains +2 power per even-valued friendly Gig while attacking', () => {
    const { state } = fixtureWithHand(0, [])
    const jackie = fieldCard(state, 0, 'jackie-welles-ride-or-die-choom') // power 8
    const victim = fieldCard(state, 1, 'japantown-jonin', { ready: false })
    setGigs(state, 0, [
      { size: 6, value: 2 },
      { size: 6, value: 4 },
      { size: 6, value: 3 },
    ])
    const next = startAttack(db, state, jackie, victim)
    expect(next.cards[jackie].tempPower).toBe(4) // 2 even dice * 2
  })

  it('draws 1 per odd-valued friendly Gig when defeated', () => {
    const { state } = fixtureWithHand(1, [])
    const jackie = fieldCard(state, 0, 'jackie-welles-ride-or-die-choom', { ready: false })
    const brute = fieldCard(state, 1, 'animals-wrecker')
    mintInto(state, 0, 'deck', 'japantown-jonin')
    mintInto(state, 0, 'deck', 'japantown-jonin')
    setGigs(state, 0, [
      { size: 6, value: 3 },
      { size: 6, value: 5 },
      { size: 6, value: 4 },
    ])
    const handBefore = state.players[0].hand.length
    const next = passReact(db, startAttack(db, state, brute, jackie))
    expect(next.players[0].trash).toContain(jackie)
    expect(next.players[0].hand).toHaveLength(handBefore + 2) // 2 odd dice * 1
  })
})

// ---------------------------------------------------------------------------
// kiroshi-optics — "(Equip to a Unit or friendly face-up Legend.) {Attack}
// Look at a friendly face-down Legend. (Don't reveal it.)"
// ---------------------------------------------------------------------------

describe('kiroshi-optics', () => {
  it("fires its {Attack} effect through its host's attack (no state change)", () => {
    const { state } = fixtureWithHand(0, ['kiroshi-optics'])
    const host = fieldCard(state, 0, 'japantown-jonin')
    const next = playCardByDef(db, state, 0, 'kiroshi-optics', { targetDef: 'japantown-jonin' })
    const gear = next.cards[host].attachedGear[0]
    const victim = fieldCard(next, 1, 'japantown-jonin', { ready: false })

    const attacked = startAttack(db, next, host, victim)
    expect(
      attacked.events.some(
        (e) =>
          e.type === 'effectResolved' &&
          e.sourceUid === gear &&
          e.description === 'scripted:kiroshi-optics'
      )
    ).toBe(true)
  })

  it('may equip to a rival Unit (docs/rulings.md §8)', () => {
    const { state } = fixtureWithHand(0, ['kiroshi-optics'])
    const rivalUnit = fieldCard(state, 1, 'japantown-jonin')
    const plays = actionsOfType(db, state, 'playCard')
    expect(plays.some((a) => a.targets[0] === rivalUnit)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// live-with-the-aftermath — "Each player defeats one of their Units."
// ---------------------------------------------------------------------------

describe('live-with-the-aftermath', () => {
  it("defeats the controller's chosen Unit and one of the rival's own", () => {
    const { state } = fixtureWithHand(0, ['live-with-the-aftermath'])
    const mine = fieldCard(state, 0, 'japantown-jonin')
    const other = fieldCard(state, 0, 'animals-wrecker')
    const rivalUnit = fieldCard(state, 1, 'japantown-jonin')

    const next = playCardByDef(db, state, 0, 'live-with-the-aftermath', { targetDef: 'japantown-jonin' })
    expect(next.players[0].trash).toContain(mine)
    expect(next.players[0].field).toContain(other)
    expect(next.players[1].trash).toContain(rivalUnit)
  })

  it('does nothing when neither side has a Unit', () => {
    const { state } = fixtureWithHand(0, ['live-with-the-aftermath'])
    const next = playCardByDef(db, state, 0, 'live-with-the-aftermath')
    expect(next.events.some((e) => e.type === 'unitDefeated')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// maelstrom-goons — "When this Unit steals a Gig, if it's equipped, a Rival
// discards 1."
// ---------------------------------------------------------------------------

describe('maelstrom-goons', () => {
  it('makes a Rival discard 1 when it steals a Gig while equipped', () => {
    const { state } = fixtureWithHand(0, ['mantis-blades'])
    const goon = fieldCard(state, 0, 'maelstrom-goons') // power 3 -> steals 1
    const next = playCardByDef(db, state, 0, 'mantis-blades', { targetDef: 'maelstrom-goons' })
    setGigs(next, 1, [{ size: 6, value: 3 }])
    mintInto(next, 1, 'hand', 'japantown-jonin')
    const handBefore = next.players[1].hand.length

    const after = attackAndSteal(db, next, goon, 'gigArea', [0])
    expect(after.players[1].hand).toHaveLength(handBefore - 1)
  })

  it('does not discard when unequipped', () => {
    const { state } = fixtureWithHand(0, [])
    const goon = fieldCard(state, 0, 'maelstrom-goons')
    setGigs(state, 1, [{ size: 6, value: 3 }])
    mintInto(state, 1, 'hand', 'japantown-jonin')
    const handBefore = state.players[1].hand.length

    const after = attackAndSteal(db, state, goon, 'gigArea', [0])
    expect(after.players[1].hand).toHaveLength(handBefore)
  })
})

// ---------------------------------------------------------------------------
// Batch bookkeeping: the cards this batch could not encode.
// ---------------------------------------------------------------------------

describe('deferred cards (see the batch-3 report)', () => {
  it('cyberpsychosis still carries no effects', () => {
    // "{Quick} Give an equipped Unit +3 power this turn for each of its
    // equipped Gears. If that Unit steals or fights, defeat it at the end of
    // this turn." A gameplay-affecting partial encoding (the buff alone,
    // without the delayed self-destruct) would make the card strictly
    // better than printed with no visible marking — forbidden by standing
    // policy (docs/rulings.md §79). The delayed, conditional, one-shot
    // defeat needs the same `floatingEffects` engine feature §52 already
    // scoped and declined to half-build for chrome-fang/
    // appetite-for-destruction, so the whole card is deferred, not just its
    // second clause.
    expect(db['cyberpsychosis'].effects).toEqual([])
  })

  it('kerry-eurodyne-axe-attitude-audience still carries no effects', () => {
    // Both clauses hook into the gig-die *roll* itself (the fixer's
    // start-of-turn roll and any future reroll), which no existing trigger
    // seam exposes — a genuine engine gap, not a vocabulary one. Recorded
    // here so the completeness test at the end of Task 8 has a single place
    // to look.
    expect(db['kerry-eurodyne-axe-attitude-audience'].effects).toEqual([])
  })
})
