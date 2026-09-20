// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useGame, HARD_THINKING_LIMIT_MS } from '../../src/ui/useGame'
import { loadCardDb } from '../../src/engine/cardDb'
import { newGame } from '../../src/engine/game'
import { actingPlayer } from '../../src/engine/query'
import { legalActions } from '../../src/engine/legal'
import { AI_VERSION, type AiDifficulty } from '../../src/ai/agents'
import type { AiWorker, AiRequest } from '../../src/ai/workerProtocol'
import type { DeckList } from '../../src/engine/deck'
import deckJson from '../../data/decks/arasaka-embracing-power.json'
const db = loadCardDb()
const deck = deckJson as unknown as DeckList
let seed = 1
while (actingPlayer(newGame(db, { decks: [deck, deck], seed })) !== 1) seed++
function harness() {
  const requests: AiRequest[] = []
  const workers: AiWorker[] = []
  const factory = () => {
    const worker: AiWorker = { onmessage: null, onerror: null,
      postMessage: vi.fn(request => requests.push(request)), terminate: vi.fn() }
    workers.push(worker)
    return worker
  }
  const hook = renderHook(({ difficulty }: { difficulty: AiDifficulty }) => useGame(db, {
    aiDelayMs: 0, aiDifficulty: difficulty, createAiWorker: factory,
  }), { initialProps: { difficulty: 'hard' as AiDifficulty } })
  return { ...hook, requests, workers }
}
describe('live AI worker', () => {
  it('uses the latest completed line at the ten-second deadline and ignores late work', async () => {
    vi.useFakeTimers()
    const h = harness()
    try {
      act(() => h.result.current.start(deck, deck, seed))
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      expect(h.requests).toHaveLength(1)
      const offered = legalActions(db, h.requests[0].state)
      const reply = h.workers[0].onmessage!
      act(() => reply.call(h.workers[0] as Worker, new MessageEvent('message', { data: { type: 'progress', action: offered[0] } })))
      const latest = offered[offered.length - 1]
      act(() => reply.call(h.workers[0] as Worker, new MessageEvent('message', { data: { type: 'progress', action: latest } })))
      await act(async () => { await vi.advanceTimersByTimeAsync(HARD_THINKING_LIMIT_MS - 1) })
      expect(h.result.current.record?.actions).toHaveLength(0)
      await act(async () => { await vi.advanceTimersByTimeAsync(1) })
      expect(h.result.current.record?.actions).toEqual([latest])
      expect(h.workers[0].terminate).toHaveBeenCalled()
      act(() => reply.call(h.workers[0] as Worker, new MessageEvent('message', { data: { type: 'action', action: offered[0] } })))
      expect(h.result.current.record?.actions).toEqual([latest])
    } finally { h.unmount(); vi.useRealTimers() }
  })

  it('pins difficulty to the game and ignores late results after replacement and unmount', async () => {
    const h = harness()
    act(() => h.result.current.start(deck, deck, seed))
    await waitFor(() => expect(h.requests).toHaveLength(1))
    expect(h.requests[0].difficulty).toBe('hard')
    expect(h.result.current.record?.aiVersion).toBe(AI_VERSION)
    h.rerender({ difficulty: 'easy' })
    expect(h.result.current.record?.aiDifficulty).toBe('hard')
    const stale = h.workers[0].onmessage!
    const response = new MessageEvent('message', { data: { type: 'action', action: legalActions(db, h.requests[0].state)[0] } })
    act(() => h.result.current.start(deck, deck, seed))
    await waitFor(() => expect(h.requests).toHaveLength(2))
    expect(h.workers[0].terminate).toHaveBeenCalled()
    act(() => stale.call(h.workers[0] as Worker, response))
    expect(h.result.current.record?.actions).toHaveLength(0)
    expect(h.requests[1].difficulty).toBe('easy')
    h.unmount()
    expect(h.workers[1].terminate).toHaveBeenCalled()
  })
  it('resumes legacy records as Medium and exposes worker errors with a retry', async () => {
    const h = harness()
    act(() => h.result.current.load({ config: { decks: [deck,deck], seed }, actions: [] }))
    await waitFor(() => expect(h.requests).toHaveLength(1))
    expect(h.requests[0].difficulty).toBe('medium')
    act(() => h.workers[0].onerror!.call(h.workers[0] as Worker, new ErrorEvent('error')))
    expect(h.result.current.aiError).toContain('Try again')
    expect(h.result.current.aiThinking).toBe(false)
    act(() => h.result.current.retryAI())
    await waitFor(() => expect(h.requests).toHaveLength(2))
    expect(h.result.current.aiError).toBeNull()
    const action = legalActions(db, h.requests[1].state)[0]
    act(() => h.workers[1].onmessage!.call(h.workers[1] as Worker, new MessageEvent('message', { data: { type: 'action', action } })))
    expect(h.result.current.record?.actions[0]).toEqual(action)
    h.unmount()
  })
})
