// Frame recording for paced presentation (docs/superpowers/specs/
// 2026-09-28-effect-pacing-design.md §1).
//
// `applyActionTimeline` is `applyAction` plus one board snapshot per emitted
// event, so the UI can replay a trigger chain step by step. Only the UI
// calls it. AI search, workers and sims keep calling `applyAction` and pay
// nothing.
//
// SCRATCH DRAFTS. Resolution sometimes emits on a copy of the draft that is
// later thrown away. So frames are kept only when their event object is the
// one at that index in the result (event objects are shared by reference
// across `draftState` copies). When a later draft re-emits at the same
// index, the last frame wins.

import { currentEventRecorder, setEventRecorder } from './emit'
import { draftState } from './game'
import { applyAction } from './reduce'
import type { Action, CardDb, GameEvent, GameState } from './types'

export interface Frame {
  eventIndex: number
  event: GameEvent
  board: GameState
}

export interface Timeline {
  state: GameState
  frames: Frame[]
}

export function recordFrames(run: () => GameState): Timeline {
  if (currentEventRecorder() !== null) throw new Error('recordFrames: already recording')
  const raw: Frame[] = []
  setEventRecorder((draft, event) => {
    raw.push({ eventIndex: draft.events.length - 1, event, board: draftState(draft) })
  })
  let state: GameState
  try {
    state = run()
  } finally {
    setEventRecorder(null)
  }
  const result = state.pendingIntercept?.view ?? state
  const byIndex = new Map<number, Frame>()
  for (const frame of raw) {
    if (result.events[frame.eventIndex] === frame.event) byIndex.set(frame.eventIndex, frame)
  }
  const frames = [...byIndex.values()].sort((a, b) => a.eventIndex - b.eventIndex)
  return { state, frames }
}

export function applyActionTimeline(db: CardDb, state: GameState, action: Action): Timeline {
  return recordFrames(() => applyAction(db, state, action))
}
