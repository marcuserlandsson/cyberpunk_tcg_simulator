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
import { createRef, useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { BeatLayer, effectCaption } from '../../src/ui/presentation/BeatLayer'
import { buildBeats } from '../../src/ui/presentation/beats'
import { useFlip } from '../../src/ui/presentation/useFlip'
import { HandStrip } from '../../src/ui/HandStrip'
import { ZonePanels } from '../../src/ui/ZonePanels'
import { NO_AFFORDANCES, type BoardHandlers } from '../../src/ui/playAffordances'
import { db, startedGame } from '../engine/gameHelpers'
import type { GameEvent, GameState } from '../../src/engine/types'

const noopHandlers: BoardHandlers = {
  onCard: () => {},
  onSell: () => {},
  onAbility: () => {},
  onFixerDie: () => {},
  onGigDie: () => {},
  onGigArea: () => {},
}

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

  it('never names a face-down card in the effect callout (source or target)', () => {
    const legend = board.players[1].legends[0] // face-down by default
    layer({ type: 'effectResolved', sourceUid: legend, description: `boost ${legend}`, targets: [legend] })
    const callout = screen.getByTestId('beat-callout')
    expect(callout.textContent).not.toContain(db[board.cards[legend].defId].name)
    expect(callout.textContent).toContain('a face-down card')
  })

  it('never flies a ghost for a removed card (only trashed/bottom-decked exit the game via a pile)', () => {
    layer({ type: 'unitDefeated', uid: rivalCard }, { type: 'cardRemoved', uid: rivalCard })
    expect(screen.queryByTestId('beat-ghost')).toBeNull()
  })
})

describe('hidden cards never carry an identifying data-uid (fix round 1, controller ruling)', () => {
  it('a hidden rival hand back has no data-uid', () => {
    const { container } = render(
      <HandStrip db={db} state={board} player={1} hidden affordances={NO_AFFORDANCES} handlers={noopHandlers} useOfficialImages={false} />
    )
    const back = container.querySelector('[data-testid="hand-back"]')
    expect(back).not.toBeNull()
    expect(back!.hasAttribute('data-uid')).toBe(false)
  })

  it("omits data-uid from the rival's eddies but keeps it on the human's own", () => {
    const withEddie = (owner: 0 | 1): GameState => {
      const clone = structuredClone(board) as GameState
      const uid = owner === 0 ? humanCard : rivalCard
      clone.players[owner] = { ...clone.players[owner], eddies: [...clone.players[owner].eddies, uid] }
      return clone
    }

    const rival = render(
      <ZonePanels db={db} state={withEddie(1)} player={1} affordances={NO_AFFORDANCES} handlers={noopHandlers} useOfficialImages={false} />
    )
    expect(rival.getByTestId('eddie-card').hasAttribute('data-uid')).toBe(false)
    rival.unmount()

    const human = render(
      <ZonePanels db={db} state={withEddie(0)} player={0} affordances={NO_AFFORDANCES} handlers={noopHandlers} useOfficialImages={false} />
    )
    expect(human.getByTestId('eddie-card').hasAttribute('data-uid')).toBe(true)
  })

  it("omits data-uid from the rival's face-down Legend but keeps it on the human's own", () => {
    const rival = render(
      <ZonePanels db={db} state={board} player={1} affordances={NO_AFFORDANCES} handlers={noopHandlers} useOfficialImages={false} />
    )
    const rivalLegend = rival.getByTestId('legends').querySelector('[data-testid="board-card"]')
    expect(rivalLegend).not.toBeNull()
    expect(rivalLegend!.hasAttribute('data-uid')).toBe(false)
    rival.unmount()

    const human = render(
      <ZonePanels db={db} state={board} player={0} affordances={NO_AFFORDANCES} handlers={noopHandlers} useOfficialImages={false} />
    )
    const humanLegend = human.getByTestId('legends').querySelector('[data-testid="board-card"]')
    expect(humanLegend).not.toBeNull()
    expect(humanLegend!.hasAttribute('data-uid')).toBe(true)
  })

  it("BeatLayer's locate degrades to a null box (no target outline) for a hidden Legend target", () => {
    const legend = board.players[1].legends[0]
    const beat = buildBeats(
      [{ eventIndex: 0, event: { type: 'effectResolved', sourceUid: rivalCard, description: 'x', targets: [legend] }, board }],
      'ai'
    )[0]

    function Harness() {
      const root = useRef<HTMLDivElement | null>(null)
      return (
        <div ref={root}>
          {/* The real rival Legends row: since it's face-down and the
              rival's, it carries no [data-uid] to find (per the fix above). */}
          <ZonePanels db={db} state={board} player={1} affordances={NO_AFFORDANCES} handlers={noopHandlers} useOfficialImages={false} />
          <BeatLayer db={db} beat={beat} human={0} root={root} previousRects={{ current: new Map() }} useOfficialImages={false} />
        </div>
      )
    }

    const { container } = render(<Harness />)
    expect(container.querySelectorAll('.beat-layer__target').length).toBe(0)
  })
})

describe('spotlitUid also hides a called Legend while its spotlight plays', () => {
  it('marks the Legend BoardCard is-spotlit when it matches spotlitUid', () => {
    const legend = board.players[0].legends[0]
    const { getByTestId } = render(
      <ZonePanels
        db={db}
        state={board}
        player={0}
        affordances={NO_AFFORDANCES}
        handlers={noopHandlers}
        useOfficialImages={false}
        spotlitUid={legend}
      />
    )
    const legendCard = getByTestId('legends').querySelector('[data-testid="board-card"]')
    expect(legendCard).not.toBeNull()
    expect(legendCard!.className).toContain('is-spotlit')
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

  // Fix round 1, item 1: React fires a CHILD's layout effect before its
  // PARENT's, in the same commit. `useFlip` is called inside PlayView
  // (the parent), and `BeatLayer` is a child rendered below it — so
  // BeatLayer's own layout effect (reading the ref this hook returns)
  // always runs before useFlip's effect updates that ref for the frame just
  // committed. This test reproduces that ordering with a real parent/child
  // pair instead of asserting on useFlip in isolation (renderHook has no
  // child to race against, so it can't see this bug).
  it("gives a child's own layout effect the rects from immediately before the current frame, not two frames back", () => {
    let left = 0
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        return { left, top: 0, right: left, bottom: 0, width: 0, height: 0, x: left, y: 0, toJSON: () => ({}) } as DOMRect
      })

    const seenByChild: Array<number | undefined> = []

    function Child({ previousRects }: { previousRects: RefObject<Map<string, DOMRect>> }) {
      useLayoutEffect(() => {
        seenByChild.push(previousRects.current.get('1')?.left)
      })
      return null
    }

    function Harness({ frameKey }: { frameKey: number }) {
      const root = useRef<HTMLDivElement | null>(null)
      const previousRects = useFlip(root, frameKey, 1000, true)
      return (
        <div ref={root}>
          <div data-uid="1" />
          <Child previousRects={previousRects} />
        </div>
      )
    }

    const { rerender } = render(<Harness frameKey={0} />) // mount: left=0
    left = 10
    rerender(<Harness frameKey={1} />) // frame 1: DOM/mock now reports left=10
    left = 20
    rerender(<Harness frameKey={2} />) // frame 2: DOM/mock now reports left=20

    // At frame 2, the child must see the rects measured immediately before
    // this frame — i.e. frame 1's (left=10) — not frame 0's (left=0), which
    // is what the two-frames-stale bug produced.
    expect(seenByChild[2]).toBe(10)
    expect(seenByChild[1]).toBe(0)

    rectSpy.mockRestore()
  })
})
