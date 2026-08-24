// Showpiece motion (Task 8): derives the handful of transient animation
// flags the playmat's CSS keyframes key off — a lunge on an attacker, a
// tumble on a just-rolled Gig die, a flying "ghost" die for a Gig steal, and
// a glitch on the whole playmat when the game ends — from the same
// `state.events` log every other view already reads.
//
// WHY A HOOK, NOT PROPS COMPUTED INLINE. Each flag has to revert on its own
// clock (~600ms) independent of whatever render triggered it, which needs
// state and a timer — exactly the shape `useEffect` + `useState` exists for.
//
// WHY "newest event past `lastSeen`", NOT "the last event". `state.events`
// can grow by more than one entry between two renders (a single action can
// push several — e.g. an attack that both declares and immediately steals),
// so only the events strictly after the previously-seen length are new, and
// only the newest of each kind among THEM is shown (Step 3 of the brief).
//
// WHY `enabled` GATES EVERYTHING, INCLUDING THE ANIMATION-LESS BOOKKEEPING.
// `enabled` is false under `prefers-reduced-motion: reduce` and whenever
// `aiDelayMs === 0` (so the E2E suite, which always runs `?aiDelay=0`, never
// sees a mid-flight animation flag racing its own assertions). While
// disabled, `lastSeen` still tracks `events.length` so a later re-enable
// (there is none today, but the invariant should hold regardless) does not
// replay a backlog as one giant burst.
//
// UNDO SAFETY. `state.events` SHRINKS on undo (and on loading an earlier
// save) — the record it is derived from is shorter than the one this hook
// last saw. Growing again afterwards must be read as "new events past the
// now-smaller length", not "an events array of the previous length minus
// however-many": if `lastSeen` is not brought back down the moment a shrink
// is observed, the slice on the next growth would replay the entire tail as
// one burst of animations, none of which the player just caused. So a shrink
// resets `lastSeen` immediately, cancels any in-flight timer, and shows
// nothing — never treated as "new events" itself.

import { useEffect, useRef, useState } from 'react'
import type { DieSize, GameEvent, PlayerId } from '../engine/types'

export interface AnimationState {
  /** The attacking card's uid, while its lunge is playing. */
  lungeUid: number | null
  /** The Gig die a `dieRolled` event just landed on, while its tumble plays. */
  tumble: { player: PlayerId; size: DieSize } | null
  /** The Gig die a `gigStolen` event just moved, while its flight plays. */
  steal: { from: PlayerId; size: DieSize; value: number } | null
  /** The playmat's game-over glitch. */
  glitch: boolean
}

const NONE: AnimationState = { lungeUid: null, tumble: null, steal: null, glitch: false }

/** How long each triggered flag stays non-null before reverting. */
const ANIMATION_MS = 600

/** The four fields, each with its own independent revert clock. */
type Field = keyof AnimationState

export function useAnimations(events: readonly GameEvent[], enabled: boolean): AnimationState {
  const lastSeenRef = useRef(0)
  // ONE timer ref PER FIELD — not one shared timer/state-write for all four.
  // A batch that triggers, say, only `tumble` must not touch `lungeUid`'s own
  // still-running window: an earlier implementation wrote the *entire*
  // `AnimationState` object on every trigger, which nulled out every field
  // the current batch didn't itself set — cutting a still-playing lunge off
  // the instant an unrelated die-roll landed. Per-field timers plus a
  // per-field functional `setState` merge are what make the four fields
  // genuinely independent.
  const timerRefs = useRef<Record<Field, ReturnType<typeof setTimeout> | null>>({
    lungeUid: null,
    tumble: null,
    steal: null,
    glitch: null,
  })
  const [state, setState] = useState<AnimationState>(NONE)

  const clearTimer = (field: Field): void => {
    const timer = timerRefs.current[field]
    if (timer !== null) {
      clearTimeout(timer)
      timerRefs.current[field] = null
    }
  }

  const clearAllTimers = (): void => {
    clearTimer('lungeUid')
    clearTimer('tumble')
    clearTimer('steal')
    clearTimer('glitch')
  }

  /** Sets one field non-null (or `true`) now, reverting only THAT field
   *  ~600ms later — replacing whichever timer that same field already had,
   *  never touching the other three. */
  function trigger<K extends Field>(field: K, value: AnimationState[K], revertTo: AnimationState[K]): void {
    clearTimer(field)
    setState((prev) => ({ ...prev, [field]: value }))
    timerRefs.current[field] = setTimeout(() => {
      timerRefs.current[field] = null
      setState((prev) => ({ ...prev, [field]: revertTo }))
    }, ANIMATION_MS)
  }

  // Any pending timer must die with the component — a `setState` fired after
  // unmount is a React warning at best, a leak at worst.
  useEffect(() => {
    return () => clearAllTimers()
  }, [])

  useEffect(() => {
    if (!enabled) {
      lastSeenRef.current = events.length
      clearAllTimers()
      setState(NONE)
      return
    }

    const lastSeen = lastSeenRef.current

    if (events.length < lastSeen) {
      // Undo/replay shrank the log — reset the watermark and show nothing;
      // see the module comment above.
      lastSeenRef.current = events.length
      clearAllTimers()
      setState(NONE)
      return
    }

    if (events.length === lastSeen) return

    const newEvents = events.slice(lastSeen)
    lastSeenRef.current = events.length

    let lungeUid: AnimationState['lungeUid'] = null
    let tumble: AnimationState['tumble'] = null
    let steal: AnimationState['steal'] = null
    let glitch = false

    for (const event of newEvents) {
      switch (event.type) {
        case 'attackDeclared':
          lungeUid = event.attacker
          break
        case 'dieRolled':
          tumble = { player: event.player, size: event.size }
          break
        case 'gigStolen':
          steal = { from: event.from, size: event.die.size, value: event.die.value }
          break
        case 'gameEnded':
          glitch = true
          break
        default:
          break
      }
    }

    // Each field that this batch actually triggered gets its OWN ~600ms
    // window, independent of the other three — a batch that triggers none of
    // a field leaves that field exactly as it was (still counting down its
    // own earlier timer, or still null).
    if (lungeUid !== null) trigger('lungeUid', lungeUid, null)
    if (tumble !== null) trigger('tumble', tumble, null)
    if (steal !== null) trigger('steal', steal, null)
    if (glitch) trigger('glitch', true, false)
  }, [events, enabled])

  return state
}
