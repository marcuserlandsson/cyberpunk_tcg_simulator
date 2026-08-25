// One-off balance investigation: full per-card stats for both starter decks
// under heuristic-vs-heuristic, sorted by timesPlayed, plus end-reason and
// game-length breakdown split by winner. Throwaway analysis tool.
//
//   npx tsx scripts/balance-dump.ts [games] [seed]

import { readFileSync } from 'node:fs'
import { loadCardDb } from '../src/engine/cardDb'
import { runGames } from '../src/sim/runner'
import type { DeckList } from '../src/engine/deck'

const games = Number(process.argv[2] ?? 1000)
const seed = Number(process.argv[3] ?? 42)

const db = loadCardDb()
const ara = JSON.parse(
  readFileSync('data/decks/arasaka-embracing-power.json', 'utf-8')
) as DeckList
const merc = JSON.parse(readFileSync('data/decks/mercs-the-heist.json', 'utf-8')) as DeckList

const result = runGames(db, {
  deckA: ara,
  deckB: merc,
  games,
  seed,
  agentA: 'heuristic',
  agentB: 'heuristic',
})

console.log(`games=${games} seed=${seed}  Arasaka winrate=${(result.winRateA * 100).toFixed(1)}%`)
console.log(`avgTurns=${result.avgTurns.toFixed(1)}  reasons=${JSON.stringify(result.reasons)}`)

for (const [label, stats, deck] of [
  ['ARASAKA', result.cardStatsA, ara],
  ['MERCS', result.cardStatsB, merc],
] as const) {
  console.log(`\n=== ${label} — every card, sorted by timesPlayed ===`)
  console.log('card'.padEnd(40), 'copies', 'timesPlayed', 'gamesSeen', 'winRateWhenPlayed')
  const copies: Record<string, number> = { ...deck.cards }
  for (const legend of deck.legends) copies[legend] = 1
  const seen = new Set(stats.map((s) => s.defId))
  const sorted = stats.slice().sort((a, b) => b.timesPlayed - a.timesPlayed)
  for (const s of sorted) {
    console.log(
      s.defId.padEnd(40),
      String(copies[s.defId] ?? '?').padEnd(6),
      String(s.timesPlayed).padEnd(11),
      String(s.gamesSeen).padEnd(9),
      `${(s.winRateWhenPlayed * 100).toFixed(1)}%`
    )
  }
  // Cards in the deck that NEVER show up in stats at all:
  for (const id of Object.keys(copies)) {
    if (!seen.has(id)) console.log(id.padEnd(40), String(copies[id]).padEnd(6), 'NEVER PLAYED')
  }
}
