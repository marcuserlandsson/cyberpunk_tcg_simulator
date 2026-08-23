// Task 11 CLI: run an AI-vs-AI simulation from two deck JSON files and print
// a summary table. Run via `npm run sim -- <flags>` (package.json wires
// `sim` to `tsx scripts/sim.ts`).
//
//   npm run sim -- --games 1000 --deckA data/decks/arasaka-embracing-power.json \
//                   --deckB data/decks/mercs-the-heist.json --seed 42 \
//                   [--agentA heuristic|random] [--agentB heuristic|random]
//
// `agentA`/`agentB` both default to `heuristic`. This is the acceptance path
// for the task brief: a 1000-game run at this seed must complete without
// throwing.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadCardDb } from '../src/engine/cardDb'
import { runGames } from '../src/sim/runner'
import type { AgentKind, CardStat, SimOptions } from '../src/sim/runner'
import type { DeckList } from '../src/engine/deck'

interface Cli {
  games: number
  deckAPath: string
  deckBPath: string
  seed: number
  agentA: AgentKind
  agentB: AgentKind
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? undefined : argv[i + 1]
}

function parseAgentKind(raw: string | undefined): AgentKind {
  if (raw === 'random') return 'random'
  if (raw === undefined || raw === 'heuristic') return 'heuristic'
  throw new Error(`--agentA/--agentB must be "heuristic" or "random", got "${raw}"`)
}

function parseArgs(argv: string[]): Cli {
  const deckAPath = flag(argv, 'deckA')
  const deckBPath = flag(argv, 'deckB')
  if (deckAPath === undefined || deckBPath === undefined) {
    throw new Error(
      'Usage: npm run sim -- --deckA <path> --deckB <path> [--games N] [--seed N] ' +
        '[--agentA heuristic|random] [--agentB heuristic|random]'
    )
  }
  const gamesRaw = flag(argv, 'games')
  const seedRaw = flag(argv, 'seed')
  return {
    deckAPath,
    deckBPath,
    games: gamesRaw === undefined ? 100 : Number(gamesRaw),
    seed: seedRaw === undefined ? 1 : Number(seedRaw),
    agentA: parseAgentKind(flag(argv, 'agentA')),
    agentB: parseAgentKind(flag(argv, 'agentB')),
  }
}

function loadDeck(path: string): DeckList {
  const raw = readFileSync(resolve(process.cwd(), path), 'utf-8')
  return JSON.parse(raw) as DeckList
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`
}

function printTable(rows: string[][]): void {
  if (rows.length === 0) return
  const widths = rows[0].map((_, col) => Math.max(...rows.map((row) => row[col].length)))
  for (const row of rows) {
    console.log(row.map((cell, col) => cell.padEnd(widths[col])).join('  '))
  }
}

const MIN_GAMES_SEEN = 10
const TOP_N = 10

function printTopCards(stats: CardStat[], label: string): void {
  const qualified = stats
    .filter((c) => c.gamesSeen >= MIN_GAMES_SEEN)
    .slice()
    .sort((a, b) => b.winRateWhenPlayed - a.winRateWhenPlayed)
    .slice(0, TOP_N)

  console.log()
  console.log(`Top cards for deck ${label} (min ${MIN_GAMES_SEEN} games seen):`)
  if (qualified.length === 0) {
    console.log(`  (no card reached the ${MIN_GAMES_SEEN}-games-seen floor)`)
    return
  }
  const rows: string[][] = [['card', 'timesPlayed', 'gamesSeen', 'winRate']]
  for (const c of qualified) {
    rows.push([c.defId, String(c.timesPlayed), String(c.gamesSeen), pct(c.winRateWhenPlayed)])
  }
  printTable(rows)
}

function main(): void {
  const cli = parseArgs(process.argv.slice(2))
  const db = loadCardDb()
  const deckA = loadDeck(cli.deckAPath)
  const deckB = loadDeck(cli.deckBPath)

  const opts: SimOptions = {
    deckA,
    deckB,
    games: cli.games,
    seed: cli.seed,
    agentA: cli.agentA,
    agentB: cli.agentB,
  }

  console.log(
    `Running ${cli.games} games: "${deckA.name}" (A, ${cli.agentA}) vs "${deckB.name}" (B, ${cli.agentB}), seed ${cli.seed}`
  )

  const progressEvery = Math.max(1, Math.floor(cli.games / 20))
  const start = Date.now()
  const result = runGames(db, opts, (done, total) => {
    if (done % progressEvery === 0 || done === total) {
      process.stdout.write(`\r  ${done}/${total} games...`)
    }
  })
  const elapsedSec = (Date.now() - start) / 1000
  process.stdout.write('\n\n')

  console.log(`Deck A win rate (${deckA.name}): ${pct(result.winRateA)}`)
  console.log(`Deck B win rate (${deckB.name}): ${pct(1 - result.winRateA)}`)
  console.log(`Average game length: ${result.avgTurns.toFixed(1)} turns`)

  console.log()
  console.log('End reasons:')
  for (const [reason, count] of Object.entries(result.reasons)) {
    console.log(`  ${reason}: ${count} (${pct(count / cli.games)})`)
  }

  printTopCards(result.cardStatsA, 'A')
  printTopCards(result.cardStatsB, 'B')

  console.log()
  console.log(`${cli.games} games in ${elapsedSec.toFixed(1)}s (${(cli.games / elapsedSec).toFixed(1)} games/sec)`)
}

main()
