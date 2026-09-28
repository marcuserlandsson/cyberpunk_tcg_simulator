// @vitest-environment jsdom
// Tests for the Play view's game-driving hook (src/ui/useGame.ts).
//
// The hook owns exactly one thing the components must not: the loop that
// alternates between the human's decisions and the AI's. Everything asserted
// below is about that loop's contract — the human is always player 0, `legal`
// is empty whenever it is not the human's decision, `act` advances the record,
// and `undo` lands back on the human's previous decision point with the AI's
// answers to the undone action removed.
//
// `aiDelayMs: 0` throughout: the ~300ms pacing delay is a readability feature,
// not part of the contract, and waiting for it would just make the suite slow.

import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { loadCardDb } from '../../src/engine/cardDb'
import { newGame } from '../../src/engine/game'
import { actingPlayer } from '../../src/engine/query'
import { legalActions } from '../../src/engine/legal'
import { applyAction } from '../../src/engine/reduce'
import { gameProvenance, replay, type GameRecord } from '../../src/engine/replay'
import { AI_VERSION } from '../../src/ai/agents'
import { describeEvent, useGame } from '../../src/ui/useGame'
import type { DeckList } from '../../src/engine/deck'
import type { Action, CardDb } from '../../src/engine/types'
import arasakaDeck from '../../data/decks/arasaka-embracing-power.json'
import mercsDeck from '../../data/decks/mercs-the-heist.json'

const db: CardDb = loadCardDb()
const arasaka = arasakaDeck as unknown as DeckList
const mercs = mercsDeck as unknown as DeckList

const SEED = 20260822

function mount() {
  return renderHook(() => useGame(db, { aiDelayMs: 0 }))
}

type Hook = ReturnType<typeof mount>

/** Starts a game with the human on player 0 and waits for their first decision. */
async function startAndWait(hook: Hook, seed = SEED): Promise<void> {
  await act(async () => {
    hook.result.current.start(arasaka, mercs, seed)
  })
  await waitFor(() => expect(hook.result.current.legal.length).toBeGreaterThan(0))
}

/** Takes the human action at `index` and waits for the next human decision. */
async function takeAction(hook: Hook, index = 0): Promise<void> {
  const action = hook.result.current.legal[index]
  await act(async () => {
    hook.result.current.act(action)
  })
  await waitFor(() =>
    expect(
      hook.result.current.legal.length > 0 || hook.result.current.state?.phase === 'gameOver'
    ).toBe(true)
  )
}

