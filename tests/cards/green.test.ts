// Task 8 — Green cards, batch 5: the first 17 Green cards assigned to this
// batch.
//
// Every test here drives a REAL card definition from `data/cards.json`
// through the public engine API (`newGame` / `legalActions` / `applyAction`),
// using the shared fixtures in ./fixtures.ts, exactly like
// tests/cards/red.test.ts and tests/cards/yellow.test.ts.
//
// Cards covered, in card-id order:
//   corpo-security, corporate-surveillance, don-t-fear-the-reaper,
//   emergency-atlus, field-operator, fool-on-the-hill,
//   goro-takemura-hands-unclean, goro-takemura-losing-his-way,
//   goro-takemura-vengeful-bodyguard, hanako-arasaka-daughter-of-the-emperor,
//   maelstrom-zealots, maxtac-av, maxtac-squadron,
//   nadia-fighting-through-grief, overwatch-panam-s-gift, pacifica-netrunner.
// Deferred (see the batch report): jackie-welles-mama-s-favorite.

import { describe, expect, it } from 'vitest'
import { legalActions } from '../../src/engine/legal'
import { effectiveKeywords, effectivePower } from '../../src/engine/query'
import { applyAction } from '../../src/engine/reduce'
import type { CardDb, GameState } from '../../src/engine/types'
import {
  activate,
  actionsOfType,
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

/** [surgery] Flips every one of `player`'s legends face-up. */
function faceUpAllLegends(state: GameState, player: 0 | 1): void {
  for (const uid of state.players[player].legends) state.cards[uid].faceUp = true
}

/** Ends the active player's turn, auto-resolving a `chooseGigDie` if offered. */
function endOneTurn(db: CardDb, state: GameState): GameState {
  let next = applyAction(db, state, { type: 'endTurn' })
  if (next.phase === 'start') {
    const die = legalActions(db, next).find((action) => action.type === 'chooseGigDie')
    if (die) next = applyAction(db, next, die)
  }
  return next
}

// ---------------------------------------------------------------------------
// corpo-security — "This Unit can't attack. {Blocker} (reminder)."
// ---------------------------------------------------------------------------

describe('corpo-security', () => {
  it("can't attack, but can still use {Blocker}", () => {
    const { state } = fixtureWithHand(0, ['corpo-security'])
    let s = playCardByDef(db, state, 0, 'corpo-security')
    const guard = findFielded(s, 0, 'corpo-security')

    // The static cantAttack node vetoes the attack outright — no `attack`
    // action for this Unit at all, whatever its Lag/readiness.
    expect(actionsOfType(db, s, 'attack').some((action) => action.attacker === guard)).toBe(false)

    s = endOneTurn(db, s)
    const attacker = fieldCard(s, 1, 'japantown-jonin', { ready: true })
    s = startAttack(db, s, attacker, 'gigArea')
    const reacts = actionsOfType(db, s, 'react')
    expect(
      reacts.some(
        (reaction) => reaction.reaction.type === 'block' && reaction.reaction.blocker === guard
      )
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// corporate-surveillance — "Spend a rival Unit with cost 4 or less."
// ---------------------------------------------------------------------------

describe('corporate-surveillance', () => {
  it('spends a rival Unit with cost 4 or less when played', () => {
    const { state } = fixtureWithHand(0, ['corporate-surveillance'])
    const target = fieldCard(state, 1, 'japantown-jonin', { ready: true }) // cost 2
    const next = playCardByDef(db, state, 0, 'corporate-surveillance', { targets: [target] })
    expect(next.cards[target].ready).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// don-t-fear-the-reaper — "Spend all rival Units. Then, defeat a spent Unit."
// ---------------------------------------------------------------------------

describe('don-t-fear-the-reaper', () => {
  it('spends every rival Unit, then defeats the sole spent Unit', () => {
    const { state } = fixtureWithHand(0, ["don-t-fear-the-reaper"])
    const rivalUnit = fieldCard(state, 1, 'japantown-jonin', { ready: true })
    const next = playCardByDef(db, state, 0, "don-t-fear-the-reaper")
    expect(next.players[1].field).toEqual([])
    expect(next.players[1].trash).toContain(rivalUnit)
  })
})

// ---------------------------------------------------------------------------
// emergency-atlus — printed line is flavour text (a quote), like
// mantis-blades (docs/rulings.md §7) — vanilla, effects stays [].
// ---------------------------------------------------------------------------

describe('emergency-atlus', () => {
  it('is a vanilla Vehicle Unit (its printed line is flavour text)', () => {
    expect(db['emergency-atlus'].effects).toEqual([])
    const { state } = fixtureWithHand(0, ['emergency-atlus'])
    const next = playCardByDef(db, state, 0, 'emergency-atlus')
    const uid = findFielded(next, 0, 'emergency-atlus')
    expect(effectivePower(db, next, uid)).toBe(4)
    expect(db['emergency-atlus'].keywords).toEqual(['vehicle', 'zetatech'])
  })
})

// ---------------------------------------------------------------------------
// field-operator — "{Play} If your ☆ (Street Cred) is an even number, draw 1."
// ---------------------------------------------------------------------------

describe('field-operator', () => {
  it('draws 1 when Street Cred is even', () => {
    const base = fixtureWithHand(0, ['field-operator']).state
    const state = forceStreetCred(base, 0, 4)
    const before = state.players[0].hand.length
    const next = playCardByDef(db, state, 0, 'field-operator')
    expect(next.players[0].hand.length).toBe(before - 1 + 1) // played then drew 1
  })

  it('does not draw when Street Cred is odd', () => {
    const base = fixtureWithHand(0, ['field-operator']).state
    const state = forceStreetCred(base, 0, 3)
    const before = state.players[0].hand.length
    const next = playCardByDef(db, state, 0, 'field-operator')
    expect(next.players[0].hand.length).toBe(before - 1)
  })
})

// ---------------------------------------------------------------------------
// fool-on-the-hill — "Reveal the top 2 cards of your deck. A Rival chooses
// whether you add them to your hand or trash them. If you trash them, draw 2."
// ---------------------------------------------------------------------------

describe('fool-on-the-hill', () => {
  it('reveals the top 2 cards and resolves to hand, or to trash-plus-draw-2', () => {
    const { state } = fixtureWithHand(0, ['fool-on-the-hill'], { seed: 3 })
    const deckBefore = state.players[0].deck.length
    const revealed = state.players[0].deck.slice(0, 2)
    const next = playCardByDef(db, state, 0, 'fool-on-the-hill')

    const trashed = revealed.filter((uid) => next.players[0].trash.includes(uid))
    const handed = revealed.filter((uid) => next.players[0].hand.includes(uid))
    expect(trashed.length + handed.length).toBe(revealed.length)
    if (trashed.length === revealed.length) {
      // The trash branch also draws 2 mandatory cards.
      expect(next.players[0].deck.length).toBe(deckBefore - revealed.length - 2)
    } else {
      expect(handed.length).toBe(revealed.length)
      expect(next.players[0].deck.length).toBe(deckBefore - revealed.length)
    }
  })
})

// ---------------------------------------------------------------------------
// goro-takemura-hands-unclean — {Go Solo} + {Blocker} reminders only.
// ---------------------------------------------------------------------------

describe('goro-takemura-hands-unclean', () => {
  // Player 0's own Arasaka starter deck already includes this Legend
  // face-down (data/decks/arasaka-embracing-power.json) — flip that existing
  // instance rather than minting a second, disambiguating copy.
  function flipExisting(state: GameState): number {
    const existing = state.players[0].legends.find(
      (uid) => state.cards[uid].defId === 'goro-takemura-hands-unclean'
    )
    if (existing === undefined) throw new Error('fixture deck missing goro-takemura-hands-unclean')
    state.cards[existing].faceUp = true
    state.cards[existing].ready = true
    return existing
  }

  it('is a vanilla Go Solo Blocker Legend that can attack the turn it is played', () => {
    expect(db['goro-takemura-hands-unclean'].effects).toEqual([])
    const { state } = fixtureWithHand(0, [])
    flipExisting(state)
    setGigs(state, 1, [{ size: 6, value: 4 }]) // a legal 'gigArea' target to attack
    const next = playCardByDef(db, state, 0, 'goro-takemura-hands-unclean')
    const uid = findFielded(next, 0, 'goro-takemura-hands-unclean')
    expect(next.cards[uid].ready).toBe(true)
    expect(next.cards[uid].lag).toBe(false)
    expect(effectiveKeywords(db, next, uid)).toEqual(
      expect.arrayContaining(['go-solo', 'blocker', 'corpo'])
    )
    const attacks = actionsOfType(db, next, 'attack').filter((action) => action.attacker === uid)
    expect(attacks.length).toBeGreaterThan(0)
  })

  // Fix round 2 (docs/rulings.md §106): a {Go Solo} Legend enters the field
  // with `lag: false`, so it has no Lag for {adrenaline}'s denial check to
  // gate — without `playedThisTurn`, a rival's `maxtac-suppression-team`
  // ("Rival Units can't attack the turn they're played") would silently do
  // nothing against it.
  it("cannot attack the turn it's played (but can the turn after) when the rival has maxtac-suppression-team", () => {
    const { state } = fixtureWithHand(0, [])
    flipExisting(state)
    fieldCard(state, 1, 'maxtac-suppression-team', { ready: true })
    setGigs(state, 1, [{ size: 6, value: 4 }]) // a legal 'gigArea' target to attack

    let s = playCardByDef(db, state, 0, 'goro-takemura-hands-unclean')
    const uid = findFielded(s, 0, 'goro-takemura-hands-unclean')
    expect(s.cards[uid].playedThisTurn).toBe(true)
    expect(actionsOfType(db, s, 'attack').filter((action) => action.attacker === uid)).toEqual([])

    s = endBothTurnsOnce(db, s)
    expect(s.cards[uid].playedThisTurn).toBe(false)
    expect(
      actionsOfType(db, s, 'attack').filter((action) => action.attacker === uid).length
    ).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// goro-takemura-losing-his-way — "{Attack} If all friendly Legends are
// face-up, this Unit has +5 power this turn."
// ---------------------------------------------------------------------------

describe('goro-takemura-losing-his-way', () => {
  it('gains +5 power on attack once all friendly Legends are face-up', () => {
    const { state } = fixtureWithHand(0, ['goro-takemura-losing-his-way'])
    let s = playCardByDef(db, state, 0, 'goro-takemura-losing-his-way')
    s = endBothTurnsOnce(db, s)
    const unit = findFielded(s, 0, 'goro-takemura-losing-his-way')
    faceUpAllLegends(s, 0)
    const rivalUnit = fieldCard(s, 1, 'japantown-jonin', { ready: false })
    expect(effectivePower(db, s, unit)).toBe(4)
    s = startAttack(db, s, unit, rivalUnit)
    expect(effectivePower(db, s, unit)).toBe(9)
  })

  it('does not gain the bonus while a friendly Legend is still face-down', () => {
    const { state } = fixtureWithHand(0, ['goro-takemura-losing-his-way'])
    let s = playCardByDef(db, state, 0, 'goro-takemura-losing-his-way')
    s = endBothTurnsOnce(db, s)
    const unit = findFielded(s, 0, 'goro-takemura-losing-his-way')
    const rivalUnit = fieldCard(s, 1, 'japantown-jonin', { ready: false })
    s = startAttack(db, s, unit, rivalUnit)
    expect(effectivePower(db, s, unit)).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// goro-takemura-vengeful-bodyguard — an activated {Blocker}(+power) grant and
// an onFriendlyBlock discard-then-draw watcher.
// ---------------------------------------------------------------------------

describe('goro-takemura-vengeful-bodyguard', () => {
  it('grants {Blocker}, plus +1 power while controlling a Gig value-pair, to a chosen Unit', () => {
    const { state } = fixtureWithHand(0, [])
    const legend = mintInto(state, 0, 'legends', 'goro-takemura-vengeful-bodyguard', {
      faceUp: true,
      ready: true,
    })
    const unit = fieldCard(state, 0, 'japantown-jonin') // cost 2, within "cost 4 or less"
    setGigs(state, 0, [
      { size: 6, value: 3 },
      { size: 8, value: 3 },
    ])
    const s = activate(db, state, legend, 0, { targets: [unit] })
    expect(s.cards[unit].tempKeywords).toContain('blocker')
    expect(s.cards[unit].tempPower).toBe(1)
  })

  it('grants only {Blocker} without a Gig value-pair', () => {
    const { state } = fixtureWithHand(0, [])
    const legend = mintInto(state, 0, 'legends', 'goro-takemura-vengeful-bodyguard', {
      faceUp: true,
      ready: true,
    })
    const unit = fieldCard(state, 0, 'japantown-jonin')
    setGigs(state, 0, [
      { size: 6, value: 3 },
      { size: 8, value: 5 },
    ])
    const s = activate(db, state, legend, 0, { targets: [unit] })
    expect(s.cards[unit].tempKeywords).toContain('blocker')
    expect(s.cards[unit].tempPower).toBe(0)
  })

  it('may discard a card and draw when a friendly Unit uses {Blocker}', () => {
    const { state } = fixtureWithHand(0, ['corpo-security'])
    const fodder = findInHand(state, 0, 'corpo-security')
    mintInto(state, 0, 'legends', 'goro-takemura-vengeful-bodyguard', {
      faceUp: true,
      ready: true,
    })
    // The blocking Unit must belong to whoever is DEFENDING an attack, so
    // this needs to be the rival's turn.
    let s = endOneTurn(db, state)
    const blocker = fieldCard(s, 0, 'corpo-security', { ready: true }) // real {Blocker} keyword
    const attacker = fieldCard(s, 1, 'maxtac-av', { ready: true })

    s = startAttack(db, s, attacker, 'gigArea')
    const deckBefore = s.players[0].deck.length
    s = applyAction(db, s, { type: 'react', reaction: { type: 'block', blocker } })

    expect(s.players[0].trash).toContain(fodder)
    expect(s.players[0].hand).not.toContain(fodder)
    expect(s.players[0].deck.length).toBe(deckBefore - 1)
  })
})

// ---------------------------------------------------------------------------
// hanako-arasaka-daughter-of-the-emperor — {Spend} swap a Gig, plus a
// start-of-turn draw per friendly value-pair.
// ---------------------------------------------------------------------------

describe('hanako-arasaka-daughter-of-the-emperor', () => {
  it('may swap a friendly Gig with a rival Gig via its {Spend} ability', () => {
    const { state } = fixtureWithHand(0, [])
    const legend = mintInto(state, 0, 'legends', 'hanako-arasaka-daughter-of-the-emperor', {
      faceUp: true,
      ready: true,
    })
    setGigs(state, 0, [{ size: 6, value: 2 }])
    setGigs(state, 1, [{ size: 10, value: 9 }])
    const s = activate(db, state, legend, 0, { targets: [0, 0] })
    expect(gigValues(s, 0)).toEqual([9])
    expect(gigValues(s, 1)).toEqual([2])
  })

  it('draws 1 for each friendly value-pair of Gigs at the start of your turn', () => {
    const { state } = fixtureWithHand(0, [])
    mintInto(state, 0, 'legends', 'hanako-arasaka-daughter-of-the-emperor', {
      faceUp: true,
      ready: true,
    })
    setGigs(state, 0, [
      { size: 6, value: 3 },
      { size: 8, value: 3 },
      { size: 10, value: 7 },
      { size: 12, value: 7 },
    ])
    const before = state.players[0].hand.length
    const next = endBothTurnsOnce(db, state)
    // +1 from the automatic start-of-turn draw, +2 from the two value-pairs.
    expect(next.players[0].hand.length).toBe(before + 3)
  })
})

// ---------------------------------------------------------------------------
// maelstrom-zealots — "When this Unit loses a fight, defeat the opposing
// rival Unit."
// ---------------------------------------------------------------------------

describe('maelstrom-zealots', () => {
  it('takes its fight foe down with it when it loses a fight', () => {
    const { state } = fixtureWithHand(0, [])
    const zealot = fieldCard(state, 0, 'maelstrom-zealots', { ready: true }) // power 0
    const foe = fieldCard(state, 1, 'maxtac-av', { ready: false }) // power 8, spent
    let s = startAttack(db, state, zealot, foe)
    s = passReact(db, s)
    expect(s.players[0].field).not.toContain(zealot)
    expect(s.players[1].field).not.toContain(foe)
  })
})

// ---------------------------------------------------------------------------
// maxtac-av — "{Play} You may swap a friendly Gig with a rival Gig."
// ---------------------------------------------------------------------------

describe('maxtac-av', () => {
  it('swaps a friendly Gig with a rival Gig when played', () => {
    const { state } = fixtureWithHand(0, ['maxtac-av'])
    setGigs(state, 0, [{ size: 6, value: 2 }])
    setGigs(state, 1, [{ size: 10, value: 9 }])
    const next = playCardByDef(db, state, 0, 'maxtac-av')
    expect(gigValues(next, 0)).toEqual([9])
    expect(gigValues(next, 1)).toEqual([2])
  })
})

// ---------------------------------------------------------------------------
// maxtac-squadron — "At the end of your turn, if this Unit is spent, ready a
// friendly face-up Legend."
// ---------------------------------------------------------------------------

describe('maxtac-squadron', () => {
  it('readies a friendly face-up Legend at end of turn while spent', () => {
    const { state } = fixtureWithHand(0, [])
    fieldCard(state, 0, 'maxtac-squadron', { ready: false })
    const legend = mintInto(state, 0, 'legends', 'jackie-welles-mama-s-favorite', {
      faceUp: true,
      ready: false,
    })
    const next = applyAction(db, state, { type: 'endTurn' })
    expect(next.cards[legend].ready).toBe(true)
  })

  it('does not ready the Legend while it is itself ready', () => {
    const { state } = fixtureWithHand(0, [])
    fieldCard(state, 0, 'maxtac-squadron', { ready: true })
    const legend = mintInto(state, 0, 'legends', 'jackie-welles-mama-s-favorite', {
      faceUp: true,
      ready: false,
    })
    const next = applyAction(db, state, { type: 'endTurn' })
    expect(next.cards[legend].ready).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// nadia-fighting-through-grief — "If a Rival controls more Gigs than you,
// this Unit can attack their Gig area the turn it's played."
// ---------------------------------------------------------------------------

describe('nadia-fighting-through-grief', () => {
  it('can attack the rival Gig area (but not a rival Unit) despite Lag when behind on Gigs', () => {
    const { state } = fixtureWithHand(0, ['nadia-fighting-through-grief'])
    setGigs(state, 0, []) // the automatic opening gig gain would otherwise tie the count
    setGigs(state, 1, [{ size: 6, value: 4 }])
    fieldCard(state, 1, 'japantown-jonin', { ready: false }) // otherwise-attackable spent Unit
    const s = playCardByDef(db, state, 0, 'nadia-fighting-through-grief')
    const nadia = findFielded(s, 0, 'nadia-fighting-through-grief')
    expect(s.cards[nadia].lag).toBe(true)
    const attacks = actionsOfType(db, s, 'attack').filter((action) => action.attacker === nadia)
    expect(attacks.map((action) => action.target)).toEqual(['gigArea'])
  })

  it('cannot attack at all despite Lag when not behind on Gigs', () => {
    const { state } = fixtureWithHand(0, ['nadia-fighting-through-grief'])
    setGigs(state, 0, [{ size: 6, value: 4 }])
    const s = playCardByDef(db, state, 0, 'nadia-fighting-through-grief')
    const nadia = findFielded(s, 0, 'nadia-fighting-through-grief')
    const attacks = actionsOfType(db, s, 'attack').filter((action) => action.attacker === nadia)
    expect(attacks).toEqual([])
  })

  // Fix round 1 (batch-5 review): `attackGigAreaDespiteLag` is a Lag
  // EXCEPTION for a fresh attack, exactly like {adrenaline}, so it must
  // respect the same rival denial (`maxtac-suppression-team`'s "Rival Units
  // can't attack the turn they're played") that `canAttack` already
  // consults for {adrenaline} (docs/rulings.md §81 ff. / fix round 1).
  it("cannot attack the rival Gig area despite Lag when the rival has maxtac-suppression-team in play", () => {
    const { state } = fixtureWithHand(0, ['nadia-fighting-through-grief'])
    setGigs(state, 0, []) // the automatic opening gig gain would otherwise tie the count
    setGigs(state, 1, [{ size: 6, value: 4 }]) // still behind on Gigs
    fieldCard(state, 1, 'maxtac-suppression-team', { ready: true })
    const s = playCardByDef(db, state, 0, 'nadia-fighting-through-grief')
    const nadia = findFielded(s, 0, 'nadia-fighting-through-grief')
    expect(s.cards[nadia].lag).toBe(true)
    const attacks = actionsOfType(db, s, 'attack').filter((action) => action.attacker === nadia)
    expect(attacks).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// overwatch-panam-s-gift — "{Quick} 1 €$, {Spend} Discard 1. Defeat a spent
// rival Unit with cost equal to or less than the discarded card's cost."
// ---------------------------------------------------------------------------

describe('overwatch-panam-s-gift', () => {
  it("discards a chosen card and defeats a spent rival Unit within its cost", () => {
    const { state } = fixtureWithHand(0, ['overwatch-panam-s-gift', 'corpo-security'])
    const host = fieldCard(state, 0, 'japantown-jonin', { ready: true })
    let s = playCardByDef(db, state, 0, 'overwatch-panam-s-gift', { targetDef: 'japantown-jonin' })
    const gear = s.cards[host].attachedGear[0]
    const fodder = findInHand(s, 0, 'corpo-security') // cost 2
    const rivalUnit = fieldCard(s, 1, 'corpo-security', { ready: false }) // cost 2, spent

    s = activate(db, s, gear, 0, { targets: [fodder] })

    expect(s.players[0].trash).toContain(fodder)
    expect(s.players[1].trash).toContain(rivalUnit)
    expect(s.players[1].field).not.toContain(rivalUnit)
  })
})

// ---------------------------------------------------------------------------
// pacifica-netrunner — "{Play} If your ☆ (Street Cred) is an even number, a
// rival Unit can't ready until your next turn."
// ---------------------------------------------------------------------------

describe('pacifica-netrunner', () => {
  it("stops a rival Unit's very next ready step when Street Cred is even", () => {
    const base = fixtureWithHand(0, ['pacifica-netrunner']).state
    const state = forceStreetCred(base, 0, 4)
    const rivalUnit = fieldCard(state, 1, 'japantown-jonin', { ready: false })
    let s = playCardByDef(db, state, 0, 'pacifica-netrunner', { targets: [rivalUnit] })
    expect(s.cards[rivalUnit].skipNextReady).toBe(true)

    s = endOneTurn(db, s) // the rival's own turn begins; their ready step runs
    expect(s.cards[rivalUnit].ready).toBe(false)
    expect(s.cards[rivalUnit].skipNextReady).toBe(false) // consumed, not reusable
  })

  it('has no effect when Street Cred is odd', () => {
    const base = fixtureWithHand(0, ['pacifica-netrunner']).state
    const state = forceStreetCred(base, 0, 3)
    const rivalUnit = fieldCard(state, 1, 'japantown-jonin', { ready: false })
    const s = playCardByDef(db, state, 0, 'pacifica-netrunner', { targets: [rivalUnit] })
    expect(s.cards[rivalUnit].skipNextReady).toBeFalsy()
  })
})

// ---------------------------------------------------------------------------
// Deferred cards (see the batch-5 report)
// ---------------------------------------------------------------------------

describe('deferred cards (see the batch-5 report)', () => {
  it('jackie-welles-mama-s-favorite still carries no effects', () => {
    // "{Go Solo} ... If a friendly Unit would be defeated, you may spend
    // 1 €$ to defeat this Legend instead." This is the same shape as the
    // deferred half of alt-cunningham-mother-of-daemons (docs/rulings.md
    // §72): "when X would happen, you may [optional costed action] to
    // prevent it" needs a true interception decision point before the
    // mutation (here, a defeat) actually happens — a genuine engine
    // feature this engine does not have yet, not a vocabulary gap. Unlike
    // Alt Cunningham, this card has no OTHER independent clause to encode,
    // so the whole card is deferred (docs/rulings.md §79/§80's "full or
    // defer" policy) — only its {Go Solo} keyword (already handled by the
    // existing keyword machinery) is live.
    expect(db['jackie-welles-mama-s-favorite'].effects).toEqual([])
  })
})
