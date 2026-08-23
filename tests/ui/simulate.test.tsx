// @vitest-environment jsdom
//
// Task 15: the Simulate view. A real Worker is unsupported in jsdom, so every
// test injects a `FakeWorker` through the `createWorker` prop and drives its
// `onmessage` handler by hand (`emit`) — this gives full control over when
// progress/result messages land, which is what lets the "progress advances
// the bar" and "cancel terminates before a result arrives" cases be tested
// deterministically, rather than racing a real async worker.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SimulateView, type SimWorkerLike } from '../../src/ui/SimulateView'
import { loadCardDb } from '../../src/engine/cardDb'
import { saveDeck, saveSimResult } from '../../src/ui/storage'
import { toCsv, type SimResult } from '../../src/sim/runner'
import type { SimWorkerMessage } from '../../src/sim/worker'
import type { DeckList } from '../../src/engine/deck'

const db = loadCardDb()

const CANNED_RESULT: SimResult = {
  games: [
    { winner: 0, turns: 10, reason: 'sevenGigs', seed: 42 },
    { winner: 1, turns: 12, reason: 'deckout', seed: 43 },
    { winner: 0, turns: 8, reason: 'sevenGigs', seed: 44 },
  ],
  winRateA: 2 / 3,
  avgTurns: 10,
  cardStatsA: [
    { defId: 'mantis-blades', timesPlayed: 5, gamesSeen: 5, winRateWhenPlayed: 0.2 },
    { defId: 'minotaur', timesPlayed: 2, gamesSeen: 2, winRateWhenPlayed: 0.8 },
    { defId: 'unseen-card', timesPlayed: 0, gamesSeen: 0, winRateWhenPlayed: 0 },
  ],
  cardStatsB: [{ defId: 'minotaur', timesPlayed: 2, gamesSeen: 2, winRateWhenPlayed: 0.5 }],
  reasons: { sevenGigs: 2, deckout: 1 },
}

/** A fake `SimWorkerLike`: `emit` delivers a message on demand so tests can
 * observe intermediate state (a progress tick) before the final result. */
