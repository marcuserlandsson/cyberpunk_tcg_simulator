//
// Sell list → what Cardmarket's bulk listing form wants. A private seller
// lists one expansion at a time, so everything is grouped by Cardmarket
// expansion (data/cardmarket-expansions.json maps our set codes onto them).
// The CSV targets the Cardmarket Bulk Import extension, whose column pickers
// fuzzy-match the header names name / quantity / condition / language
// (checked against PedroPerpetua/cardmarket-bulk-import 8ed18c0, 2026-09-05).
// Price is left for Cardmarket, where the trend price is on screen.
import { z } from 'zod'
import rawMap from '../../data/cardmarket-expansions.json'
import { cardIdentity } from '../engine/deck'
import type { CardDb } from '../engine/types'
import type { Printing } from './printings'
import type { Condition, EffectiveLine, Language } from './sellDraft'

const mapSchema = z.object({
  version: z.literal(1),
  subtitle: z.enum(['always', 'when-shared']),
  separator: z.string(),
  expansions: z.record(z.string(), z.object({ expansion: z.string().min(1), variant: z.string().min(1).optional() })),
  names: z.record(z.string(), z.string().min(1)),
})
export type CardmarketMap = z.infer<typeof mapSchema>
export function loadCardmarketMap(raw: unknown = rawMap): CardmarketMap { return mapSchema.parse(raw) }

export interface ExportRow { name: string; collectorNumbers: string[]; quantity: number; condition: Condition; variant?: string }
export interface ExportGroup { expansion: string; mapped: boolean; rows: ExportRow[]; copies: number }

const CONDITION_NAMES: Record<Condition, string> = { MT: 'Mint', NM: 'Near Mint', EX: 'Excellent', GD: 'Good', LP: 'Light Played', PL: 'Played', PO: 'Poor' }

function sharedNames(db: CardDb): Set<string> {
  const identities = new Map<string, Set<string>>()
  for (const def of Object.values(db)) identities.set(def.name, (identities.get(def.name) ?? new Set()).add(cardIdentity(def)))
  return new Set([...identities].filter(([, ids]) => ids.size > 1).map(([name]) => name))
}

function collectorOrder(a: string, b: string): number {
  const parse = (s: string) => { const m = s.match(/(\d+)(\D*)$/); return m ? [Number(m[1]), m[2]] as const : [Infinity, s] as const }
  const [an, as] = parse(a), [bn, bs] = parse(b)
  return an - bn || as.localeCompare(bs)
}

export function buildExportGroups(lines: EffectiveLine[], printings: Printing[], db: CardDb, map: CardmarketMap): ExportGroup[] {
  const byKey = new Map(printings.map(p => [p.key, p]))
  const shared = sharedNames(db)
  const setOrder = Object.keys(map.expansions)
  const groups = new Map<string, ExportGroup & { rank: number }>()
  for (const line of lines) {
    const p = byKey.get(line.key)
    if (!p || line.count < 1) continue // unknown after a dataset regeneration, or nothing left to sell
    const m = map.expansions[p.setCode]
    const groupKey = m ? `m:${m.expansion}` : `u:${p.setCode}`
    const group = groups.get(groupKey) ?? { expansion: m?.expansion ?? p.setName, mapped: !!m, rows: [], copies: 0, rank: m ? setOrder.indexOf(p.setCode) : Infinity }
    if (m) group.rank = Math.min(group.rank, setOrder.indexOf(p.setCode))
    const def = db[p.cardId]
    const withSubtitle = def?.subtitle && (map.subtitle === 'always' || shared.has(def.name))
    const name = map.names[p.key] ?? (def ? (withSubtitle ? `${def.name}${map.separator}${def.subtitle}` : def.name) : p.cardId)
    const existing = group.rows.find(r => r.name === name && r.condition === line.condition && r.variant === m?.variant)
    if (existing) { existing.quantity += line.count; if (!existing.collectorNumbers.includes(p.collectorNumber)) existing.collectorNumbers.push(p.collectorNumber) }
    else group.rows.push({ name, collectorNumbers: [p.collectorNumber], quantity: line.count, condition: line.condition, ...(m?.variant ? { variant: m.variant } : {}) })
    group.copies += line.count
    groups.set(groupKey, group)
  }
  return [...groups.values()]
    .sort((a, b) => a.rank - b.rank || a.expansion.localeCompare(b.expansion))
    .map(g => ({ expansion: g.expansion, mapped: g.mapped, copies: g.copies, rows: g.rows.sort((a, b) => collectorOrder(a.collectorNumbers[0], b.collectorNumbers[0]) || a.name.localeCompare(b.name)) }))
}

const copies = (n: number) => `${n} ${n === 1 ? 'copy' : 'copies'}`

export function bulkListingText(groups: ExportGroup[], language: Language): string {
  return groups.map(g => [
    `## ${g.expansion}${g.mapped ? '' : ' ⚠ check expansion'} (${copies(g.copies)})`,
    ...g.rows.map(r => `${r.quantity}× ${r.name} · #${r.collectorNumbers.join('/#')}${r.variant ? ` · ${r.variant}` : ''} · ${r.condition} · ${language}`),
  ].join('\n')).join('\n\n')
}

function csvCell(value: string): string { return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value }

export function groupCsv(group: ExportGroup, language: Language): string {
  const rows = [['name', 'quantity', 'condition', 'language'], ...group.rows.map(r => [r.name, String(r.quantity), CONDITION_NAMES[r.condition], language])]
  return rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

export function csvFilename(group: ExportGroup, today = new Date()): string {
  const slug = group.expansion.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `cardmarket-sell-${today.toISOString().slice(0, 10)}-${group.mapped ? '' : 'CHECK-'}${slug}.csv`
}
