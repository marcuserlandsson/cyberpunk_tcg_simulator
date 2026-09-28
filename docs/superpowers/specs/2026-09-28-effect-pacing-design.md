# Effect pacing and beat presentation — design

Date: 2026-09-28
Status: approved in brainstorming, awaiting spec review

## Goal

Playing against the AI should read like a real card game. Today one AI action
resolves its whole trigger chain inside a single `applyAction` call, the board
jumps to the final state, and the only pacing is a flat 300ms delay before each
AI action. Players cannot follow what happened without reading the log.

Success: every card played and every effect resolved is shown as its own
visual beat, in order, on the board, at a readable pace, with the player in
control of speed.

### Decisions made during brainstorming

- **Scope (B):** rival actions are fully paced. For the human's own actions,
  the chosen action resolves instantly, but its consequences (triggers,
  defeats, draws) are paced.
- **Control (A + pause):** beats auto-play with a speed setting, skip-beat,
  skip-to-end-of-turn and pause.
- **Presentation (C, hybrid):** card plays and legend calls get a center
  spotlight. Effects play in place with a text callout and a target line.
  Minor beats animate without captions.
- **Architecture (option 1):** the engine records a board snapshot at every
  emitted event. The UI plays those frames back.

### Constraints

- The engine stays pure and UI-independent. AI search, the worker and `sim`
  keep calling `applyAction` and pay nothing for recording.
- `?aiDelay=0` and `prefers-reduced-motion: reduce` force the Instant speed,
  which behaves exactly like today. Existing unit and E2E tests keep passing
  unchanged.
- No animation library. Use the Web Animations API (`element.animate`) and
  CSS in `src/ui/styles/motion.css`.
- Visuals reuse the `tokens.css` / `tools.css` vocabulary. Nothing is stacked
  above the playmat; overlays live inside it.
- This spec supersedes the visual-overhaul rule that motion never blocks input
  for more than about 600ms (`2026-08-23-visual-overhaul-design.md`,
  "Constraints"), but only for paced beats. The human's own chosen action
  stays instant.

## 1. Engine: the timeline recorder

### `emit`

Add `emit(draft: GameState, event: GameEvent): void` in `src/engine/`. It is
the single way events are appended. Replace all 50 `draft.events.push(...)`
call sites with it:

- `src/cards/effects.ts`, including `note()`
- `src/cards/scripted/index.ts`
- `src/engine/combat.ts`, `reduce.ts`, `game.ts`, `stealing.ts`,
  `knowledge.ts`, `choices.ts`

### `applyActionTimeline`

```ts
export interface Frame { eventIndex: number; event: GameEvent; board: GameState }
export interface Timeline { state: GameState; frames: Frame[] }
export function applyActionTimeline(db: CardDb, state: GameState, action: Action): Timeline
```

- It sets a module-scoped recorder, calls `applyAction`, clears the recorder
  in `finally`, and returns the frames it collected.
- While the recorder is set, `emit` pushes the event and then records
  `{ eventIndex: draft.events.length - 1, event, board: draftState(draft) }`.
- The recorder is never stored on `GameState`. It stays out of saves,
  `draftState` copies, the game record and AI search.
- `board` is a full `GameState`, so existing components render a frame
  unchanged. There is no parallel view model.
- **Intercepts:** when `runAction` catches `InterceptRequired` and returns the
  original state with `pendingIntercept.view`, the frames recorded so far are
  still returned. Answering replays the whole action and records again from
  the beginning. The UI discards frames at or below its presented watermark
  (section 3).
- Re-entrancy: the engine never calls `applyAction` from inside resolution.
  The only other caller is `replay.ts`, which loads saves outside any
  timeline. So `applyActionTimeline` throws if a recorder is already set.
- **Scratch drafts:** resolution sometimes works on copies of the draft
  (`resolveEffect`, and scripts that return a fresh state). A copy that is
  thrown away could emit events that never reach the result. After the call,
  frames are therefore filtered against the result's events. The result is
  `pendingIntercept.view` when an intercept paused the action, otherwise the
  returned state. A frame is kept only when
  `result.events[frame.eventIndex] === frame.event` (event objects are
  shared by reference across `draftState` copies). When several frames share
  an index, the last one is kept.

### Data additions

- `effectResolved` gains an optional `targets?: number[]`. `note()` callers
  pass the uids they acted on when known.
- `StreetStrip` keys Gig and fixer dice by `die.id`. Ensure every die gets an
  id when created.
- No new event kinds. Buffs, ready/spend and eddies show up as differences
  between consecutive frames.

### Risk: emit ordering

A frame must show what its beat is about:

- **In-place effects** (buff, grant keyword, ready, spend, change gig, draw)
  must emit *after* the mutation, so the frame shows the result.
- **Removal effects** (`defeat`, `bottomDeck`) emit their `effectResolved`
  note *before* the card leaves the field. That is the desired order, because
  the target is still on the board to draw the target line to.
  `unitDefeated` is also pushed before `leaveField`, but `leaveField` then
  emits `cardTrashed` / `cardBottomDecked` / `cardRemoved` *after* the move.
  `buildBeats` therefore lets a `defeat` or `effect` beat absorb an
  immediately following exit event for the same uid. The beat's board is then
  the post-move frame, and `BeatLayer` flies an exit ghost from the card's
  previous position to its pile.