class FakeWorker implements SimWorkerLike {
  postMessage = vi.fn()
  terminate = vi.fn()
  onmessage: ((event: MessageEvent<SimWorkerMessage>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null

  emit(message: SimWorkerMessage): void {
    this.onmessage?.({ data: message } as MessageEvent<SimWorkerMessage>)
  }

  fail(message: string): void {
    this.onerror?.(new ErrorEvent('error', { message }))
  }
}

/** Renders SimulateView with a fresh FakeWorker factory and returns the last
 * worker instance created (there is only ever one live worker at a time in
 * these tests). */
function renderView(): { worker: () => FakeWorker } {
  let current: FakeWorker | null = null
  render(
    <SimulateView
      db={db}
      createWorker={() => {
        current = new FakeWorker()
        return current
      }}
    />
  )
  return {
    worker: () => {
      if (current === null) throw new Error('no worker created yet')
      return current
    },
  }
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('SimulateView — run, progress, cancel', () => {
  it('runs a sim through the injected worker and renders win rates from a canned result', () => {
    const { worker } = renderView()
    fireEvent.click(screen.getByTestId('sim-run'))
    expect(worker().postMessage).toHaveBeenCalledTimes(1)

    act(() => worker().emit({ type: 'result', result: CANNED_RESULT }))

    expect(screen.getByTestId('sim-results')).toBeTruthy()
    expect(screen.getByTestId('sim-winrate-a').textContent).toMatch(/2 wins \(66\.7%\)/)
    expect(screen.getByTestId('sim-winrate-b').textContent).toMatch(/1 wins \(33\.3%\)/)
    expect(screen.getByTestId('sim-avg-turns').textContent).toMatch(/10\.0 turns/)
    expect(screen.getByTestId('sim-reasons').textContent).toMatch(/sevenGigs: 2/)
    expect(screen.getByTestId('sim-reasons').textContent).toMatch(/deckout: 1/)
  })

  it('advances the progress bar as progress messages arrive', () => {
    const { worker } = renderView()
    fireEvent.click(screen.getByTestId('sim-run'))

    act(() => worker().emit({ type: 'progress', done: 5, total: 200 }))
    expect((screen.getByTestId('sim-progress-bar') as HTMLProgressElement).value).toBe(5)
    expect(screen.getByTestId('sim-progress-text').textContent).toContain('5 / 200')

    act(() => worker().emit({ type: 'progress', done: 120, total: 200 }))
    expect((screen.getByTestId('sim-progress-bar') as HTMLProgressElement).value).toBe(120)
    expect(screen.getByTestId('sim-progress-text').textContent).toContain('120 / 200')
  })

  it('cancel terminates the worker before a result arrives, and re-enables Run', () => {
    const { worker } = renderView()
    fireEvent.click(screen.getByTestId('sim-run'))
    expect(screen.getByTestId('sim-progress')).toBeTruthy()

    act(() => worker().emit({ type: 'progress', done: 3, total: 200 }))
    fireEvent.click(screen.getByTestId('sim-cancel'))

    expect(worker().terminate).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('sim-progress')).toBeNull()
    expect((screen.getByTestId('sim-run') as HTMLButtonElement).disabled).toBe(false)
    // No result was ever delivered, so no results panel should exist either.
    expect(screen.queryByTestId('sim-results')).toBeNull()
  })
})

describe('SimulateView — worker failure (fix round 1)', () => {
  it('a {type:"error"} message renders the error, stops the run, and re-enables Run', () => {
    const { worker } = renderView()
    fireEvent.click(screen.getByTestId('sim-run'))
    expect(screen.getByTestId('sim-progress')).toBeTruthy()

    act(() => worker().emit({ type: 'error', message: 'game 7 (seed 49) hit a dead end' }))

    expect(screen.getByTestId('sim-error').textContent).toMatch(/game 7 \(seed 49\) hit a dead end/)
    expect(screen.queryByTestId('sim-progress')).toBeNull()
    expect((screen.getByTestId('sim-run') as HTMLButtonElement).disabled).toBe(false)
    expect(worker().terminate).toHaveBeenCalledTimes(1)
    // The hang the bug report described never happens: no results panel,
    // and running has genuinely stopped rather than being stuck mid-run.
    expect(screen.queryByTestId('sim-results')).toBeNull()
  })

  it("the worker's own onerror (a failure it never got to catch) is handled the same way", () => {
    const { worker } = renderView()
    fireEvent.click(screen.getByTestId('sim-run'))

    act(() => worker().fail('worker module failed to load'))

    expect(screen.getByTestId('sim-error').textContent).toMatch(/worker module failed to load/)
    expect(screen.queryByTestId('sim-progress')).toBeNull()
    expect((screen.getByTestId('sim-run') as HTMLButtonElement).disabled).toBe(false)
    expect(worker().terminate).toHaveBeenCalledTimes(1)
  })

  it('a later successful run clears a previous error', () => {
    const { worker } = renderView()
    fireEvent.click(screen.getByTestId('sim-run'))
    act(() => worker().emit({ type: 'error', message: 'boom' }))
    expect(screen.getByTestId('sim-error')).toBeTruthy()

    fireEvent.click(screen.getByTestId('sim-run'))
    act(() => worker().emit({ type: 'result', result: CANNED_RESULT }))

    expect(screen.queryByTestId('sim-error')).toBeNull()
    expect(screen.getByTestId('sim-results')).toBeTruthy()
  })
})

describe('SimulateView — card table: sort and filter', () => {
  function runAndGetResult(): void {
    const { worker } = renderView()
    fireEvent.click(screen.getByTestId('sim-run'))
    act(() => worker().emit({ type: 'result', result: CANNED_RESULT }))
  }

  it('sorts the card table by win% when the column is clicked', () => {
    runAndGetResult()
    const rowsInOrder = () =>
      screen.getAllByTestId('sim-table-a-row').map((row) => row.getAttribute('data-def-id'))

    // Default sort is by timesPlayed desc: mantis-blades (5) before minotaur (2).
    expect(rowsInOrder()).toEqual(['mantis-blades', 'minotaur', 'unseen-card'])

    fireEvent.click(screen.getByTestId('sim-table-a-sort-winRate'))
    // First click on a new column sorts desc: minotaur (0.8) before mantis-blades (0.2).
    expect(rowsInOrder()[0]).toBe('minotaur')
    expect(rowsInOrder()[1]).toBe('mantis-blades')

    fireEvent.click(screen.getByTestId('sim-table-a-sort-winRate'))
    // Second click on the same column flips to asc.
    expect(rowsInOrder()[0]).toBe('unseen-card')
    expect(rowsInOrder()[rowsInOrder().length - 1]).toBe('minotaur')
  })

  it('filters rows below the min-games-seen threshold', () => {
    runAndGetResult()
    expect(screen.getAllByTestId('sim-table-a-row')).toHaveLength(3)

    fireEvent.change(screen.getByTestId('sim-min-games-seen'), { target: { value: '1' } })

    const rows = screen.getAllByTestId('sim-table-a-row')
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.getAttribute('data-def-id'))).not.toContain('unseen-card')
  })
})

