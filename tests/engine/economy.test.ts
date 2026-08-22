import { describe, expect, it } from 'vitest'
import { canPayWith, canonicalPayment, pay } from '../../src/engine/economy'
import { draftState, newGame } from '../../src/engine/game'
import { legalActions } from '../../src/engine/legal'
import { applyAction, IllegalActionError } from '../../src/engine/reduce'
import { nextInt } from '../../src/engine/rng'
import type { Action, GameState, PlayerId } from '../../src/engine/types'
import { db, decks } from './gameHelpers'

// ---------------------------------------------------------------------------
// Scenario helpers (local to this file: they inject specific cards into a
// player's hand/eddies by relocating real instances the deck already built,
// rather than depending on whatever a given seed happens to draw).
// ---------------------------------------------------------------------------

/** newGame -> player 0 always goes first -> both players keep their hand -> player 0 chooses a d4 gig -> main phase, turn 1, player 0 active. */
function mainPhaseP0(seed: number): GameState {
  let state = newGame(db, { decks, seed })
  const rollWinner = state.activePlayer
  state = applyAction(db, state, { type: 'choosePlayOrder', goFirst: rollWinner === 0 })
  state = applyAction(db, state, { type: 'keepHand' })
  state = applyAction(db, state, { type: 'keepHand' })
  state = applyAction(db, state, { type: 'chooseGigDie', size: 4 })
  return state
}

function findUid(state: GameState, player: PlayerId, defId: string, exclude: Set<number>): number {
  const p = state.players[player]
  for (const uid of [...p.deck, ...p.hand, ...p.trash]) {
    if (exclude.has(uid)) continue
    if (state.cards[uid].defId === defId) return uid
  }
  throw new Error(`No unused "${defId}" instance available for player ${player}.`)
}

/** Replaces `player`'s hand with fresh instances of `defIds`, pulled from their deck/trash. */
function setHand(state: GameState, player: PlayerId, defIds: string[]): GameState {
  const next = structuredClone(state)
  const p = next.players[player]
  const oldHand = p.hand
  const used = new Set<number>(oldHand)
  const uids = defIds.map((id) => {
    const uid = findUid(next, player, id, used)
    used.add(uid)
    return uid
  })
  p.deck = p.deck.filter((uid) => !uids.includes(uid))
  p.trash = p.trash.filter((uid) => !uids.includes(uid))
  p.deck = [...p.deck, ...oldHand]
  p.hand = uids
  return next
}

/** Gives `player` `count` fresh ready, face-down eddies pulled from their deck. */
function giveEddies(state: GameState, player: PlayerId, count: number): GameState {
  const next = structuredClone(state)
  const p = next.players[player]
  const uids = p.deck.slice(0, count)
  p.deck = p.deck.slice(count)
  for (const uid of uids) {
    next.cards[uid].ready = true
    next.cards[uid].faceUp = false
  }
  p.eddies = [...p.eddies, ...uids]
  return next
}

/** Puts a friendly field Unit under player 0's control, pulled from their deck. */
function giveFieldUnit(state: GameState, player: PlayerId): { state: GameState; uid: number } {
  const next = structuredClone(state)
  const p = next.players[player]
  const uid = p.deck.find((u) => db[next.cards[u].defId].type === 'unit')
  if (uid === undefined) throw new Error('expected a unit left in the deck')
  p.deck = p.deck.filter((u) => u !== uid)
  p.field.push(uid)
  return { state: next, uid }
}

function findPlayCard(state: GameState, cardUid: number): Extract<Action, { type: 'playCard' }> | undefined {
  return legalActions(db, state).find(
    (a): a is Extract<Action, { type: 'playCard' }> => a.type === 'playCard' && a.card === cardUid
  )
}

// Arasaka (player 0's deck, per gameHelpers' `decks` ordering) vanilla cards
// with no effects, used throughout:
//   corpo-security      unit,    cost 2, sellTag: false
//   mantis-blades       gear,    cost 1, sellTag: true
//   industrial-assembly program, cost 1, sellTag: true

