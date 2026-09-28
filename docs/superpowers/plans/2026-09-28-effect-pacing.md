# Effect Pacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Present every AI action, and the consequences of every human action, as a paced sequence of visual beats (spotlight, effect callout, attack line, defeat, and so on) on the playmat, with speed, skip, skip-turn and pause controls.

**Architecture:** The engine gets one `emit()` choke point for events, plus an opt-in recorder. `applyActionTimeline` returns the new state and one board snapshot ("frame") per event. The UI groups frames into beats (`buildBeats`). `useGame` queues beats and holds the AI until the queue drains. `usePresentation` runs the clock, and `PlayView` renders the current beat's board with a `BeatLayer` overlay and FLIP card movement.

**Tech Stack:** TypeScript (strict), React 19 hooks, Vitest + Testing Library (jsdom), Playwright, plain CSS plus the Web Animations API (no animation library).

**Spec:** `docs/superpowers/specs/2026-09-28-effect-pacing-design.md`

## Global Constraints

- The engine (`src/engine`, `src/cards`) stays free of React and UI imports (`tests/engine/purity.test.ts` enforces this).
- `applyAction` keeps its signature and behaviour. AI search, `src/ai/worker.ts` and `src/sim` keep calling it and never record frames.
- The recorder is never stored on `GameState`. Frames are never written to the game record or save files.
- `?aiDelay=0` (`aiDelayMs === 0`) and `prefers-reduced-motion: reduce` force the Instant speed, which behaves exactly like today.
- `useGame`'s new `pacing` option defaults to `false`, so every existing hook test is unaffected.
- `data-awaiting` is `presenting` during playback. Existing E2E specs wait on `/^(human|over)$/` and keep working.
- No animation library. Use `element.animate` (guard `typeof el.animate === 'function'`, because jsdom lacks it) and CSS keyframes in `src/ui/styles/motion.css`, inside the existing `@media (prefers-reduced-motion: no-preference)` block.
- Colors: `--you` for human beats, `--rival` for rival beats, `--act` for targets. Reuse `tools.css` / `chrome.css` vocabulary (`.check-list`, `.check-chip`, `.btn--ghost`, `.chip`). Nothing may be stacked above the playmat.
- Beat base times in ms: turnBanner 900, spotlight 1400, effect 1100, attack 900, block 700, defeat 700, steal 900, dieRoll 700, minor 350, silent 0, gameOver 600. Speed factors: slow 1.5, normal 1, fast 0.5, instant 0.
- Code style: two-space indent, single quotes, no semicolons, strict TS (see `AGENTS.md`).
- Browser verification: any ad-hoc dev server must set `CTCG_COLLECTION_FILE=test-results/e2e-collection.json`, otherwise it writes and auto-commits the real `data/collection.json`. Never kill port 5173. Run E2E from the main checkout, not a worktree (worktrees lack card art).

## Review Focus

1. **Answering an intercept mid-playback.** The action replays from scratch after the answer. Beats already shown must not replay. This is covered in Task 5 by the "does not replay presented beats after an intercept answer" test.
2. **Undo or load while beats are queued.** The queue must clear and the board must show the true state immediately, with the AI not stuck holding. This is covered in Task 5 by the "undo clears the queue" test.
3. **Typing in the save-name box during playback.** Space and P must not skip or pause while an input has focus. This is covered in Task 6 by the "ignores keys typed into form fields" test.
4. **Switching speed to Instant while beats are queued.** The queue must drain at once rather than finish slowly. This is covered in Task 6 by the "instant drains a queued backlog" test.
5. **The game ending mid-queue.** The remaining beats play, then the game-over overlay appears, and `data-awaiting` becomes `over` only after the queue drains. This is covered in Task 7 by the "data-awaiting reports presenting while beats are queued" test, together with Task 5's gating.

---

## File Structure

**Engine**
- Create `src/engine/emit.ts`: `emit(draft, event)` and the recorder slot (`setEventRecorder`). Imports types only.
- Create `src/engine/timeline.ts`: `recordFrames`, `applyActionTimeline`, and the `Frame` and `Timeline` types.
- Modify every file that pushes events: `src/cards/effects.ts`, `src/cards/scripted/index.ts`, `src/engine/combat.ts`, `reduce.ts`, `game.ts`, `stealing.ts`, `knowledge.ts`, `choices.ts`.
- Modify `src/engine/types.ts`: add `targets?: number[]` to `effectResolved`.

**UI: presentation** (new folder `src/ui/presentation/`)
- `beats.ts`: `Beat`, `BeatKind`, `BEAT_MS`, `buildBeats`.
- `speed.ts`: `Speed`, `SPEED_FACTOR`, `loadSpeed`, `saveSpeed`.
- `usePresentation.ts`: the clock, controls and keyboard handling.
- `beatAnimations.ts`: `AnimationState` and `beatAnimations(beat)`. This replaces `useAnimations`.
- `useFlip.ts`: FLIP movement of `[data-uid]` elements between frames.
- `BeatLayer.tsx`: the spotlight, callout, target lines, banner and exit ghosts.
- `PacingControls.tsx`: the speed, pause and skip-turn controls in the rail.

**UI: modified**
- `src/ui/useGame.ts`: session state, the beat queue and AI hold.
- `src/ui/PlayView.tsx`: wiring.
- `src/ui/LogPanel.tsx`: highlighting of the current beat's lines.
- `src/ui/StreetStrip.tsx`: dice keyed by `die.id`, and `data-die-id`.
- `src/ui/HandStrip.tsx`, `src/ui/ZonePanels.tsx`: `data-uid` on backs and eddies, `data-pile` on piles, and `FACE_DOWN_DEF` exported.
- `src/ui/styles/motion.css`, `src/ui/styles/board.css`: beat styles.

**Delete**
- `src/ui/useAnimations.ts`
- `tests/ui/useanimations.test.ts`

**Tests (new)**
- `tests/engine/emit.test.ts`
- `tests/engine/timeline.test.ts`
- `tests/ui/beats.test.ts`
- `tests/ui/presentation.test.ts`
- `tests/ui/beatlayer.test.tsx`
- `e2e/pacing.spec.ts`

---

### Task 1: The `emit` choke point

**Files:**
- Create: `src/engine/emit.ts`
- Modify: every `draft.events.push(` / `state.events.push(` site in `src/engine/*.ts` and `src/cards/**/*.ts` (50 sites; find them with `grep -rn "events.push(" src/engine src/cards`)
- Test: `tests/engine/emit.test.ts`

**Interfaces:**
- Produces:
  - `emit(draft: GameState, event: GameEvent): void`
  - `type EventRecorder = (draft: GameState, event: GameEvent) => void`
  - `setEventRecorder(recorder: EventRecorder | null): EventRecorder | null` (returns the previous recorder)
  - `currentEventRecorder(): EventRecorder | null`

- [ ] **Step 1: Write the failing test**

```ts
// tests/engine/emit.test.ts
// Every engine event goes through `emit`, the one place a recorder can see
// it. A stray `events.push` would silently drop a beat from the UI's
// timeline, so this test also guards the source tree against new ones.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { emit, setEventRecorder } from '../../src/engine/emit'
import { freshGame } from './gameHelpers'
import type { GameEvent, GameState } from '../../src/engine/types'

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? sourceFiles(full) : /\.ts$/.test(entry.name) ? [full] : []
  })
}

describe('emit', () => {
  it('appends the event to the draft', () => {
    const state = freshGame()
    const before = state.events.length
    emit(state, { type: 'turnEnded', player: 0 })
    expect(state.events).toHaveLength(before + 1)
    expect(state.events.at(-1)).toEqual({ type: 'turnEnded', player: 0 })
  })

  it('hands every event to the active recorder after appending it', () => {
    const state = freshGame()
    const seen: [number, GameEvent][] = []
    const previous = setEventRecorder((draft: GameState, event) => seen.push([draft.events.length, event]))
    try {
      emit(state, { type: 'turnEnded', player: 1 })
    } finally {
      setEventRecorder(previous)
    }
    expect(seen).toEqual([[state.events.length, { type: 'turnEnded', player: 1 }]])
  })

  it('is the only place under src/engine and src/cards that pushes events', () => {
    const root = path.resolve(__dirname, '..', '..')
    const offenders = [...sourceFiles(path.join(root, 'src/engine')), ...sourceFiles(path.join(root, 'src/cards'))]
      .filter((file) => !file.endsWith(`${path.sep}emit.ts`))
      .filter((file) => /\.events\.push\(/.test(fs.readFileSync(file, 'utf-8')))
    expect(offenders).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/engine/emit.test.ts`
Expected: FAIL. The import of `../../src/engine/emit` cannot be resolved.

- [ ] **Step 3: Create `src/engine/emit.ts`**

```ts
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
```

- [ ] **Step 4: Replace every push site**

For each hit of `grep -rn "events.push(" src/engine src/cards` (other than `emit.ts`), rewrite `X.events.push(EVENT)` as `emit(X, EVENT)`, and add `import { emit } from '<relative>/emit'` to that file:
- From `src/cards/*.ts` the import path is `'../engine/emit'`.
- From `src/cards/scripted/index.ts` it is `'../../engine/emit'`.
- From `src/engine/*.ts` it is `'./emit'`.

Keep the event literal byte-for-byte identical. For example, in `src/cards/effects.ts`:

```ts
function note(draft: GameState, sourceUid: number, description: string): void {
  emit(draft, { type: 'effectResolved', sourceUid, description })
}
```

and in `src/engine/combat.ts`:

```ts
  emit(draft, { type: 'unitDefeated', uid })
  leaveField(draft, db, uid, 'trash')
```

If a site pushes several events in one call (`events.push(a, b)`), split it into consecutive `emit` calls in the same order.

Also look for events added without `push`: `grep -rnE "events = \[|events: \[\.\.\.|events\.concat|events\.unshift|events\.splice" src/engine src/cards`. The `events: state.events.slice()` copy in `draftState` and the initial `events: []` / first-event literal in `newGame` are fine; they create or copy the array rather than appending to it. Any site that *appends* through another form must be rewritten to `emit` too. Otherwise Task 2's equivalence test will report a missing frame.

- [ ] **Step 5: Run the new test and the whole suite**

Run: `npx vitest run tests/engine/emit.test.ts`
Expected: PASS (3 tests).

Run: `npm test`
Expected: PASS, with the same test count as before plus 3. This is a pure refactor, so any failure means a site was rewritten incorrectly.

- [ ] **Step 6: Commit**

```bash
git add src/engine src/cards tests/engine/emit.test.ts
git commit -m "refactor(engine): route every event through emit()"
```

---

### Task 2: `applyActionTimeline` and frame recording

**Files:**
- Create: `src/engine/timeline.ts`
- Test: `tests/engine/timeline.test.ts`