describe('SimulateView — export', () => {
  it('exports CSV as toCsv(result) via a Blob download', async () => {
    runResultAndCapture()
    const blobSpy = vi.spyOn(globalThis, 'Blob')
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-csv')
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    fireEvent.click(screen.getByTestId('sim-export-csv'))

    expect(blobSpy).toHaveBeenCalledTimes(1)
    const [parts, options] = blobSpy.mock.calls[0] as [BlobPart[], { type: string }]
    expect(parts[0]).toBe(toCsv(CANNED_RESULT))
    expect(options.type).toBe('text/csv')
    expect(createUrl).toHaveBeenCalledTimes(1)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    // Revoke is deferred a macrotask (setTimeout(…, 0)) past the click, on
    // purpose — see download()'s own comment — so it's asserted with a wait
    // rather than immediately after the click.
    await waitFor(() => expect(revokeUrl).toHaveBeenCalledWith('blob:mock-csv'))
  })

  it('exports JSON as JSON.stringify(result, null, 2) via a Blob download', async () => {
    runResultAndCapture()
    const blobSpy = vi.spyOn(globalThis, 'Blob')
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-json')
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    fireEvent.click(screen.getByTestId('sim-export-json'))

    const [parts, options] = blobSpy.mock.calls[0] as [BlobPart[], { type: string }]
    expect(parts[0]).toBe(JSON.stringify(CANNED_RESULT, null, 2))
    expect(options.type).toBe('application/json')
    await waitFor(() => expect(revokeUrl).toHaveBeenCalledWith('blob:mock-json'))
  })

  function runResultAndCapture(): void {
    const { worker } = renderView()
    fireEvent.click(screen.getByTestId('sim-run'))
    act(() => worker().emit({ type: 'result', result: CANNED_RESULT }))
  }
})

describe('SimulateView — deck picker', () => {
  it('disables an invalid non-demo deck in both deck selects', () => {
    const broken: DeckList = { name: 'Broken Deck', legends: ['', '', ''], cards: {} }
    saveDeck(broken)

    render(<SimulateView db={db} createWorker={() => new FakeWorker()} />)

    const optionA = screen
      .getByTestId('sim-deck-a')
      .querySelector('option[value="Broken Deck"]') as HTMLOptionElement
    const optionB = screen
      .getByTestId('sim-deck-b')
      .querySelector('option[value="Broken Deck"]') as HTMLOptionElement

    expect(optionA.disabled).toBe(true)
    expect(optionA.textContent).toMatch(/⚠ invalid/)
    expect(optionB.disabled).toBe(true)
    expect(optionB.textContent).toMatch(/⚠ invalid/)
  })
})

describe('SimulateView — last-result banner', () => {
  it('renders a banner from storage.getLastSimResult on mount', () => {
    saveSimResult(CANNED_RESULT)
    render(<SimulateView db={db} createWorker={() => new FakeWorker()} />)
    expect(screen.getByTestId('sim-last-result-banner').textContent).toMatch(/3 games/)
  })

  it('renders no banner when no prior result is stored', () => {
    render(<SimulateView db={db} createWorker={() => new FakeWorker()} />)
    expect(screen.queryByTestId('sim-last-result-banner')).toBeNull()
  })

  it('does not resurface once a new run is started (minor fix: stale banner during a second run)', () => {
    saveSimResult(CANNED_RESULT)
    const { worker } = renderView()
    expect(screen.getByTestId('sim-last-result-banner')).toBeTruthy()

    // Starting a run sets `result` back to null transiently — before this
    // fix, that briefly (and misleadingly) resurfaced the "last run" banner
    // for the run that is now in progress rather than the one it describes.
    fireEvent.click(screen.getByTestId('sim-run'))
    expect(screen.queryByTestId('sim-last-result-banner')).toBeNull()

    act(() => worker().emit({ type: 'result', result: CANNED_RESULT }))
    expect(screen.queryByTestId('sim-last-result-banner')).toBeNull()
  })
})
