// Task 8 — Blue cards, batch 7: the first 17 Blue cards.
//
// Cards covered, in card-id order:
//   alt-cunningham-soulkiller-architect, chrome-reverie, delamain-cab,
//   delamain-rideshare-ai, dying-night-v-s-pistol,
//   evelyn-parker-beautiful-enigma, evelyn-parker-scheming-siren, floor-it,
//   hacked-corpo, jacked-in-voodoo-boy, jackie-welles-pour-one-out-for-me,
//   judy-a-lvarez-braindance-maestro, judy-a-lvarez-nothing-to-doubt,
//   les-e-le-mens, lizzy-wizzy-delicate-weapon, maman-brigitte-spirit-of-death,
//   misty-olszewski-mender-of-broken-spirits.
// No deferrals in full this batch; two cards are PARTIALLY encoded (see the
// batch-7 report and docs/rulings.md §120 ff.):
//   * chrome-reverie — only its "may Call a Legend for free" clause; "A rival
//     Unit can't attack until your next turn" needs the `floatingEffects`
//     engine gap §52 already scoped and declined to build;
//   * evelyn-parker-beautiful-enigma — only its "ready 1 Eddie" watcher
//     clause; the "A rival Unit must attack next turn if it can" ability
//     needs a new "forced action" engine capability nothing in the pool has
//     built yet.
// Both omissions can only ever make the encoded card WEAKER than printed
// (never stronger), the same safe partial-encoding shape §60/§72 already
// established — never a gameplay-affecting partial per §79/§80.
//
// Every test here drives a REAL card definition from `data/cards.json`
// through the public engine API (`newGame` / `legalActions` / `applyAction`),
// using the shared fixtures in ./fixtures.ts, exactly like the other
// tests/cards/*.test.ts files.

import { describe, expect, it } from 'vitest'
import { legalActions } from '../../src/engine/legal'
import { effectivePower, hasKeyword } from '../../src/engine/query'
import { applyAction } from '../../src/engine/reduce'
import type { Action, CardDb, GameState } from '../../src/engine/types'
import {
  activate,
  actionsOfType,
  attackAndSteal,
  db,
  endBothTurnsOnce,
  fieldCard,
  findFielded,
  findInHand,
  fixtureWithHand,
  forceStreetCred,
  gigValues,
  mintInto,
  passReact,
  playCardByDef,
  setGigs,
  startAttack,
} from './fixtures'

/**
 * Ends only the active player's turn, landing on the rival's `start`/`main`
 * phase — unlike `endBothTurnsOnce`, this never runs the ORIGINAL player's own
 * next ready step, so a surgically-spent Eddie's readiness right afterward
 * reflects only what fired during THIS `endTurn` (an onEndTurn watcher), not
 * the ordinary "ready every spent card" step every turn start does anyway.
 */
function endOneTurn(db: CardDb, state: GameState): GameState {
  let next = applyAction(db, state, { type: 'endTurn' })
  if (next.phase === 'start') {
    const die = legalActions(db, next).find((action) => action.type === 'chooseGigDie')
    if (die) next = applyAction(db, next, die)
  }
  return next
}

// ---------------------------------------------------------------------------
// alt-cunningham-soulkiller-architect — "1 €$, {Spend} Play a Program from
// your trash. Bottom-deck it after you play it. (You still pay its cost.)"
// ---------------------------------------------------------------------------

