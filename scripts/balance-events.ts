// One-off balance instrumentation: replay heuristic-vs-heuristic games and
// tally engine EVENTS per deck — steals, attacks, defeats, effects — to see
// mechanically where the gig differential comes from. Throwaway analysis tool.
//
//   npx tsx scripts/balance-events.ts [games] [seed]

import { readFileSync } from 'node:fs'
import { loadCardDb } from '../src/engine/cardDb'
import { newGame } from '../src/engine/game'
import { legalActions } from '../src/engine/legal'
import { applyAction } from '../src/engine/reduce'
import { actingPlayer, effectivePower } from '../src/engine/query'
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

interface Tally {
  wins: number
  dieRolls: number
  stolenDice: number
  stolenValue: number
  attacksGig: number
  attacksUnit: number
  attackPowerTotal: number
  attackPower10plus: number
  blocks: number
  unitsLost: number
  legendsCalled: number
  effectCounts: Map<string, number>
  gigsAtEnd: number
}

const tallies: [Tally, Tally] = [newTally(), newTally()] // [Arasaka, Mercs]
function newTally(): Tally {
  return {
    wins: 0,
    dieRolls: 0,
    stolenDice: 0,
    stolenValue: 0,
    attacksGig: 0,
    attacksUnit: 0,
    attackPowerTotal: 0,
    attackPower10plus: 0,
    blocks: 0,
    unitsLost: 0,
    legendsCalled: 0,
    effectCounts: new Map(),
    gigsAtEnd: 0,
  }
}

for (let i = 0; i < games; i++) {
  const gameSeed = gameSeedFor(seed, i)
  const araSeat = deckASeatFor(i) // Arasaka is deck A
  const decks: [DeckList, DeckList] = araSeat === 0 ? [ara, merc] : [merc, ara]
  const [s0, s1] = agentSeedsFor(gameSeed)
  const agents = [createHeuristicAgent(s0), createHeuristicAgent(s1)]

  // deckOf(seat) -> 0 = Arasaka, 1 = Mercs
  const deckOf = (seat: PlayerId): 0 | 1 => (seat === araSeat ? 0 : 1)

  let state: GameState = newGame(db, { decks, seed: gameSeed })
  let seen = state.events.length
  // Process events incrementally so uid lookups use a state where the card exists.
  const processNew = (s: GameState) => {
    for (; seen < s.events.length; seen++) {
      const e = s.events[seen]
      switch (e.type) {
        case 'dieRolled':
          tallies[deckOf(e.player)].dieRolls++
          break
        case 'gigStolen': {
          const thief = deckOf(e.from === 0 ? 1 : 0)
          tallies[thief].stolenDice++
          tallies[thief].stolenValue += e.die.value
          break
        }
        case 'attackDeclared': {
          const inst = s.cards[e.attacker]
          if (inst === undefined) break
          const d = deckOf(inst.owner)
          const p = effectivePower(db, s, e.attacker)
          tallies[d].attackPowerTotal += p
          if (p >= 10) tallies[d].attackPower10plus++
          if (e.target === 'gigArea') tallies[d].attacksGig++
          else tallies[d].attacksUnit++
          break
        }
        case 'attackBlocked': {
          const inst = s.cards[e.blocker]
          if (inst !== undefined) tallies[deckOf(inst.owner)].blocks++
          break
        }
        case 'unitDefeated': {
          const inst = s.cards[e.uid]
          if (inst !== undefined) tallies[deckOf(inst.owner)].unitsLost++
          break
        }
        case 'legendCalled':
          tallies[deckOf(e.player)].legendsCalled++
          break
        case 'effectResolved': {
          const inst = s.cards[e.sourceUid]
          if (inst === undefined) break
          const d = deckOf(inst.owner)
          const id = db[inst.defId]?.id ?? inst.defId
          tallies[d].effectCounts.set(id, (tallies[d].effectCounts.get(id) ?? 0) + 1)
          break
        }
      }
    }
  }
  processNew(state)

  let steps = 0
  while (state.phase !== 'gameOver' && steps++ < 1000) {
    const actions = legalActions(db, state)
    const chosen = agents[actingPlayer(state)].chooseAction(db, state, actions)
    state = applyAction(db, state, chosen)
    processNew(state)
  }

  if (state.winner !== null) tallies[deckOf(state.winner)].wins++
  tallies[0].gigsAtEnd += state.players[araSeat].gigArea.length
  tallies[1].gigsAtEnd += state.players[araSeat === 0 ? 1 : 0].gigArea.length
}

for (const [name, t] of [
  ['ARASAKA', tallies[0]],
  ['MERCS', tallies[1]],
] as const) {
  console.log(`\n=== ${name} (${games} games) ===`)
  console.log(`wins: ${t.wins} (${((t.wins / games) * 100).toFixed(1)}%)`)
  console.log(`avg gigs at game end: ${(t.gigsAtEnd / games).toFixed(2)}`)
  console.log(`die rolls (own turns): ${t.dieRolls}`)
  console.log(
    `dice stolen: ${t.stolenDice} (${(t.stolenDice / games).toFixed(2)}/game, avg value ${(t.stolenValue / Math.max(1, t.stolenDice)).toFixed(1)})`
  )
  const attacks = t.attacksGig + t.attacksUnit
  console.log(
    `attacks: ${attacks} (${(attacks / games).toFixed(2)}/game) — gigArea ${t.attacksGig}, units ${t.attacksUnit}; avg attacker power ${(t.attackPowerTotal / Math.max(1, attacks)).toFixed(1)}; attacks at 10+ power: ${t.attackPower10plus}`
  )
  console.log(`blocks made: ${t.blocks}; own units defeated: ${t.unitsLost}; legends called: ${t.legendsCalled}`)
  const effects = [...t.effectCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
  console.log(`top effects: ${effects.map(([id, n]) => `${id}×${n}`).join(', ')}`)
}
