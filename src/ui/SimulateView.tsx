// Task 15: the Simulate view. Runs many AI-vs-AI games through the Task 11
// runner (`src/sim/runner.ts`), off the main thread via the Task 11 worker
// (`src/sim/worker.ts`), and renders the aggregate `SimResult`: win rates,
// average game length, end-reason breakdown, and a sortable per-deck card
// table. Complete versioned runs persist independently in browser storage.
//
// WORKER INJECTION. The view never calls `new Worker` directly — it goes
// through a `createWorker` prop (`CreateSimWorker`), defaulted to
// `defaultCreateSimWorker` below. Real usage (App.tsx) leaves the prop
// unset; tests inject a fake `SimWorkerLike` that posts canned progress and
// result messages synchronously, so `tests/ui/simulate.test.tsx` never
// touches an actual Worker (unsupported in jsdom).
//
// DECK PICKER. Both selects use `deckPicker.ts`'s `isDeckPickable` (docs/
// rulings.md §153, shared with the Play view's setup screen): a non-demo
// deck that fails `validateDeck` is disabled and labelled "⚠ invalid" —
// simulating an illegal deck would silently corrupt the stats with games
// the engine was never validated to allow.
//
// WORKER FAILURE (fix round 1). Two independent ways a worker can fail to
// deliver a result: `worker.ts`'s own try/catch posts a `{type:'error'}`
// message when `runGames` throws, and the DOM `Worker`'s `onerror` fires
// for failures the worker never gets to catch (a syntax error loading the
// module, an uncaught exception outside the try block). Both are routed
// through `handleWorkerFailure`, which surfaces a visible
// `data-testid="sim-error"` message, flips `running` back to `false` (so
// Run is clickable again), and terminates/nulls the worker — otherwise a
// thrown error would hang the progress bar forever with no way to tell a
// crash from a slow run.

import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { intervalLabel } from '../sim/statistics'
import { SimBenchmark, benchmarkPlan } from './SimBenchmark'
import { cardStatsCsv, runGamesCsv } from './simCsv'
import { isDeckPickable, deckPickerLabel } from './deckPicker'
import { createSimRun, parseSimRun, readSimRuns, saveSimRun, removeSimRun, runUsesCurrentRules, simResultSchema, type SimRun } from './simHistory'
import { useDecks, getLastSimResult } from './storage'
import { toCsv, type AgentKind, type CardStat, type SimOptions, type SimResult } from '../sim/runner'
import type { SimWorkerMessage } from '../sim/worker'
import type { DeckList } from '../engine/deck'
import type { CardDb } from '../engine/types'

// ---------------------------------------------------------------------------
// Worker plumbing
// ---------------------------------------------------------------------------

/** The subset of the DOM `Worker` interface the view actually uses. */
export interface SimWorkerLike {
  postMessage: (message: SimOptions) => void
  terminate: () => void
  onmessage: ((event: MessageEvent<SimWorkerMessage>) => void) | null
  /** Fires for failures the worker itself never gets to catch and report
   * as a `{type:'error'}` message (e.g. the module failing to load). */
  onerror: ((event: ErrorEvent) => void) | null
}

export type CreateSimWorker = () => SimWorkerLike

