// FLIP card movement between presentation frames: remember where every card
// root (FLIP_SELECTOR) was, and when the frame changes, animate each moved
// element from its old spot to its new one. The CSS `translate` property is
// used, not `transform`, so hand-fan rotations and spent-card rotations
// compose instead of being overwritten mid-flight.
//
// Diff cues (spec §4): the same layout effect also pulses elements whose
// *value* changed between frames. Elements opt in with `data-pulse-id` (a
// stable id) and `data-pulse-key` (the value) — see Field.tsx's BoardCard
// root (`power-${uid}`) and ZonePanels.tsx's eddies zone (`eddies-${player}`).
//
// WHY THE RETURNED REF IS `current`, NOT `previous` (fix round 1). This hook
// is called directly inside PlayView, so the `useLayoutEffect` below belongs
// to PlayView's own fiber. `BeatLayer` is a CHILD of PlayView, and React
// fires child layout effects before parent ones within the same commit — so
// BeatLayer's own layout effect (reading the ref this hook returns) always
// runs BEFORE this hook's effect updates anything for the frame just
// committed. That means whatever this hook assigns during THIS frame's
// effect is invisible to BeatLayer until the *next* frame; what BeatLayer
// actually sees is whatever the ref held at the end of the *previous*
// frame's effect. `current.current` at that moment holds exactly the rects
// measured one frame ago — precisely "immediately before the frame now on
// screen" — which is what a child needs to locate a card that just left.
// Returning `previous` instead would be a further frame stale: by the time
// BeatLayer reads it, `previous.current` was last set to what `current`
// held two frames back.

import { useLayoutEffect, useRef, type RefObject } from 'react'

/**
 * The elements FLIP moves and measures: card roots only. A nested element
 * that happened to carry `data-uid` (a button inside a card, say) would
 * otherwise overwrite its card's rect (final review I3).
 */
export const FLIP_SELECTOR = '.board-card[data-uid], .eddie-card[data-uid]'

function measure(root: HTMLElement): Map<string, DOMRect> {
  const rects = new Map<string, DOMRect>()
  root.querySelectorAll<HTMLElement>(FLIP_SELECTOR).forEach((el) => rects.set(el.dataset.uid!, el.getBoundingClientRect()))
  return rects
}

function pulseKeys(root: HTMLElement): Map<string, string> {
  const keys = new Map<string, string>()
  root.querySelectorAll<HTMLElement>('[data-pulse-id]').forEach((el) => keys.set(el.dataset.pulseId!, el.dataset.pulseKey ?? ''))
  return keys
}

/**
 * Returns a ref holding the rects measured as of immediately before the
 * frame currently on screen — see the module doc comment above for why that
 * is `current`, not `previous`, from a child component's own layout effect.
 */
export function useFlip(
  root: RefObject<HTMLElement | null>,
  frameKey: unknown,
  durationMs: number,
  enabled: boolean,
): RefObject<Map<string, DOMRect>> {
  const current = useRef(new Map<string, DOMRect>())
  const previous = useRef(new Map<string, DOMRect>())
  const lastKeys = useRef(new Map<string, string>())
  const glides = useRef<Animation[]>([])

  useLayoutEffect(() => {
    const element = root.current
    if (element === null) return
    // A glide still in flight would be included in getBoundingClientRect, so
    // the new frame would measure (and later start from) a mid-air position
    // and overshoot. Settle every glide this hook started before measuring
    // (final review I2).
    glides.current.forEach((animation) => animation.cancel())
    glides.current = []
    const next = measure(element)
    previous.current = current.current
    current.current = next
    if (!enabled) { lastKeys.current = pulseKeys(element); return }
    const ms = Math.min(450, Math.max(180, durationMs * 0.4))
    element.querySelectorAll<HTMLElement>(FLIP_SELECTOR).forEach((el) => {
      const before = previous.current.get(el.dataset.uid!)
      const after = next.get(el.dataset.uid!)
      if (before === undefined || after === undefined || typeof el.animate !== 'function') return
      const dx = before.left - after.left
      const dy = before.top - after.top
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return
      glides.current.push(el.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }], { duration: ms, easing: 'cubic-bezier(.2,.7,.2,1)' }))
    })

    const keys = pulseKeys(element)
    element.querySelectorAll<HTMLElement>('[data-pulse-id]').forEach((el) => {
      const before = lastKeys.current.get(el.dataset.pulseId!)
      if (before === undefined || before === el.dataset.pulseKey || typeof el.animate !== 'function') return
      el.animate([{ filter: 'brightness(1.8)', scale: '1.08' }, { filter: 'none', scale: '1' }], { duration: 420, easing: 'ease-out' })
    })
    lastKeys.current = keys
  }, [frameKey])

  return current
}
