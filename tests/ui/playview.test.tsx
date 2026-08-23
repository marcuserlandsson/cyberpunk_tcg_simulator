// @vitest-environment jsdom
//
// Final-review item 1: a saved GameRecord that no longer replays (written
// before a rules/card-data change, say) must surface as a visible,
// recoverable error rather than a dead "resume" button and a console-only
// exception. `useGame`'s own `loadError` contract is covered in
// tests/ui/usegame.test.ts; this covers the Play view actually wiring it up —
// the error message rendering, and the broken slot being deletable.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PlayView } from '../../src/ui/PlayView'
import { loadCardDb } from '../../src/engine/cardDb'
import { listGameRecords, saveGameRecord } from '../../src/ui/storage'
import type { DeckList } from '../../src/engine/deck'
import type { GameRecord } from '../../src/engine/replay'
import arasakaDeck from '../../data/decks/arasaka-embracing-power.json'
import mercsDeck from '../../data/decks/mercs-the-heist.json'

const db = loadCardDb()
const arasaka = arasakaDeck as unknown as DeckList
const mercs = mercsDeck as unknown as DeckList

/** A genuinely replayable record — a fresh deal, no actions yet. */
const GOOD_RECORD: GameRecord = {
  config: { decks: [arasaka, mercs], seed: 20260822 },
  actions: [],
}

// Hand-corrupted: `endTurn` is not legal as the very first action (a fresh
// game opens in `chooseOrder`), the same shape a save would take once replay
// reaches an action a rules/card-data change made illegal.
const CORRUPT_RECORD = {
  config: {
    decks: [
      { name: 'human', legends: ['x', 'y', 'z'], cards: {} },
      { name: 'ai', legends: ['x', 'y', 'z'], cards: {} },
    ],
    seed: 1,
  },
  actions: [{ type: 'endTurn' }],
} as unknown as GameRecord

beforeEach(() => {
  localStorage.clear()
})

afterEach(cleanup)

describe('PlayView resume error handling', () => {
  it('surfaces a visible error instead of crashing when a saved game no longer replays', () => {
    saveGameRecord('broken-slot', CORRUPT_RECORD)
    const { container } = render(<PlayView db={db} useOfficialImages={false} aiDelayMs={0} />)

    const resumeButton = screen.getByTestId('resume-game')
    expect(resumeButton.getAttribute('data-name')).toBe('broken-slot')

    // Must not throw out of the click handler.
    expect(() => fireEvent.click(resumeButton)).not.toThrow()

    // The setup screen is still showing (the load did not succeed), with a
    // visible, specific error message.
    expect(container.querySelector('[data-testid="play-setup"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="resume-error"]')?.textContent).toContain(
      "This save predates a rules change and can't be resumed."
    )

    // A Delete-save option for the broken slot, and only for that slot.
    const del = container.querySelector('[data-testid="delete-broken-save"]')
    expect(del).not.toBeNull()
    expect(del?.getAttribute('data-name')).toBe('broken-slot')
  })

  it('deleting the broken slot removes it and clears the error', () => {
    saveGameRecord('broken-slot', CORRUPT_RECORD)
    const { container } = render(<PlayView db={db} useOfficialImages={false} aiDelayMs={0} />)

    fireEvent.click(screen.getByTestId('resume-game'))
    expect(container.querySelector('[data-testid="resume-error"]')).not.toBeNull()

    fireEvent.click(screen.getByTestId('delete-broken-save'))

    expect(container.querySelector('[data-testid="resume-error"]')).toBeNull()
    expect(container.querySelector('[data-testid="resume-game"]')).toBeNull()
    expect(container.querySelector('[data-testid="no-saves"]')).not.toBeNull()
    expect(listGameRecords().find((entry) => entry.name === 'broken-slot')).toBeUndefined()
  })

  it('a good save still resumes normally alongside a broken one', () => {
    saveGameRecord('broken-slot', CORRUPT_RECORD)
    saveGameRecord('good-slot', GOOD_RECORD)
    const { container } = render(<PlayView db={db} useOfficialImages={false} aiDelayMs={0} />)

    const buttonNamed = (name: string): HTMLElement => {
      const el = container.querySelector(`[data-testid="resume-game"][data-name="${name}"]`)
      if (el === null) throw new Error(`resume button "${name}" not found`)
      return el as HTMLElement
    }

    fireEvent.click(buttonNamed('broken-slot'))
    expect(container.querySelector('[data-testid="resume-error"]')).not.toBeNull()
    // The setup screen (with both saves) is still up after the failed load.
    expect(container.querySelector('[data-testid="resume-game"][data-name="good-slot"]')).not.toBeNull()

    fireEvent.click(buttonNamed('good-slot'))
    // The good save resumes for real: the setup screen is gone, the error
    // with it, and the playmat is up.
    expect(container.querySelector('[data-testid="play-setup"]')).toBeNull()
    expect(container.querySelector('[data-testid="playmat"]')).not.toBeNull()
  })
})

describe('PlayView feed', () => {
  it('feed lines are actor-classed', () => {
    saveGameRecord('good-slot', GOOD_RECORD)
    render(<PlayView db={db} useOfficialImages={false} aiDelayMs={0} />)

    fireEvent.click(screen.getByTestId('resume-game'))

    const lines = screen.getAllByTestId('log-line')
    expect(lines.some((l) => l.className.includes('log-line--sys'))).toBe(true)
  })
})
