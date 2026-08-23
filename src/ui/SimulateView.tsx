// Task 15: the Simulate view. Runs many AI-vs-AI games through the Task 11
// runner (`src/sim/runner.ts`), off the main thread via the Task 11 worker
// (`src/sim/worker.ts`), and renders the aggregate `SimResult`: win rates,
// average game length, end-reason breakdown, and a sortable per-deck card
// table. The last completed result persists across reloads via
// `storage.saveSimResult`/`getLastSimResult` (Task 12).
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

import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { isDeckPickable, deckPickerLabel } from './deckPicker'
import { listDecks, saveSimResult, getLastSimResult } from './storage'
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
  URL.revokeObjectURL(url)
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
      .map((stat) => ({ ...stat, name: db[stat.defId]?.name ?? stat.defId }))
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
    { key: 'gamesSeen', label: 'Games seen' },
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
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.defId} data-testid={`${testId}-row`} data-def-id={row.defId}>
            <td>{row.name}</td>
            <td data-testid={`${testId}-row-timesPlayed`}>{row.timesPlayed}</td>
            <td data-testid={`${testId}-row-gamesSeen`}>{row.gamesSeen}</td>
            <td data-testid={`${testId}-row-winRate`}>{pct(row.winRateWhenPlayed)}</td>
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
  const decks = useMemo(() => listDecks(), [])
  const pickableDecks = useMemo(() => decks.filter((deck) => isDeckPickable(db, deck)), [db, decks])

  const [deckAName, setDeckAName] = useState(() => pickableDecks[0]?.name ?? decks[0]?.name ?? '')
  const [deckBName, setDeckBName] = useState(
    () => pickableDecks[1]?.name ?? pickableDecks[0]?.name ?? decks[0]?.name ?? ''
  )
  const [agentA, setAgentA] = useState<AgentKind>('heuristic')
  const [agentB, setAgentB] = useState<AgentKind>('heuristic')
  const [gamesText, setGamesText] = useState(String(DEFAULT_GAMES))
  const [seedText, setSeedText] = useState(String(DEFAULT_SEED))

  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<SimResult | null>(null)
  const [ranNames, setRanNames] = useState<{ a: string; b: string } | null>(null)
  const [minGamesSeen, setMinGamesSeen] = useState(0)
  const [lastResult] = useState<SimResult | null>(() => (getLastSimResult() as SimResult | undefined) ?? null)

  const workerRef = useRef<SimWorkerLike | null>(null)

  // A worker left running when the view unmounts (tab switch mid-run) would
  // otherwise keep spinning invisibly forever.
  useEffect(() => {
    return () => {
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [])

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
    const seed = Number.isFinite(parsedSeed) ? Math.trunc(parsedSeed) : DEFAULT_SEED

    const opts: SimOptions = { deckA, deckB, games, seed, agentA, agentB }

    setRunning(true)
    setProgress({ done: 0, total: games })
    setResult(null)
    setRanNames({ a: deckA.name, b: deckB.name })

    const worker = (createWorker ?? defaultCreateSimWorker)()
    workerRef.current = worker
    worker.onmessage = (event: MessageEvent<SimWorkerMessage>) => {
      const message = event.data
      if (message.type === 'progress') {
        setProgress({ done: message.done, total: message.total })
        return
      }
      setResult(message.result)
      saveSimResult(message.result)
      setRunning(false)
      setProgress(null)
      workerRef.current = null
    }
    worker.postMessage(opts)
  }

  function handleCancel(): void {
    workerRef.current?.terminate()
    workerRef.current = null
    setRunning(false)
    setProgress(null)
  }

  function handleExportJson(): void {
    if (result === null) return
    download('sim-result.json', JSON.stringify(result, null, 2), 'application/json')
  }

  function handleExportCsv(): void {
    if (result === null) return
    download('sim-result.csv', toCsv(result), 'text/csv')
  }

  const winsA = result?.games.filter((g) => g.winner === 0).length ?? 0
  const winsB = result === null ? 0 : result.games.length - winsA

  return (
    <section aria-label="Simulate" data-testid="simulate-view">
      <h2>Simulate</h2>

      {lastResult !== null && result === null && (
        <div className="sim-banner" data-testid="sim-last-result-banner">
          Last run: {lastResult.games.length} games — Deck A won {pct(lastResult.winRateA)}, Deck B
          won {pct(1 - lastResult.winRateA)}.
        </div>
      )}

      <div className="sim-setup" data-testid="sim-setup">
        <label className="sim-setup__field">
          Deck A
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
          Agent A
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
          Deck B
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
          Agent B
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
          Games
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
          Seed
          <input
            data-testid="sim-seed"
            type="number"
            value={seedText}
            onChange={(event) => setSeedText(event.target.value)}
          />
        </label>

        <button type="button" data-testid="sim-run" disabled={!canRun} onClick={handleRun}>
          Run
        </button>
      </div>

      {running && progress !== null && (
        <div className="sim-progress" data-testid="sim-progress">
          <progress
            data-testid="sim-progress-bar"
            value={progress.done}
            max={progress.total}
          />
          <span data-testid="sim-progress-text">
            {progress.done} / {progress.total}
          </span>
          <button type="button" data-testid="sim-cancel" onClick={handleCancel}>
            Cancel
          </button>
        </div>
      )}

      {result !== null && ranNames !== null && (
        <section className="sim-results" data-testid="sim-results">
          <h3>Results</h3>

          <div className="sim-winrates" data-testid="sim-winrates">
            <div data-testid="sim-winrate-a">
              {ranNames.a}: {winsA} wins ({pct(result.winRateA)})
            </div>
            <div data-testid="sim-winrate-b">
              {ranNames.b}: {winsB} wins ({pct(1 - result.winRateA)})
            </div>
          </div>

          <div data-testid="sim-avg-turns">
            Average game length: {result.avgTurns.toFixed(1)} turns
          </div>

          <div className="sim-reasons" data-testid="sim-reasons">
            End reasons:{' '}
            {Object.entries(result.reasons)
              .map(([reason, count]) => `${reason}: ${count}`)
              .join(', ')}
          </div>

          <label className="sim-setup__field">
            Min games seen
            <input
              data-testid="sim-min-games-seen"
              type="number"
              min={0}
              value={minGamesSeen}
              onChange={(event) => setMinGamesSeen(Math.max(0, Number(event.target.value) || 0))}
            />
          </label>

          <CardStatsTable
            db={db}
            title={ranNames.a}
            stats={result.cardStatsA}
            minGamesSeen={minGamesSeen}
            testId="sim-table-a"
          />
          <CardStatsTable
            db={db}
            title={ranNames.b}
            stats={result.cardStatsB}
            minGamesSeen={minGamesSeen}
            testId="sim-table-b"
          />

          <div className="sim-export">
            <button type="button" data-testid="sim-export-json" onClick={handleExportJson}>
              Export JSON
            </button>
            <button type="button" data-testid="sim-export-csv" onClick={handleExportCsv}>
              Export CSV
            </button>
          </div>
        </section>
      )}
    </section>
  )
}