describe('sellCard', () => {
  it('adds a ready face-down eddie and blocks a second sell that turn', () => {
    const state = setHand(mainPhaseP0(101), 0, ['mantis-blades', 'industrial-assembly'])
    const [uid1, uid2] = state.players[0].hand

    expect(legalActions(db, state)).toContainEqual({ type: 'sellCard', card: uid1 })

    const sold = applyAction(db, state, { type: 'sellCard', card: uid1 })
    expect(sold.players[0].hand).not.toContain(uid1)
    expect(sold.players[0].eddies).toContain(uid1)
    expect(sold.cards[uid1].faceUp).toBe(false)
    expect(sold.cards[uid1].ready).toBe(true)
    expect(sold.players[0].soldThisTurn).toBe(true)
    expect(sold.events.some((e) => e.type === 'cardSold' && e.uid === uid1)).toBe(true)

    expect(legalActions(db, sold).some((a) => a.type === 'sellCard')).toBe(false)
    expect(() => applyAction(db, sold, { type: 'sellCard', card: uid2 })).toThrow(IllegalActionError)
  })

  it("a card without a sell tag can't be sold", () => {
    const state = setHand(mainPhaseP0(103), 0, ['corpo-security'])
    const [uid] = state.players[0].hand
    expect(legalActions(db, state).some((a) => a.type === 'sellCard' && a.card === uid)).toBe(false)
    expect(() => applyAction(db, state, { type: 'sellCard', card: uid })).toThrow(IllegalActionError)
  })

  it('a sold eddie can immediately pay a cost the same turn', () => {
    let state = setHand(mainPhaseP0(105), 0, ['mantis-blades', 'industrial-assembly'])
    const [sellUid, programUid] = state.players[0].hand
    state = applyAction(db, state, { type: 'sellCard', card: sellUid })
    // 1 fresh eddie is enough to afford the cost-1 program.
    const playAction = findPlayCard(state, programUid)
    expect(playAction).toBeDefined()
    expect(playAction!.payment).toEqual([sellUid])
  })
})

describe('playCard: units', () => {
  it('playing a 2-cost unit spends 2 eddies, removes it from hand, and it enters the field ready with lag', () => {
    let state = setHand(mainPhaseP0(107), 0, ['corpo-security'])
    state = giveEddies(state, 0, 2)
    const [uid] = state.players[0].hand
    const [e1, e2] = state.players[0].eddies

    const playAction = findPlayCard(state, uid)
    expect(playAction).toBeDefined()
    expect(playAction!.payment.sort()).toEqual([e1, e2].sort())

    const next = applyAction(db, state, playAction!)
    expect(next.players[0].hand).not.toContain(uid)
    expect(next.players[0].field).toContain(uid)
    expect(next.cards[uid].ready).toBe(true)
    expect(next.cards[uid].lag).toBe(true)
    expect(next.cards[e1].ready).toBe(false)
    expect(next.cards[e2].ready).toBe(false)
    expect(next.events.some((e) => e.type === 'cardPlayed' && e.uid === uid)).toBe(true)
  })

  it('a unit without enough payment is not in legalActions and is rejected by applyAction', () => {
    // At turn 1, player 0 has 0 eddies and only 1 ready legend (2 are spent
    // by the going-first penalty) -> cost 2 is unaffordable.
    const state = setHand(mainPhaseP0(107), 0, ['corpo-security'])
    const [uid] = state.players[0].hand

    expect(state.players[0].eddies).toHaveLength(0)
    expect(legalActions(db, state).some((a) => a.type === 'playCard' && a.card === uid)).toBe(false)
    expect(() =>
      applyAction(db, state, { type: 'playCard', card: uid, payment: [], targets: [] })
    ).toThrow(IllegalActionError)
  })

  it('lag clears at the owner\'s next turn start, not the same turn', () => {
    let state = setHand(mainPhaseP0(107), 0, ['corpo-security'])
    state = giveEddies(state, 0, 2)
    const [uid] = state.players[0].hand
    const playAction = findPlayCard(state, uid)!
    state = applyAction(db, state, playAction)
    expect(state.cards[uid].lag).toBe(true)

    // End player 0's turn 1 -> player 1's turn 1 begins.
    state = applyAction(db, state, { type: 'endTurn' })
    expect(state.activePlayer).toBe(1)
    expect(state.cards[uid].lag).toBe(true) // still lagged through the rival's turn

    // Drive player 1's entire turn 1 (gig die, then end turn) to reach player 0's turn 2 start.
    const gigChoice = legalActions(db, state).find((a) => a.type === 'chooseGigDie')
    if (gigChoice) state = applyAction(db, state, gigChoice)
    state = applyAction(db, state, { type: 'endTurn' })

    expect(state.activePlayer).toBe(0)
    expect(state.turnNumber).toBe(2)
    expect(state.cards[uid].lag).toBe(false)
  })
})

describe('playCard: programs', () => {
  it('a program resolves (nothing to resolve yet) and goes straight to the trash', () => {
    const state = setHand(mainPhaseP0(109), 0, ['industrial-assembly'])
    const [uid] = state.players[0].hand
    const playAction = findPlayCard(state, uid)!

    const next = applyAction(db, state, playAction)
    expect(next.players[0].hand).not.toContain(uid)
    expect(next.players[0].trash).toContain(uid)
    expect(next.players[0].field).not.toContain(uid)
    expect(next.events.some((e) => e.type === 'cardPlayed' && e.uid === uid)).toBe(true)
    expect(next.events.some((e) => e.type === 'cardTrashed' && e.uid === uid)).toBe(true)
  })
})

