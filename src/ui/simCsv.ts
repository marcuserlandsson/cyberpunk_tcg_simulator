import type { CardDb } from '../engine/types'
import type { SimRun } from './simHistory'
import { deckASeatFor, agentSeedsFor } from '../sim/runner'
import { intervalLabel } from '../sim/statistics'

// Neutralize spreadsheet formula interpretation in user-provided deck names.
const cell = (value: unknown) => { const text = String(value ?? ''); return '"' + (/^[=+@\-\t\r]/.test(text) ? "'" : '') + text.replaceAll('"','""') + '"' }
const csv = (rows: unknown[][]) => rows.map(row => row.map(cell).join(',')).join('\n')
const headers = ['run_id','created_at','engine','rules','card_data','deck_a','deck_b','agent_a','agent_b','run_seed']
const metadata = (r: SimRun) => [r.id,r.createdAt,r.engineVersion,r.rulesVersion,r.cardData,r.options.deckA.name,r.options.deckB.name,r.options.agentA,r.options.agentB,r.options.seed]
export function runGamesCsv(r: SimRun): string {
  return csv([[...headers,'game','seed','deck_a_seat','seat_0_agent_seed','seat_1_agent_seed','winner_deck','turns','reason'], ...r.result.games.map((g,i) => [...metadata(r),i,g.seed,deckASeatFor(i),...agentSeedsFor(g.seed),g.winner === null ? 'draw' : g.winner === 0 ? 'A' : 'B',g.turns,g.reason])])
}
export function cardStatsCsv(db: CardDb, r: SimRun): string {
  return csv([[...headers,'deck','card_id','name','subtitle','times_played','games_played','win_rate_when_played','95pct_wilson_interval'], ...([r.result.cardStatsA,r.result.cardStatsB]).flatMap((stats,index) => stats.map(s => [...metadata(r),index === 0 ? 'A' : 'B',s.defId,db[s.defId]?.name ?? s.defId,db[s.defId]?.subtitle ?? '',s.timesPlayed,s.gamesSeen,s.gamesSeen ? s.winRateWhenPlayed : '',intervalLabel(Math.round(s.winRateWhenPlayed*s.gamesSeen),s.gamesSeen)]))])
}
