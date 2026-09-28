// The single choke point every engine event goes through.
//
// `applyActionTimeline` (timeline.ts) installs a recorder here to snapshot the
// board after each event. That is how the UI can play one action back beat by
// beat. The recorder is module state, not a GameState field, so it never
// reaches saves, `draftState` copies or AI search. With no recorder
// installed, `emit` is exactly the `events.push` it replaced.

import type { GameEvent, GameState } from './types'

export type EventRecorder = (draft: GameState, event: GameEvent) => void

let recorder: EventRecorder | null = null

/** Installs `next` (or clears with null) and returns what was installed before. */
export function setEventRecorder(next: EventRecorder | null): EventRecorder | null {
  const previous = recorder
  recorder = next
  return previous
}

export function currentEventRecorder(): EventRecorder | null {
  return recorder
}

export function emit(draft: GameState, event: GameEvent): void {
  draft.events.push(event)
  recorder?.(draft, event)
}
