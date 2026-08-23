// @vitest-environment jsdom
//
// Task 3 (visual overhaul): the street strip renders BOTH players' dice
// pools (fixer + gig area) plus the contested-center turn/phase line, with
// the same testids `ZonePanels`'s old `DicePanels` used to carry.

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { StreetStrip } from '../../src/ui/StreetStrip'
import { NO_AFFORDANCES, type BoardHandlers } from '../../src/ui/playAffordances'
import { db, startedGame } from '../engine/gameHelpers'

const noopHandlers: BoardHandlers = {
  onCard: () => {},
  onSell: () => {},
  onAbility: () => {},
  onFixerDie: () => {},
  onGigDie: () => {},
  onGigArea: () => {},
}

afterEach(cleanup)

describe('StreetStrip', () => {
  it('renders both players gig areas and street cred', () => {
    const state = startedGame()
    render(
      <StreetStrip
        db={db}
        state={state}
        affordances={NO_AFFORDANCES}
        handlers={noopHandlers}
        humanFixerInteractive={false}
        rivalGigStealInteractive={false}
        rivalGigAreaTargetable={false}
      />
    )
    expect(screen.getAllByTestId('gig-area')).toHaveLength(2)
    expect(screen.getAllByTestId('fixer')).toHaveLength(2)
    expect(screen.getAllByTestId('street-cred')).toHaveLength(2)
  })

  it('keeps the center turn/phase testid', () => {
    const state = startedGame()
    render(
      <StreetStrip
        db={db}
        state={state}
        affordances={NO_AFFORDANCES}
        handlers={noopHandlers}
        humanFixerInteractive={false}
        rivalGigStealInteractive={false}
        rivalGigAreaTargetable={false}
      />
    )
    expect(screen.getByTestId('center-turn').textContent).toContain(String(state.turnNumber))
  })
})