describe('playCard: gear', () => {
  it('is not playable with no valid target, then attaches to the chosen target once one exists', () => {
    const state = setHand(mainPhaseP0(111), 0, ['mantis-blades'])
    const [uid] = state.players[0].hand

    // Fresh game: no field units, no face-up legends -> no legal target.
    expect(legalActions(db, state).some((a) => a.type === 'playCard' && a.card === uid)).toBe(false)
    expect(() =>
      applyAction(db, state, { type: 'playCard', card: uid, payment: [], targets: [999] })
    ).toThrow(IllegalActionError)

    const { state: withUnit, uid: unitUid } = giveFieldUnit(state, 0)
    const playAction = findPlayCard(withUnit, uid)
    expect(playAction).toBeDefined()
    expect(playAction!.targets).toEqual([unitUid])

    const next = applyAction(db, withUnit, playAction!)
    expect(next.players[0].hand).not.toContain(uid)
    expect(next.cards[unitUid].attachedGear).toEqual([uid])
    expect(next.players[0].field).toContain(unitUid) // the target itself is untouched
  })

  it('offers one legalActions entry per legal target (field unit and face-up legend)', () => {
    const base = setHand(mainPhaseP0(113), 0, ['mantis-blades'])
    const { state: withUnit, uid: unitUid } = giveFieldUnit(base, 0)
    const flippedLegend = withUnit.players[0].legends[2]
    const withFaceUpLegend = structuredClone(withUnit)
    withFaceUpLegend.cards[flippedLegend].faceUp = true

    const [gearUid] = withFaceUpLegend.players[0].hand
    const gearActions = legalActions(db, withFaceUpLegend).filter(
      (a): a is Extract<Action, { type: 'playCard' }> => a.type === 'playCard' && a.card === gearUid
    )
    const targets = gearActions.map((a) => a.targets[0]).sort((a, b) => a - b)
    expect(targets).toEqual([unitUid, flippedLegend].sort((a, b) => a - b))
  })

  it('does not offer a face-down legend as a gear target', () => {
    const base = setHand(mainPhaseP0(115), 0, ['mantis-blades'])
    const { state: withUnit } = giveFieldUnit(base, 0)
    const [gearUid] = withUnit.players[0].hand
    const faceDownLegends = withUnit.players[0].legends.filter((u) => !withUnit.cards[u].faceUp)
    const gearTargets = legalActions(db, withUnit)
      .filter((a): a is Extract<Action, { type: 'playCard' }> => a.type === 'playCard' && a.card === gearUid)
      .map((a) => a.targets[0])
    for (const legendUid of faceDownLegends) {
      expect(gearTargets).not.toContain(legendUid)
    }
  })
})

describe('playCard: payment flexibility', () => {
  it('applyAction accepts a legend as payment even when a ready eddie is the canonical choice', () => {
    let state = setHand(mainPhaseP0(117), 0, ['industrial-assembly'])
    state = giveEddies(state, 0, 1)
    const [uid] = state.players[0].hand
    const [eddieUid] = state.players[0].eddies
    const readyLegend = state.players[0].legends.find((u) => state.cards[u].ready)
    if (readyLegend === undefined) throw new Error('expected a ready legend on turn 1')

    expect(canonicalPayment(state, 0, 1)).toEqual([eddieUid]) // eddies come first, canonically

    // The card's own effect targets are whatever legalActions offers (since
    // Task 8 the card has an effect); only the *payment* is being varied here.
    const offered = legalActions(db, state).find(
      (a): a is Extract<Action, { type: 'playCard' }> => a.type === 'playCard' && a.card === uid
    )
    if (offered === undefined) throw new Error('expected the card to be playable')

    const next = applyAction(db, state, {
      type: 'playCard',
      card: uid,
      payment: [readyLegend],
      targets: offered.targets,
    })
    expect(next.cards[readyLegend].ready).toBe(false)
    expect(next.cards[eddieUid].ready).toBe(true) // untouched
    expect(next.players[0].legends).toContain(readyLegend) // stays in the legends zone
    expect(next.players[0].trash).toContain(uid)
  })

  it('rejects a payment with the wrong total or a duplicated uid', () => {
    let state = setHand(mainPhaseP0(117), 0, ['industrial-assembly'])
    state = giveEddies(state, 0, 2)
    const [uid] = state.players[0].hand
    const [e1] = state.players[0].eddies

    expect(() =>
      applyAction(db, state, { type: 'playCard', card: uid, payment: [], targets: [] })
    ).toThrow(IllegalActionError)
    expect(() =>
      applyAction(db, state, { type: 'playCard', card: uid, payment: [e1, e1], targets: [] })
    ).toThrow(IllegalActionError)
  })
})

