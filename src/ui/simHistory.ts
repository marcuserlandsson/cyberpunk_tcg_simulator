import { z } from 'zod'
import { AGENT_KINDS } from '../ai/agents'
import type { SimOptions, SimResult } from '../sim/runner'
import type { CardDb } from '../engine/types'
import { cardDataFingerprint, ENGINE_VERSION, RULES_VERSION } from '../engine/version'

export interface SimRun {
  version: 1
  id: string
  createdAt: string
  engineVersion: string
  rulesVersion: string
  cardData: string
  options: SimOptions
  result: SimResult
}
const PREFIX = 'ctcg:simRun:v1:'
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const deck = z.object({ name: z.string(), legends: z.tuple([z.string(), z.string(), z.string()]), cards: z.record(z.string(), count), demo: z.boolean().optional() }).passthrough()
const stat = z.object({ defId: z.string(), timesPlayed: count, gamesSeen: count, winRateWhenPlayed: z.number().min(0).max(1) })
export const simResultSchema = z.object({ games: z.array(z.object({ winner: z.union([z.literal(0), z.literal(1), z.null()]), turns: count, seed: z.number().int(), reason: z.string() })).min(1),
  winRateA: z.number().min(0).max(1), avgTurns: z.number().nonnegative(), cardStatsA: z.array(stat), cardStatsB: z.array(stat), reasons: z.record(z.string(), count) })
const runSchema = z.object({ version: z.literal(1), id: z.string().min(1), createdAt: z.iso.datetime(), engineVersion: z.string(), rulesVersion: z.string(), cardData: z.string(),
  options: z.object({ benchmark: z.object({ id: z.string(), opponent: count, role: z.enum(['baseline','candidate']) }).optional(), deckA: deck, deckB: deck, games: count.positive(), seed: z.number().int(), agentA: z.enum(AGENT_KINDS), agentB: z.enum(AGENT_KINDS) }), result: simResultSchema })

export function createSimRun(db: CardDb, options: SimOptions, result: SimResult): SimRun {
  return structuredClone({ version: 1, id: crypto.randomUUID(), createdAt: new Date().toISOString(),
    engineVersion: ENGINE_VERSION, rulesVersion: RULES_VERSION, cardData: cardDataFingerprint(db), options, result })
}

export function parseSimRun(text: string): SimRun {
  const parsed = runSchema.safeParse(JSON.parse(text))
  if (!parsed.success) throw new Error('This is not a complete simulation-run export. The existing history has not changed.')
  return parsed.data
}

/** A separate key per run avoids cross-tab read/modify/write races and never evicts history. */
export function saveSimRun(run: SimRun): string | null {
  try { localStorage.setItem(PREFIX + run.id, JSON.stringify(run)); return null }
  catch { return 'Run finished, but browser storage could not save it. Keep this tab open and export JSON to retain the complete run.' }
}

export function readSimRuns(): { runs: SimRun[]; error: string | null } {
  const runs: SimRun[] = []
  let invalid = 0
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(PREFIX)) continue
      try { runs.push(parseSimRun(localStorage.getItem(key)!)) } catch { invalid++ }
    }
    runs.sort((a,b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    return { runs, error: invalid ? `${invalid} unreadable simulation records were left untouched in browser storage.` : null }
  } catch { return { runs, error: 'Simulation history could not be read from browser storage.' } }
}

export function removeSimRun(id: string): string | null {
  try { localStorage.removeItem(PREFIX + id); return null }
  catch { return 'The run could not be removed from browser storage.' }
}

export function runUsesCurrentRules(db: CardDb, run: SimRun): boolean {
  return run.engineVersion === ENGINE_VERSION && run.rulesVersion === RULES_VERSION && run.cardData === cardDataFingerprint(db)
}
