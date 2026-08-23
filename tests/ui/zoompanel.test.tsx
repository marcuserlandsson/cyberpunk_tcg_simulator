// @vitest-environment jsdom
//
// Task 6 (visual overhaul): the zoom panel a board/hand hover opens
// (design spec's "Card renditions" §3 ZoomCard / "Play view" row 4) — the
// full `CardFrame size="zoom"` rendition plus a live-state strip (effective
// power, granted keywords, attachment names). PlayView's own wiring
// (hover/focus opening/closing it) is covered in tests/ui/playview.test.tsx;
// this file covers the component in isolation: what it shows for a live
// card, and that a face-down card never leaks past its back.

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ZoomPanel } from '../../src/ui/ZoomPanel'
import { applyAction } from '../../src/engine/reduce'
import { newGame } from '../../src/engine/game'
import { AI, HUMAN } from '../../src/ui/useGame'
import type { GameState } from '../../src/engine/types'
import { db, decks } from '../engine/gameHelpers'

afterEach(cleanup)

/** newGame -> player 0 goes first -> both keep hand -> chooses a d4 gig ->
 *  main phase, turn 1, player 0 active (mirrors zonepanels.test.tsx's local
 *  helper of the same name). */
function mainPhaseP0(seed: number): GameState {
  let state = newGame(db, { decks, seed })
  const rollWinner = state.activePlayer
  state = applyAction(db, state, { type: 'choosePlayOrder', goFirst: rollWinner === 0 })
  state = applyAction(db, state, { type: 'keepHand' })
  state = applyAction(db, state, { type: 'keepHand' })
  state = applyAction(db, state, { type: 'chooseGigDie', size: 4 })
  return state
}

const UNIT_UID = 555001
const GEAR_UID = 555002

/** A real Unit (Corpo Security, printed power 2, no {quick}) on the human's
 *  field, with a real Gear (Mantis Blades, printed power 2) attached and a
 *  live +3 buff plus a granted-only {quick} — so effective power (2+3+2=7)
 *  and the granted keyword both differ from what's printed. */
function stateWithEquippedUnit(): GameState {
  const state = structuredClone(mainPhaseP0(1)) as GameState
  state.cards[UNIT_UID] = {
    uid: UNIT_UID,
    defId: 'corpo-security',
    owner: HUMAN,
    ready: true,
    lag: false,
    faceUp: true,
    attachedGear: [GEAR_UID],
    tempPower: 3,
    permPower: 0,
    tempKeywords: ['quick'],
  }
  state.cards[GEAR_UID] = {
    uid: GEAR_UID,
    defId: 'mantis-blades',
    owner: HUMAN,
    ready: true,
    lag: false,
    faceUp: true,
    attachedGear: [],
    tempPower: 0,
    permPower: 0,
    tempKeywords: [],
  }
  state.players[HUMAN] = {
    ...state.players[HUMAN],
    field: [...state.players[HUMAN].field, UNIT_UID],
  }
  return state
}

describe('ZoomPanel', () => {
  it('renders nothing when uid is null', () => {
    const { container } = render(
      <ZoomPanel db={db} state={mainPhaseP0(1)} uid={null} useOfficialImages={false} />
    )
    expect(container.querySelector('[data-testid="zoom-panel"]')).toBeNull()
  })

  it('renders nothing for a uid the state has never heard of', () => {
    const { container } = render(
      <ZoomPanel db={db} state={mainPhaseP0(1)} uid={999999} useOfficialImages={false} />
    )
    expect(container.querySelector('[data-testid="zoom-panel"]')).toBeNull()
  })

  it('shows effective power, granted keywords, and attachment names for a live card', () => {
    const state = stateWithEquippedUnit()
    render(<ZoomPanel db={db} state={state} uid={UNIT_UID} useOfficialImages={false} />)

    const panel = screen.getByTestId('zoom-panel')
    // Printed 2, +3 temp buff, +2 from the attached Gear's own power box.
    expect(panel.textContent).toContain('7')
    expect(panel.textContent).toContain('quick')
    expect(panel.textContent).toContain('Mantis Blades')
    // The full zoom rendition is present too (name, printed keyword pip).
    expect(panel.textContent).toContain('Corpo Security')
  })

  it('renders only the back for a face-down card, never its name or live state', () => {
    const state = mainPhaseP0(1)
    const legendUid = state.players[AI].legends[0]
    expect(state.cards[legendUid].faceUp).toBe(false)

    render(<ZoomPanel db={db} state={state} uid={legendUid} useOfficialImages={false} />)

    const panel = screen.getByTestId('zoom-panel')
    expect(panel.querySelector('.card-frame__back')).not.toBeNull()
    expect(panel.textContent).toBe('')
    expect(panel.querySelector('[data-testid="zoom-panel-strip"]')).toBeNull()
  })
})