describe('useGame', () => {
  it('starts empty', () => {
    const hook = mount()
    expect(hook.result.current.state).toBeNull()
    expect(hook.result.current.record).toBeNull()
    expect(hook.result.current.legal).toEqual([])
    expect(hook.result.current.canUndo).toBe(false)
    expect(hook.result.current.eventsForLog).toEqual([])
    expect(hook.result.current.loadError).toBeNull()
  })

  it('starts a game against the heuristic AI and reaches a human decision', async () => {
    const hook = mount()
    await startAndWait(hook)

    const { state, record, legal } = hook.result.current
    expect(state).not.toBeNull()
    expect(record).not.toBeNull()
    expect(legal.length).toBeGreaterThan(0)
    // The human is always player 0, and `legal` is only ever populated when it
    // is genuinely their decision.
    expect(actingPlayer(state!)).toBe(0)
    expect(legal).toEqual(legalActions(db, state!))
    expect(record!.config.seed).toBe(SEED)
    expect(record!.config.decks[0]).toEqual(arasaka)
    expect(record!.config.decks[1]).toEqual(mercs)
  })

  it('runs the AI itself, so the record can already hold rival actions', async () => {
    // Seeds differ in who wins the opening d20 roll; across a handful of them
    // at least one has the AI acting before the human ever does, which is the
    // case that proves the hook drives the AI without being prompted.
    const seenAiFirst: boolean[] = []
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const hook = mount()
      await startAndWait(hook, seed)
      seenAiFirst.push(hook.result.current.record!.actions.length > 0)
      hook.unmount()
    }
    expect(seenAiFirst).toContain(true)
  })

  it('advances the record when the human acts', async () => {
    const hook = mount()
    await startAndWait(hook)
    const before = hook.result.current.record!.actions.length
    const chosen = hook.result.current.legal[0]

    await takeAction(hook)

    const after = hook.result.current.record!
    expect(after.actions.length).toBeGreaterThan(before)
    expect(after.actions[before]).toEqual(chosen)
    // The live state is always exactly the fold of the record.
    expect(hook.result.current.state).toEqual(replay(db, after))
  })

  it('keeps `legal` empty and `state` non-null once the game is over', async () => {
    const hook = mount()
    await startAndWait(hook)
    // Play a long stretch of the game out with the "first legal action" policy;
    // it terminates well inside this cap on every seed the suite uses.
    for (let i = 0; i < 400; i++) {
      if (hook.result.current.state!.phase === 'gameOver') break
      await takeAction(hook)
    }
    expect(hook.result.current.state!.phase).toBe('gameOver')
    expect(hook.result.current.state!.winner).not.toBeNull()
    expect(hook.result.current.legal).toEqual([])
    expect(hook.result.current.eventsForLog.at(-1)!.text).toMatch(/Game over/)
  })

  it('undo returns to the human`s previous decision point', async () => {
    const hook = mount()
    await startAndWait(hook)
    // Two human actions in, so the undone one is not the very first action of
    // the game (whose undo would be indistinguishable from a fresh start).
    await takeAction(hook)
    const snapshotState = hook.result.current.state
    const snapshotRecord = hook.result.current.record!
    const snapshotLegal = hook.result.current.legal

    await takeAction(hook)
    expect(hook.result.current.record!.actions.length).toBeGreaterThan(
      snapshotRecord.actions.length
    )

    await act(async () => {
      hook.result.current.undo()
    })

    expect(hook.result.current.record).toEqual(snapshotRecord)
    expect(hook.result.current.state).toEqual(snapshotState)
    expect(hook.result.current.legal).toEqual(snapshotLegal)
    expect(actingPlayer(hook.result.current.state!)).toBe(0)
  })

  it('undo does not let the AI immediately re-act', async () => {
    const hook = mount()
    await startAndWait(hook)
    await takeAction(hook)
    const snapshot = hook.result.current.record!

    await takeAction(hook)
    await act(async () => {
      hook.result.current.undo()
    })
    // Give any stray AI timer the chance to fire before asserting nothing did.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(hook.result.current.record).toEqual(snapshot)
  })

  it('undo twice steps back two human decisions', async () => {
    const hook = mount()
    await startAndWait(hook)
    const first = hook.result.current.record!
    await takeAction(hook)
    const second = hook.result.current.record!
    await takeAction(hook)

    await act(async () => {
      hook.result.current.undo()
    })
    expect(hook.result.current.record).toEqual(second)

    await act(async () => {
      hook.result.current.undo()
    })
    expect(hook.result.current.record).toEqual(first)
  })

  it('canUndo is false before the human has acted and true after', async () => {
    const hook = mount()
    await startAndWait(hook)
    expect(hook.result.current.canUndo).toBe(false)
    await takeAction(hook)
    expect(hook.result.current.canUndo).toBe(true)
  })

  it('undo is a no-op when there is nothing of the human`s to undo', async () => {
    const hook = mount()
    await startAndWait(hook)
    const before = hook.result.current.record!
    await act(async () => {
      hook.result.current.undo()
    })
    expect(hook.result.current.record).toEqual(before)
  })

  it('load replays a record and continues from it', async () => {
    const hook = mount()
    await startAndWait(hook)
    await takeAction(hook)
    const saved = hook.result.current.record!
    const savedState = hook.result.current.state

    const fresh = mount()
    await act(async () => {
      fresh.result.current.load(saved)
    })
    await waitFor(() => expect(fresh.result.current.state).not.toBeNull())
    expect(fresh.result.current.record).toEqual(saved)
    expect(fresh.result.current.state).toEqual(savedState)
    // ...and it is playable: undo works on a loaded record too, because
    // attribution is recomputed from the record rather than remembered.
    expect(fresh.result.current.canUndo).toBe(true)
  })

  it('load surfaces an error for a record that no longer replays, instead of throwing', async () => {
    const hook = mount()
    // Hand-corrupted: `endTurn` is not legal as the very first action (the
    // game opens in `chooseOrder`), the same shape a save written before a
    // rules/card-data change would take once replay reaches the point that
    // changed.
    const corrupt = {
      config: { decks: [arasaka, mercs], seed: SEED },
      actions: [{ type: 'endTurn' }],
    }

    await act(async () => {
      // Must not throw out of the click handler.
      hook.result.current.load(corrupt as never)
    })

    expect(hook.result.current.loadError).toBe(
      "This save predates a rules change and can't be resumed."
    )
    // The broken load must not leave a half-built game behind.
    expect(hook.result.current.state).toBeNull()
    expect(hook.result.current.record).toBeNull()

    // A subsequent successful load/start clears the error.
    await startAndWait(hook)
    expect(hook.result.current.loadError).toBeNull()
  })

  it('clearLoadError dismisses the error without touching the game', async () => {
    const hook = mount()
    const corrupt = {
      config: { decks: [arasaka, mercs], seed: SEED },
      actions: [{ type: 'endTurn' }],
    }
    await act(async () => {
      hook.result.current.load(corrupt as never)
    })
    expect(hook.result.current.loadError).not.toBeNull()

    await act(async () => {
      hook.result.current.clearLoadError()
    })
    expect(hook.result.current.loadError).toBeNull()
  })

  it('resumes a loaded record with the same AI, so play is reproducible', async () => {
    const hook = mount()
    await startAndWait(hook)
    await takeAction(hook)
    await takeAction(hook)
    const original = hook.result.current.record!

    // Rewind to the previous human decision, replay the identical action, and
    // the AI must answer it identically — the AI seed is derived from the
    // record, never from a mutable agent position.
    await act(async () => {
      hook.result.current.undo()
    })
    const rewound = hook.result.current.record!
    const nextAction = original.actions[rewound.actions.length]
    await act(async () => {
      hook.result.current.act(nextAction)
    })
    await waitFor(() =>
      expect(
        hook.result.current.legal.length > 0 ||
          hook.result.current.state?.phase === 'gameOver'
      ).toBe(true)
    )
    expect(hook.result.current.record).toEqual(original)
  })

  it('builds a human-readable log with turn numbers', async () => {
    const hook = mount()
    await startAndWait(hook)
    await takeAction(hook)

    const log = hook.result.current.eventsForLog
    expect(log.length).toBeGreaterThan(0)
    for (const line of log) {
      expect(typeof line.text).toBe('string')
      expect(line.text.length).toBeGreaterThan(0)
      expect(Number.isInteger(line.turn)).toBe(true)
    }
    expect(log[0].text).toMatch(/^Game started/)
  })

  it('save persists the record under a name', async () => {
    const hook = mount()
    await startAndWait(hook)
    await takeAction(hook)
    await act(async () => {
      hook.result.current.save('slot-a')
    })
    const raw = window.localStorage.getItem('ctcg:gameRecords:v1')
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw!)['slot-a']).toEqual(
      JSON.parse(JSON.stringify(hook.result.current.record))
    )
  })
})

