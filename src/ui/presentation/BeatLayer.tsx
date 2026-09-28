// The overlay for the beat being shown (docs/superpowers/specs/
// 2026-09-28-effect-pacing-design.md §4). It sits inside .playmat__board (never
// above the playmat) and draws, per beat kind:
//   spotlight  - veil, the card at zoom size, and a caption
//   effect     - a callout next to the source, plus target lines
//   attack     - a line from the attacker to its target
//   turnBanner - a sweep naming whose turn it is
//   defeat and exit-absorbing effects - a ghost flying to the trash or deck
//     pile (a card that leaves the game via 'cardRemoved' gets no ghost: it
//     never lands in either pile)
// Positions come from the rendered board ([data-uid] and [data-pile]
// elements), falling back to the pre-frame rects for cards that just left.
// A hidden card (face-down, not the human's own) never carries [data-uid] —
// `locate` then falls back to its pre-frame rect, or degrades to a null box
// if it never had one either.

import { useLayoutEffect, useState, type CSSProperties, type ReactElement, type RefObject } from 'react'
import { CardFrame } from '../CardFrame'
import { FACE_DOWN_DEF } from '../ZonePanels'
import { describeEvent } from '../useGame'
import type { CardDb, PlayerId } from '../../engine/types'
import type { Beat } from './beats'
import { describeEffect } from './describeEffect'

type Box = { x: number; y: number; w: number; h: number }

function boxOf(root: HTMLElement, rect: DOMRect): Box {
  const origin = root.getBoundingClientRect()
  return { x: rect.left - origin.left + root.scrollLeft, y: rect.top - origin.top + root.scrollTop, w: rect.width, h: rect.height }
}

function locate(root: HTMLElement | null, previous: Map<string, DOMRect>, target: number | 'gigArea', owner: PlayerId | null): Box | null {
  if (root === null) return null
  const selector = target === 'gigArea'
    ? `[data-testid="gig-area"][data-player="${owner === null ? 0 : 1 - owner}"]`
    : `[data-uid="${target}"]`
  const el = root.querySelector(selector)
  if (el !== null) return boxOf(root, el.getBoundingClientRect())
  const old = target === 'gigArea' ? undefined : previous.get(String(target))
  return old === undefined ? null : boxOf(root, old)
}

function center(box: Box): [number, number] {
  return [box.x + box.w / 2, box.y + box.h / 2]
}

export interface BeatLayerProps {
  db: CardDb
  beat: Beat | null
  human: PlayerId
  root: RefObject<HTMLElement | null>
  previousRects: RefObject<Map<string, DOMRect>>
  useOfficialImages: boolean
}

export function BeatLayer({ db, beat, human, root, previousRects, useOfficialImages }: BeatLayerProps): ReactElement | null {
  const [boxes, setBoxes] = useState<{ source: Box | null; targets: Box[]; pile: Box | null }>({ source: null, targets: [], pile: null })

  useLayoutEffect(() => {
    if (beat === null) return
    const el = root.current
    const previous = previousRects.current ?? new Map()
    const source = beat.sourceUid === null ? null : locate(el, previous, beat.sourceUid, beat.player)
    const targets = beat.targets.map((t) => locate(el, previous, t, beat.player)).filter((b): b is Box => b !== null)
    // 'cardRemoved' deliberately excluded: a removed card leaves the game
    // entirely (docs/rulings.md §31), it never lands in the trash, so it
    // gets no ghost at all rather than a misleading flight to that pile.
    const exit = beat.events.find((e) => e.type === 'cardTrashed' || e.type === 'cardBottomDecked')
    let pile: Box | null = null
    if (exit !== undefined && el !== null && 'uid' in exit) {
      const owner = beat.board.cards[exit.uid]?.owner
      const kind = exit.type === 'cardBottomDecked' ? 'deck' : 'trash'
      const pileEl = el.querySelector(`[data-player="${owner}"] [data-pile="${kind}"]`)
      if (pileEl !== null) pile = boxOf(el, pileEl.getBoundingClientRect())
    }
    setBoxes({ source, targets, pile })
  }, [beat, root, previousRects])

  if (beat === null || beat.kind === 'minor' || beat.kind === 'silent') return null
  const side = beat.player === human ? 'you' : 'rival'
  const event = beat.events[beat.events.length - 1]
  const first = beat.events[0]

  const lines = (beat.kind === 'effect' || beat.kind === 'attack' || beat.kind === 'block') && boxes.source !== null
    ? boxes.targets.map((target, i) => {
        const [x1, y1] = center(boxes.source!)
        const [x2, y2] = center(target)
        return <line key={i} className="beat-layer__line" x1={x1} y1={y1} x2={x2} y2={y2} />
      })
    : []

  return (
    <div className={`beat-layer beat-layer--${beat.kind} beat-layer--${side}`} data-testid="beat-layer" aria-live="polite">
      {lines.length > 0 && <svg className="beat-layer__lines" aria-hidden="true">{lines}</svg>}
      {boxes.targets.map((target, i) => (
        <div key={i} className="beat-layer__target" style={{ left: target.x, top: target.y, width: target.w, height: target.h }} />
      ))}

      {beat.kind === 'spotlight' && (first.type === 'cardPlayed' || first.type === 'legendCalled') && (() => {
        const instance = beat.board.cards[first.uid]
        const faceDown = instance === undefined || !instance.faceUp
        const def = faceDown ? FACE_DOWN_DEF : db[instance.defId]
        const verb = first.type === 'cardPlayed' ? 'plays' : 'calls'
        return (
          <>
            <div className="beat-layer__veil" />
            <p className="beat-layer__caption" data-testid="beat-caption">{side === 'you' ? 'You' : 'Rival'} {verb}</p>
            <div className="beat-layer__spotlight" data-testid="beat-spotlight">
              <CardFrame def={def} size="zoom" faceDown={faceDown} owner={side} useOfficialImages={useOfficialImages} />
            </div>
          </>
        )
      })()}

      {beat.kind === 'effect' && event.type === 'effectResolved' && (
        <div
          className="beat-layer__callout"
          data-testid="beat-callout"
          style={boxes.source === null ? undefined : { left: boxes.source.x + boxes.source.w + 8, top: boxes.source.y }}
        >
          <strong>{
            beat.board.cards[event.sourceUid]?.faceUp === false
              ? 'A face-down card'
              : db[beat.board.cards[event.sourceUid]?.defId ?? '']?.name ?? 'Effect'
          }</strong>
          <span>{describeEffect(db, beat.board, event)}</span>
        </div>
      )}

      {beat.kind === 'turnBanner' && (
        <div className="beat-layer__banner" data-testid="beat-banner">{side === 'you' ? 'YOUR TURN' : "RIVAL'S TURN"}</div>
      )}

      {(beat.kind === 'attack' || beat.kind === 'block' || beat.kind === 'defeat' || beat.kind === 'steal' || beat.kind === 'dieRoll') && (
        <p className="beat-layer__caption beat-layer__caption--small" data-testid="beat-caption">
          {describeEvent(db, beat.board, first)}
        </p>
      )}

      {boxes.pile !== null && boxes.source !== null && (
        <div
          className="beat-layer__ghost"
          data-testid="beat-ghost"
          style={{
            left: boxes.source.x, top: boxes.source.y, width: boxes.source.w, height: boxes.source.h,
            '--ghost-x': `${boxes.pile.x - boxes.source.x}px`, '--ghost-y': `${boxes.pile.y - boxes.source.y}px`,
          } as CSSProperties}
        />
      )}
    </div>
  )
}
