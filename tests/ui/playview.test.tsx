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
import { PlayView, endReasonLabel, lastGameEnded } from '../../src/ui/PlayView'
import { loadCardDb } from '../../src/engine/cardDb'
import { newGame } from '../../src/engine/game'
import { legalActions } from '../../src/engine/legal'
import { actingPlayer, effectivePower } from '../../src/engine/query'
import { applyAction } from '../../src/engine/reduce'
import { AI, HUMAN } from '../../src/ui/useGame'
import { listGameRecords, saveGameRecord } from '../../src/ui/storage'
import type { DeckList } from '../../src/engine/deck'
import type { GameRecord } from '../../src/engine/replay'
import type { Action, GameEvent, GameState } from '../../src/engine/types'
import arasakaDeck from '../../data/decks/arasaka-embracing-power.json'
import mercsDeck from '../../data/decks/mercs-the-heist.json'

const db = loadCardDb()
const arasaka = arasakaDeck as unknown as DeckList
const mercs = mercsDeck as unknown as DeckList

/**
 * A single deterministic step of a very dumb "always try to attack, always
 * pass a reaction" policy, applied to WHICHEVER side `legalActions` currently
 * belongs to (mirrors e2e/play.spec.ts's scripted driver, but over the pure
 * engine instead of the DOM) — used below to build real `GameRecord`s that
 * land on a react window or a real game-over, rather than hand-fabricating
 * states an actual game could never reach.
 */
function pickAction(actions: Action[]): Action {
  const pass = actions.find((a) => a.type === 'react' && a.reaction.type === 'pass')
  if (pass !== undefined) return pass
  const attackGig = actions.find((a) => a.type === 'attack' && a.target === 'gigArea')
  if (attackGig !== undefined) return attackGig
  const anyAttack = actions.find((a) => a.type === 'attack')
  if (anyAttack !== undefined) return anyAttack
  // Without ever playing a card, no Unit is ever on the field to attack with
  // — a pure die/turn-passing walk decks out around turn 20 without a single
  // `attackDeclared` event (verified against this exact seed/deck pair).
  const playCard = actions.find((a) => a.type === 'playCard')
  if (playCard !== undefined) return playCard
  const declineIntercept = actions.find((a) => a.type === 'answerIntercept' && a.answer === -1)
  if (declineIntercept !== undefined) return declineIntercept
  const rerollNo = actions.find((a) => a.type === 'chooseGigReroll' && !a.reroll)
  if (rerollNo !== undefined) return rerollNo
  const goFirst = actions.find((a) => a.type === 'choosePlayOrder' && a.goFirst)
  if (goFirst !== undefined) return goFirst
  const keepHand = actions.find((a) => a.type === 'keepHand')
  if (keepHand !== undefined) return keepHand
  const endTurn = actions.find((a) => a.type === 'endTurn')
  if (endTurn !== undefined) return endTurn
  return actions[0]
}

/**
 * Plays a real game from `seed` with the policy above, recording every action
 * taken, until `stop` says to halt or the game runs out of legal actions
 * (gameOver). The returned `actions` is a genuine `GameRecord.actions` — a
 * `saveGameRecord` + `resume-game` round-trip through `PlayView` replays it
 * through the exact same engine functions, landing on the exact same state.
 */
function driveToRecord(
  seed: number,
  stop: (state: GameState) => boolean,
  maxSteps = 3000
): { actions: Action[]; state: GameState } {
  let state = newGame(db, { decks: [arasaka, mercs], seed })
  const recorded: Action[] = []
  for (let step = 0; step < maxSteps; step += 1) {
    const actions = legalActions(db, state)
    if (stop(state) || actions.length === 0) return { actions: recorded, state }
    const chosen = pickAction(actions)
    state = applyAction(db, state, chosen)
    recorded.push(chosen)
  }
  throw new Error('driveToRecord exceeded maxSteps without reaching the stop condition')
}

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