function defaultCreateSimWorker(): SimWorkerLike {
  return new Worker(new URL('../sim/worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as SimWorkerLike
}

export interface SimulateViewProps {
  db: CardDb
  /** Defaults to a real Worker; tests inject a mock. */
  createWorker?: CreateSimWorker
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const DEFAULT_GAMES = 200
const MIN_GAMES = 1
const MAX_GAMES = 10000
const DEFAULT_SEED = 42

function clampGames(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_GAMES
  return Math.min(MAX_GAMES, Math.max(MIN_GAMES, Math.round(value)))
}

function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`
}

function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  // Deferred rather than called immediately after `.click()`: revoking the
  // URL synchronously is a well-known footgun — some browsers process the
  // anchor's download asynchronously, so an immediate revoke can race it and
  // occasionally produce an empty/failed download. A 0ms `setTimeout` pushes
  // the revoke to the next macrotask, after the click's own handling.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

// ---------------------------------------------------------------------------
// Sortable per-deck card table
// ---------------------------------------------------------------------------

type SortKey = 'name' | 'timesPlayed' | 'gamesSeen' | 'winRate'

interface CardStatsTableProps {
  db: CardDb
  title: string
  stats: CardStat[]
  minGamesSeen: number
  testId: string
}

function CardStatsTable({ db, title, stats, minGamesSeen, testId }: CardStatsTableProps): ReactElement {
  const [sortKey, setSortKey] = useState<SortKey>('timesPlayed')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  function toggleSort(key: SortKey): void {
    if (key === sortKey) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const rows = useMemo(() => {
    const withName = stats
      .filter((stat) => stat.gamesSeen >= minGamesSeen)
      .map((stat) => ({ ...stat, name: db[stat.defId] ? [db[stat.defId].name, db[stat.defId].subtitle].filter(Boolean).join(' — ') : stat.defId }))
    const dir = sortDir === 'asc' ? 1 : -1
    return withName.sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return dir * a.name.localeCompare(b.name)
        case 'timesPlayed':
          return dir * (a.timesPlayed - b.timesPlayed)
        case 'gamesSeen':
          return dir * (a.gamesSeen - b.gamesSeen)
        case 'winRate':
          return dir * (a.winRateWhenPlayed - b.winRateWhenPlayed)
      }
    })
  }, [stats, minGamesSeen, sortKey, sortDir, db])

  const columns: { key: SortKey; label: string }[] = [
    { key: 'name', label: 'Card' },
    { key: 'timesPlayed', label: 'Times played' },
    { key: 'gamesSeen', label: 'Games played' },
    { key: 'winRate', label: 'Win % when played' },
  ]

  return (
    <table className="sim-table" data-testid={testId}>
      <caption>{title}</caption>
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col.key}>
              <button
                type="button"
                data-testid={`${testId}-sort-${col.key}`}
                onClick={() => toggleSort(col.key)}
              >
                {col.label}
                {sortKey === col.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
              </button>
            </th>
          ))}
          <th>95% interval</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.defId} data-testid={`${testId}-row`} data-def-id={row.defId}>
            <td>{row.name}</td>
            <td data-testid={`${testId}-row-timesPlayed`}>{row.timesPlayed}</td>
            <td data-testid={`${testId}-row-gamesSeen`}>{row.gamesSeen}</td>
            <td data-testid={`${testId}-row-winRate`}>{row.gamesSeen ? pct(row.winRateWhenPlayed) : "—"}</td>
            <td>{intervalLabel(Math.round(row.winRateWhenPlayed * row.gamesSeen), row.gamesSeen)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ---------------------------------------------------------------------------
// SimulateView
// ---------------------------------------------------------------------------

export function SimulateView({ db, createWorker }: SimulateViewProps): ReactElement {
  const decks = useDecks()
  const pickableDecks = useMemo(() => decks.filter((deck) => isDeckPickable(db, deck)), [db, decks])

  const [deckAName, setDeckAName] = useState(() => pickableDecks[0]?.name ?? decks[0]?.name ?? '')
  const [deckBName, setDeckBName] = useState(
    () => pickableDecks[1]?.name ?? pickableDecks[0]?.name ?? decks[0]?.name ?? ''
  )
  const [agentA, setAgentA] = useState<AgentKind>('heuristic')
  const [agentB, setAgentB] = useState<AgentKind>('heuristic')
  const [gamesText, setGamesText] = useState(String(DEFAULT_GAMES))
  const [seedText, setSeedText] = useState(String(DEFAULT_SEED))

  const [history, setHistory] = useState(readSimRuns)
  const [selectedRun, setSelectedRun] = useState<SimRun | null>(() => history.runs[0] ?? null)
  const [historyError, setHistoryError] = useState<string | null>(history.error)
  const [importRunText, setImportRunText] = useState('')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<SimResult | null>(() => selectedRun?.result ?? null)
  const [ranNames, setRanNames] = useState<{ a: string; b: string } | null>(() => selectedRun ? { a: selectedRun.options.deckA.name, b: selectedRun.options.deckB.name } : null)
  const [minGamesSeen, setMinGamesSeen] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<SimResult | null>(
    () => { try { const parsed = simResultSchema.safeParse(getLastSimResult()); return parsed.success ? parsed.data : null } catch { return null } }
  )

  const queueRef = useRef<SimOptions[]>([])
  const workerRef = useRef<SimWorkerLike | null>(null)
  useEffect(() => {
    if (!decks.some((d) => d.name === deckAName)) setDeckAName(pickableDecks[0]?.name ?? '')
    if (!decks.some((d) => d.name === deckBName)) setDeckBName(pickableDecks[1]?.name ?? pickableDecks[0]?.name ?? '')
  }, [decks, pickableDecks, deckAName, deckBName])

  // Navigation keeps this view mounted. A worker left running on app unmount would
  // otherwise keep spinning invisibly forever.
  useEffect(() => {
    return () => {
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!running && queueRef.current.length) { const next = queueRef.current.shift()!; startRun(next) }
  }, [running, history])

  function deckByName(name: string): DeckList | undefined {
    return decks.find((deck) => deck.name === name)
  }

  const deckA = deckByName(deckAName)
  const deckB = deckByName(deckBName)
  const canRun =
    !running &&
    deckA !== undefined &&
    deckB !== undefined &&
    isDeckPickable(db, deckA) &&
    isDeckPickable(db, deckB)

  function handleRun(): void {
    if (deckA === undefined || deckB === undefined) return
    if (!isDeckPickable(db, deckA) || !isDeckPickable(db, deckB)) return

    const games = clampGames(Number(gamesText))
    const parsedSeed = Number(seedText)
    const seed = Number.isSafeInteger(parsedSeed) ? parsedSeed : DEFAULT_SEED

    startRun({ deckA, deckB, games, seed, agentA, agentB })
  }

  function startRun(options: SimOptions): void {
    if (running) return
    if (!isDeckPickable(db, options.deckA) || !isDeckPickable(db, options.deckB)) { queueRef.current = []; setError("A queued deck is no longer playable."); return }
    const opts = structuredClone(options)
    const games = opts.games
    setSelectedRun(null)
    setRunning(true)
    setProgress({ done: 0, total: games })
    setResult(null)
    setError(null)
    setRanNames({ a: opts.deckA.name, b: opts.deckB.name })

    let worker: SimWorkerLike
    try { worker = (createWorker ?? defaultCreateSimWorker)() } catch (error) { handleWorkerFailure(String(error)); return }
    workerRef.current = worker
    worker.onmessage = (event: MessageEvent<SimWorkerMessage>) => {
      if (workerRef.current !== worker) return
      const message = event.data
      if (message.type === 'progress') {
        setProgress({ done: message.done, total: message.total })
        return
      }
      if (message.type === 'error') {
        handleWorkerFailure(message.message)
        return
      }
      setResult(message.result)
      const run = createSimRun(db, opts, message.result)
      setSelectedRun(run)
      setHistoryError(saveSimRun(run))
      setHistory(previous => ({ runs: [run, ...previous.runs.filter(r => r.id !== run.id)], error: null }))
      setLastResult(message.result)
      setRunning(false)
      setProgress(null)
      worker.terminate()
      workerRef.current = null
    }
    worker.onerror = (event: ErrorEvent) => {
      if (workerRef.current !== worker) return
      handleWorkerFailure(event.message || 'The simulation worker failed unexpectedly.')
    }
    try { worker.postMessage(opts) } catch (error) { handleWorkerFailure(String(error)) }
  }

  /**
   * Both ways a worker can fail to deliver a result (its own caught-and-
   * reported `{type:'error'}` message, or an `onerror` it never got to
   * catch) land here: show the message, stop the run, and make sure the
   * dead worker can't still be `postMessage`d or leaked.
   */
  function handleWorkerFailure(message: string): void {
    queueRef.current = []
    setError(message)
    setRunning(false)
    setProgress(null)
    workerRef.current?.terminate()
    workerRef.current = null
  }

  function handleCancel(): void {
    queueRef.current = []
    workerRef.current?.terminate()
    workerRef.current = null
    setRunning(false)
    setProgress(null)
  }

  function handleExportJson(): void {
    if (result === null) return
    download('sim-result.json', JSON.stringify(selectedRun ?? result, null, 2), 'application/json')
  }

  function handleExportCsv(): void {
    if (result === null) return
    download('sim-result.csv', selectedRun ? runGamesCsv(selectedRun) : toCsv(result), 'text/csv')
  }

  function openRun(run: SimRun): void {
    setSelectedRun(run); setResult(run.result)
    setRanNames({ a: run.options.deckA.name, b: run.options.deckB.name })
  }
  function importRun(): void {
    try {
      const parsed = parseSimRun(importRunText)
      // Import as a new local history entry; never overwrite a prior run with the same exported ID.
      const run = { ...parsed, id: crypto.randomUUID() }
      const error = saveSimRun(run)
      setHistoryError(error)
      setHistory(previous => ({ runs: [run, ...previous.runs], error: null }))
      openRun(run); setImportRunText('')
    } catch (error) { setHistoryError(error instanceof Error ? error.message : String(error)) }
  }

  const winsA = result?.games.filter((g) => g.winner === 0).length ?? 0
  const winsB = result?.games.filter(g => g.winner === 1).length ?? 0
  const draws = result?.games.filter(g => g.winner === null).length ?? 0

  const winRateB = result?.games.length ? winsB / result.games.length : 0

  return (
    <section aria-label="Simulate" className="simulate-view" data-testid="simulate-view">
      <h2>Simulate</h2>
      <p>Completed runs save in this browser. Navigation keeps a run going; keep the tab open until it finishes.</p>
      {historyError && <p role="alert" data-testid="sim-history-error">{historyError}</p>}
      <details className="panel" data-testid="sim-history"><summary>Run history ({history.runs.length})</summary>
        {history.runs.map(run => <div key={run.id}>
          <button type="button" disabled={running} onClick={() => openRun(run)} data-testid="sim-open-run">{new Date(run.createdAt).toLocaleString()} · A: {run.options.deckA.name} / B: {run.options.deckB.name} · {run.result.games.length} games · seed {run.options.seed}</button>
          <button type="button" disabled={running} onClick={() => { const error = removeSimRun(run.id); setHistoryError(error); if (!error) setHistory(previous => ({ ...previous, runs: previous.runs.filter(r => r.id !== run.id) })) }}>Remove from history</button>
        </div>)}
        <label>Import a complete run JSON<textarea data-testid="sim-import-json" value={importRunText} onChange={e => setImportRunText(e.target.value)} /></label>
        <button type="button" data-testid="sim-import-run" disabled={running || !importRunText.trim()} onClick={importRun}>Import run</button>
      </details>

      {lastResult !== null && result === null && !running && (
        <div className="sim-banner panel" data-testid="sim-last-result-banner">
          Last run: {lastResult.games.length} games — Deck A won {pct(lastResult.winRateA)}, Deck B
          won {pct(lastResult.games.filter(g => g.winner === 1).length / lastResult.games.length)}.
          Legacy result: deck snapshots and rules version are unavailable.
          <button type="button" onClick={() => { setResult(lastResult); setSelectedRun(null); setRanNames({ a: 'Deck A (unknown)', b: 'Deck B (unknown)' }) }}>Open legacy result</button>
        </div>
      )}

      {error !== null && (
        <div className="sim-error panel" role="alert" data-testid="sim-error">
          Simulation failed: {error}
        </div>
      )}

      <div className="sim-setup panel clip-corners" data-testid="sim-setup">
        <label className="sim-setup__field">
          <span className="sim-setup__field-label">Deck A</span>
          <select
            data-testid="sim-deck-a"
            value={deckAName}
            onChange={(event) => setDeckAName(event.target.value)}
          >
            {decks.map((deck) => (
              <option key={deck.name} value={deck.name} disabled={!isDeckPickable(db, deck)}>
                {deckPickerLabel(db, deck)}
              </option>
            ))}
          </select>
        </label>

        <label className="sim-setup__field">
          <span className="sim-setup__field-label">Agent A</span>
          <select
            data-testid="sim-agent-a"
            value={agentA}
            onChange={(event) => setAgentA(event.target.value as AgentKind)}
          >
            <option value="heuristic">Heuristic</option>
            <option value="random">Random</option>
          </select>
        </label>

        <label className="sim-setup__field">
          <span className="sim-setup__field-label">Deck B</span>
          <select
            data-testid="sim-deck-b"
            value={deckBName}
            onChange={(event) => setDeckBName(event.target.value)}
          >
            {decks.map((deck) => (
              <option key={deck.name} value={deck.name} disabled={!isDeckPickable(db, deck)}>
                {deckPickerLabel(db, deck)}
              </option>
            ))}
          </select>
        </label>

        <label className="sim-setup__field">
          <span className="sim-setup__field-label">Agent B</span>
          <select
            data-testid="sim-agent-b"
            value={agentB}
            onChange={(event) => setAgentB(event.target.value as AgentKind)}
          >
            <option value="heuristic">Heuristic</option>
            <option value="random">Random</option>
          </select>
        </label>

        <label className="sim-setup__field">
          <span className="sim-setup__field-label">Games</span>
          <input
            data-testid="sim-games"
            type="number"
            min={MIN_GAMES}
            max={MAX_GAMES}
            value={gamesText}
            onChange={(event) => setGamesText(event.target.value)}
          />
        </label>

        <label className="sim-setup__field">
          <span className="sim-setup__field-label">Seed</span>
          <input
            data-testid="sim-seed"
            type="number"
            value={seedText}
            onChange={(event) => setSeedText(event.target.value)}
          />
        </label>

        <button
          type="button"
          className="btn--primary sim-setup__run"
          data-testid="sim-run"
          disabled={!canRun}
          onClick={handleRun}
        >
          Run
        </button>
      </div>

      <SimBenchmark decks={pickableDecks} runs={history.runs} busy={running} start={(baseline, candidate, opponents) => {
        const seed = Number(seedText)
        const plan = benchmarkPlan(baseline, candidate, opponents, { games: clampGames(Number(gamesText)), seed: Number.isSafeInteger(seed) ? seed : DEFAULT_SEED, agentA, agentB })
        const first = plan.shift()!; queueRef.current = plan; startRun(first)
      }} />
      {running && progress !== null && (
        <div className="sim-progress panel" data-testid="sim-progress">
          <progress
            className="sim-progress__bar"
            data-testid="sim-progress-bar"
            value={progress.done}
            max={progress.total}
          />
          <span className="sim-progress__text" data-testid="sim-progress-text">
            {progress.done} / {progress.total} · {queueRef.current.length} queued runs
          </span>
          <button type="button" className="btn--danger" data-testid="sim-cancel" onClick={handleCancel}>
            Cancel
          </button>
        </div>
      )}

      {result !== null && ranNames !== null && (
        <section className="sim-results panel clip-corners" data-testid="sim-results">
          <h3>Results</h3>
          {selectedRun && <div data-testid="sim-provenance">
            <p>{new Date(selectedRun.createdAt).toLocaleString()} · seed {selectedRun.options.seed} · {selectedRun.options.agentA} vs {selectedRun.options.agentB}</p>
            <p>Rules {selectedRun.rulesVersion.slice(0, 10)} · engine {selectedRun.engineVersion} · card data {selectedRun.cardData}</p>
            {!runUsesCurrentRules(db, selectedRun) && <p role="status">Historical result uses different rules, engine or card data. A new run will use the current version.</p>}
            <details><summary>Exact deck snapshots</summary><pre>{JSON.stringify({ A: selectedRun.options.deckA, B: selectedRun.options.deckB }, null, 2)}</pre></details>
            <button type="button" disabled={running} onClick={() => startRun({ ...selectedRun.options, benchmark: undefined })}>Run these snapshots with current rules</button>
          </div>}

          <div className="sim-winrates" data-testid="sim-winrates">
            <div className="sim-splitbar" aria-hidden="true">
              <div
                className="sim-splitbar__fill sim-splitbar__fill--a"
                style={{ width: pct(result.winRateA) }}
              >
                {result.winRateA >= 0.12 && (
                  <span className="sim-splitbar__label">{pct(result.winRateA)}</span>
                )}
              </div>
              <div
                className="sim-splitbar__fill sim-splitbar__fill--b"
                style={{ width: pct(winRateB) }}
              >
                {winRateB >= 0.12 && <span className="sim-splitbar__label">{pct(winRateB)}</span>}
              </div>
            </div>
            <div className="sim-winrates__row sim-winrates__row--a" data-testid="sim-winrate-a">
              {ranNames.a}: {winsA} wins ({pct(result.winRateA)}) · 95% interval {intervalLabel(winsA, result.games.length)}
            </div>
            <div className="sim-winrates__row sim-winrates__row--b" data-testid="sim-winrate-b">
              {ranNames.b}: {winsB} wins ({pct(winRateB)}) · 95% interval {intervalLabel(winsB, result.games.length)}
            </div>
          </div>

          <div className="sim-summary-row">
            <div data-testid="sim-avg-turns">
              <span className="chip">
                Average game length: {result.avgTurns.toFixed(1)} turns
              </span>
            </div>

            {draws > 0 && <p>{draws} draws</p>}
            <div className="sim-reasons" data-testid="sim-reasons">
              <span className="sim-reasons__label">End reasons:</span>
              {Object.entries(result.reasons).map(([reason, count]) => (
                <span key={reason} className="chip">
                  {reason}: {count}
                </span>
              ))}
            </div>
          </div>

          <p>{result.games.length} games. Wins use all games as the denominator, including draws. Games played counts games where a card was played, not drawn. Conditional card win rates show correlation, not the benefit of adding that card. The 95% Wilson intervals reflect sample size, not AI quality or rules certainty.</p>
          <label className="sim-setup__field sim-min-games">
            <span className="sim-setup__field-label">Min games played</span>
            <input
              data-testid="sim-min-games-seen"
              type="number"
              min={0}
              value={minGamesSeen}
              onChange={(event) => setMinGamesSeen(Math.max(0, Number(event.target.value) || 0))}
            />
          </label>

          <div className="sim-tables">
            <div className="sim-table-wrap panel">
              <CardStatsTable
                db={db}
                title={ranNames.a}
                stats={result.cardStatsA}
                minGamesSeen={minGamesSeen}
                testId="sim-table-a"
              />
            </div>
            <div className="sim-table-wrap panel">
              <CardStatsTable
                db={db}
                title={ranNames.b}
                stats={result.cardStatsB}
                minGamesSeen={minGamesSeen}
                testId="sim-table-b"
              />
            </div>
          </div>

          <div className="sim-export">
            {selectedRun && <button type="button" data-testid="sim-export-card-csv" onClick={() => download("sim-card-statistics.csv", cardStatsCsv(db, selectedRun), "text/csv")}>Export card statistics CSV</button>}
            <button
              type="button"
              className="btn--ghost"
              data-testid="sim-export-json"
              onClick={handleExportJson}
            >
              Export JSON
            </button>
            <button
              type="button"
              className="btn--ghost"
              data-testid="sim-export-csv"
              onClick={handleExportCsv}
            >
              Export CSV
            </button>
          </div>
        </section>
      )}
    </section>
  )
}