describe('callLegend', () => {
  it('flips exactly one face-down legend chosen uniformly at random via the seeded RNG', () => {
    const state = giveEddies(mainPhaseP0(119), 0, 1)
    const callAction = legalActions(db, state).find((a) => a.type === 'callLegend')
    expect(callAction).toBeDefined()
    expect(callAction!.payment).toHaveLength(1)

    const faceDownBefore = state.players[0].legends.filter((u) => !state.cards[u].faceUp)
    expect(faceDownBefore).toHaveLength(3)
    const [expectedIndex] = nextInt(state.rng, faceDownBefore.length)
    const expectedUid = faceDownBefore[expectedIndex]

    const next = applyAction(db, state, callAction!)
    const faceDownAfter = next.players[0].legends.filter((u) => !next.cards[u].faceUp)
    expect(faceDownAfter).toHaveLength(2)
    expect(next.cards[expectedUid].faceUp).toBe(true)
    expect(next.players[0].calledLegendThisTurn).toBe(true)
    expect(next.events.some((e) => e.type === 'legendCalled' && e.uid === expectedUid)).toBe(true)

    // Determinism: replaying from the identical starting state flips the same legend.
    const replay = applyAction(db, state, callAction!)
    expect(replay.cards[expectedUid].faceUp).toBe(true)
  })

  it('is once per turn and costs exactly 1', () => {
    const state = giveEddies(mainPhaseP0(121), 0, 1)
    const callAction = legalActions(db, state).find((a) => a.type === 'callLegend')!
    expect(callAction.payment).toHaveLength(1)

    const next = applyAction(db, state, callAction)
    expect(legalActions(db, next).some((a) => a.type === 'callLegend')).toBe(false)
    expect(() => applyAction(db, next, { type: 'callLegend', payment: [] })).toThrow(
      IllegalActionError
    )
  })

  it('is illegal with no eligible payment', () => {
    // Turn 1, player 0: 0 eddies, only 1 legend ready (the 3rd, the other 2
    // spent by the going-first penalty) -> that legend alone still affords
    // it, so instead force every legend spent to prove unaffordability.
    const state = mainPhaseP0(123)
    const starved = structuredClone(state)
    for (const uid of starved.players[0].legends) starved.cards[uid].ready = false
    expect(legalActions(db, starved).some((a) => a.type === 'callLegend')).toBe(false)
    expect(() => applyAction(db, starved, { type: 'callLegend', payment: [] })).toThrow(
      IllegalActionError
    )
  })

  it('is illegal once every legend is already face-up', () => {
    const state = giveEddies(mainPhaseP0(125), 0, 3)
    const allFaceUp = structuredClone(state)
    for (const uid of allFaceUp.players[0].legends) allFaceUp.cards[uid].faceUp = true
    expect(legalActions(db, allFaceUp).some((a) => a.type === 'callLegend')).toBe(false)
  })
})

describe('economy primitives', () => {
  it('canPayWith requires ready, owned, non-duplicated uids totalling exactly cost', () => {
    const state = giveEddies(mainPhaseP0(127), 0, 2)
    const [e1, e2] = state.players[0].eddies

    expect(canPayWith(state, 0, [e1, e2], 2)).toBe(true)
    expect(canPayWith(state, 0, [e1], 2)).toBe(false) // wrong total
    expect(canPayWith(state, 0, [e1, e1], 2)).toBe(false) // duplicate uid
    expect(canPayWith(state, 1, [e1, e2], 2)).toBe(false) // not player 1's cards

    const spent = structuredClone(state)
    spent.cards[e1].ready = false
    expect(canPayWith(spent, 0, [e1, e2], 2)).toBe(false) // e1 no longer ready
  })

  it('canonicalPayment spends ready eddies before legends, left to right, or null if unaffordable', () => {
    const state = giveEddies(mainPhaseP0(127), 0, 1)
    const [eddieUid] = state.players[0].eddies
    const readyLegends = state.players[0].legends.filter((u) => state.cards[u].ready)
    expect(readyLegends).toHaveLength(1) // turn 1 going-first penalty

    expect(canonicalPayment(state, 0, 0)).toEqual([])
    expect(canonicalPayment(state, 0, 1)).toEqual([eddieUid])
    expect(canonicalPayment(state, 0, 2)).toEqual([eddieUid, readyLegends[0]])
    expect(canonicalPayment(state, 0, 99)).toBeNull()
  })

  it('pay mutates the given draft in place and returns it, leaving other states untouched', () => {
    const state = giveEddies(mainPhaseP0(127), 0, 2)
    const [e1, e2] = state.players[0].eddies
    const draft = draftState(state)

    const paid = pay(draft, [e1, e2])
    expect(paid).toBe(draft) // same object, mutated in place
    expect(paid.cards[e1].ready).toBe(false)
    expect(paid.cards[e2].ready).toBe(false)
    expect(state.cards[e1].ready).toBe(true) // the original, un-drafted state is untouched
  })
})
