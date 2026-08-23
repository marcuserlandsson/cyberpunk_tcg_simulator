// A thin Web Worker wrapper over `runGames`, so the UI (Task 15) can run a
// large simulation off the main thread. Consumer side:
//
//   const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
//   worker.postMessage(opts satisfies SimOptions)
//   worker.onmessage = (e: MessageEvent<SimWorkerMessage>) => { ... }
//
// All the actual logic lives in runner.ts; this file just wires
// self.onmessage -> runGames -> self.postMessage so it stays trivial (and,
// per the Task 11 brief, close to untestable-in-node — Task 15 tests the UI
// side against a mock of this postMessage contract instead).
//
// ERROR HANDLING (Task 15 fix round 1). `runGames` can throw (a fuzz-style
// invariant violation, an unexpectedly-illegal deck slipping past the UI's
// own `isDeckPickable` check, etc.) — uncaught, that would just kill the
// worker silently, leaving the UI's progress bar spinning forever with no
// way to tell a hang from a crash. The whole run is wrapped in try/catch so
// a thrown error is instead reported to the main thread as an explicit
// `{type:'error'}` message the UI can render and recover from.

import { loadCardDb } from '../engine/cardDb'
import { runGames } from './runner'
import type { SimOptions, SimResult } from './runner'

export type SimWorkerMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'result'; result: SimResult }
  | { type: 'error'; message: string }

// `declare const self: Worker` shadows the ambient DOM `self` (this project's
// tsconfig includes the "DOM" lib project-wide, not "webworker" — adding a
// `/// <reference lib="webworker" />` here would conflict with it) with the
// same Worker-side interface (`postMessage`/`onmessage`) a dedicated worker's
// global scope actually satisfies, without pulling in a second, conflicting
// set of global declarations.
declare const self: Worker

self.onmessage = (event: MessageEvent): void => {
  const opts = event.data as SimOptions
  try {
    const db = loadCardDb()
    const result = runGames(db, opts, (done, total) => {
      self.postMessage({ type: 'progress', done, total } satisfies SimWorkerMessage)
    })
    self.postMessage({ type: 'result', result } satisfies SimWorkerMessage)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    self.postMessage({ type: 'error', message } satisfies SimWorkerMessage)
  }
}
