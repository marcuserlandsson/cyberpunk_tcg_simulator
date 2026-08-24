// @vitest-environment jsdom
// Tests for src/ui/useAnimations.ts — the showpiece-motion hook (Task 8).
//
// Fake timers throughout: every flag reverts on its own ~600ms `setTimeout`,
// and the whole point of these tests is pinning down exactly when that
// timer fires relative to new events landing.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useAnimations } from '../../src/ui/useAnimations'
import type { GameEvent } from '../../src/engine/types'

afterEach(() => {
  vi.useRealTimers()
})

describe('useAnimations', () => {
  it('exposes a lunge for 600ms after attackDeclared, none when disabled', () => {
    vi.useFakeTimers()
    const events: GameEvent[] = []
    const { result, rerender } = renderHook(
      ({ ev, on }: { ev: GameEvent[]; on: boolean }) => useAnimations(ev, on),
      { initialProps: { ev: events, on: true } }
    )
    expect(result.current.lungeUid).toBeNull()

    const next = [...events, { type: 'attackDeclared', attacker: 7, target: 'gigArea' } as GameEvent]
    rerender({ ev: next, on: true })
    expect(result.current.lungeUid).toBe(7)

    act(() => vi.advanceTimersByTime(700))
    expect(result.current.lungeUid).toBeNull()

    rerender({
      ev: [...next, { type: 'attackDeclared', attacker: 9, target: 'gigArea' } as GameEvent],
      on: false,
    })
    expect(result.current.lungeUid).toBeNull()
  })

  it('returns the all-null state always when disabled from the start', () => {
    vi.useFakeTimers()
    const events: GameEvent[] = []
    const { result, rerender } = renderHook(
      ({ ev }: { ev: GameEvent[] }) => useAnimations(ev, false),
      { initialProps: { ev: events } }
    )
    expect(result.current).toEqual({ lungeUid: null, tumble: null, steal: null, glitch: false })

    rerender({
      ev: [{ type: 'attackDeclared', attacker: 3, target: 'gigArea' }],
    })
    expect(result.current).toEqual({ lungeUid: null, tumble: null, steal: null, glitch: false })
  })

  it('shows the newest of each kind among a batch of new events', () => {
    vi.useFakeTimers()
    const events: GameEvent[] = []
    const { result, rerender } = renderHook(
      ({ ev }: { ev: GameEvent[] }) => useAnimations(ev, true),
      { initialProps: { ev: events } }
    )

    const batch: GameEvent[] = [
      { type: 'attackDeclared', attacker: 1, target: 'gigArea' },
      { type: 'attackDeclared', attacker: 2, target: 5 },
      { type: 'dieRolled', player: 0, size: 6, value: 4 },
      { type: 'gigStolen', from: 1, die: { size: 8, value: 3 } },
    ]
    rerender({ ev: batch })

    expect(result.current.lungeUid).toBe(2)
    expect(result.current.tumble).toEqual({ player: 0, size: 6 })
    expect(result.current.steal).toEqual({ from: 1, size: 8, value: 3 })
    expect(result.current.glitch).toBe(false)
  })

  it('sets glitch on gameEnded and reverts it after 600ms', () => {
    vi.useFakeTimers()
    const events: GameEvent[] = []
    const { result, rerender } = renderHook(
      ({ ev }: { ev: GameEvent[] }) => useAnimations(ev, true),
      { initialProps: { ev: events } }
    )

    rerender({ ev: [{ type: 'gameEnded', winner: 0, reason: 'sevenGigs' }] })
    expect(result.current.glitch).toBe(true)

    act(() => vi.advanceTimersByTime(700))
    expect(result.current.glitch).toBe(false)
  })

  it('is robust to the events array shrinking (undo): resets without animating, and a later growth only replays what is actually new', () => {
    vi.useFakeTimers()
    const attack7: GameEvent = { type: 'attackDeclared', attacker: 7, target: 'gigArea' }
    const attack9: GameEvent = { type: 'attackDeclared', attacker: 9, target: 'gigArea' }

    const { result, rerender } = renderHook(
      ({ ev }: { ev: GameEvent[] }) => useAnimations(ev, true),
      { initialProps: { ev: [attack7] } }
    )
    expect(result.current.lungeUid).toBe(7)

    // Undo: the record — and therefore state.events — shrinks back to [].
    // No burst, no lingering animation from the undone attack.
    rerender({ ev: [] })
    expect(result.current.lungeUid).toBeNull()

    // Advancing time after the shrink must not do anything surprising: the
    // in-flight timer from the pre-undo trigger was cancelled, so this must
    // not, say, throw or resurrect a stale state.
    act(() => vi.advanceTimersByTime(700))
    expect(result.current.lungeUid).toBeNull()

    // A fresh action replaces the undone one. Only the truly new event
    // (attacker 9) should ever animate — never a replay of attacker 7.
    rerender({ ev: [attack9] })
    expect(result.current.lungeUid).toBe(9)
  })

  it('clears its timer on unmount without throwing', () => {
    vi.useFakeTimers()
    const { result, rerender, unmount } = renderHook(
      ({ ev }: { ev: GameEvent[] }) => useAnimations(ev, true),
      { initialProps: { ev: [] as GameEvent[] } }
    )
    rerender({ ev: [{ type: 'attackDeclared', attacker: 1, target: 'gigArea' }] })
    expect(result.current.lungeUid).toBe(1)
    expect(() => unmount()).not.toThrow()
    expect(() => act(() => vi.advanceTimersByTime(700))).not.toThrow()
  })
})
