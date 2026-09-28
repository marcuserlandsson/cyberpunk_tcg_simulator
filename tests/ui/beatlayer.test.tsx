// @vitest-environment jsdom
//
// Task 8: BeatLayer renders the overlay for the beat currently being shown
// (spotlight, effect callout, turn banner) and useFlip drives FLIP card
// movement plus data-pulse-key value pulses between presentation frames.
//
// The project does not use jest-dom, so assertions use built-in
// Vitest/DOM equivalents (`.textContent`, `container.innerHTML`, etc.)
// instead of `toHaveTextContent`/`toBeEmptyDOMElement`.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, renderHook, screen, cleanup } from '@testing-library/react'
import { createRef } from 'react'
import { BeatLayer, effectCaption } from '../../src/ui/presentation/BeatLayer'
import { buildBeats } from '../../src/ui/presentation/beats'
import { useFlip } from '../../src/ui/presentation/useFlip'
import { db, startedGame } from '../engine/gameHelpers'
import type { GameEvent, GameState } from '../../src/engine/types'

afterEach(cleanup)

const board: GameState = startedGame()
const rivalCard = board.players[1].hand[0]
const humanCard = board.players[0].hand[0]
const rivalName = db[board.cards[rivalCard].defId].name
const humanName = db[board.cards[humanCard].defId].name

function layer(...events: GameEvent[]) {
  const beat = buildBeats(events.map((event, i) => ({ eventIndex: i, event, board })), 'ai')[0]
  return render(<BeatLayer db={db} beat={beat} human={0} root={createRef()} previousRects={{ current: new Map() }} useOfficialImages={false} />)
}

describe('BeatLayer', () => {
  it('renders nothing without a beat', () => {
    const { container } = render(<BeatLayer db={db} beat={null} human={0} root={createRef()} previousRects={{ current: new Map() }} useOfficialImages={false} />)
    expect(container.innerHTML).toBe('')
  })

  it('spotlights a played card with a rival caption', () => {
    layer({ type: 'cardPlayed', player: 1, uid: rivalCard })
    expect(screen.getByTestId('beat-spotlight').textContent).toContain(rivalName)
    expect(screen.getByTestId('beat-caption').textContent).toContain('Rival plays')
  })

  it('shows a face-down legend call as a card back', () => {
    const legend = board.players[1].legends[0]
    layer({ type: 'legendCalled', player: 1, uid: legend })
    expect(screen.getByTestId('beat-spotlight').textContent).not.toContain(db[board.cards[legend].defId].name)
  })

  it('names effect targets in the callout instead of raw uids', () => {
    layer({ type: 'effectResolved', sourceUid: rivalCard, description: `defeat ${humanCard}`, targets: [humanCard] })
    const callout = screen.getByTestId('beat-callout')
    expect(callout.textContent).toContain(rivalName)
    expect(callout.textContent).toContain(`defeat ${humanName}`)
  })

  it('announces whose turn starts', () => {
    layer({ type: 'turnStarted', player: 1, turn: 3 })
    expect(screen.getByTestId('beat-banner').textContent).toContain("RIVAL'S TURN")
  })

  it('draws nothing extra for minor beats', () => {
    layer({ type: 'cardDrawn', player: 1, uid: rivalCard })
    expect(screen.queryByTestId('beat-spotlight')).toBeNull()
    expect(screen.queryByTestId('beat-callout')).toBeNull()
  })
})

describe('effectCaption', () => {
  it('leaves untargeted descriptions alone', () => {
    expect(effectCaption(db, board, { type: 'effectResolved', sourceUid: rivalCard, description: 'draw 2' })).toBe('draw 2')
  })
})

describe('useFlip', () => {
  it('pulses an element whose data-pulse-key changed between frames', () => {
    const root = document.createElement('div')
    root.innerHTML = '<div data-pulse-id="power-1" data-pulse-key="2"></div>'
    document.body.appendChild(root)
    const el = root.firstElementChild as HTMLElement
    const animate = vi.fn()
    ;(el as unknown as { animate: typeof animate }).animate = animate
    const hook = renderHook(({ key }) => useFlip({ current: root }, key, 1000, true), { initialProps: { key: 1 as unknown } })
    el.dataset.pulseKey = '4'
    hook.rerender({ key: 2 })
    expect(animate).toHaveBeenCalledTimes(1)
    root.remove()
  })
})