describe('alt-cunningham-soulkiller-architect', () => {
  it('plays a Program from trash, paying its own cost separately, and bottom-decks it', () => {
    const { state } = fixtureWithHand(0, [])
    const alt = mintInto(state, 0, 'legends', 'alt-cunningham-soulkiller-architect', {
      faceUp: true,
      ready: true,
    })
    const program = mintInto(state, 0, 'trash', 'floor-it')
    const rival = fieldCard(state, 1, 'animals-wrecker')
    const readyEddiesBefore = state.players[0].eddies.filter((uid) => state.cards[uid].ready).length

    const s = activate(db, state, alt, 0, { targets: [program] })

    expect(s.players[0].trash).not.toContain(program)
    expect(s.players[0].hand).not.toContain(program)
    expect(s.players[0].deck[s.players[0].deck.length - 1]).toBe(program)
    // floor-it's own {Quick} onPlay resolved: -1 power to the rival Unit.
    expect(effectivePower(db, s, rival)).toBe(9)
    // Two separate payments: Alt's own 1 €$ (plus her self-spend) and
    // floor-it's own 1 €$.
    const readyEddiesAfter = s.players[0].eddies.filter((uid) => s.cards[uid].ready).length
    expect(readyEddiesBefore - readyEddiesAfter).toBe(2)
    expect(s.cards[alt].ready).toBe(false)
  })

  it('does not offer the ability with no Program in trash', () => {
    const { state } = fixtureWithHand(0, [])
    const alt = mintInto(state, 0, 'legends', 'alt-cunningham-soulkiller-architect', {
      faceUp: true,
      ready: true,
    })
    expect(actionsOfType(db, state, 'activateAbility').some((a) => a.card === alt)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// chrome-reverie — "... If you control a min Gig, you may Call a Legend for
// free. (You can only Call a Legend once per turn.)" (first clause deferred)
// ---------------------------------------------------------------------------

describe('chrome-reverie', () => {
  it('may Call a Legend for free when it controls a min Gig', () => {
    const { state } = fixtureWithHand(0, ['chrome-reverie'])
    setGigs(state, 0, [{ size: 6, value: 1 }])
    const before = state.players[0].legends.filter((uid) => state.cards[uid].faceUp).length

    const s = playCardByDef(db, state, 0, 'chrome-reverie')

    const after = s.players[0].legends.filter((uid) => s.cards[uid].faceUp).length
    expect(after).toBe(before + 1)
    expect(s.players[0].calledLegendThisTurn).toBe(true)
  })

  it('does not Call a Legend without a min Gig', () => {
    const { state } = fixtureWithHand(0, ['chrome-reverie'])
    setGigs(state, 0, [{ size: 6, value: 3 }])
    const before = state.players[0].legends.filter((uid) => state.cards[uid].faceUp).length

    const s = playCardByDef(db, state, 0, 'chrome-reverie')

    const after = s.players[0].legends.filter((uid) => s.cards[uid].faceUp).length
    expect(after).toBe(before)
    expect(s.players[0].calledLegendThisTurn).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// delamain-cab — "At the end of your turn, if this Unit stole a Gig this
// turn, ready 1 Eddie."
// ---------------------------------------------------------------------------

describe('delamain-cab', () => {
  it('readies 1 spent Eddie at the end of a turn it stole a Gig', () => {
    const { state } = fixtureWithHand(0, ['delamain-cab'])
    let s = playCardByDef(db, state, 0, 'delamain-cab')
    s = endBothTurnsOnce(db, s) // clear Lag
    const cab = findFielded(s, 0, 'delamain-cab')
    setGigs(s, 1, [{ size: 6, value: 3 }])
    s.cards[s.players[0].eddies[0]].ready = false // [surgery] a spent Eddie to observe

    s = attackAndSteal(db, s, cab, 'gigArea', [0])
    expect(s.cards[cab].stoleGigThisTurn).toBe(true)

    const ended = endOneTurn(db, s)
    expect(ended.cards[s.players[0].eddies[0]].ready).toBe(true)

    s = endBothTurnsOnce(db, s)
    expect(s.cards[cab].stoleGigThisTurn).toBe(false) // cleared for the next turn
  })

  it('does not ready an Eddie on a turn it did not steal', () => {
    const { state } = fixtureWithHand(0, ['delamain-cab'])
    let s = playCardByDef(db, state, 0, 'delamain-cab')
    s = endBothTurnsOnce(db, s)
    s.cards[s.players[0].eddies[0]].ready = false

    const ended = endOneTurn(db, s)
    expect(ended.cards[s.players[0].eddies[0]].ready).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// delamain-rideshare-ai — "{Play} Draw 2. (Units with power 0 don't steal
// Gigs.)"
// ---------------------------------------------------------------------------

describe('delamain-rideshare-ai', () => {
  it('draws 2 on play', () => {
    const { state } = fixtureWithHand(0, ['delamain-rideshare-ai'])
    const before = state.players[0].hand.length

    const s = playCardByDef(db, state, 0, 'delamain-rideshare-ai')

    // -1 for the card itself leaving hand, +2 drawn.
    expect(s.players[0].hand).toHaveLength(before - 1 + 2)
  })
})

// ---------------------------------------------------------------------------
// dying-night-v-s-pistol — "(Equip to a friendly Unit or face-up Legend.)
// {Attack} Decrease a Gig by up to 2. At the end of your turn, if this Unit
// is named 'V', ready 2 Eddies."
// ---------------------------------------------------------------------------

describe('dying-night-v-s-pistol', () => {
  it('decreases a Gig on attack; a non-"V" host never readies Eddies', () => {
    const { state } = fixtureWithHand(0, ['dying-night-v-s-pistol'])
    const wrecker = fieldCard(state, 0, 'animals-wrecker')
    let s = playCardByDef(db, state, 0, 'dying-night-v-s-pistol', { targetDef: 'animals-wrecker' })
    setGigs(s, 0, [])
    setGigs(s, 1, [{ size: 6, value: 5 }])
    s.cards[s.players[0].eddies[0]].ready = false
    s.cards[s.players[0].eddies[1]].ready = false

    s = attackAndSteal(db, s, wrecker, 'gigArea', [0])
    // The rival's only die was decreased by 2 before being stolen.
    expect(gigValues(s, 0)).toEqual([3])

    const ended = endOneTurn(db, s)
    expect(ended.cards[s.players[0].eddies[0]].ready).toBe(false)
    expect(ended.cards[s.players[0].eddies[1]].ready).toBe(false)
  })

  it('readies 2 Eddies at end of turn when its host is named "V"', () => {
    const { state } = fixtureWithHand(0, ['v-roamer-of-the-badlands', 'dying-night-v-s-pistol'])
    let s = playCardByDef(db, state, 0, 'v-roamer-of-the-badlands')
    s = endBothTurnsOnce(db, s)
    s = playCardByDef(db, s, 0, 'dying-night-v-s-pistol', { targetDef: 'v-roamer-of-the-badlands' })
    s.cards[s.players[0].eddies[0]].ready = false
    s.cards[s.players[0].eddies[1]].ready = false

    const ended = endOneTurn(db, s)
    expect(ended.cards[s.players[0].eddies[0]].ready).toBe(true)
    expect(ended.cards[s.players[0].eddies[1]].ready).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// evelyn-parker-beautiful-enigma — "When a friendly CORPO or GANGER Unit
// steals 1 or more Gigs, ready 1 Eddie." (the {Spend} ability is deferred)
// ---------------------------------------------------------------------------

describe('evelyn-parker-beautiful-enigma', () => {
  it('readies 1 Eddie when a friendly GANGER Unit steals a Gig', () => {
    const { state } = fixtureWithHand(0, ['animals-wrecker'])
    let s = playCardByDef(db, state, 0, 'animals-wrecker')
    s = endBothTurnsOnce(db, s)
    const wrecker = findFielded(s, 0, 'animals-wrecker')
    mintInto(s, 0, 'legends', 'evelyn-parker-beautiful-enigma', { faceUp: true, ready: true })
    setGigs(s, 1, [{ size: 6, value: 4 }])
    s.cards[s.players[0].eddies[0]].ready = false

    s = attackAndSteal(db, s, wrecker, 'gigArea', [0])
    expect(s.cards[s.players[0].eddies[0]].ready).toBe(true)
  })

  it('does not ready an Eddie when the stealer is neither CORPO nor GANGER', () => {
    const { state } = fixtureWithHand(0, ['v-roamer-of-the-badlands'])
    let s = playCardByDef(db, state, 0, 'v-roamer-of-the-badlands')
    s = endBothTurnsOnce(db, s)
    const roamer = findFielded(s, 0, 'v-roamer-of-the-badlands')
    mintInto(s, 0, 'legends', 'evelyn-parker-beautiful-enigma', { faceUp: true, ready: true })
    setGigs(s, 1, [{ size: 6, value: 4 }])
    s.cards[s.players[0].eddies[0]].ready = false

    s = attackAndSteal(db, s, roamer, 'gigArea', [0])
    expect(s.cards[s.players[0].eddies[0]].ready).toBe(false)
  })

  it('readies exactly 1 Eddie for a steal EPISODE, even when it takes 2 dice (fix round 1)', () => {
    // Controller ruling (docs/rulings.md §133): "steals 1 or more Gigs"
    // fires ONCE per completed steal episode, not once per die. Power 10
    // steals 2 dice in one attack (POWER_PER_EXTRA_GIG = 10); the fix
    // fires the new `onFriendlyStealComplete` watcher exactly once when
    // that whole steal finishes, unlike the per-die `onFriendlyStealDie`
    // every other card in the pool still uses.
    const { state } = fixtureWithHand(0, ['animals-wrecker']) // power 10, GANGER
    let s = playCardByDef(db, state, 0, 'animals-wrecker')
    s = endBothTurnsOnce(db, s)
    const wrecker = findFielded(s, 0, 'animals-wrecker')
    mintInto(s, 0, 'legends', 'evelyn-parker-beautiful-enigma', { faceUp: true, ready: true })
    setGigs(s, 0, [])
    setGigs(s, 1, [
      { size: 6, value: 3 },
      { size: 6, value: 4 },
    ])
    s.cards[s.players[0].eddies[0]].ready = false
    s.cards[s.players[0].eddies[1]].ready = false

    s = attackAndSteal(db, s, wrecker, 'gigArea', [0, 0])

    expect(gigValues(s, 0)).toHaveLength(2) // both dice stolen in one episode
    expect(s.cards[s.players[0].eddies[0]].ready).toBe(true)
    expect(s.cards[s.players[0].eddies[1]].ready).toBe(false) // only 1 Eddie readied, not 2
  })
})

// ---------------------------------------------------------------------------
// evelyn-parker-scheming-siren — "{Attack} Draw 1. Then, if you have more ☆
// (Street Cred) than a Rival, discard 1. (Units with power 0 don't steal
// Gigs.)"
// ---------------------------------------------------------------------------

describe('evelyn-parker-scheming-siren', () => {
  it('draws 1 on attack', () => {
    const { state } = fixtureWithHand(0, ['evelyn-parker-scheming-siren'])
    let s = playCardByDef(db, state, 0, 'evelyn-parker-scheming-siren')
    s = endBothTurnsOnce(db, s)
    const siren = findFielded(s, 0, 'evelyn-parker-scheming-siren')
    setGigs(s, 1, [{ size: 6, value: 2 }])
    const deckBefore = s.players[0].deck.length

    s = passReact(db, startAttack(db, s, siren, 'gigArea'))

    expect(s.players[0].deck.length).toBe(deckBefore - 1)
  })

  it('also discards 1 when ahead on Street Cred', () => {
    const { state } = fixtureWithHand(0, ['evelyn-parker-scheming-siren', 'floor-it'])
    let s = playCardByDef(db, state, 0, 'evelyn-parker-scheming-siren')
    s = endBothTurnsOnce(db, s)
    const siren = findFielded(s, 0, 'evelyn-parker-scheming-siren')
    s = forceStreetCred(s, 0, 10)
    s = forceStreetCred(s, 1, 2) // also gives the rival a Gig area to attack
    const deckBefore = s.players[0].deck.length
    const trashBefore = s.players[0].trash.length

    s = passReact(db, startAttack(db, s, siren, 'gigArea'))

    expect(s.players[0].deck.length).toBe(deckBefore - 1) // the draw
    expect(s.players[0].trash.length).toBe(trashBefore + 1) // the discard
  })
})

// ---------------------------------------------------------------------------
// floor-it — "{Quick} Give a rival Unit -1 power this turn. Draw 1."
// ---------------------------------------------------------------------------

describe('floor-it', () => {
  it('gives a rival Unit -1 power this turn and draws 1', () => {
    const { state } = fixtureWithHand(0, ['floor-it'])
    const rival = fieldCard(state, 1, 'animals-wrecker')
    const deckBefore = state.players[0].deck.length

    const s = playCardByDef(db, state, 0, 'floor-it', { targets: [rival] })

    expect(effectivePower(db, s, rival)).toBe(9)
    expect(s.players[0].deck.length).toBe(deckBefore - 1)
  })
})

// ---------------------------------------------------------------------------
// hacked-corpo — "{Play} Trash 3. Add a Program from among them to your
// hand."
// ---------------------------------------------------------------------------

describe('hacked-corpo', () => {
  it('trashes the top 3 and returns a Program among them to hand', () => {
    const { state } = fixtureWithHand(0, ['hacked-corpo'])
    const progA = mintInto(state, 0, 'deck', 'industrial-assembly')
    const unit = mintInto(state, 0, 'deck', 'animals-wrecker')
    const progB = mintInto(state, 0, 'deck', 'floor-it')
    const rest = state.players[0].deck.filter((uid) => ![progA, unit, progB].includes(uid))
    state.players[0].deck = [progA, unit, progB, ...rest]

    const s = playCardByDef(db, state, 0, 'hacked-corpo')

    expect(s.players[0].trash).toContain(unit)
    const programsInHand = [progA, progB].filter((uid) => s.players[0].hand.includes(uid))
    expect(programsInHand).toHaveLength(1)
  })

  it('keeps nothing when none of the 3 is a Program', () => {
    const { state } = fixtureWithHand(0, ['hacked-corpo'])
    const units = [0, 1, 2].map(() => mintInto(state, 0, 'deck', 'animals-wrecker'))
    const rest = state.players[0].deck.filter((uid) => !units.includes(uid))
    state.players[0].deck = [...units, ...rest]

    const s = playCardByDef(db, state, 0, 'hacked-corpo')

    for (const uid of units) expect(s.players[0].trash).toContain(uid)
    expect(s.players[0].hand.some((uid) => units.includes(uid))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// jacked-in-voodoo-boy — "This Unit can't attack unless you played a Program
// this turn."
// ---------------------------------------------------------------------------

describe('jacked-in-voodoo-boy', () => {
  it("can't attack until a Program is played that turn", () => {
    const { state } = fixtureWithHand(0, ['jacked-in-voodoo-boy'])
    let s = playCardByDef(db, state, 0, 'jacked-in-voodoo-boy')
    s = endBothTurnsOnce(db, s)
    const voodoo = findFielded(s, 0, 'jacked-in-voodoo-boy')
    expect(actionsOfType(db, s, 'attack').some((a) => a.attacker === voodoo)).toBe(false)

    mintInto(s, 0, 'hand', 'industrial-assembly')
    s = playCardByDef(db, s, 0, 'industrial-assembly')

    expect(actionsOfType(db, s, 'attack').some((a) => a.attacker === voodoo)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// jackie-welles-pour-one-out-for-me — "The first time you play a Blue Unit or
// Blue Gear each turn, you may decrease a friendly Gig by up to 2. If it
// becomes a min Gig, draw 1."
// ---------------------------------------------------------------------------

describe('jackie-welles-pour-one-out-for-me', () => {
  it('decreases a friendly Gig, drawing 1 when it becomes a min Gig', () => {
    const { state } = fixtureWithHand(0, ['jacked-in-voodoo-boy'])
    mintInto(state, 0, 'legends', 'jackie-welles-pour-one-out-for-me', { faceUp: true, ready: true })
    setGigs(state, 0, [{ size: 6, value: 2 }])
    const deckBefore = state.players[0].deck.length

    const s = playCardByDef(db, state, 0, 'jacked-in-voodoo-boy')

    expect(gigValues(s, 0)).toEqual([1])
    expect(s.players[0].deck.length).toBe(deckBefore - 1)
  })

  it('only fires once per turn across a Unit AND a Gear play', () => {
    const { state } = fixtureWithHand(0, ['jacked-in-voodoo-boy', 'evelyn-parker-scheming-siren'])
    mintInto(state, 0, 'legends', 'jackie-welles-pour-one-out-for-me', { faceUp: true, ready: true })
    setGigs(state, 0, [{ size: 6, value: 6 }])

    let s = playCardByDef(db, state, 0, 'jacked-in-voodoo-boy')
    expect(gigValues(s, 0)).toEqual([4]) // 6 - 2

    s = playCardByDef(db, s, 0, 'evelyn-parker-scheming-siren')
    expect(gigValues(s, 0)).toEqual([4]) // unchanged: this turn's allowance is spent
  })

  it('checks the specific decreased die, not the whole board, for "min Gig" (fix round 1)', () => {
    // "If IT becomes a min Gig" is anaphoric — the SPECIFIC die this effect
    // just decreased, not "you control any Gig at 1" (docs/rulings.md
    // §133). With two Gigs [1, 5], the watcher-picked die to decrease is
    // rng-chosen (§32); the default seed deterministically picks the "5"
    // die here, decreasing it to 3 — which must NOT draw, even though the
    // OTHER, untouched die already sits at 1. (The pre-fix encoding checked
    // `friendlyGigValueEquals: 1` against the whole board and drew
    // incorrectly in exactly this scenario.)
    const { state } = fixtureWithHand(0, ['jacked-in-voodoo-boy'])
    mintInto(state, 0, 'legends', 'jackie-welles-pour-one-out-for-me', { faceUp: true, ready: true })
    setGigs(state, 0, [
      { size: 6, value: 1 },
      { size: 6, value: 5 },
    ])
    const deckBefore = state.players[0].deck.length

    const s = playCardByDef(db, state, 0, 'jacked-in-voodoo-boy')

    expect(gigValues(s, 0)).toEqual([1, 3])
    expect(s.players[0].deck.length).toBe(deckBefore) // no draw
  })

  it('draws when the specific decreased die itself becomes a min Gig', () => {
    // A single-candidate board removes the rng ambiguity: the only die is
    // both the one decreased AND the one checked.
    const { state } = fixtureWithHand(0, ['jacked-in-voodoo-boy'])
    mintInto(state, 0, 'legends', 'jackie-welles-pour-one-out-for-me', { faceUp: true, ready: true })
    setGigs(state, 0, [{ size: 8, value: 3 }])
    const deckBefore = state.players[0].deck.length

    const s = playCardByDef(db, state, 0, 'jacked-in-voodoo-boy')

    expect(gigValues(s, 0)).toEqual([1])
    expect(s.players[0].deck.length).toBe(deckBefore - 1) // drew
  })
})

// ---------------------------------------------------------------------------
// judy-a-lvarez-braindance-maestro — "When you play a BRAINDANCE Program,
// give a friendly Unit +1 power this turn.\n{Spend} Trash the top card of
// your deck. If it's a Program, you may add it to your hand."
// ---------------------------------------------------------------------------

describe('judy-a-lvarez-braindance-maestro', () => {
  it('gives a friendly Unit +1 power this turn when a BRAINDANCE Program is played', () => {
    const { state } = fixtureWithHand(0, ['industrial-assembly', 'animals-wrecker'])
    let s = playCardByDef(db, state, 0, 'animals-wrecker')
    s = endBothTurnsOnce(db, s)
    mintInto(s, 0, 'legends', 'judy-a-lvarez-braindance-maestro', { faceUp: true, ready: true })
    const wrecker = findFielded(s, 0, 'animals-wrecker')

    s = playCardByDef(db, s, 0, 'industrial-assembly')

    expect(effectivePower(db, s, wrecker)).toBe(11) // 10 base + 1
  })

  it('{Spend} trashes the top card, keeping a revealed Program in hand instead', () => {
    const { state } = fixtureWithHand(0, [])
    const judy = mintInto(state, 0, 'legends', 'judy-a-lvarez-braindance-maestro', {
      faceUp: true,
      ready: true,
    })
    const top = mintInto(state, 0, 'deck', 'floor-it')
    state.players[0].deck = [top, ...state.players[0].deck.filter((uid) => uid !== top)]

    const s = activate(db, state, judy, 1, {})

    expect(s.players[0].hand).toContain(top)
    expect(s.players[0].trash).not.toContain(top)
    expect(s.cards[judy].ready).toBe(false)
  })

  it('{Spend} leaves a trashed non-Program in the trash', () => {
    const { state } = fixtureWithHand(0, [])
    const judy = mintInto(state, 0, 'legends', 'judy-a-lvarez-braindance-maestro', {
      faceUp: true,
      ready: true,
    })
    const top = mintInto(state, 0, 'deck', 'animals-wrecker')
    state.players[0].deck = [top, ...state.players[0].deck.filter((uid) => uid !== top)]

    const s = activate(db, state, judy, 1, {})

    expect(s.players[0].trash).toContain(top)
    expect(s.players[0].hand).not.toContain(top)
  })
})

// ---------------------------------------------------------------------------
// judy-a-lvarez-nothing-to-doubt — "1 €$, {Spend} Reveal the top card of your
// deck. You may play it for free. Otherwise, add it to your hand."
// ---------------------------------------------------------------------------

describe('judy-a-lvarez-nothing-to-doubt', () => {
  it('plays a revealed Unit for free from the top of the deck', () => {
    const { state } = fixtureWithHand(0, ['judy-a-lvarez-nothing-to-doubt'])
    let s = playCardByDef(db, state, 0, 'judy-a-lvarez-nothing-to-doubt')
    s = endBothTurnsOnce(db, s)
    const judy = findFielded(s, 0, 'judy-a-lvarez-nothing-to-doubt')
    const top = mintInto(s, 0, 'deck', 'animals-wrecker')
    s.players[0].deck = [top, ...s.players[0].deck.filter((uid) => uid !== top)]

    const next = activate(db, s, judy, 0, {})

    expect(next.players[0].field).toContain(top)
    expect(next.cards[top].ready).toBe(true)
    expect(next.cards[top].lag).toBe(true)
  })

  it('equips a revealed Gear to a friendly host for free', () => {
    const { state } = fixtureWithHand(0, ['judy-a-lvarez-nothing-to-doubt'])
    let s = playCardByDef(db, state, 0, 'judy-a-lvarez-nothing-to-doubt')
    s = endBothTurnsOnce(db, s)
    const judy = findFielded(s, 0, 'judy-a-lvarez-nothing-to-doubt')
    const top = mintInto(s, 0, 'deck', 'dying-night-v-s-pistol')
    s.players[0].deck = [top, ...s.players[0].deck.filter((uid) => uid !== top)]

    const next = activate(db, s, judy, 0, {})

    expect(next.players[0].hand).not.toContain(top)
    expect(next.cards[judy].attachedGear).toContain(top)
  })

  it('adds a revealed Program to hand after it resolves and trashes', () => {
    const { state } = fixtureWithHand(0, ['judy-a-lvarez-nothing-to-doubt'])
    let s = playCardByDef(db, state, 0, 'judy-a-lvarez-nothing-to-doubt')
    s = endBothTurnsOnce(db, s)
    const judy = findFielded(s, 0, 'judy-a-lvarez-nothing-to-doubt')
    const top = mintInto(s, 0, 'deck', 'floor-it')
    s.players[0].deck = [top, ...s.players[0].deck.filter((uid) => uid !== top)]

    const next = activate(db, s, judy, 0, {})

    expect(next.players[0].trash).toContain(top)
    expect(next.players[0].hand).not.toContain(top)
  })
})

// ---------------------------------------------------------------------------
// les-e-le-mens — "Bottom-deck a Rival's lowest-power Unit. (If there are
// multiple, choose 1.)"
// ---------------------------------------------------------------------------

describe('les-e-le-mens', () => {
  it("bottom-decks a Rival's lowest-power Unit, sparing a stronger one", () => {
    const { state } = fixtureWithHand(0, ['les-e-le-mens'])
    const weak = fieldCard(state, 1, 'japantown-jonin') // power 0
    const strong = fieldCard(state, 1, 'animals-wrecker') // power 10

    const s = playCardByDef(db, state, 0, 'les-e-le-mens')

    expect(s.players[1].deck).toContain(weak)
    expect(s.players[1].field).toContain(strong)
    expect(s.players[1].field).not.toContain(weak)
  })
})

// ---------------------------------------------------------------------------
// lizzy-wizzy-delicate-weapon — "{Play} You may play a Program with cost 3 or
// less from your hand or trash for free. Bottom-deck it after you play it.
// {Blocker}"
// ---------------------------------------------------------------------------

describe('lizzy-wizzy-delicate-weapon', () => {
  it('plays a cheap Program from hand for free, then bottom-decks it', () => {
    const { state } = fixtureWithHand(0, ['lizzy-wizzy-delicate-weapon', 'floor-it'])
    const floorIt = findInHand(state, 0, 'floor-it')

    const s = playCardByDef(db, state, 0, 'lizzy-wizzy-delicate-weapon', { targets: [floorIt] })

    expect(s.players[0].hand).not.toContain(floorIt)
    expect(s.players[0].trash).not.toContain(floorIt)
    expect(s.players[0].deck[s.players[0].deck.length - 1]).toBe(floorIt)
    const lizzy = findFielded(s, 0, 'lizzy-wizzy-delicate-weapon')
    expect(hasKeyword(db, s, lizzy, 'blocker')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// maman-brigitte-spirit-of-death — "{Play} You may discard 2 Programs. If
// you do, bottom-deck a rival unequipped Unit."
// ---------------------------------------------------------------------------

describe('maman-brigitte-spirit-of-death', () => {
  it('may discard 2 chosen Programs and bottom-deck a rival unequipped Unit', () => {
    const { state } = fixtureWithHand(0, [
      'maman-brigitte-spirit-of-death',
      'floor-it',
      'industrial-assembly',
    ])
    const floorIt = findInHand(state, 0, 'floor-it')
    const industrialAssembly = findInHand(state, 0, 'industrial-assembly')
    const rival = fieldCard(state, 1, 'animals-wrecker')

    // The "take it" mode (index 0) with both Programs as the real, chosen
    // discard targets (fix round 1, docs/rulings.md §133 — a real decision,
    // not an auto-take).
    const s = playCardByDef(db, state, 0, 'maman-brigitte-spirit-of-death', {
      targets: [0, floorIt, industrialAssembly],
    })

    expect(s.players[0].hand).toEqual([])
    expect(s.players[0].trash).toEqual(expect.arrayContaining([floorIt, industrialAssembly]))
    expect(s.players[1].field).not.toContain(rival)
    expect(s.players[1].deck).toContain(rival)
  })

  it('may decline, leaving hand and rival field untouched', () => {
    const { state } = fixtureWithHand(0, [
      'maman-brigitte-spirit-of-death',
      'floor-it',
      'industrial-assembly',
    ])
    const floorIt = findInHand(state, 0, 'floor-it')
    const industrialAssembly = findInHand(state, 0, 'industrial-assembly')
    const rival = fieldCard(state, 1, 'animals-wrecker')
    const card = findInHand(state, 0, 'maman-brigitte-spirit-of-death')

    // The decline mode (index 1) is offered as a real, separate choice —
    // every mode's slots are reserved regardless of which is picked (§45),
    // so the action still carries mode 0's (unused) sub-targets too.
    const decline = actionsOfType(db, state, 'playCard').find(
      (a) => a.card === card && a.targets[0] === 1
    )
    expect(decline).toBeDefined()
    const s = applyAction(db, state, decline as Extract<Action, { type: 'playCard' }>)

    expect(s.players[0].hand).toEqual(expect.arrayContaining([floorIt, industrialAssembly]))
    expect(s.players[1].field).toContain(rival)
  })

  it('a degenerate duplicate pick (only 1 Program in hand) is a no-op, not a real discard', () => {
    const { state } = fixtureWithHand(0, ['maman-brigitte-spirit-of-death', 'floor-it'])
    const floorIt = findInHand(state, 0, 'floor-it')
    const rival = fieldCard(state, 1, 'animals-wrecker')
    const card = findInHand(state, 0, 'maman-brigitte-spirit-of-death')

    // With only 1 qualifying Program, the "take it" mode's only reachable
    // tuple picks it for BOTH slots — a degenerate same-card duplicate the
    // script treats as no pick at all (docs/rulings.md §133), the same
    // tolerance `matchGig` already extends to a harmless self-pick.
    const takeIt = actionsOfType(db, state, 'playCard').find(
      (a) => a.card === card && a.targets[0] === 0
    )
    expect(takeIt).toBeDefined()
    expect(takeIt?.targets).toEqual([0, floorIt, floorIt])

    const s = applyAction(db, state, takeIt as Extract<Action, { type: 'playCard' }>)
    expect(s.players[0].hand).toContain(floorIt)
    expect(s.players[1].field).toContain(rival)
  })
})

// ---------------------------------------------------------------------------
// misty-olszewski-mender-of-broken-spirits — "This Unit can't attack. At the
// end of your turn, choose a card type. Then, reveal the top card of your
// deck. If it's the chosen type, add it to your hand and ready 1 Eddie.
// Otherwise, trash it."
// ---------------------------------------------------------------------------

describe('misty-olszewski-mender-of-broken-spirits', () => {
  it("can't attack", () => {
    const { state } = fixtureWithHand(0, ['misty-olszewski-mender-of-broken-spirits'])
    const s = playCardByDef(db, state, 0, 'misty-olszewski-mender-of-broken-spirits')
    const misty = findFielded(s, 0, 'misty-olszewski-mender-of-broken-spirits')
    expect(actionsOfType(db, s, 'attack').some((a) => a.attacker === misty)).toBe(false)
  })

  it('reveals the top card at end of turn: kept + Eddie readied, or trashed', () => {
    const { state } = fixtureWithHand(0, ['misty-olszewski-mender-of-broken-spirits'])
    let s = playCardByDef(db, state, 0, 'misty-olszewski-mender-of-broken-spirits')
    const top = mintInto(s, 0, 'deck', 'animals-wrecker')
    s.players[0].deck = [top, ...s.players[0].deck.filter((uid) => uid !== top)]
    const spentEddie = s.players[0].eddies[0]
    s.cards[spentEddie].ready = false

    const next = endOneTurn(db, s)

    const keptInHand = next.players[0].hand.includes(top)
    const trashed = next.players[0].trash.includes(top)
    // Exactly one of the two happened — the reveal always resolves one way.
    expect(keptInHand).toBe(!trashed)
    // An Eddie was readied exactly when the card was kept.
    expect(next.cards[spentEddie].ready).toBe(keptInHand)
  })
})