- `bounce` has no exit event, because a return to hand emits nothing. Its
  note moves to *after* `leaveField`, so the effect frame shows the card in
  hand. `spendCard` notes before spending, and moves after it.

Audit `note()` and each `events.push` site against these two rules and move
the emits that break them. Regression tests cover representative primitives
(section 5).

### Cost

About 10–40 frames per action. Each frame is one `draftState` copy (around 100
card objects). Frames are UI-only and discarded once presented.

## 2. Beat model

`buildBeats(frames: Frame[], actor: 'human' | 'ai'): Beat[]` is a pure
function in `src/ui/presentation/beats.ts`. Captions are not stored on the
beat. `BeatLayer` renders them at display time with `describeEvent`, which
keeps `beats.ts` free of a dependency on `useGame.ts`. Effect callouts and the
log's effect lines both use `describeEffect`
(`src/ui/presentation/describeEffect.ts`), which turns the engine's terse notes
into readable text: a `scripted:*` note shows the source card's printed text
(trimmed to about 140 characters), `mode N` reads "chooses an effect", Gig
notes read "sets a Gig from a to b" / "matches a Gig: a → b" / "swaps two
Gigs", and card uids are named only in their own slot (never by a global
replace), with hidden cards reading "a face-down card".

```ts
type BeatKind = 'turnBanner' | 'spotlight' | 'effect' | 'attack' | 'block'
  | 'defeat' | 'steal' | 'dieRoll' | 'minor' | 'silent' | 'gameOver'
interface Beat {
  id: number               // = lastIndex; unique within a game
  kind: BeatKind
  events: GameEvent[]      // one or more consecutive events
  firstIndex: number       // event index range covered
  lastIndex: number
  board: GameState         // the frame at lastIndex
  baseMs: number           // duration before the speed multiplier; 0 = instant
  player: PlayerId | null
  sourceUid: number | null
  targets: (number | 'gigArea')[]
  step: number             // 1-based position within this action's beats
  of: number               // number of beats this action produced
}
```

| Kind | Triggering events | Visual | Base time |
|---|---|---|---|
| turnBanner | `turnStarted`, plus the ready and draw events that follow it | "RIVAL'S TURN" / "YOUR TURN" sweep | 900ms |
| spotlight | `cardPlayed`, `legendCalled` | Board veil, the card goes center stage with a caption, then flies to its slot | 1400ms |
| effect | `effectResolved`; absorbs an immediately preceding `abilityActivated`, and a `mode N` note absorbs the next `effectResolved` of the same source | Source pulses, callout with the readable description (`describeEffect`), line to each target | 1100ms |
| attack | `attackDeclared` | Attacker lunges, line to the target unit or Gig area | 900ms |
| block | `attackBlocked` | Blocker highlighted, attack line re-points to it | 700ms |
| defeat | `unitDefeated` | Glitch, then the card flies to trash | 700ms |
| steal | `gigStolen` | Existing steal-fly, keyed by die id | 900ms |
| dieRoll | `dieRolled` | Existing tumble | 700ms |
| minor | `cardDrawn`, `cardSold`, `cardTrashed`, `cardBottomDecked`, `cardRemoved`, `cardRevealed`, `mulliganTaken`, `handKept` | Card moves between zones, no caption. Consecutive same-kind events by the same player merge into one beat | 350ms |
| silent | `turnEnded`, `gameStarted`, `playOrderChosen` | Frame applies instantly | 0 |
| gameOver | `gameEnded` | Existing glitch, then the overlay | 600ms |

### Human actions

When `actor === 'human'`, walk the beats in order:

- `minor` and `silent` beats get `baseMs = 0`.
- The first *primary* beat (`spotlight`, `effect`, `attack`, `block`,
  `steal`, `dieRoll`) also gets `baseMs = 0`, and the walk stops. That beat is
  the action the player just chose.
- Any other kind (`turnBanner`, `defeat`, `gameOver`) stops the walk without
  being zeroed. Ending your turn therefore still shows the rival's turn banner.

Every later beat is paced normally. Beats with `baseMs = 0` are acknowledged
immediately. Their frame is still committed, so cards glide to their new
positions over a short fixed movement (section 4).

In manual practice mode, every action counts as the human's.

### Hidden information

Frames render through the same components that already hide the rival's hand
and face-down cards. A rival draw shows a card back moving into their hand. A
face-down legend call spotlights the card back. Captions come from
`describeEvent`, which already hides rival draws.

## 3. Player: queue, clock and gating

### Queue ownership (`useGame`)

- `useGame` holds `beats: Beat[]` and a `presentedIndex` watermark, and
  exposes `ackBeat()`.
- `applyOne` uses `applyActionTimeline`. It filters out frames with
  `eventIndex <= presentedIndex`, builds beats, and appends them.
  `presentedIndex` advances as beats are acknowledged.
- Undo and load clear the queue and set
  `presentedIndex = state.events.length - 1`.
