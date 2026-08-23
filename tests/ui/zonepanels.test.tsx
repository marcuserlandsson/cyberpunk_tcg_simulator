// @vitest-environment jsdom
//
// Task 4 (visual overhaul): the Eddies area renders physically — one small
// face-down `CardFrame` per uid in `players[x].eddies`, tapped (90°,
// `card-frame--spent`) when spent — instead of a bare `ready/total` count.
// Deck/trash become visual piles (a face-down back with the existing count
// chip overlaid). Legends already tap via `CardFrame`'s `card-frame--spent`
// class (Task 2/3) once `BoardCard` passes `ready={instance.ready}`; this
// file just asserts that keeps working now that the zone gets tap headroom.

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ZonePanels } from '../../src/ui/ZonePanels'
import { NO_AFFORDANCES, type BoardHandlers } from '../../src/ui/playAffordances'
import { AI, HUMAN } from '../../src/ui/useGame'
import { newGame } from '../../src/engine/game'
import { applyAction } from '../../src/engine/reduce'
import { legalActions } from '../../src/engine/legal'
import type { GameState } from '../../src/engine/types'
import { db, decks } from '../engine/gameHelpers'

const noopHandlers: BoardHandlers = {
  onCard: () => {},
  onSell: () => {},
  onAbility: () => {},
  onFixerDie: () => {},
  onGigDie: () => {},
  onGigArea: () => {},
}

afterEach(cleanup)

/** newGame -> player 0 goes first -> both keep hand -> chooses a d4 gig ->
 *  main phase, turn 1, player 0 active. Mirrors economy.test.ts's local
 *  `mainPhaseP0` helper (not exported from there, so reimplemented here). */
function mainPhaseP0(seed: number): GameState {
  let state = newGame(db, { decks, seed })
  const rollWinner = state.activePlayer
  state = applyAction(db, state, { type: 'choosePlayOrder', goFirst: rollWinner === 0 })
  state = applyAction(db, state, { type: 'keepHand' })
  state = applyAction(db, state, { type: 'keepHand' })
  state = applyAction(db, state, { type: 'chooseGigDie', size: 4 })
  return state
}

/** A real main-phase state where player 0 has sold a card into the Eddies
 *  area (docs/rulings.md #21: a sold card enters ready). Not every opening
 *  hand has a sellable card, so this tries a spread of seeds. */
function stateWithEddie(): GameState {
  for (let seed = 1; seed <= 40; seed++) {
    const state = mainPhaseP0(seed)
    const sell = legalActions(db, state).find((a) => a.type === 'sellCard')
    if (sell !== undefined && sell.type === 'sellCard') {
      return applyAction(db, state, sell)
    }
  }
  throw new Error('No seed in range produced a sellable opening hand for player 0.')
}

const baseState = stateWithEddie()

function renderZones(state: GameState, player: 0 | 1 = HUMAN) {
  render(
    <ZonePanels
      db={db}
      state={state}
      player={player}
      affordances={NO_AFFORDANCES}
      handlers={noopHandlers}
      useOfficialImages={false}
    />
  )
}