**Interfaces:**
- Consumes: `setEventRecorder`, `currentEventRecorder`, `emit` (Task 1); `draftState` from `src/engine/game.ts`; `applyAction` from `src/engine/reduce.ts`.
- Produces:
  - `interface Frame { eventIndex: number; event: GameEvent; board: GameState }`
  - `interface Timeline { state: GameState; frames: Frame[] }`
  - `recordFrames(run: () => GameState): Timeline`
  - `applyActionTimeline(db: CardDb, state: GameState, action: Action): Timeline`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/engine/timeline.test.ts
// The recorder behind paced presentation. The core contract is equivalence:
// recording must never change what the engine computes. The fuzz block below
// replays random games through both entry points and demands identical
// states, plus exactly one frame per new event.
import { describe, expect, it } from 'vitest'
import { applyAction } from '../../src/engine/reduce'
import { applyActionTimeline, recordFrames } from '../../src/engine/timeline'
import { emit } from '../../src/engine/emit'
import { draftState, newGame } from '../../src/engine/game'
import { legalActions } from '../../src/engine/legal'
import { createRandomAgent } from '../../src/ai/random'
import { db, decks, startedGame } from './gameHelpers'
import type { Action, GameState } from '../../src/engine/types'

/** Plays a random game, calling `visit` with the state before each action. */
function eachStep(seed: number, visit: (before: GameState, action: Action) => GameState, cap = 300): void {
  let state = newGame(db, { decks, seed })
  const agent = createRandomAgent(seed * 31 + 7)
  for (let i = 0; i < cap && state.phase !== 'gameOver'; i++) {
    const actions = legalActions(db, state)
    if (actions.length === 0) break
    state = visit(state, agent.chooseAction(db, state, actions))
  }
}

