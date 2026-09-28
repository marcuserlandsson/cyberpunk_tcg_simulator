// The clock that plays queued beats (docs/superpowers/specs/
// 2026-09-28-effect-pacing-design.md §3). It owns time only: the queue
// lives in useGame, and this hook acknowledges beats by id when their time
// is up or the player skips.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Beat } from './beats'
import { SPEED_FACTOR, type Speed } from './speed'

export interface PresentationInput {
  beats: Beat[]
  ackBeat: (id: number) => void
  clearBeats: () => void
  /** The human has a decision (or the game is over): ends a skip-turn. */
  awaitingHuman: boolean
  speed: Speed
}

export interface PresentationApi {
  beat: Beat | null
  /** The current beat's scaled duration: drives `--beat-ms`. */
  durationMs: number
  paused: boolean
  fastForward: boolean
  skipBeat: () => void
  skipTurn: () => void
  togglePause: () => void
}

function typingInto(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

export function usePresentation({ beats, ackBeat, clearBeats, awaitingHuman, speed }: PresentationInput): PresentationApi {
  const beat = beats[0] ?? null
  const durationMs = beat === null ? 0 : Math.round(beat.baseMs * SPEED_FACTOR[speed])
  const [paused, setPaused] = useState(false)
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.visibilityState === 'hidden')
  const [fastForward, setFastForward] = useState(false)
  const remaining = useRef<{ id: number; ms: number } | null>(null)

  useEffect(() => {
    const onVisibility = () => setHidden(document.visibilityState === 'hidden')
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // Instant speed and skip-turn both drain whatever is queued.
  useEffect(() => {
    if (beats.length > 0 && (speed === 'instant' || fastForward)) clearBeats()
  }, [beats, speed, fastForward, clearBeats])

  useEffect(() => {
    if (fastForward && awaitingHuman && beats.length === 0) setFastForward(false)
  }, [fastForward, awaitingHuman, beats.length])

  useEffect(() => {
    if (beat === null || speed === 'instant' || fastForward) return
    if (durationMs === 0) { ackBeat(beat.id); return }
    if (remaining.current?.id !== beat.id) remaining.current = { id: beat.id, ms: durationMs }
    if (paused || hidden) return
    const startedAt = Date.now()
    const timer = setTimeout(() => { remaining.current = null; ackBeat(beat.id) }, remaining.current.ms)
    return () => {
      clearTimeout(timer)
      if (remaining.current?.id === beat.id)
        remaining.current = { id: beat.id, ms: Math.max(0, remaining.current.ms - (Date.now() - startedAt)) }
    }
  }, [beat, durationMs, paused, hidden, speed, fastForward, ackBeat])

  const skipBeat = useCallback(() => { if (beat !== null) ackBeat(beat.id) }, [beat, ackBeat])
  const skipTurn = useCallback(() => { setFastForward(true); clearBeats() }, [clearBeats])
  const togglePause = useCallback(() => setPaused((value) => !value), [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (typingInto(event.target)) return
      if (event.key === ' ' && beat !== null) {
        event.preventDefault()
        if (event.shiftKey) skipTurn()
        else skipBeat()
      } else if (event.key === 'p' || event.key === 'P') {
        togglePause()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [beat, skipBeat, skipTurn, togglePause])

  return { beat, durationMs, paused, fastForward, skipBeat, skipTurn, togglePause }
}
