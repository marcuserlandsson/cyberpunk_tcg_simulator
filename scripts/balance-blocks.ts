// One-off: per deck, how often is a BLOCK legally available in a react window,
// and how often does the heuristic take it? Same for playing the 0-power
// blocker cards when a playCard for them is legal. Throwaway analysis tool.
//
//   npx tsx scripts/balance-blocks.ts [games] [seed]

import { readFileSync } from 'node:fs'
import { loadCardDb } from '../src/engine/cardDb'
import { newGame } from '../src/engine/game'
import { legalActions } from '../src/engine/legal'
import { applyAction } from '../src/engine/reduce'
import { actingPlayer } from '../src/engine/query'
import { createHeuristicAgent } from '../src/ai/heuristic'
import { agentSeedsFor, deckASeatFor, gameSeedFor } from '../src/sim/runner'
import type { DeckList } from '../src/engine/deck'
import type { GameState, PlayerId } from '../src/engine/types'

const games = Number(process.argv[2] ?? 300)
const seed = Number(process.argv[3] ?? 42)

const db = loadCardDb()
const ara = JSON.parse(
  readFileSync('data/decks/arasaka-embracing-power.json', 'utf-8')
) as DeckList
const merc = JSON.parse(readFileSync('data/decks/mercs-the-heist.json', 'utf-8')) as DeckList

const WATCH_PLAYS = [
  'secondhand-bombus',
  'mandibular-upgrade',
  'corpo-security',
  'evelyn-parker-scheming-siren',
]

interface T {
  blockWindows: number // react windows where >=1 block was legal
  blockTaken: number
  playOffered: Map<string, number> // decision points where playCard(id) was legal
  playTaken: Map<string, number>
}
const tallies: [T, T] = [
  { blockWindows: 0, blockTaken: 0, playOffered: new Map(), playTaken: new Map() },
  { blockWindows: 0, blockTaken: 0, playOffered: new Map(), playTaken: new Map() },
]

for (let i = 0; i < games; i++) {
  const gameSeed = gameSeedFor(seed, i)
  const araSeat = deckASeatFor(i)
  const decks: [DeckList, DeckList] = araSeat === 0 ? [ara, merc] : [merc, ara]
  const [s0, s1] = agentSeedsFor(gameSeed)
  const agents = [createHeuristicAgent(s0), createHeuristicAgent(s1)]
  const deckOf = (seat: PlayerId): 0 | 1 => (seat === araSeat ? 0 : 1)

  let state: GameState = newGame(db, { decks, seed: gameSeed })
  let steps = 0
  while (state.phase !== 'gameOver' && steps++ < 1000) {
    const actions = legalActions(db, state)
    const actor = actingPlayer(state)
    const t = tallies[deckOf(actor)]

    const hasBlock = actions.some(
      (a) => a.type === 'react' && a.reaction.type === 'block'
    )
    if (hasBlock) t.blockWindows++

    // playCard availability per watched defId (count each decision point once per id)
    const offeredIds = new Set<string>()
    for (const a of actions) {
      if (a.type !== 'playCard') continue
      const defId = state.cards[a.card]?.defId
      if (defId !== undefined && WATCH_PLAYS.includes(defId)) offeredIds.add(defId)
    }
    for (const id of offeredIds) t.playOffered.set(id, (t.playOffered.get(id) ?? 0) + 1)

    const chosen = agents[actor].chooseAction(db, state, actions)
    if (chosen.type === 'react' && chosen.reaction.type === 'block') t.blockTaken++
    if (chosen.type === 'playCard') {
      const defId = state.cards[chosen.card]?.defId
      if (defId !== undefined && WATCH_PLAYS.includes(defId))
        t.playTaken.set(defId, (t.playTaken.get(defId) ?? 0) + 1)
    }
    state = applyAction(db, state, chosen)
  }
}

for (const [name, t] of [
  ['ARASAKA', tallies[0]],
  ['MERCS', tallies[1]],
] as const) {
  console.log(`\n=== ${name} (${games} games) ===`)
  console.log(
    `react windows with a legal block: ${t.blockWindows} (${(t.blockWindows / games).toFixed(2)}/game); blocks taken: ${t.blockTaken} (${((t.blockTaken / Math.max(1, t.blockWindows)) * 100).toFixed(0)}% of windows)`
  )
  for (const id of WATCH_PLAYS) {
    const off = t.playOffered.get(id) ?? 0
    const tak = t.playTaken.get(id) ?? 0
    if (off > 0)
      console.log(
        `  ${id}: playable at ${off} decision points, played ${tak} (${((tak / off) * 100).toFixed(0)}%)`
      )
  }
}