describe('applyActionTimeline', () => {
  it('is equivalent to applyAction and records one frame per new event', () => {
    for (let seed = 1; seed <= 12; seed++) {
      eachStep(seed, (before, action) => {
        const plain = applyAction(db, before, action)
        const { state, frames } = applyActionTimeline(db, before, action)
        expect(state).toEqual(plain)
        const result = state.pendingIntercept?.view ?? state
        const fresh = result.events.length - before.events.length
        expect(frames).toHaveLength(Math.max(0, fresh))
        frames.forEach((frame, i) => {
          expect(frame.eventIndex).toBe(before.events.length + i)
          expect(frame.event).toBe(result.events[frame.eventIndex])
          expect(frame.board.events).toHaveLength(frame.eventIndex + 1)
        })
        return state
      })
    }
  })

  it('returns the frames up to the pause point when an intercept is required', () => {
    let found = false
    for (let seed = 1; seed <= 80 && !found; seed++) {
      eachStep(seed, (before, action) => {
        const timeline = applyActionTimeline(db, before, action)
        if (!found && timeline.state.phase === 'intercept' && before.phase !== 'intercept') {
          found = true
          const view = timeline.state.pendingIntercept!.view!
          expect(timeline.state.events).toHaveLength(before.events.length)
          expect(timeline.frames.length).toBe(view.events.length - before.events.length)
        }
        return timeline.state
      })
    }
    expect(found).toBe(true)
  })

  it('clears the recorder when the action is illegal', () => {
    const state = startedGame()
    expect(() => applyActionTimeline(db, state, { type: 'mulligan' })).toThrow()
    // A second timeline would throw "already recording" if the first leaked.
    const action = legalActions(db, state)[0]
    expect(() => applyActionTimeline(db, state, action)).not.toThrow()
  })

  it('refuses to nest', () => {
    const state = startedGame()
    expect(() => recordFrames(() => {
      applyActionTimeline(db, state, legalActions(db, state)[0])
      return state
    })).toThrow(/already recording/)
  })

  it('drops frames emitted on a scratch draft that never reaches the result', () => {
    const state = startedGame()
    const { frames } = recordFrames(() => {
      const scratch = draftState(state)
      emit(scratch, { type: 'turnEnded', player: 0 })
      return state
    })
    expect(frames).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/engine/timeline.test.ts`
Expected: FAIL. `../../src/engine/timeline` cannot be resolved.

- [ ] **Step 3: Implement `src/engine/timeline.ts`**

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/engine/timeline.test.ts`
Expected: PASS (5 tests).

The equivalence test demands exactly one frame per new event. If it fails because a frame is missing, some event was pushed outside `emit`; the guard from Task 1 should already make that impossible. If a frame's `board.events` length is wrong, the event was emitted on a draft whose history diverges; investigate before loosening anything.

- [ ] **Step 5: Run the purity test and the whole suite**

Run: `npx vitest run tests/engine/purity.test.ts && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/engine/timeline.ts tests/engine/timeline.test.ts
git commit -m "feat(engine): record per-event board frames with applyActionTimeline"
```

---

### Task 3: Effect targets and emit ordering

**Files:**
- Modify: `src/engine/types.ts` (the `effectResolved` member of `GameEvent`, around line 1032)
- Modify: `src/cards/effects.ts` (`note()` at line ~518 and its callers at lines ~579–1025)
- Modify: `src/ui/StreetStrip.tsx:102` and `:123` (dice keys)
- Test: `tests/engine/effects.test.ts` (append a new `describe` at the end; it reuses that file's local helpers `def`, `makeDb`, `scenario`, `mint`, `fire` and `onPlay`)

**Interfaces:**
- Consumes: `recordFrames` (Task 2).
- Produces: `GameEvent` `effectResolved` becomes `{ type: 'effectResolved'; sourceUid: number; description: string; targets?: number[] }`. Later tasks read `event.targets ?? []`.

- [ ] **Step 1: Write the failing tests** (append to `tests/engine/effects.test.ts`, adding `import { recordFrames } from '../../src/engine/timeline'` and `import { effectivePower } from '../../src/engine/query'` to the imports if they aren't there)

```ts
describe('presentation frames (effect pacing)', () => {
  const effectFrame = (frames: ReturnType<typeof recordFrames>['frames']) =>
    frames.find((f) => f.event.type === 'effectResolved')!

  it('buffPower notes its target after the power change', () => {
    const db = makeDb([
      def('pump', 'program', { effects: [onPlay({ kind: 'buffPower', amount: 2, target: 'friendlyUnit', duration: 'turn' })] }),
      def('grunt', 'unit', { power: 1 }),
    ])
    const s = scenario()
    const src = mint(s, 0, 'trash', 'pump')
    const unit = mint(s, 0, 'field', 'grunt')
    const { frames } = recordFrames(() => fire(db, s, src, [unit]))
    const frame = effectFrame(frames)
    expect(frame.event).toMatchObject({ targets: [unit] })
    expect(effectivePower(db, frame.board, unit)).toBe(3)
  })

  it('defeat notes while the target is on the field, and the trash frame follows', () => {
    const db = makeDb([
      def('hit', 'program', { effects: [onPlay({ kind: 'defeat', target: 'rivalUnit' })] }),
      def('grunt', 'unit'),
    ])
    const s = scenario()
    const src = mint(s, 0, 'trash', 'hit')
    const victim = mint(s, 1, 'field', 'grunt')
    const { frames } = recordFrames(() => fire(db, s, src, [victim]))
    const noted = effectFrame(frames)
    expect(noted.event).toMatchObject({ targets: [victim] })
    expect(noted.board.players[1].field).toContain(victim)
    const trashed = frames.find((f) => f.event.type === 'cardTrashed' && f.event.uid === victim)!
    expect(trashed.eventIndex).toBeGreaterThan(noted.eventIndex)
    expect(trashed.board.players[1].trash).toContain(victim)
  })

  it('bounce notes after the card is back in hand', () => {
    const db = makeDb([
      def('shoo', 'program', { effects: [onPlay({ kind: 'bounce', target: 'rivalUnit' })] }),
      def('grunt', 'unit'),
    ])
    const s = scenario()
    const src = mint(s, 0, 'trash', 'shoo')
    const victim = mint(s, 1, 'field', 'grunt')
    const { frames } = recordFrames(() => fire(db, s, src, [victim]))
    const frame = effectFrame(frames)
    expect(frame.event).toMatchObject({ targets: [victim] })
    expect(frame.board.players[1].hand).toContain(victim)
  })

  it('spendCard notes after the card is spent', () => {
    const db = makeDb([
      def('tap', 'program', { effects: [onPlay({ kind: 'spendCard', target: 'rivalUnit' })] }),
      def('grunt', 'unit'),
    ])
    const s = scenario()
    const src = mint(s, 0, 'trash', 'tap')
    const victim = mint(s, 1, 'field', 'grunt', { ready: true })
    const { frames } = recordFrames(() => fire(db, s, src, [victim]))
    const frame = effectFrame(frames)
    expect(frame.event).toMatchObject({ targets: [victim] })
    expect(frame.board.cards[victim].ready).toBe(false)
  })
})
```

If `spendCard`'s node shape or the `rivalUnit` target spec differs from what's written above, copy the exact node shape from an existing `spendCard` test in the same file (`grep -n "spendCard" tests/engine/effects.test.ts`) and keep the assertions.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/engine/effects.test.ts -t "presentation frames"`
Expected: FAIL. The `targets` field is missing from the events, the bounce frame still shows the card on the field, and the spend frame shows it ready.

- [ ] **Step 3: Add `targets` to the event type**

In `src/engine/types.ts`, replace the `effectResolved` member with:

```ts
  | { type: 'effectResolved'; sourceUid: number; description: string; targets?: number[] }
```

- [ ] **Step 4: Thread targets through `note()` and fix the order**

In `src/cards/effects.ts`:

```ts
function note(draft: GameState, sourceUid: number, description: string, targets: number[] = []): void {
  emit(draft, targets.length > 0
    ? { type: 'effectResolved', sourceUid, description, targets }
    : { type: 'effectResolved', sourceUid, description })
}
```

Only set `targets` when it is non-empty. That keeps every existing `toEqual` assertion on untargeted events valid.

Then pass `[target]` as the fourth argument at every single-target `note` call. These are the ones with a local `target` or `targetDie`-owner uid: `buffPower`, `grantKeyword`, fight power (~702), skip-ready (~710), `defeat`, `bounce`, `bottomDeck`, `retrieveFromTrash`, `discardCard`, `readyCard` and `spendCard`. For example:

```ts
      note(draft, ctx.sourceUid, `${sign}${amount} power (${node.duration}) on ${target}`, [target])
```

Reorder the two sites that note before their in-place mutation:

```ts
    case 'bounce': {
      const target = takeTarget(node, ctx, slots)
      if (target === null) return
      if (!draft.players[controllerOf(draft, target)].field.includes(target)) return
      leaveField(draft, db, target, 'hand')
      note(draft, ctx.sourceUid, `bounce ${target}`, [target])
      return
    }
```

```ts
    case 'spendCard': {
      const target = takeTarget(node, ctx, slots)
      if (target === null || !draft.cards[target]) return
      // Being spent by an effect is still being spent (docs/rulings.md §47).
      spendOnDraft(db, draft, [target])
      note(draft, ctx.sourceUid, `spend ${target}`, [target])
      return
    }
```

`spendOnDraft` can fire `onSpend` triggers, so after this change their events come *before* the note. Check with `grep -n "spend" tests/engine/*.test.ts` whether any test asserts on event order around a spend; if one does, update its expected order and mention it in the commit body.

`defeat` and `bottomDeck` keep noting *before* `defeatUnit` / `leaveField`, because the target must still be visible. Their exit events (`cardTrashed` / `cardBottomDecked` / `cardRemoved`, emitted inside `leaveField` after the move) provide the post-move frame.

- [ ] **Step 5: Audit the remaining `note` sites**

Read each remaining `note(` call in `src/cards/effects.ts` and confirm it runs after the mutation it describes. As of this plan, all of these already do: `draw`, `discardRandomRival`, `changeGig`, the swap and match variants, `stealGig`, return-to-fixer, reroll, trash-from-deck, bank eddies, ready eddies, `mode` and `scripted`. If one doesn't, move it after the mutation the same way as `bounce`.

- [ ] **Step 6: Key dice by id in `StreetStrip`**

In `src/ui/StreetStrip.tsx`:
- Line ~102 (Gig dice): change `key={index}` to `key={die.id ?? `i${index}`}` and add `data-die-id={die.id}`.
- Line ~123 (fixer dice): change the key to `key={die.id ?? `${die.size}-${index}`}` and add `data-die-id={die.id}`.

Keep `data-testid` unchanged.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/engine/effects.test.ts tests/ui/streetstrip.test.tsx`
Expected: PASS.

Run: `npm test`
Expected: PASS. If an existing test compares a targeted `effectResolved` event with `toEqual`, add the `targets` field to its expected value.

- [ ] **Step 8: Commit**

```bash
git add src/engine/types.ts src/cards/effects.ts src/ui/StreetStrip.tsx tests
git commit -m "feat(engine): effect events carry targets; frames show effect results"
```

---

### Task 4: The beat model (`buildBeats`)

**Files:**
- Create: `src/ui/presentation/beats.ts`
- Test: `tests/ui/beats.test.ts`

**Interfaces:**
- Consumes: `Frame` (Task 2); `GameEvent`, `GameState`, `PlayerId` from `src/engine/types`; `opponentOf` from `src/engine/query`.
- Produces:
  - `type BeatKind = 'turnBanner' | 'spotlight' | 'effect' | 'attack' | 'block' | 'defeat' | 'steal' | 'dieRoll' | 'minor' | 'silent' | 'gameOver'`
  - `interface Beat { id: number; kind: BeatKind; events: GameEvent[]; firstIndex: number; lastIndex: number; board: GameState; baseMs: number; player: PlayerId | null; sourceUid: number | null; targets: (number | 'gigArea')[]; step: number; of: number }`
  - `const BEAT_MS: Record<BeatKind, number>`
  - `buildBeats(frames: Frame[], actor: 'human' | 'ai'): Beat[]`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/ui/beats.test.ts
import { describe, expect, it } from 'vitest'
import { buildBeats, BEAT_MS } from '../../src/ui/presentation/beats'
import type { Frame } from '../../src/engine/timeline'
import type { GameEvent, GameState } from '../../src/engine/types'
import { startedGame } from '../engine/gameHelpers'

const base: GameState = startedGame()
// Owners for uid-only events: uid 900 belongs to player 1, 800 to player 0.
base.cards[900] = { ...Object.values(base.cards)[0], uid: 900, owner: 1 }
base.cards[800] = { ...Object.values(base.cards)[0], uid: 800, owner: 0 }

function frames(...events: GameEvent[]): Frame[] {
  return events.map((event, i) => ({ eventIndex: 100 + i, event, board: base }))
}

const kinds = (fs: Frame[], actor: 'human' | 'ai' = 'ai') => buildBeats(fs, actor).map((b) => b.kind)

describe('buildBeats', () => {
  it('maps each event kind to its beat', () => {
    expect(kinds(frames(
      { type: 'cardPlayed', player: 1, uid: 900 },
      { type: 'attackDeclared', attacker: 900, target: 'gigArea' },
      { type: 'attackBlocked', blocker: 800 },
      { type: 'unitDefeated', uid: 800 },
      { type: 'dieRolled', player: 1, size: 6, value: 3 },
      { type: 'gigStolen', from: 0, die: { size: 6, value: 3 } },
      { type: 'turnEnded', player: 1 },
      { type: 'gameEnded', winner: 1, reason: 'sevenGigs' },
    ))).toEqual(['spotlight', 'attack', 'block', 'defeat', 'dieRoll', 'steal', 'silent', 'gameOver'])
  })

  it('absorbs an ability activation into the effect it resolves', () => {
    const beats = buildBeats(frames(
      { type: 'abilityActivated', player: 1, uid: 900, abilityIndex: 0 },
      { type: 'effectResolved', sourceUid: 900, description: 'defeat 800', targets: [800] },
    ), 'ai')
    expect(beats).toHaveLength(1)
    expect(beats[0]).toMatchObject({ kind: 'effect', sourceUid: 900, targets: [800], firstIndex: 100, lastIndex: 101, player: 1 })
  })

  it('lets a defeat absorb the exit event of the same card', () => {
    const beats = buildBeats(frames(
      { type: 'unitDefeated', uid: 800 },
      { type: 'cardTrashed', uid: 800 },
      { type: 'cardTrashed', uid: 900 },
    ), 'ai')
    expect(beats.map((b) => [b.kind, b.firstIndex, b.lastIndex])).toEqual([['defeat', 100, 101], ['minor', 102, 102]])
  })

  it('lets an effect absorb the exit event of its target', () => {
    const beats = buildBeats(frames(
      { type: 'effectResolved', sourceUid: 900, description: 'bottom-deck 800', targets: [800] },
      { type: 'cardBottomDecked', uid: 800 },
    ), 'ai')
    expect(beats).toHaveLength(1)
    expect(beats[0].lastIndex).toBe(101)
  })

  it('merges consecutive same-kind minor events by the same player', () => {
    const beats = buildBeats(frames(
      { type: 'cardDrawn', player: 1, uid: 900 },
      { type: 'cardDrawn', player: 1, uid: 901 },
      { type: 'cardDrawn', player: 0, uid: 800 },
    ), 'ai')
    expect(beats.map((b) => b.events.length)).toEqual([2, 1])
  })

  it('folds the draws that follow a turn start into the banner', () => {
    const beats = buildBeats(frames(
      { type: 'turnStarted', player: 1, turn: 4 },
      { type: 'cardDrawn', player: 1, uid: 900 },
      { type: 'cardPlayed', player: 1, uid: 900 },
    ), 'ai')
    expect(beats.map((b) => b.kind)).toEqual(['turnBanner', 'spotlight'])
    expect(beats[0].events).toHaveLength(2)
  })

  it('gives each kind its base time and numbers the beats of the action', () => {
    const beats = buildBeats(frames(
      { type: 'cardPlayed', player: 1, uid: 900 },
      { type: 'effectResolved', sourceUid: 900, description: 'draw 1' },
    ), 'ai')
    expect(beats.map((b) => [b.baseMs, b.step, b.of, b.id])).toEqual([
      [BEAT_MS.spotlight, 1, 2, 100],
      [BEAT_MS.effect, 2, 2, 101],
    ])
  })

  it("resolves the human's chosen action instantly but paces its consequences", () => {
    const beats = buildBeats(frames(
      { type: 'cardSold', player: 0, uid: 800 },
      { type: 'cardPlayed', player: 0, uid: 800 },
      { type: 'effectResolved', sourceUid: 800, description: 'defeat 900', targets: [900] },
      { type: 'unitDefeated', uid: 900 },
    ), 'human')
    expect(beats.map((b) => b.baseMs)).toEqual([0, 0, BEAT_MS.effect, BEAT_MS.defeat])
  })

  it("still shows the rival's turn banner after the human ends their turn", () => {
    const beats = buildBeats(frames(
      { type: 'turnEnded', player: 0 },
      { type: 'turnStarted', player: 1, turn: 4 },
    ), 'human')
    expect(beats.map((b) => [b.kind, b.baseMs])).toEqual([['silent', 0], ['turnBanner', BEAT_MS.turnBanner]])
  })

  it('attributes attacks and steals to the acting player', () => {
    const beats = buildBeats(frames(
      { type: 'attackDeclared', attacker: 900, target: 800 },
      { type: 'gigStolen', from: 0, die: { size: 6, value: 3 } },
    ), 'ai')
    expect(beats.map((b) => [b.player, b.sourceUid, b.targets])).toEqual([[1, 900, [800]], [1, null, ['gigArea']]])
  })

  it('returns nothing for no frames', () => {
    expect(buildBeats([], 'ai')).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/ui/beats.test.ts`
Expected: FAIL. The module cannot be resolved.

- [ ] **Step 3: Implement `src/ui/presentation/beats.ts`**

```ts
// Groups an action's recorded frames into presentation beats
// (docs/superpowers/specs/2026-09-28-effect-pacing-design.md §2).
// Pure: no React, no timers, and no captions. BeatLayer renders captions at
// display time.

import { opponentOf } from '../../engine/query'
import type { Frame } from '../../engine/timeline'
import type { GameEvent, GameState, PlayerId } from '../../engine/types'

export type BeatKind = 'turnBanner' | 'spotlight' | 'effect' | 'attack' | 'block'
  | 'defeat' | 'steal' | 'dieRoll' | 'minor' | 'silent' | 'gameOver'

export interface Beat {
  id: number
  kind: BeatKind
  events: GameEvent[]
  firstIndex: number
  lastIndex: number
  board: GameState
  baseMs: number
  player: PlayerId | null
  sourceUid: number | null
  targets: (number | 'gigArea')[]
  step: number
  of: number
}

export const BEAT_MS: Record<BeatKind, number> = {
  turnBanner: 900, spotlight: 1400, effect: 1100, attack: 900, block: 700,
  defeat: 700, steal: 900, dieRoll: 700, minor: 350, silent: 0, gameOver: 600,
}

const KIND: Record<GameEvent['type'], BeatKind> = {
  gameStarted: 'silent', playOrderChosen: 'silent', turnEnded: 'silent',
  mulliganTaken: 'minor', handKept: 'minor', cardDrawn: 'minor', cardSold: 'minor',
  cardRevealed: 'minor', cardTrashed: 'minor', cardBottomDecked: 'minor', cardRemoved: 'minor',
  turnStarted: 'turnBanner', cardPlayed: 'spotlight', legendCalled: 'spotlight',
  abilityActivated: 'effect', effectResolved: 'effect', attackDeclared: 'attack',
  attackBlocked: 'block', unitDefeated: 'defeat', gigStolen: 'steal', dieRolled: 'dieRoll',
  gameEnded: 'gameOver',
}

/** A beat that resolves the human's own chosen action. */
const PRIMARY = new Set<BeatKind>(['spotlight', 'effect', 'attack', 'block', 'steal', 'dieRoll'])
const EXITS = new Set<GameEvent['type']>(['cardTrashed', 'cardBottomDecked', 'cardRemoved'])

function uidOf(event: GameEvent): number | null {
  switch (event.type) {
    case 'cardDrawn': case 'cardSold': case 'cardPlayed': case 'legendCalled': case 'cardRevealed':
    case 'cardTrashed': case 'cardBottomDecked': case 'cardRemoved': case 'abilityActivated':
    case 'unitDefeated':
      return event.uid
    case 'effectResolved': return event.sourceUid
    case 'attackDeclared': return event.attacker
    case 'attackBlocked': return event.blocker
    default: return null
  }
}

function playerOf(event: GameEvent, board: GameState): PlayerId | null {
  if ('player' in event) return event.player
  if (event.type === 'gigStolen') return opponentOf(event.from)
  if (event.type === 'gameEnded') return event.winner
  const uid = uidOf(event)
  return uid === null ? null : board.cards[uid]?.owner ?? null
}

function targetsOf(event: GameEvent): (number | 'gigArea')[] {
  if (event.type === 'effectResolved') return event.targets ?? []
  if (event.type === 'attackDeclared') return [event.target]
  if (event.type === 'gigStolen') return ['gigArea']
  return []
}

function absorbs(beat: Beat, event: GameEvent, player: PlayerId | null): boolean {
  const last = beat.events[beat.events.length - 1]
  const kind = KIND[event.type]
  if (beat.kind === 'effect' && last.type === 'abilityActivated' && event.type === 'effectResolved')
    return event.sourceUid === last.uid
  if (EXITS.has(event.type) && (beat.kind === 'defeat' || beat.kind === 'effect')) {
    const uid = uidOf(event)
    return beat.kind === 'defeat' ? uid === beat.sourceUid : beat.targets.includes(uid as number)
  }
  if (beat.kind === 'turnBanner') return kind === 'minor' && player === beat.player
  if (beat.kind === 'minor') return kind === 'minor' && event.type === last.type && player === beat.player
  return false
}

export function buildBeats(frames: Frame[], actor: 'human' | 'ai'): Beat[] {
  const beats: Beat[] = []
  for (const frame of frames) {
    const { event, board, eventIndex } = frame
    const player = playerOf(event, board)
    const open = beats[beats.length - 1]
    if (open !== undefined && absorbs(open, event, player)) {
      open.events.push(event)
      open.lastIndex = eventIndex
      open.id = eventIndex
      open.board = board
      if (event.type === 'effectResolved') open.targets = targetsOf(event)
      continue
    }
    const kind = KIND[event.type] ?? 'minor'
    beats.push({
      id: eventIndex, kind, events: [event], firstIndex: eventIndex, lastIndex: eventIndex, board,
      baseMs: BEAT_MS[kind], player, sourceUid: uidOf(event), targets: targetsOf(event), step: 0, of: 0,
    })
  }
  if (actor === 'human') {
    for (const beat of beats) {
      if (beat.kind === 'minor' || beat.kind === 'silent') { beat.baseMs = 0; continue }
      if (PRIMARY.has(beat.kind)) beat.baseMs = 0
      break
    }
  }
  beats.forEach((beat, i) => { beat.step = i + 1; beat.of = beats.length })
  return beats
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/ui/beats.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/presentation/beats.ts tests/ui/beats.test.ts
git commit -m "feat(ui): group recorded frames into presentation beats"
```

---

### Task 5: The beat queue and AI hold in `useGame`

**Files:**
- Modify: `src/ui/useGame.ts` (`Game`, `applyOne`, the hook body at lines 143–297)
- Test: `tests/ui/usegame.test.ts` (append a `describe('pacing')`)

**Interfaces:**
- Consumes: `applyActionTimeline` (Task 2); `buildBeats`, `Beat` (Task 4).
- Produces, as additions to `UseGameOptions` / `UseGameApi`:
  - `UseGameOptions.pacing?: boolean` (default `false`)
  - `UseGameApi.beats: Beat[]`
  - `UseGameApi.ackBeat: (id: number) => void`
  - `UseGameApi.clearBeats: () => void`
  - `UseGameApi.presenting: boolean` (`beats.length > 0`)
  - `legal` is `[]` and `aiThinking` is `false` while `presenting`.

- [ ] **Step 1: Write the failing tests** (append to `tests/ui/usegame.test.ts`, and add `import { newGame } from '../../src/engine/game'` if it is missing)

```ts
describe('useGame pacing', () => {
  let aiFirstSeed = 1
  while (actingPlayer(newGame(db, { decks: [arasaka, mercs], seed: aiFirstSeed })) !== 1) aiFirstSeed++

  function mountPaced() {
    return renderHook(() => useGame(db, { aiDelayMs: 0, pacing: true }))
  }

  /** Acknowledges every queued beat, one render at a time. */
  async function drain(hook: ReturnType<typeof mountPaced>): Promise<void> {
    for (let i = 0; i < 500 && hook.result.current.beats.length > 0; i++) {
      await act(async () => hook.result.current.ackBeat(hook.result.current.beats[0].id))
    }
  }

  it('queues beats for an AI action and holds the next AI action until they drain', async () => {
    const hook = mountPaced()
    await act(async () => hook.result.current.start(arasaka, mercs, aiFirstSeed))
    await waitFor(() => expect(hook.result.current.beats.length).toBeGreaterThan(0))
    const applied = hook.result.current.record!.actions.length
    expect(hook.result.current.presenting).toBe(true)
    expect(hook.result.current.legal).toEqual([])
    expect(hook.result.current.aiThinking).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(hook.result.current.record!.actions.length).toBe(applied)
    await drain(hook)
    await waitFor(() => expect(
      hook.result.current.record!.actions.length > applied || hook.result.current.legal.length > 0,
    ).toBe(true))
  })

  it('only offers the human legal actions once the queue is empty', async () => {
    const hook = mountPaced()
    await act(async () => hook.result.current.start(arasaka, mercs, aiFirstSeed))
    for (let i = 0; i < 50 && hook.result.current.legal.length === 0; i++) {
      await drain(hook)
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    }
    expect(hook.result.current.legal.length).toBeGreaterThan(0)
    expect(hook.result.current.beats).toEqual([])
  })

  it('does not queue anything when pacing is off', async () => {
    const hook = renderHook(() => useGame(db, { aiDelayMs: 0 }))
    await act(async () => hook.result.current.start(arasaka, mercs, aiFirstSeed))
    await waitFor(() => expect(hook.result.current.legal.length).toBeGreaterThan(0))
    expect(hook.result.current.beats).toEqual([])
  })

  it('undo clears the queue', async () => {
    const hook = mountPaced()
    await act(async () => hook.result.current.start(arasaka, mercs, SEED))
    for (let i = 0; i < 50 && hook.result.current.legal.length === 0; i++) {
      await drain(hook)
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    }
    const endTurn = hook.result.current.legal.find((a) => a.type === 'endTurn') ?? hook.result.current.legal[0]
    await act(async () => hook.result.current.act(endTurn))
    expect(hook.result.current.beats.length).toBeGreaterThan(0)
    await act(async () => hook.result.current.undo())
    expect(hook.result.current.beats).toEqual([])
    expect(hook.result.current.legal.length).toBeGreaterThan(0)
  })

  it('does not replay presented beats after an intercept answer', async () => {
    // Find a record whose next human action pauses for a human intercept.
    let found: { seed: number; prefix: import('../../src/engine/types').Action[]; action: import('../../src/engine/types').Action } | null = null
    for (let seed = 1; seed <= 150 && found === null; seed++) {
      let state = newGame(db, { decks: [arasaka, mercs], seed })
      const prefix: import('../../src/engine/types').Action[] = []
      for (let i = 0; i < 250 && state.phase !== 'gameOver' && found === null; i++) {
        const actions = legalActions(db, state)
        if (actions.length === 0) break
        const action = actions[(seed * 7 + i) % actions.length]
        const next = applyAction(db, state, action)
        if (next.phase === 'intercept' && next.pendingIntercept?.player === 0 && actingPlayer(state) === 0) {
          found = { seed, prefix: [...prefix], action }
        }
        prefix.push(action)
        state = next
      }
    }
    expect(found).not.toBeNull()
    const hook = mountPaced()
    const record = { practiceMode: true, aiDifficulty: 'medium' as const, aiVersion: 0, config: { decks: [arasaka, mercs] as [typeof arasaka, typeof mercs], seed: found!.seed }, actions: found!.prefix }
    await act(async () => hook.result.current.load(record as never))
    await act(async () => hook.result.current.act(found!.action))
    const shown = new Set<number>()
    for (const beat of hook.result.current.beats) for (let i = beat.firstIndex; i <= beat.lastIndex; i++) shown.add(i)
    await drain(hook)
    expect(hook.result.current.state!.phase).toBe('intercept')
    await act(async () => hook.result.current.act(hook.result.current.legal[0]))
    for (const beat of hook.result.current.beats) expect(shown.has(beat.firstIndex)).toBe(false)
  })
})
```

Notes for the implementer:
- Add `import { applyAction } from '../../src/engine/reduce'` to the test file if it is missing.
- The intercept test loads a *practice-mode* record so the AI never moves on its own.
- Copy the real `GameRecord` field names from `src/engine/replay.ts` (`provenance` and so on) if the literal above doesn't type-check. The `as never` is only there to keep the literal short, and must not hide a missing required field that `replay` reads. Build the record the same way `start` does: `aiVersion: AI_VERSION, provenance: gameProvenance(db)`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/ui/usegame.test.ts -t "pacing"`
Expected: FAIL. `beats` is undefined and `pacing` is ignored.

- [ ] **Step 3: Restructure `useGame` around a session**

In `src/ui/useGame.ts`:

1. Add the imports:
   ```ts
   import { applyActionTimeline } from '../engine/timeline'
   import { buildBeats, type Beat } from './presentation/beats'
   ```
2. Add `pacing?: boolean` to `UseGameOptions`, with a doc comment: "Queue presentation beats per action (PlayView turns this off for Instant speed, `?aiDelay=0` and reduced motion)."
3. Add `beats`, `ackBeat`, `clearBeats` and `presenting` to `UseGameApi`, with doc comments.
4. Replace `applyOne` and add the session helpers:

```ts
/** The live game plus the beats still waiting to be shown. */
interface Session {
  game: Game | null
  beats: Beat[]
  /** Highest event index already queued or shown; replays below it are skipped. */
  seen: number
}

const NO_SESSION: Session = { game: null, beats: [], seen: -1 }

/** The last event index a state has shown, counting a paused intercept's view. */
function lastEventIndex(state: GameState): number {
  return (state.pendingIntercept?.view ?? state).events.length - 1
}

function settled(game: Game): Session {
  return { game, beats: [], seen: lastEventIndex(game.state) }
}

function withAction(game: Game, action: Action, state: GameState): Game {
  return {
    record: { ...game.record, actions: [...game.record.actions, action] },
    state,
    owners: [...game.owners, actingPlayer(game.state)],
  }
}

function applyOne(db: CardDb, game: Game, action: Action): Game {
  return withAction(game, action, applyAction(db, game.state, action))
}

/**
 * Applies one action to the session. With pacing on, the action's frames
 * become queued beats. Frames at or below `seen` are dropped: an intercept
 * answer replays its action from the start, and the part before the pause
 * was already shown.
 */
function advance(db: CardDb, session: Session, action: Action, pacing: boolean): Session {
  const game = session.game
  if (game === null) return session
  if (!pacing) {
    const next = applyOne(db, game, action)
    return { game: next, beats: [], seen: Math.max(session.seen, lastEventIndex(next.state)) }
  }
  const { state, frames } = applyActionTimeline(db, game.state, action)
  const actor = game.record.practiceMode || actingPlayer(game.state) === HUMAN ? 'human' : 'ai'
  const fresh = frames.filter((frame) => frame.eventIndex > session.seen)
  const next = withAction(game, action, state)
  return {
    game: next,
    beats: [...session.beats, ...buildBeats(fresh, actor)],
    seen: Math.max(session.seen, lastEventIndex(state), ...fresh.map((frame) => frame.eventIndex)),
  }
}
```

5. In the hook body:
   - Replace `const [game, setGame] = useState<Game | null>(null)` with
     ```ts
     const [session, setSession] = useState<Session>(NO_SESSION)
     const game = session.game
     const pacing = options.pacing ?? false
     const [aiChoice, setAiChoice] = useState<{ game: Game; action: Action } | null>(null)
     ```
   - `start` and `load`: `setSession(settled(next))` and `setAiChoice(null)`.
   - `act`: `setSession((current) => advance(dbRef.current, current, action, pacing))`. Add `pacing` to its deps.
   - `undo`: return `settled({ record: rewound, state: replay(...), owners: ... })` from the updater, and return `current` unchanged in the two no-op branches. Also call `setAiChoice(null)`.
   - Add:
     ```ts
     const ackBeat = useCallback((id: number) => {
       setSession((current) => current.beats[0]?.id === id ? { ...current, beats: current.beats.slice(1) } : current)
     }, [])
     const clearBeats = useCallback(() => {
       setSession((current) => current.beats.length === 0 ? current : { ...current, beats: [] })
     }, [])
     const presenting = session.beats.length > 0
     ```
   - In the AI effect, change `accept` so it no longer applies the action itself:
     ```ts
     const accept = (action: Action) => {
       if (!active) return
       active = false
       clearTimeout(deadline)
       worker?.terminate()
       setAiChoice({ game, action })
     }
     ```
     Keep the effect's deps as `[game, aiDelayMs, options.createAiWorker, retry]`. `game` is the same object across `ackBeat` calls, so acknowledging beats never restarts the worker.
   - Add the apply effect, which is the AI hold:
     ```ts
     // The AI may finish thinking while beats play; its move is applied only
     // once the player has seen everything before it.
     useEffect(() => {
       if (aiChoice === null || session.beats.length > 0) return
       setAiChoice(null)
       if (aiChoice.game !== session.game) return
       try {
         setSession(advance(dbRef.current, session, aiChoice.action, pacing))
       } catch (error) {
         setAiError(error instanceof Error ? error.message : String(error))
       }
     }, [aiChoice, session, pacing])
     ```
   - `aiThinking` also requires `!presenting && aiChoice === null`.
   - `legal`: return `[]` when `presenting`. Add `presenting` to its memo deps.
   - `save` keeps reading `game`.
   - Add `beats: session.beats, ackBeat, clearBeats, presenting` to the returned object.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/ui/usegame.test.ts tests/ui/ai-worker.test.ts`
Expected: PASS, including the existing worker-deadline tests. Pacing is off there, so `accept` → `aiChoice` → the apply effect runs inside the same `act()` flush.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui/useGame.ts tests/ui/usegame.test.ts
git commit -m "feat(ui): queue presentation beats in useGame and hold the AI until they drain"
```

---

### Task 6: The presentation clock (`usePresentation`) and speed setting

**Files:**
- Create: `src/ui/presentation/speed.ts`
- Create: `src/ui/presentation/usePresentation.ts`
- Test: `tests/ui/presentation.test.ts`

**Interfaces:**
- Consumes: `Beat` (Task 4); `ackBeat`, `clearBeats` shapes (Task 5).
- Produces:
  - `type Speed = 'slow' | 'normal' | 'fast' | 'instant'`
  - `const SPEEDS: Speed[]`
  - `const SPEED_FACTOR: Record<Speed, number>`
  - `loadSpeed(): Speed`
  - `saveSpeed(speed: Speed): void`
  - `interface PresentationInput { beats: Beat[]; ackBeat: (id: number) => void; clearBeats: () => void; awaitingHuman: boolean; speed: Speed }`
  - `interface PresentationApi { beat: Beat | null; durationMs: number; paused: boolean; fastForward: boolean; skipBeat: () => void; skipTurn: () => void; togglePause: () => void }`
  - `usePresentation(input: PresentationInput): PresentationApi`

- [ ] **Step 1: Write the failing tests**

```ts
// @vitest-environment jsdom
// tests/ui/presentation.test.ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/ui/presentation.test.ts`
Expected: FAIL. The modules cannot be resolved.

- [ ] **Step 3: Implement `src/ui/presentation/speed.ts`**

```ts
// The player's pacing speed, remembered per browser. Storage can be missing
// or throw (private windows, blocked site data), so every access is guarded
// and falls back to 'normal'.

export type Speed = 'slow' | 'normal' | 'fast' | 'instant'

export const SPEEDS: Speed[] = ['slow', 'normal', 'fast', 'instant']
export const SPEED_FACTOR: Record<Speed, number> = { slow: 1.5, normal: 1, fast: 0.5, instant: 0 }

const KEY = 'ctcg.pacingSpeed'

export function loadSpeed(): Speed {
  try {
    const stored = localStorage.getItem(KEY)
    return SPEEDS.includes(stored as Speed) ? (stored as Speed) : 'normal'
  } catch {
    return 'normal'
  }
}

export function saveSpeed(speed: Speed): void {
  try {
    localStorage.setItem(KEY, speed)
  } catch {
    // Remembering the speed is a convenience; failing to is harmless.
  }
}
```

- [ ] **Step 4: Implement `src/ui/presentation/usePresentation.ts`**

```ts
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/ui/presentation.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 6: Commit**

```bash
git add src/ui/presentation/speed.ts src/ui/presentation/usePresentation.ts tests/ui/presentation.test.ts
git commit -m "feat(ui): presentation clock with speed, skip, skip-turn and pause"
```

---

### Task 7: Wire playback into `PlayView`, retire `useAnimations`, add the controls and log highlight

**Files:**
- Create: `src/ui/presentation/beatAnimations.ts`
- Create: `src/ui/presentation/PacingControls.tsx`
- Modify: `src/ui/PlayView.tsx` (the hook section at lines ~176–193, the playmat root at ~623–631, the rail at ~752–767)
- Modify: `src/ui/LogPanel.tsx`
- Modify: `src/ui/styles/board.css` (append the control-bar and log-highlight rules)
- Delete: `src/ui/useAnimations.ts`, `tests/ui/useanimations.test.ts`
- Test: `tests/ui/beats.test.ts` (append the `beatAnimations` cases), `tests/ui/playview.test.tsx` (append the pacing cases)

**Interfaces:**
- Consumes: `useGame`'s `beats`, `ackBeat`, `clearBeats`, `presenting`, `pacing` (Task 5); `usePresentation`, `loadSpeed`, `saveSpeed`, `Speed`, `SPEEDS` (Task 6); `Beat` (Task 4).
- Produces:
  - `interface AnimationState { lungeUid: number | null; tumble: { player: PlayerId; size: DieSize } | null; steal: { from: PlayerId; size: DieSize; value: number } | null; glitch: boolean }`
  - `beatAnimations(beat: Beat | null): AnimationState`
  - `PacingControls` props: `{ speed: Speed; onSpeed: (s: Speed) => void; paused: boolean; onPause: () => void; onSkipTurn: () => void; beat: Beat | null; disabled: boolean }`
  - `LogPanel` gets a new optional prop `highlight?: { from: number; to: number } | null` (line index equals event index, because `buildLog` emits one line per event).

- [ ] **Step 1: Write the failing tests**

Append to `tests/ui/beats.test.ts`:

```ts
import { beatAnimations } from '../../src/ui/presentation/beatAnimations'

describe('beatAnimations', () => {
  const [attack, roll, steal, over] = buildBeats(frames(
    { type: 'attackDeclared', attacker: 900, target: 'gigArea' },
    { type: 'dieRolled', player: 1, size: 8, value: 5 },
    { type: 'gigStolen', from: 0, die: { size: 6, value: 3 } },
    { type: 'gameEnded', winner: 1, reason: 'sevenGigs' },
  ), 'ai')

  it('maps beats onto the existing animation flags', () => {
    expect(beatAnimations(null)).toEqual({ lungeUid: null, tumble: null, steal: null, glitch: false })
    expect(beatAnimations(attack).lungeUid).toBe(900)
    expect(beatAnimations(roll).tumble).toEqual({ player: 1, size: 8 })
    expect(beatAnimations(steal).steal).toEqual({ from: 0, size: 6, value: 3 })
    expect(beatAnimations(over).glitch).toBe(true)
  })
})
```

Append to `tests/ui/playview.test.tsx`, following that file's existing `render` / setup helpers for starting a game (read the top of the file first and reuse its helper that renders `PlayView` and starts a game with `aiDelayMs={0}`):

```ts
describe('PlayView pacing wiring', () => {
  it('shows the pacing controls in the rail', async () => {
    // Use the file's existing start-a-game helper here.
    expect(screen.getByTestId('pacing-controls')).toBeInTheDocument()
    expect(screen.getByTestId('pacing-speed-instant')).toBeChecked() // aiDelayMs=0 forces Instant
  })

  it('data-awaiting reports presenting while beats are queued', () => {
    // A unit test at the hook level already pins the gating (Task 5). Here we
    // only pin the attribute mapping, via the pure helper.
    expect(awaitingAttribute({ presenting: true, legalCount: 3, over: false })).toBe('presenting')
    expect(awaitingAttribute({ presenting: false, legalCount: 3, over: false })).toBe('human')
    expect(awaitingAttribute({ presenting: false, legalCount: 0, over: true })).toBe('over')
    expect(awaitingAttribute({ presenting: false, legalCount: 0, over: false })).toBe('ai')
  })
})
```

Add `import { awaitingAttribute } from '../../src/ui/PlayView'` to that file.

Also add a LogPanel highlight case (to `tests/ui/playview.test.tsx`, or a new `tests/ui/logpanel.test.tsx` with the jsdom pragma):

```ts
import { render, screen } from '@testing-library/react'
import { LogPanel } from '../../src/ui/LogPanel'

it('highlights the lines of the current beat', () => {
  render(<LogPanel lines={[{ text: 'a', turn: 1 }, { text: 'b', turn: 1 }, { text: 'c', turn: 1 }]} highlight={{ from: 1, to: 2 }} />)
  const lines = screen.getAllByTestId('log-line')
  expect(lines.map((line) => line.classList.contains('log-panel__line--current'))).toEqual([false, true, true])
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/ui/beats.test.ts tests/ui/playview.test.tsx`
Expected: FAIL. `beatAnimations`, `awaitingAttribute`, the `pacing-controls` testid and `highlight` don't exist yet.

- [ ] **Step 3: Implement `src/ui/presentation/beatAnimations.ts`**

```ts
// The four showpiece flags (lunge, tumble, steal-fly, glitch) that Field and
// StreetStrip already know how to play, now driven by the current beat
// instead of a diff of the event log (this replaces useAnimations.ts).

import type { DieSize, PlayerId } from '../../engine/types'
import type { Beat } from './beats'

export interface AnimationState {
  lungeUid: number | null
  tumble: { player: PlayerId; size: DieSize } | null
  steal: { from: PlayerId; size: DieSize; value: number } | null
  glitch: boolean
}

const NONE: AnimationState = { lungeUid: null, tumble: null, steal: null, glitch: false }

export function beatAnimations(beat: Beat | null): AnimationState {
  if (beat === null) return NONE
  const event = beat.events[0]
  switch (event.type) {
    case 'attackDeclared': return { ...NONE, lungeUid: event.attacker }
    case 'dieRolled': return { ...NONE, tumble: { player: event.player, size: event.size } }
    case 'gigStolen': return { ...NONE, steal: { from: event.from, size: event.die.size, value: event.die.value } }
    case 'gameEnded': return { ...NONE, glitch: true }
    default: return NONE
  }
}
```

- [ ] **Step 4: Implement `src/ui/presentation/PacingControls.tsx`**

```tsx
// Speed / pause / skip-turn for beat playback. Lives in the playmat rail and
// uses the shared check-chip and ghost-button vocabulary (tools.css,
// chrome.css).

import type { ReactElement } from 'react'
import type { Beat } from './beats'
import { SPEEDS, type Speed } from './speed'

const LABELS: Record<Speed, string> = { slow: 'Slow', normal: 'Normal', fast: 'Fast', instant: 'Instant' }

export interface PacingControlsProps {
  speed: Speed
  onSpeed: (speed: Speed) => void
  paused: boolean
  onPause: () => void
  onSkipTurn: () => void
  beat: Beat | null
  /** Instant is forced (aiDelay=0 or reduced motion): speeds are read-only. */
  disabled: boolean
}

export function PacingControls(props: PacingControlsProps): ReactElement {
  const { speed, onSpeed, paused, onPause, onSkipTurn, beat, disabled } = props
  return (
    <div className="pacing-controls" data-testid="pacing-controls">
      <fieldset className="check-list" aria-label="Playback speed">
        {SPEEDS.map((option) => (
          <label key={option} className="check-chip">
            <input
              type="radio"
              name="pacing-speed"
              data-testid={`pacing-speed-${option}`}
              checked={speed === option}
              disabled={disabled}
              onChange={() => onSpeed(option)}
            />
            {LABELS[option]}
          </label>
        ))}
      </fieldset>
      <div className="pacing-controls__row">
        <button type="button" className="btn--ghost" data-testid="pacing-pause" aria-pressed={paused} onClick={onPause}>
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button type="button" className="btn--ghost" data-testid="pacing-skip-turn" disabled={beat === null} onClick={onSkipTurn}>
          Skip turn
        </button>
        {beat !== null && (
          <span className="chip" data-testid="pacing-step">Beat {beat.step}/{beat.of}</span>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Add the log highlight to `LogPanel`**

In `src/ui/LogPanel.tsx`:
- Add `highlight?: { from: number; to: number } | null` to `LogPanelProps`, with a doc comment: "Event-index range of the beat being shown; those lines get `log-panel__line--current`."
- Destructure it.
- In the `<li>` class list, add `highlight && index >= highlight.from && index <= highlight.to && 'log-panel__line--current'`.

- [ ] **Step 6: Wire `PlayView`**

In `src/ui/PlayView.tsx`:

1. Replace `import { useAnimations } from './useAnimations'` with:
   ```ts
   import { beatAnimations } from './presentation/beatAnimations'
   import { PacingControls } from './presentation/PacingControls'
   import { usePresentation } from './presentation/usePresentation'
   import { loadSpeed, saveSpeed, type Speed } from './presentation/speed'
   import { buildLog } from './useGame'
   ```
   Merge `buildLog` into the existing `./useGame` import rather than adding a second import line.
2. Export the attribute helper, above `PlayView`:
   ```ts
   /** `data-awaiting`: whose input the game waits on, or `presenting` while beats play. */
   export function awaitingAttribute(input: { presenting: boolean; legalCount: number; over: boolean }): string {
     if (input.presenting) return 'presenting'
     if (input.legalCount > 0) return 'human'
     return input.over ? 'over' : 'ai'
   }
   ```
3. Replace the block from `const game = useGame(...)` through `const anim = useAnimations(...)` with:
   ```ts
   // Reduced motion and `?aiDelay=0` (every E2E run) force Instant, which is
   // exactly the pre-pacing behaviour. `matchMedia` is guarded because jsdom
   // lacks it.
   const reducesMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false
   const speedForced = aiDelayMs === 0 || reducesMotion
   const [chosenSpeed, setChosenSpeed] = useState<Speed>(loadSpeed)
   const speed: Speed = speedForced ? 'instant' : chosenSpeed
   const changeSpeed = (next: Speed) => { setChosenSpeed(next); saveSpeed(next) }
   const game = useGame(db, { aiDelayMs, manual, aiDifficulty, pacing: speed !== 'instant' })
   const presentation = usePresentation({
     beats: game.beats,
     ackBeat: game.ackBeat,
     clearBeats: game.clearBeats,
     awaitingHuman: game.legal.length > 0 || game.state?.phase === 'gameOver',
     speed,
   })
   const beat = presentation.beat
   const HUMAN = game.record?.practiceMode && game.state ? actingPlayer(game.state) : DEFAULT_HUMAN
   const AI = opponentOf(HUMAN)
   const { record, legal } = game
   const base = beat?.board ?? game.state
   const state = base?.pendingIntercept?.view
     ? { ...base.pendingIntercept.view, phase: base.phase, pendingIntercept: base.pendingIntercept }
     : base
   const anim = beatAnimations(beat)
   const logLines = useMemo(() => (beat === null ? game.eventsForLog : buildLog(db, beat.board)), [beat, db, game.eventsForLog])
   ```
   This block replaces code that already sits before any early `return` (the old `useAnimations` call was a hook too), so `usePresentation` and `useMemo` keep a stable hook order. Don't move them below a conditional return.
4. On the playmat root `<section>`:
   - Set `data-awaiting={awaitingAttribute({ presenting: game.presenting, legalCount: legal.length, over: state.phase === 'gameOver' })}`.
   - Append `${beat !== null ? ' is-presenting' : ''}` to its className.
   - Add `style={beat !== null ? ({ '--beat-ms': `${presentation.durationMs}ms` } as CSSProperties) : undefined}`, and import `type CSSProperties` from `react`.
5. On `<div className="playmat__board">`, add click-to-skip:
   ```tsx
   onClickCapture={(event) => {
     if (presentation.beat === null) return
     event.stopPropagation()
     event.preventDefault()
     presentation.skipBeat()
   }}
   ```
6. In the rail, pass `lines={logLines}` and `highlight={beat === null ? null : { from: beat.firstIndex, to: beat.lastIndex }}` to `LogPanel`, and render the controls right after it:
   ```tsx
   <PacingControls
     speed={speed}
     onSpeed={changeSpeed}
     paused={presentation.paused}
     onPause={presentation.togglePause}
     onSkipTurn={presentation.skipTurn}
     beat={beat}
     disabled={speedForced}
   />
   ```
7. Delete `src/ui/useAnimations.ts` and `tests/ui/useanimations.test.ts`. If `Field.tsx` or `StreetStrip.tsx` import `AnimationState` from `./useAnimations`, import it from `./presentation/beatAnimations` instead.

- [ ] **Step 7: Style the controls and highlight** (append to `src/ui/styles/board.css`)

```css
/* Beat playback controls (PacingControls.tsx), in the rail under the feed. */
.pacing-controls {
  display: grid;
  gap: 4px;
}
.pacing-controls__row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}
/* The log line(s) of the beat being shown right now. */
.log-panel__line--current {
  background: var(--panel-2);
  box-shadow: inset 2px 0 0 var(--act);
}
```

- [ ] **Step 8: Run the tests**

Run: `npx vitest run tests/ui`
Expected: PASS. The `useanimations` suite is gone, and every PlayView test still passes because `aiDelayMs={0}` means Instant.

Run: `npm test && npm run build`
Expected: both PASS (the build type-checks).

- [ ] **Step 9: Commit**

```bash
git add -A src/ui tests/ui
git commit -m "feat(ui): play queued beats in PlayView with speed, pause and skip controls"
```

---

### Task 8: `BeatLayer`, FLIP movement and beat styles

**Files:**
- Create: `src/ui/presentation/useFlip.ts`
- Create: `src/ui/presentation/BeatLayer.tsx`
- Modify: `src/ui/HandStrip.tsx:73-77` (add `data-uid={uid}` to the hidden hand back)
- Modify: `src/ui/ZonePanels.tsx`: export `FACE_DOWN_DEF`; add `data-uid={uid}` to `.eddie-card` (line ~96); add `data-pile="deck"` / `data-pile="trash"` to the two `.pile` divs (lines ~119 and ~131), and `data-player={player}` if the `.pile` elements don't inherit it from `zone--counts`
- Modify: `src/ui/PlayView.tsx` (a ref on `.playmat__board`, `useFlip`, render `<BeatLayer>` inside `.playmat__board`)
- Modify: `src/ui/styles/motion.css` (beat keyframes, inside the reduced-motion guard), `src/ui/styles/board.css` (static layer layout)
- Test: `tests/ui/beatlayer.test.tsx`

**Interfaces:**
- Consumes: `Beat` (Task 4); `describeEvent` from `src/ui/useGame.ts`; `CardFrame` from `src/ui/CardFrame.tsx`; `FACE_DOWN_DEF` from `src/ui/ZonePanels.tsx`.
- Produces:
  - `useFlip(root: RefObject<HTMLElement | null>, frameKey: unknown, durationMs: number, enabled: boolean): RefObject<Map<string, DOMRect>>`. Keys are the `data-uid` values, and the returned ref holds the rects from *before* the latest frame.
  - `effectCaption(db: CardDb, board: GameState, event: Extract<GameEvent, { type: 'effectResolved' }>): string`
  - `BeatLayer` props: `{ db: CardDb; beat: Beat | null; human: PlayerId; root: RefObject<HTMLElement | null>; previousRects: RefObject<Map<string, DOMRect>>; useOfficialImages: boolean }`

- [ ] **Step 1: Write the failing tests**

```tsx
// @vitest-environment jsdom
// tests/ui/beatlayer.test.tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { BeatLayer, effectCaption } from '../../src/ui/presentation/BeatLayer'
import { buildBeats } from '../../src/ui/presentation/beats'
import { db, startedGame } from '../engine/gameHelpers'
import type { GameEvent, GameState } from '../../src/engine/types'

const board: GameState = startedGame()
const rivalCard = board.players[1].hand[0]
const humanCard = board.players[0].hand[0]
const rivalName = db[board.cards[rivalCard].defId].name
const humanName = db[board.cards[humanCard].defId].name

function layer(...events: GameEvent[]) {
  const beat = buildBeats(events.map((event, i) => ({ eventIndex: i, event, board })), 'ai')[0]
  return render(<BeatLayer db={db} beat={beat} human={0} root={createRef()} previousRects={{ current: new Map() }} useOfficialImages={false} />)
}

describe('BeatLayer', () => {
  it('renders nothing without a beat', () => {
    const { container } = render(<BeatLayer db={db} beat={null} human={0} root={createRef()} previousRects={{ current: new Map() }} useOfficialImages={false} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('spotlights a played card with a rival caption', () => {
    layer({ type: 'cardPlayed', player: 1, uid: rivalCard })
    expect(screen.getByTestId('beat-spotlight')).toHaveTextContent(rivalName)
    expect(screen.getByTestId('beat-caption')).toHaveTextContent('Rival plays')
  })

  it('shows a face-down legend call as a card back', () => {
    const legend = board.players[1].legends[0]
    layer({ type: 'legendCalled', player: 1, uid: legend })
    expect(screen.getByTestId('beat-spotlight')).not.toHaveTextContent(db[board.cards[legend].defId].name)
  })

  it('names effect targets in the callout instead of raw uids', () => {
    layer({ type: 'effectResolved', sourceUid: rivalCard, description: `defeat ${humanCard}`, targets: [humanCard] })
    const callout = screen.getByTestId('beat-callout')
    expect(callout).toHaveTextContent(rivalName)
    expect(callout).toHaveTextContent(`defeat ${humanName}`)
  })

  it('announces whose turn starts', () => {
    layer({ type: 'turnStarted', player: 1, turn: 3 })
    expect(screen.getByTestId('beat-banner')).toHaveTextContent("RIVAL'S TURN")
  })

  it('draws nothing extra for minor beats', () => {
    layer({ type: 'cardDrawn', player: 1, uid: rivalCard })
    expect(screen.queryByTestId('beat-spotlight')).toBeNull()
    expect(screen.queryByTestId('beat-callout')).toBeNull()
  })
})

describe('effectCaption', () => {
  it('leaves untargeted descriptions alone', () => {
    expect(effectCaption(db, board, { type: 'effectResolved', sourceUid: rivalCard, description: 'draw 2' })).toBe('draw 2')
  })
})
```

If the starter decks mean `board.players[1].legends[0]` is face-up at game start, set `board.cards[legend].faceUp = false` on a `structuredClone` of the board in that one test.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/ui/beatlayer.test.tsx`
Expected: FAIL. The module cannot be resolved.

- [ ] **Step 3: Implement `src/ui/presentation/useFlip.ts`**

```ts
// FLIP card movement between presentation frames: remember where every
// [data-uid] element was, and when the frame changes, animate each moved
// element from its old spot to its new one. The CSS `translate` property is
// used, not `transform`, so hand-fan rotations and spent-card rotations
// compose instead of being overwritten mid-flight.

import { useLayoutEffect, useRef, type RefObject } from 'react'

function measure(root: HTMLElement): Map<string, DOMRect> {
  const rects = new Map<string, DOMRect>()
  root.querySelectorAll<HTMLElement>('[data-uid]').forEach((el) => rects.set(el.dataset.uid!, el.getBoundingClientRect()))
  return rects
}

export function useFlip(
  root: RefObject<HTMLElement | null>,
  frameKey: unknown,
  durationMs: number,
  enabled: boolean,
): RefObject<Map<string, DOMRect>> {
  const current = useRef(new Map<string, DOMRect>())
  const previous = useRef(new Map<string, DOMRect>())

  useLayoutEffect(() => {
    const element = root.current
    if (element === null) return
    const next = measure(element)
    previous.current = current.current
    current.current = next
    if (!enabled) return
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
  }, [frameKey])

  return previous
}
```

`frameKey` is the displayed board object. The dependency array is `[frameKey]` on purpose, so it runs once per frame change. Add `// eslint-disable-next-line react-hooks/exhaustive-deps` only if a linter is ever added; no linter is configured today.

**Diff cues** (spec §4): extend the same layout effect so it also pulses elements whose *value* changed between frames. Elements opt in with `data-pulse-id` (a stable id) and `data-pulse-key` (the value). Add this to the module:

```ts
function pulseKeys(root: HTMLElement): Map<string, string> {
  const keys = new Map<string, string>()
  root.querySelectorAll<HTMLElement>('[data-pulse-id]').forEach((el) => keys.set(el.dataset.pulseId!, el.dataset.pulseKey ?? ''))
  return keys
}
```

Add a `const lastKeys = useRef(new Map<string, string>())` next to `current`. Inside the effect, after the FLIP loop (and still gated by `enabled`):

```ts
    const keys = pulseKeys(element)
    element.querySelectorAll<HTMLElement>('[data-pulse-id]').forEach((el) => {
      const before = lastKeys.current.get(el.dataset.pulseId!)
      if (before === undefined || before === el.dataset.pulseKey || typeof el.animate !== 'function') return
      el.animate([{ filter: 'brightness(1.8)', scale: '1.08' }, { filter: 'none', scale: '1' }], { duration: 420, easing: 'ease-out' })
    })
    lastKeys.current = keys
```

When `enabled` is false, update `lastKeys.current = pulseKeys(element)` before the early `return`, so turning pacing on later doesn't pulse everything at once.

Opt the elements in:
- `src/ui/Field.tsx` (`BoardCard` root div): `data-pulse-id={`power-${uid}`}` and `data-pulse-key={power ?? ''}`. Power changes (buffs) then pulse.
- `src/ui/ZonePanels.tsx` (the eddies zone div): `data-pulse-id={`eddies-${player}`}` and `data-pulse-key={`${p.eddies.length}:${p.eddies.filter((uid) => state.cards[uid].ready).length}`}`.

Ready/spend rotation: inside the reduced-motion block in `motion.css`, add `.card-frame { transition: transform 250ms ease; }`. Before adding it, check `src/ui/styles/cards.css:18` for an existing `transition` on `.card-frame`; if there is one, extend that declaration with `transform 250ms ease` instead of adding a second rule.

Test (append to `tests/ui/beatlayer.test.tsx`):

```tsx
import { useFlip } from '../../src/ui/presentation/useFlip'
import { renderHook } from '@testing-library/react'

it('pulses an element whose data-pulse-key changed between frames', () => {
  const root = document.createElement('div')
  root.innerHTML = '<div data-pulse-id="power-1" data-pulse-key="2"></div>'
  document.body.appendChild(root)
  const el = root.firstElementChild as HTMLElement
  const animate = vi.fn()
  ;(el as unknown as { animate: typeof animate }).animate = animate
  const hook = renderHook(({ key }) => useFlip({ current: root }, key, 1000, true), { initialProps: { key: 1 as unknown } })
  el.dataset.pulseKey = '4'
  hook.rerender({ key: 2 })
  expect(animate).toHaveBeenCalledTimes(1)
  root.remove()
})
```

Add `vi` to the file's `vitest` import.

- [ ] **Step 4: Implement `src/ui/presentation/BeatLayer.tsx`**

```tsx
// The overlay for the beat being shown (docs/superpowers/specs/
// 2026-09-28-effect-pacing-design.md §4). It sits inside .playmat__board (never
// above the playmat) and draws, per beat kind:
//   spotlight  - veil, the card at zoom size, and a caption
//   effect     - a callout next to the source, plus target lines
//   attack     - a line from the attacker to its target
//   turnBanner - a sweep naming whose turn it is
//   defeat and exit-absorbing effects - a ghost flying to the trash or deck pile
// Positions come from the rendered board ([data-uid] and [data-pile]
// elements), falling back to the pre-frame rects for cards that just left.

import { useLayoutEffect, useState, type ReactElement, type RefObject } from 'react'
import { CardFrame } from '../CardFrame'
import { FACE_DOWN_DEF } from '../ZonePanels'
import { describeEvent } from '../useGame'
import type { CardDb, GameEvent, GameState, PlayerId } from '../../engine/types'
import type { Beat } from './beats'

type Box = { x: number; y: number; w: number; h: number }

export function effectCaption(db: CardDb, board: GameState, event: Extract<GameEvent, { type: 'effectResolved' }>): string {
  let text = event.description
  for (const uid of event.targets ?? []) {
    const def = db[board.cards[uid]?.defId ?? '']
    if (def) text = text.replace(new RegExp(`\\b${uid}\\b`, 'g'), def.name)
  }
  return text
}

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
    const exit = beat.events.find((e) => e.type === 'cardTrashed' || e.type === 'cardBottomDecked' || e.type === 'cardRemoved')
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
          <strong>{db[beat.board.cards[event.sourceUid]?.defId ?? '']?.name ?? 'Effect'}</strong>
          <span>{effectCaption(db, beat.board, event)}</span>
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
          style={{
            left: boxes.source.x, top: boxes.source.y, width: boxes.source.w, height: boxes.source.h,
            '--ghost-x': `${boxes.pile.x - boxes.source.x}px`, '--ghost-y': `${boxes.pile.y - boxes.source.y}px`,
          } as React.CSSProperties}
        />
      )}
    </div>
  )
}
```

Add `import type { CSSProperties } from 'react'` and use `CSSProperties` instead of `React.CSSProperties` if the global `React` namespace isn't available under the project's `jsx` setting.

In `src/ui/ZonePanels.tsx`, change `const FACE_DOWN_DEF` to `export const FACE_DOWN_DEF`.

- [ ] **Step 5: Add the DOM hooks for positions**

- `src/ui/HandStrip.tsx`: add `data-uid={uid}` on the `.board-card--hand-back` div.
- `src/ui/ZonePanels.tsx`: add `data-uid={uid}` on each `.eddie-card`, `data-pile="deck"` on the deck `.pile`, and `data-pile="trash"` on the trash `.pile`. (The `zone--counts` wrapper already carries `data-player`.)
- `src/ui/StreetStrip.tsx`: confirm the `gig-area` element carries `data-player={player}`. If it doesn't, add it next to its `data-testid="gig-area"`.

- [ ] **Step 6: Mount the layer and FLIP in `PlayView`**

In `src/ui/PlayView.tsx`:

```ts
import { useRef } from 'react' // merge into the existing react import
import { BeatLayer } from './presentation/BeatLayer'
import { useFlip } from './presentation/useFlip'
```

Near the other hooks (after `const state = ...`), and before any early `return`, so hook order stays stable:

```ts
const boardRef = useRef<HTMLDivElement | null>(null)
const previousRects = useFlip(boardRef, state, presentation.durationMs, speed !== 'instant')
```

Check that no early `return` sits above these lines. If `PlayView` returns early when `state === null` (the setup screen), place both hooks above that return, the same way `usePresentation` is placed.

Then give `<div className="playmat__board">` the prop `ref={boardRef}`, and render as its last child (after the game-over overlay):

```tsx
<BeatLayer db={db} beat={beat} human={HUMAN} root={boardRef} previousRects={previousRects} useOfficialImages={useOfficialImages} />
```

Hide the real card while its spotlight plays. Add a `spotlitUid` prop to `Field`: in `src/ui/Field.tsx`, add `spotlitUid?: number | null` to both prop interfaces, pass it down like `lungeUid`, and add `props.spotlitUid === uid && 'is-spotlit'` to the class list. In `PlayView`, pass `spotlitUid={beat?.kind === 'spotlight' ? beat.sourceUid : null}` to both `<Field>` elements.

- [ ] **Step 7: Styles**

Append to `src/ui/styles/board.css`. These are static layout rules, valid with or without motion:

```css
/* BeatLayer (presentation/BeatLayer.tsx): inside .playmat__board, over the board rows. */
.playmat__board { position: relative; }
.beat-layer { position: absolute; inset: 0; pointer-events: none; z-index: 5; }
.beat-layer--you { --beat-color: var(--you); }
.beat-layer--rival { --beat-color: var(--rival); }
.beat-layer__veil { position: absolute; inset: 0; background: rgba(7, 7, 13, 0.72); }
.beat-layer__spotlight {
  position: absolute; left: 50%; top: 50%; translate: -50% -50%;
  filter: drop-shadow(0 0 22px var(--beat-color));
}
.beat-layer__caption {
  position: absolute; left: 50%; top: 10px; translate: -50% 0; margin: 0;
  padding: 3px 12px; background: var(--panel); border: 1px solid var(--beat-color);
  color: var(--beat-color); font-family: var(--font-display); letter-spacing: 0.08em;
  text-transform: uppercase; white-space: nowrap;
}
.beat-layer__caption--small { font-family: var(--font-body); text-transform: none; letter-spacing: 0; font-size: 13px; }
.beat-layer__callout {
  position: absolute; display: grid; gap: 2px; max-width: 220px; padding: 5px 8px;
  background: var(--panel); border: 1px solid var(--beat-color); font-size: 12px;
}
.beat-layer__callout strong { color: var(--beat-color); font-family: var(--font-display); text-transform: uppercase; }
.beat-layer__lines { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.beat-layer__line { stroke: var(--beat-color); stroke-width: 2; stroke-dasharray: 6 5; }
.beat-layer__target { position: absolute; box-shadow: 0 0 0 2px var(--act), 0 0 16px var(--act); border-radius: 4px; }
.beat-layer__banner {
  position: absolute; left: 0; right: 0; top: 50%; translate: 0 -50%; padding: 10px 0;
  text-align: center; background: linear-gradient(90deg, transparent, var(--panel) 20%, var(--panel) 80%, transparent);
  color: var(--beat-color); font-family: var(--font-display); font-size: 28px; letter-spacing: 0.2em;
}
.beat-layer__ghost { position: absolute; border: 1px solid var(--beat-color); background: var(--panel-2); border-radius: 4px; opacity: 0; }
.board-card.is-spotlit { visibility: hidden; }
```

Append inside the existing `@media (prefers-reduced-motion: no-preference) { ... }` block in `src/ui/styles/motion.css`. These are the beat keyframes; every duration derives from `--beat-ms`, which PlayView sets on the playmat:

```css
  /* Effect pacing (presentation/BeatLayer.tsx). `--beat-ms` is set per beat
     on the playmat by PlayView from the beat's base time and the speed. */
  @keyframes beat-spotlight {
    0% { opacity: 0; scale: 0.35; }
    18%, 78% { opacity: 1; scale: 1; }
    100% { opacity: 0; scale: 0.35; }
  }
  .beat-layer__spotlight { animation: beat-spotlight var(--beat-ms, 1400ms) ease-in-out forwards; }
  @keyframes beat-fade {
    0% { opacity: 0; }
    15%, 85% { opacity: 1; }
    100% { opacity: 0; }
  }
  .beat-layer__veil,
  .beat-layer__caption,
  .beat-layer__callout,
  .beat-layer__target { animation: beat-fade var(--beat-ms, 1000ms) ease-in-out forwards; }
  @keyframes beat-line { from { stroke-dashoffset: 60; } to { stroke-dashoffset: 0; } }
  .beat-layer__line { animation: beat-line calc(var(--beat-ms, 900ms) * 0.5) linear infinite; }
  @keyframes beat-banner {
    0% { opacity: 0; translate: -40% -50%; }
    20%, 80% { opacity: 1; translate: 0 -50%; }
    100% { opacity: 0; translate: 40% -50%; }
  }
  .beat-layer__banner { animation: beat-banner var(--beat-ms, 900ms) ease-in-out forwards; }
  @keyframes beat-ghost {
    0% { opacity: 1; translate: 0 0; }
    100% { opacity: 0.2; translate: var(--ghost-x) var(--ghost-y); scale: 0.6; }
  }
  .beat-layer__ghost { animation: beat-ghost var(--beat-ms, 700ms) ease-in forwards; }
  .playmat.is-presenting.is-paused .beat-layer * { animation-play-state: paused; }
```

In `PlayView`, append `${presentation.paused ? ' is-paused' : ''}` to the playmat root className, next to `is-presenting`.

- [ ] **Step 8: Run the tests**

Run: `npx vitest run tests/ui/beatlayer.test.tsx tests/ui/playview.test.tsx tests/ui/zonepanels.test.tsx tests/ui/streetstrip.test.tsx`
Expected: PASS.

Run: `npm test && npm run build`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -A src/ui tests/ui
git commit -m "feat(ui): beat overlay with spotlight, callouts, target lines, banners and FLIP moves"
```

---

### Task 9: E2E pacing spec, docs and visual verification

**Files:**
- Create: `e2e/pacing.spec.ts`
- Modify: `docs/superpowers/specs/2026-08-23-visual-overhaul-design.md` (the Constraints section, around lines 107–114)
- Modify: `README.md`, only if it documents the `?aiDelay=` query parameter (`grep -n "aiDelay" README.md docs/*.md`)

**Interfaces:**
- Consumes: the testids from Tasks 7–8: `pacing-controls`, `pacing-speed-*`, `pacing-skip-turn`, `beat-layer`, `beat-spotlight`, `beat-banner`, and `data-awaiting="presenting"`.

- [ ] **Step 1: Write the E2E spec**

```ts
// e2e/pacing.spec.ts
// Paced presentation, end to end: at normal pacing, a rival turn plays as
// visible beats, the human prompt waits for playback, and Skip turn drains
// it. Unlike play.spec.ts this runs WITHOUT `?aiDelay=0`, because pacing
// is the point. It never plays a full game.
import { expect, test } from './fixtures'

test('rival actions play as beats before the human is prompted', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ctcg.pacingSpeed', 'fast'))
  await page.goto('/')
  await expect(page.getByTestId('play-setup')).toBeVisible()
  await page.getByTestId('deck-human').selectOption('Arasaka — Embracing Power')
  await page.getByTestId('deck-ai').selectOption('Mercs — The Heist')
  await page.getByTestId('seed-input').fill('20260822')
  await page.getByTestId('start-game').click()

  const playmat = page.getByTestId('playmat')
  await expect(page.getByTestId('pacing-speed-fast')).toBeChecked()

  // Drive the human's opening decisions with the safe defaults until the
  // rival has a turn, then watch it play.
  for (let i = 0; i < 40; i++) {
    const awaiting = await playmat.getAttribute('data-awaiting')
    if (awaiting === 'presenting') break
    if (awaiting === 'human') {
      const endTurn = page.getByTestId('end-turn')
      if (await endTurn.isEnabled()) await endTurn.click()
      else await page.locator('.prompt-bar button').first().click()
    }
    await page.waitForTimeout(100)
  }
  await expect(playmat).toHaveAttribute('data-awaiting', 'presenting', { timeout: 15_000 })
  await expect(page.getByTestId('beat-layer')).toBeVisible()
  await page.screenshot({ path: 'test-results/pacing-beat.png' })

  // Playback blocks the prompt; skipping the turn gets back to the human.
  await expect(page.getByTestId('end-turn')).toBeDisabled()
  await page.getByTestId('pacing-skip-turn').click()
  await expect(playmat).toHaveAttribute('data-awaiting', /^(human|over)$/, { timeout: 30_000 })
  await expect(page.getByTestId('beat-layer')).toHaveCount(0)
})
```

If the opening prompts (play order, mulligan) use buttons outside `.prompt-bar`, read how `e2e/play.spec.ts`'s `takeOneAction` answers them and reuse the same testids (`choose-first`, `keep-hand` and so on) instead of the `.prompt-bar button` fallback.

- [ ] **Step 2: Run the spec**

Run: `npx playwright test e2e/pacing.spec.ts` (from the main checkout)
Expected: PASS, and `test-results/pacing-beat.png` exists. Open it with the Read tool and check that the beat overlay is visible over the board (not above the playmat), that its colors match the rival red, and that nothing overflows the rail.

- [ ] **Step 3: Run the existing E2E suite**

Run: `npm run e2e`
Expected: PASS. `play.spec.ts` uses `?aiDelay=0`, which means Instant, so its flow is unchanged.

- [ ] **Step 4: Update the visual-overhaul constraint**

In `docs/superpowers/specs/2026-08-23-visual-overhaul-design.md`, in the Constraints section, add this line directly under the "never blocks input for more than ~600ms" constraint:

```markdown
- Superseded for paced beats by `2026-09-28-effect-pacing-design.md`: rival actions and the consequences of human actions play as timed beats (skippable, pausable, with an Instant speed). The human's own chosen action still resolves instantly.
```

If `README.md` documents `?aiDelay=`, add one sentence there: "`?aiDelay=0` also forces the Instant playback speed (no beat animations)."

- [ ] **Step 5: Verify in the running app**

Start a dev server on a spare port with the scratch collection:

```powershell
$env:CTCG_COLLECTION_FILE='test-results/e2e-collection.json'; npx vite --port 5180 --strictPort
```

Run it in the background. Then open `http://localhost:5180/`, start a game against the AI at Normal speed, and take screenshots of one spotlight, one effect callout with a target line, and one turn banner. Stop the server afterwards and confirm port 5180 is free (`Get-NetTCPConnection -LocalPort 5180`). Never touch port 5173.

- [ ] **Step 6: Final checks and commit**

Run: `npm test && npm run build`
Expected: PASS.

```bash
git add e2e/pacing.spec.ts docs README.md
git commit -m "test(e2e): paced rival turn; docs: pacing supersedes the 600ms motion rule"
```