describe('describeEvent', () => {
  it('describes every event of a played-out game without falling back', async () => {
    const hook = mount()
    await startAndWait(hook)
    for (let i = 0; i < 400; i++) {
      if (hook.result.current.state!.phase === 'gameOver') break
      await takeAction(hook)
    }
    const state = hook.result.current.state!
    const kinds = new Set(state.events.map((event) => event.type))
    // A real game exercises a broad slice of the event vocabulary; every one
    // of them must produce a real sentence, not the unknown-event fallback.
    expect(kinds.size).toBeGreaterThan(8)
    for (const event of state.events) {
      const text = describeEvent(db, state, event)
      expect(text.length).toBeGreaterThan(0)
      expect(text).not.toMatch(/^\[/)
    }
  })

  it('writes the log from the human`s point of view', async () => {
    const hook = mount()
    await startAndWait(hook)
    const state = hook.result.current.state!
    expect(describeEvent(db, state, { type: 'handKept', player: 0 })).toBe('You kept your hand.')
    expect(describeEvent(db, state, { type: 'handKept', player: 1 })).toBe(
      'Rival kept their hand.'
    )
    expect(describeEvent(db, state, { type: 'dieRolled', player: 1, size: 8, value: 6 })).toBe(
      'Rival rolled a d8: 6.'
    )
    expect(
      describeEvent(db, state, { type: 'gigStolen', from: 0, die: { size: 8, value: 6 } })
    ).toBe('Rival stole your d8 (6).')
    expect(
      describeEvent(db, state, { type: 'gigStolen', from: 1, die: { size: 8, value: 6 } })
    ).toBe("You stole Rival's d8 (6).")
  })

  it('never reveals the contents of a rival draw', async () => {
    const hook = mount()
    await startAndWait(hook)
    const state = hook.result.current.state!
    const rivalCard = state.players[1].hand[0]
    const line = describeEvent(db, state, { type: 'cardDrawn', player: 1, uid: rivalCard })
    expect(line).toBe('Rival drew a card.')
    expect(line).not.toContain(db[state.cards[rivalCard].defId].name)
  })

  it('falls back to a generic line on an unknown event type', async () => {
    const hook = mount()
    await startAndWait(hook)
    const state = hook.result.current.state!
    // Deliberately not a member of the GameEvent union: an event kind added by
    // a future engine change must not crash the log panel.
    const line = describeEvent(db, state, { type: 'somethingNew', extra: 1 } as never)
    expect(line).toBe('[somethingNew]')
  })
})

it('manual practice controls both seats, never schedules AI, and saves/undoes a single decision', async () => {
  vi.useFakeTimers()
  const hook=renderHook(()=>useGame(db,{manual:true,aiDelayMs:0}))
  try {
    act(()=>hook.result.current.start(arasaka,mercs,42))
    const seats=new Set<number>()
    for(let i=0;i<35 && hook.result.current.state?.phase!=='gameOver';i++){
      const current=hook.result.current
      seats.add(actingPlayer(current.state!))
      expect(current.aiThinking).toBe(false)
      const length=current.record!.actions.length
      act(()=>vi.advanceTimersByTime(1000))
      expect(hook.result.current.record!.actions).toHaveLength(length)
      const available=current.legal
      const chosen=available.find(a=>a.type==='keepHand') ?? available.find(a=>a.type==='endTurn') ?? available[0]
      expect(chosen).toBeDefined()
      act(()=>hook.result.current.act(chosen))
    }
    expect([...seats].sort()).toEqual([0,1])
    const before=hook.result.current.record!
    expect(before.practiceMode).toBe(true)
    act(()=>hook.result.current.undo())
    expect(hook.result.current.record!.actions).toHaveLength(before.actions.length-1)
    expect(hook.result.current.state).toEqual(replay(db,hook.result.current.record!))
    act(()=>hook.result.current.load(before))
    expect(hook.result.current.aiThinking).toBe(false)
    act(()=>vi.advanceTimersByTime(1000))
    expect(hook.result.current.record).toEqual(before)
  } finally { hook.unmount();vi.useRealTimers() }
})

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

  /**
   * A record whose next human action pauses for a human intercept, and only
   * after the pause itself has already emitted at least one event.
   */
  function findInterceptPause(): { seed: number; prefix: Action[]; action: Action } {
    // The pre-pause events must exist, so the tests below can see them. (A
    // pause with nothing emitted yet, like the very first `callLegend` of a
    // game, would make their assertions vacuously true.)
    let found: { seed: number; prefix: Action[]; action: Action } | null = null
    for (let seed = 1; seed <= 150 && found === null; seed++) {
      let state = newGame(db, { decks: [arasaka, mercs], seed })
      const prefix: Action[] = []
      for (let i = 0; i < 250 && state.phase !== 'gameOver' && found === null; i++) {
        const actions = legalActions(db, state)
        if (actions.length === 0) break
        const action = actions[(seed * 7 + i) % actions.length]
        const next = applyAction(db, state, action)
        const pausedAfterEvents = (next.pendingIntercept?.view ?? next).events.length - 1 > state.events.length - 1
        if (next.phase === 'intercept' && next.pendingIntercept?.player === 0 && actingPlayer(state) === 0 && pausedAfterEvents) {
          found = { seed, prefix: [...prefix], action }
        }
        prefix.push(action)
        state = next
      }
    }
    expect(found).not.toBeNull()
    return found!
  }

  function interceptRecord(found: { seed: number; prefix: Action[] }): GameRecord {
    return {
      practiceMode: true,
      aiDifficulty: 'medium',
      aiVersion: AI_VERSION,
      provenance: gameProvenance(db),
      config: { decks: [arasaka, mercs], seed: found.seed },
      actions: found.prefix,
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
    // It is still the AI's decision after the beat it just queued: the 20ms
    // wait below proves an AI move is genuinely held, not just that nothing
    // happens because it is the human's turn.
    expect(actingPlayer(hook.result.current.state!)).toBe(1)
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
    const found = findInterceptPause()
    const hook = mountPaced()
    await act(async () => hook.result.current.load(interceptRecord(found)))
    await act(async () => hook.result.current.act(found.action))
    const shown = new Set<number>()
    for (const beat of hook.result.current.beats) for (let i = beat.firstIndex; i <= beat.lastIndex; i++) shown.add(i)
    // The pause itself must have produced beats, or the loop below that checks
    // nothing was re-shown would pass trivially.
    expect(shown.size).toBeGreaterThan(0)
    await drain(hook)
    expect(hook.result.current.state!.phase).toBe('intercept')
    await act(async () => hook.result.current.act(hook.result.current.legal[0]))
    // The intercept answer's own beats must be real, or the "none were shown
    // before" check below would also pass trivially.
    expect(hook.result.current.beats.length).toBeGreaterThan(0)
    for (const beat of hook.result.current.beats) expect(shown.has(beat.firstIndex)).toBe(false)
  })

  // Final review M5: once the queue drains during an intercept pause, the log
  // must still show the events that led up to the pause.
  it('keeps the pre-pause log lines once the queue drains during an intercept', async () => {
    const found = findInterceptPause()
    const hook = mountPaced()
    await act(async () => hook.result.current.load(interceptRecord(found)))
    await act(async () => hook.result.current.act(found.action))
    await drain(hook)
    const state = hook.result.current.state!
    expect(state.phase).toBe('intercept')
    const view = state.pendingIntercept!.view!
    expect(view.events.length).toBeGreaterThan(state.events.length)
    expect(hook.result.current.eventsForLog).toHaveLength(view.events.length)
  })
})