describe('ZonePanels eddies', () => {
  it('renders one card per eddie, tapped when spent', () => {
    const spent = structuredClone(baseState) as GameState
    const uid = spent.players[0].eddies[0]
    spent.cards[uid] = { ...spent.cards[uid], ready: false }

    renderZones(spent)

    const cards = screen.getAllByTestId('eddie-card')
    expect(cards).toHaveLength(spent.players[0].eddies.length)
    expect(cards[0].getAttribute('data-ready')).toBe('false')
    expect(cards[0].querySelector('.card-frame--spent')).not.toBeNull()
  })

  it('renders a ready (untapped) eddie without the spent class', () => {
    renderZones(baseState)

    const cards = screen.getAllByTestId('eddie-card')
    expect(cards.length).toBeGreaterThan(0)
    expect(cards[0].getAttribute('data-ready')).toBe('true')
    expect(cards[0].querySelector('.card-frame--spent')).toBeNull()
  })

  it('keeps the eddies-count chip text as €$ ready/total', () => {
    renderZones(baseState)

    const ready = baseState.players[0].eddies.filter((uid) => baseState.cards[uid].ready).length
    const chip = screen.getByTestId('eddies-count')
    expect(chip.textContent).toBe(`€$ ${ready}/${baseState.players[0].eddies.length}`)
  })

  it('never renders a face-down eddie card\'s real identity', () => {
    renderZones(baseState)

    const realDefId = baseState.cards[baseState.players[0].eddies[0]].defId
    const card = screen.getAllByTestId('eddie-card')[0]
    expect(card.textContent).toBe('')
    expect(card.querySelector(`[data-def-id="${realDefId}"]`)).toBeNull()
  })

  it("keys the face-down back to the owner (rival reads red, human reads cyan)", () => {
    renderZones(baseState, HUMAN)
    expect(screen.getAllByTestId('eddie-card')[0].querySelector('.card-frame--you')).not.toBeNull()
    cleanup()

    const rivalState = structuredClone(baseState) as GameState
    rivalState.players[1] = { ...rivalState.players[1], eddies: rivalState.players[0].eddies }
    renderZones(rivalState, AI)
    expect(screen.getAllByTestId('eddie-card')[0].querySelector('.card-frame--rival')).not.toBeNull()
  })

  it('adds the dense overlap class once eddies exceed 6', () => {
    const many = structuredClone(baseState) as GameState
    const template = many.cards[many.players[0].eddies[0]]
    const fakeUids = Array.from({ length: 7 }, (_, i) => 900000 + i)
    for (const uid of fakeUids) {
      many.cards[uid] = { ...template, uid }
    }
    many.players[0] = { ...many.players[0], eddies: fakeUids }

    renderZones(many)

    expect(screen.getByTestId('eddies').className).toContain('zone--eddies--dense')
  })

  it('does not add the dense class at 6 or fewer eddies', () => {
    renderZones(baseState)
    expect(screen.getByTestId('eddies').className).not.toContain('zone--eddies--dense')
  })
})

describe('ZonePanels deck/trash piles', () => {
  it('keeps deck-count/trash-count/removed-count testids and text', () => {
    renderZones(baseState)

    const p = baseState.players[0]
    expect(screen.getByTestId('deck-count').textContent).toBe(`Deck ${p.deck.length}`)
    expect(screen.getByTestId('trash-count').textContent).toBe(`Trash ${p.trash.length}`)
    expect(screen.queryByTestId('removed-count')).toBeNull()
  })

  it('shows removed-count only when removed.length > 0', () => {
    const withRemoved = structuredClone(baseState) as GameState
    const uid = withRemoved.players[0].trash[0]
    withRemoved.players[0] = {
      ...withRemoved.players[0],
      trash: withRemoved.players[0].trash.slice(1),
      removed: [...withRemoved.players[0].removed, uid],
    }
    renderZones(withRemoved)
    expect(screen.getByTestId('removed-count').textContent).toBe('Removed 1')
  })

  it('renders the deck and trash as face-down pile backs', () => {
    renderZones(baseState)
    const counts = screen.getByTestId('counts')
    expect(counts.querySelectorAll('.card-frame--face-down').length).toBeGreaterThanOrEqual(2)
  })
})

describe('ZonePanels legends', () => {
  // `baseState`'s legends start from the real "first player's opening two
  // legends enter tapped" setup rule (reduce.ts's `choosePlayOrder`, per
  // docs/rulings.md), so every legend is force-readied first here to isolate
  // this test from that unrelated engine fact before flipping exactly one.
  function readiedLegends(): GameState {
    const clone = structuredClone(baseState) as GameState
    for (const uid of clone.players[0].legends) clone.cards[uid].ready = true
    return clone
  }

  it('taps a spent legend in the legends row', () => {
    const clone = readiedLegends()
    const legendUid = clone.players[0].legends[0]
    clone.cards[legendUid] = { ...clone.cards[legendUid], ready: false }

    renderZones(clone)

    const legends = screen.getByTestId('legends')
    expect(legends.querySelectorAll('.card-frame--spent')).toHaveLength(1)
    expect(
      legends.querySelector(`[data-uid="${legendUid}"] .card-frame--spent`)
    ).not.toBeNull()
  })

  it('does not tap a ready legend', () => {
    renderZones(readiedLegends())
    const legends = screen.getByTestId('legends')
    expect(legends.querySelector('.card-frame--spent')).toBeNull()
  })
})
