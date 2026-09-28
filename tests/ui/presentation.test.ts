// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useCallback, useState } from 'react'
import { usePresentation } from '../../src/ui/presentation/usePresentation'
import { loadSpeed, saveSpeed, type Speed } from '../../src/ui/presentation/speed'
import type { Beat } from '../../src/ui/presentation/beats'
import { startedGame } from '../engine/gameHelpers'

const board = startedGame()
function beat(id: number, baseMs = 1000): Beat {
  return { id, kind: 'effect', events: [], firstIndex: id, lastIndex: id, board, baseMs,
    player: 1, sourceUid: null, targets: [], step: 1, of: 1 }
}

function harness(initial: Beat[], speed: Speed = 'normal', awaitingHuman = false) {
  return renderHook(({ speed, awaitingHuman }) => {
    const [beats, setBeats] = useState(initial)
    const ackBeat = useCallback((id: number) => setBeats((b) => (b[0]?.id === id ? b.slice(1) : b)), [])
    const clearBeats = useCallback(() => setBeats([]), [])
    const api = usePresentation({ beats, ackBeat, clearBeats, awaitingHuman, speed })
    return { beats, api, setBeats }
  }, { initialProps: { speed, awaitingHuman } })
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('usePresentation', () => {
  it('advances one beat per scaled duration', () => {
    const h = harness([beat(1), beat(2)], 'fast')
    expect(h.result.current.api.beat?.id).toBe(1)
    expect(h.result.current.api.durationMs).toBe(500)
    act(() => { vi.advanceTimersByTime(499) })
    expect(h.result.current.api.beat?.id).toBe(1)
    act(() => { vi.advanceTimersByTime(1) })
    expect(h.result.current.api.beat?.id).toBe(2)
  })

  it('acknowledges zero-length beats immediately', () => {
    const h = harness([beat(1, 0), beat(2)])
    expect(h.result.current.api.beat?.id).toBe(2)
  })

  it('skipBeat finishes the current beat now', () => {
    const h = harness([beat(1), beat(2)])
    act(() => h.result.current.api.skipBeat())
    expect(h.result.current.api.beat?.id).toBe(2)
  })

  it('pause holds the clock and resume continues with the remaining time', () => {
    const h = harness([beat(1), beat(2)])
    act(() => { vi.advanceTimersByTime(400) })
    act(() => h.result.current.api.togglePause())
    act(() => { vi.advanceTimersByTime(5000) })
    expect(h.result.current.api.beat?.id).toBe(1)
    act(() => h.result.current.api.togglePause())
    act(() => { vi.advanceTimersByTime(599) })
    expect(h.result.current.api.beat?.id).toBe(1)
    act(() => { vi.advanceTimersByTime(1) })
    expect(h.result.current.api.beat?.id).toBe(2)
  })

  it('pauses while the tab is hidden', () => {
    const h = harness([beat(1), beat(2)])
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    act(() => { vi.advanceTimersByTime(5000) })
    expect(h.result.current.api.beat?.id).toBe(1)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    act(() => { vi.advanceTimersByTime(1000) })
    expect(h.result.current.api.beat?.id).toBe(2)
  })

  it('does not reuse a stale beat\'s remaining time for an unrelated beat with the same id', () => {
    const h = harness([beat(5)])
    act(() => { vi.advanceTimersByTime(400) })
    act(() => h.result.current.setBeats([]))
    act(() => h.result.current.setBeats([beat(5)]))
    act(() => { vi.advanceTimersByTime(999) })
    expect(h.result.current.api.beat?.id).toBe(5)
    act(() => { vi.advanceTimersByTime(1) })
    expect(h.result.current.beats).toEqual([])
  })

  it('skipTurn drains the queue and keeps draining new beats until the human is up', () => {
    const h = harness([beat(1), beat(2)])
    act(() => h.result.current.api.skipTurn())
    expect(h.result.current.beats).toEqual([])
    expect(h.result.current.api.fastForward).toBe(true)
    act(() => h.result.current.setBeats([beat(3)]))
    expect(h.result.current.beats).toEqual([])
    h.rerender({ speed: 'normal', awaitingHuman: true })
    expect(h.result.current.api.fastForward).toBe(false)
  })

  it('instant drains a queued backlog', () => {
    const h = harness([beat(1), beat(2), beat(3)])
    h.rerender({ speed: 'instant', awaitingHuman: false })
    expect(h.result.current.beats).toEqual([])
  })

  it('Space skips, Shift+Space skips the turn, P pauses', () => {
    const h = harness([beat(1), beat(2), beat(3)])
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' })) })
    expect(h.result.current.api.beat?.id).toBe(2)
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' })) })
    expect(h.result.current.api.paused).toBe(true)
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', shiftKey: true })) })
    expect(h.result.current.beats).toEqual([])
  })

  it('ignores keys typed into form fields', () => {
    const h = harness([beat(1), beat(2)])
    const input = document.createElement('input')
    document.body.appendChild(input)
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })) })
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true })) })
    expect(h.result.current.api.beat?.id).toBe(1)
    expect(h.result.current.api.paused).toBe(false)
    input.remove()
  })
})

describe('speed storage', () => {
  it('round-trips and defaults to normal', () => {
    localStorage.removeItem('ctcg.pacingSpeed')
    expect(loadSpeed()).toBe('normal')
    saveSpeed('fast')
    expect(loadSpeed()).toBe('fast')
    localStorage.setItem('ctcg.pacingSpeed', 'bogus')
    expect(loadSpeed()).toBe('normal')
  })
})
