// FLIP card movement between presentation frames: remember where every
// [data-uid] element was, and when the frame changes, animate each moved
// element from its old spot to its new one. The CSS `translate` property is
// used, not `transform`, so hand-fan rotations and spent-card rotations
// compose instead of being overwritten mid-flight.
//
// Diff cues (spec §4): the same layout effect also pulses elements whose
// *value* changed between frames. Elements opt in with `data-pulse-id` (a
// stable id) and `data-pulse-key` (the value) — see Field.tsx's BoardCard
// root (`power-${uid}`) and ZonePanels.tsx's eddies zone (`eddies-${player}`).

import { useLayoutEffect, useRef, type RefObject } from 'react'

function measure(root: HTMLElement): Map<string, DOMRect> {
  const rects = new Map<string, DOMRect>()
  root.querySelectorAll<HTMLElement>('[data-uid]').forEach((el) => rects.set(el.dataset.uid!, el.getBoundingClientRect()))
  return rects
}

function pulseKeys(root: HTMLElement): Map<string, string> {
  const keys = new Map<string, string>()
  root.querySelectorAll<HTMLElement>('[data-pulse-id]').forEach((el) => keys.set(el.dataset.pulseId!, el.dataset.pulseKey ?? ''))
  return keys
}

export function useFlip(
  root: RefObject<HTMLElement | null>,
  frameKey: unknown,
  durationMs: number,
  enabled: boolean,
): RefObject<Map<string, DOMRect>> {
  const current = useRef(new Map<string, DOMRect>())
  const previous = useRef(new Map<string, DOMRect>())
  const lastKeys = useRef(new Map<string, string>())

  useLayoutEffect(() => {
    const element = root.current
    if (element === null) return
    const next = measure(element)
    previous.current = current.current
    current.current = next
    if (!enabled) { lastKeys.current = pulseKeys(element); return }
    const ms = Math.min(450, Math.max(180, durationMs * 0.4))
    element.querySelectorAll<HTMLElement>('[data-uid]').forEach((el) => {
      const before = previous.current.get(el.dataset.uid!)
      const after = next.get(el.dataset.uid!)
      if (before === undefined || after === undefined || typeof el.animate !== 'function') return
      const dx = before.left - after.left
      const dy = before.top - after.top
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return
      el.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }], { duration: ms, easing: 'cubic-bezier(.2,.7,.2,1)' })
    })

    const keys = pulseKeys(element)
    element.querySelectorAll<HTMLElement>('[data-pulse-id]').forEach((el) => {
      const before = lastKeys.current.get(el.dataset.pulseId!)
      if (before === undefined || before === el.dataset.pulseKey || typeof el.animate !== 'function') return
      el.animate([{ filter: 'brightness(1.8)', scale: '1.08' }, { filter: 'none', scale: '1' }], { duration: 420, easing: 'ease-out' })
    })
    lastKeys.current = keys
  }, [frameKey])

  return previous
}