describe('PlayView hover zoom panel', () => {
  // `choosePlayOrder` is the action that actually deals the opening hands
  // (reduce.ts) — `GOOD_RECORD`'s bare `actions: []` leaves both hands empty
  // (still in `chooseOrder`), so this record advances one action further,
  // into `mulligan`, specifically so the human's hand is non-empty.
  const HOVER_RECORD: GameRecord = {
    config: { decks: [arasaka, mercs], seed: 20260822 },
    actions: [{ type: 'choosePlayOrder', goFirst: true }],
  }

  function humanHandCard(container: HTMLElement): HTMLElement {
    const hand = container.querySelector('[data-testid="hand"][data-player="0"]')
    if (hand === null) throw new Error('human hand zone not found')
    const card = hand.querySelector<HTMLElement>(
      '[data-testid="playable-card"], [data-testid="board-card-hit"]'
    )
    if (card === null) throw new Error('no human hand card found to hover')
    return card
  }

  it('hovering a hand card opens the zoom panel', () => {
    saveGameRecord('hover-slot', HOVER_RECORD)
    const { container } = render(<PlayView db={db} useOfficialImages={false} aiDelayMs={0} />)
    fireEvent.click(screen.getByTestId('resume-game'))

    const card = humanHandCard(container)
    expect(screen.queryByTestId('zoom-panel')).toBeNull()

    fireEvent.mouseEnter(card)
    expect(screen.queryByTestId('zoom-panel')).not.toBeNull()

    fireEvent.mouseLeave(card)
    expect(screen.queryByTestId('zoom-panel')).toBeNull()
  })

  it('focusing a hand card (keyboard parity) opens the zoom panel the same as hovering', () => {
    saveGameRecord('hover-slot', HOVER_RECORD)
    const { container } = render(<PlayView db={db} useOfficialImages={false} aiDelayMs={0} />)
    fireEvent.click(screen.getByTestId('resume-game'))

    const card = humanHandCard(container)
    fireEvent.focus(card)
    expect(screen.queryByTestId('zoom-panel')).not.toBeNull()

    fireEvent.blur(card)
    expect(screen.queryByTestId('zoom-panel')).toBeNull()
  })

  it('never leaks a face-down legend past its back, even when hovered', () => {
    saveGameRecord('hover-slot', HOVER_RECORD)
    const { container } = render(<PlayView db={db} useOfficialImages={false} aiDelayMs={0} />)
    fireEvent.click(screen.getByTestId('resume-game'))

    const rivalLegends = container.querySelector('[data-testid="legends"][data-player="1"]')
    if (rivalLegends === null) throw new Error('rival legends zone not found')
    const legendCard = rivalLegends.querySelector<HTMLElement>('[data-testid="board-card-hit"]')
    if (legendCard === null) throw new Error('no rival legend card-hit found')

    fireEvent.mouseEnter(legendCard)
    const panel = screen.getByTestId('zoom-panel')
    expect(panel.querySelector('.card-frame__back')).not.toBeNull()
    expect(panel.textContent).toBe('')
  })

  it("keeps the rival's hidden hand backs red-keyed to the rival, testid intact", () => {
    saveGameRecord('hover-slot', HOVER_RECORD)
    const { container } = render(<PlayView db={db} useOfficialImages={false} aiDelayMs={0} />)
    fireEvent.click(screen.getByTestId('resume-game'))

    const backs = container.querySelectorAll('[data-testid="hand-back"]')
    expect(backs.length).toBeGreaterThan(0)
    for (const back of backs) {
      expect(back.querySelector('.card-frame--rival')).not.toBeNull()
    }
  })
})