- Instant speed: beats are not queued. The watermark jumps to the end.

### Clock (`usePresentation`)

`usePresentation(beats, ackBeat, speed)` returns:

- `displayed`: the board to render. This is the current beat's board, or
  `game.state` when the queue is empty.
- `beat`: the current beat, or null.
- `controls`:
  - `skipBeat`: click on the playmat, or Space
  - `skipTurn`: drains the queue up to the next human decision point.
    Shift+Space or a button.
  - `togglePause`: P or a button
  - `setSpeed`: Slow ×1.5, Normal ×1, Fast ×0.5, Instant
- Speed is saved in `localStorage`, with reads and writes wrapped in
  try/catch.
- The clock pauses while `document.visibilityState === 'hidden'`.
- `PlayView` renders `displayed` everywhere it rendered `game.state`
  (`pendingIntercept.view` handling applies on top as today).

### Gating

- **AI:** the worker may start thinking while beats play, which hides hard-mode
  thinking time. Its result is applied only once the queue is empty. The
  "Rival is thinking…" chip shows only when the queue is empty and the AI
  hasn't answered yet. Pausing therefore also holds the AI.
- **Human:**
  - Action buttons, reaction prompts and intercept choices render only when
    the queue is empty.
  - `data-awaiting` reports `human` only when the queue is empty. During
    playback it reports `presenting`. Existing E2E waits on `human|over`, so
    they are unaffected.
  - Clicking the playmat during playback is `skipBeat`, not a game action.

### Log sync

- `LogLine` gains `eventIndex`, and `buildLog` takes `upTo`.
- The log shows lines up to the current beat's `lastIndex` and highlights the
  lines inside the current beat.

### Retiring `useAnimations`

Lunge, tumble, steal-fly and glitch become beat animations driven by
`BeatLayer`. Delete `src/ui/useAnimations.ts` and its test, and move the
behavior it covered to the new tests.

## 4. Visual layer

- **`BeatLayer`** (`src/ui/presentation/BeatLayer.tsx`): absolutely positioned
  inside the playmat. It renders:
  - the spotlight veil and card (using the existing card face component)
  - effect callouts
  - an SVG line layer for attack and effect targets
  - the turn banner
- Card components get `data-uid`. `BeatLayer` finds source and target
  elements with `querySelector('[data-uid="…"]')` and measures them with
  `getBoundingClientRect`.
- **`useFlip`**: before a displayed-frame change, record the rects of
  `[data-uid]` elements. After commit, animate each moved card from its old
  rect to its new one with `element.animate`. This covers draws, field
  entries, trash and bottom-deck. Cards that appear with no previous rect
  animate in from their zone's pile element.
- **Diff cues:**
  - The power badge pulses when effective power differs from the previous
    frame.
  - Ready/spend uses a CSS rotation transition.
  - An eddy count change pulses the eddy panel.
- **Timing:** one CSS custom property, `--beat-ms`, set per beat
  (`baseMs × speed`). All beat keyframes derive from it.
- **Colors:** `--you` for human beats, `--rival` for rival beats, `--act` for
  target highlights.
- **Control bar:** in the right rail, near the log, using `tools.css` button
  styles. It holds speed, pause and skip-turn buttons and a
  "beat n of m this action" indicator.

## 5. Testing

- **Engine** (`tests/engine/timeline.test.ts`):
  - Fuzz: for fixed sim seeds, replay AI-vs-AI games through both
    `applyAction` and `applyActionTimeline`. Final states and event arrays must
    be deep-equal, and the frame count must equal the number of new events.
  - Frame `eventIndex` values are strictly increasing.
  - An action that hits an intercept returns frames up to the pause point.
  - A nested `applyActionTimeline` throws.
  - The recorder is cleared after a thrown `IllegalActionError`.
  - Representative primitives follow the ordering rules above. A buff frame
    shows the new power. A defeat effect's frame still has the target on the
    field, and the following `unitDefeated` frame has it in the trash.
  - An event emitted on a scratch draft that is thrown away produces no
    frame.
- **Beats** (`tests/ui/beats.test.ts`): table-driven tests for grouping,
  minor-beat merging, absorbing `abilityActivated`, human first-beat instant,
  and a hidden rival draw caption.
- **Clock** (`tests/ui/presentation.test.ts`, fake timers): speed multipliers,
  skipBeat, skipTurn, pause, visibility pause, Instant bypass.
- **useGame** (`tests/ui/usegame.test.ts`):
  - The AI action is held until the queue is empty.
  - An intercept replay does not replay presented beats.
  - Undo and load clear the queue.
  - `data-awaiting` changes only after the queue drains.
- **Existing tests:** they keep `aiDelayMs: 0` and `?aiDelay=0`, which means
  Instant. They should need no changes beyond the `useAnimations` removal.
- **New E2E** (`e2e/pacing.spec.ts`): at normal speed, a rival card play shows
  the spotlight, Space skips it, and the human prompt appears only after
  playback. It includes a screenshot. Run it in the main checkout, because
  worktrees lack card art.

## Out of scope

- Sound.
- A replay viewer for past turns.
- A spotlight for the human's own chosen card.
- Animating hand reordering.