describe('PlayView spotlight prompts (Task 7)', () => {
  it('sets playmat--prompting while the mulligan bar is open', () => {
    const seed = 20260822
    // `choosePlayOrder` deals both hands and enters `mulligan`, but which side
    // decides first depends on the roll — drive to whichever real state has
    // it genuinely be the human's turn to answer, rather than assuming it.
    const { actions, state } = driveToRecord(
      seed,
      (s) => s.phase === 'mulligan' && actingPlayer(s) === HUMAN
    )
    expect(state.phase).toBe('mulligan')

    const record: GameRecord = { config: { decks: [arasaka, mercs], seed }, actions }
    saveGameRecord('mulligan-slot', record)
    render(<PlayView db={db} useOfficialImages={false} aiDelayMs={0} />)
    fireEvent.click(screen.getByTestId('resume-game'))

    expect(screen.getByTestId('mulligan-bar')).not.toBeNull()
    expect(screen.getByTestId('playmat').className).toContain('playmat--prompting')
  })

  it("derives the reaction bar's label from the real attackDeclared event, naming attacker/target and power, and never a hidden name", () => {
    // Drive a real game until it lands on a react window that is actually the
    // HUMAN's own decision (`useGame.legal` — and so the ReactionBar — is only
    // populated when `actingPlayer` is the human; see src/ui/useGame.ts).
    const seed = 20260822
    const { actions, state } = driveToRecord(
      seed,
      (s) => s.phase === 'react' && actingPlayer(s) === HUMAN
    )
    expect(state.phase).toBe('react')

    const declared = [...state.events]
      .reverse()
      .find((e): e is Extract<GameEvent, { type: 'attackDeclared' }> => e.type === 'attackDeclared')
    if (declared === undefined) throw new Error('no attackDeclared event on a react-window state')

    const record: GameRecord = { config: { decks: [arasaka, mercs], seed }, actions }
    saveGameRecord('react-slot', record)
    render(<PlayView db={db} useOfficialImages={false} aiDelayMs={0} />)
    fireEvent.click(screen.getByTestId('resume-game'))

    const bar = screen.getByTestId('reaction-bar')
    const attackerName = db[state.cards[declared.attacker].defId].name
    expect(bar.textContent).toContain(attackerName)
    expect(bar.textContent).toContain(String(effectivePower(db, state, declared.attacker)))
    expect(bar.textContent).toContain('react or pass:')
    if (declared.target === 'gigArea') {
      expect(bar.textContent).toContain('your Gig area')
    } else {
      const targetName = db[state.cards[declared.target].defId].name
      expect(bar.textContent).toContain(targetName)
      expect(bar.textContent).toContain(String(effectivePower(db, state, declared.target)))
    }
    // Info hygiene: whatever the label says, it must never be built from an
    // instance's real name while that instance is face-down.
    for (const uid of [declared.attacker, declared.target].filter(
      (v): v is number => typeof v === 'number'
    )) {
      expect(state.cards[uid]?.faceUp).not.toBe(false)
    }

    expect(screen.getByTestId('playmat').className).toContain('playmat--prompting')
  })

  it('reaches a real game over, and shows a full-board overlay with WIN/LOSS, the reason, and its own New game button — leaving the rail (and its own New game) intact', () => {
    const seed = 20260822
    const { actions, state } = driveToRecord(seed, (s) => s.phase === 'gameOver')
    expect(state.phase).toBe('gameOver')
    expect(state.winner).not.toBeNull()

    const record: GameRecord = { config: { decks: [arasaka, mercs], seed }, actions }
    saveGameRecord('gameover-slot', record)
    render(<PlayView db={db} useOfficialImages={false} aiDelayMs={0} />)
    fireEvent.click(screen.getByTestId('resume-game'))

    const overlay = screen.getByTestId('game-over')
    expect(overlay.textContent).toContain(state.winner === HUMAN ? 'WIN' : 'LOSS')
    expect(overlay.textContent).toContain(endReasonLabel(lastGameEnded(state)))
    expect(screen.getByTestId('playmat').className).toContain('playmat--prompting')

    // The rail survives untouched behind/beside the overlay: its own
    // "New game" testid is exactly where it always was, distinct from the
    // overlay's own button.
    expect(screen.getByTestId('new-game')).not.toBeNull()
    const overlayNewGame = screen.getByTestId('game-over-new-game')
    expect(overlay.contains(overlayNewGame)).toBe(true)

    fireEvent.click(overlayNewGame)
    expect(screen.getByTestId('play-setup')).not.toBeNull()
  })
})

describe('endReasonLabel / lastGameEnded (pure — the game-over overlay reason text)', () => {
  function stateWithEvents(events: GameEvent[]): GameState {
    return { events } as unknown as GameState
  }

  it('finds the LAST gameEnded event, not the first', () => {
    const first: GameEvent = { type: 'gameEnded', winner: AI, reason: 'deckout' }
    const last: GameEvent = { type: 'gameEnded', winner: HUMAN, reason: 'sevenGigs' }
    const state = stateWithEvents([first, { type: 'turnEnded', player: HUMAN }, last])
    expect(lastGameEnded(state)).toBe(last)
  })

  it('returns undefined, and an empty label, when the game has not ended', () => {
    const state = stateWithEvents([{ type: 'turnEnded', player: HUMAN }])
    expect(lastGameEnded(state)).toBeUndefined()
    expect(endReasonLabel(undefined)).toBe('')
  })

  it('maps every ending reason to its words, including the deckout direction', () => {
    expect(endReasonLabel({ type: 'gameEnded', winner: HUMAN, reason: 'sevenGigs' })).toBe(
      '7 Gigs at the start of turn'
    )
    expect(endReasonLabel({ type: 'gameEnded', winner: AI, reason: 'overtimeMajority' })).toBe(
      'Overtime majority'
    )
    // deckout: the winner is whoever DIDN'T run out.
    expect(endReasonLabel({ type: 'gameEnded', winner: HUMAN, reason: 'deckout' })).toBe(
      'Rival deck ran out'
    )
    expect(endReasonLabel({ type: 'gameEnded', winner: AI, reason: 'deckout' })).toBe(
      'You ran out of cards'
    )
    expect(endReasonLabel({ type: 'gameEnded', winner: HUMAN, reason: 'concede' })).toBe('Conceded')
  })
})
