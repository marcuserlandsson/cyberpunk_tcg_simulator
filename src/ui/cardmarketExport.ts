//
// Sell list → what Cardmarket's bulk listing form wants. A private seller
// lists one expansion at a time, so everything is grouped by Cardmarket
// expansion (data/cardmarket-expansions.json maps our set codes onto them).
// The CSV targets the Cardmarket Bulk Import extension, whose column pickers
// fuzzy-match the header names name / quantity / condition / language
// (checked against PedroPerpetua/cardmarket-bulk-import 8ed18c0, 2026-09-05).
// Price is left for Cardmarket, where the trend price is on screen.
//
// Naming: `map.names[key]` is an explicit override and always wins. Failing
// that, Cardmarket appends ` (V.n)` to a card's name when one expansion
// carries several printings of the same base name — numbered in
// collector-number order, ties broken by printing key. That grouping is
// built once per call from the *full* printings dataset (not just what is
// being sold), so a line's suffix never depends on what else happens to be
// queued. Unmapped sets never get a suffix, since we don't know Cardmarket's
// grouping for them. Rows within a group are then sorted alphabetically by
// name, then by first collector number — Cardmarket's own lists default to
// A–Z; the bulk form's order couldn't be verified.
import { z } from 'zod'
import rawMap from '../../data/cardmarket-expansions.json'
import { cardIdentity } from '../engine/deck'
import type { CardDb } from '../engine/types'
import type { Printing } from './printings'
import { localDate, type Condition, type EffectiveLine, type Language } from './sellDraft'

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

/** The name before any `(V.n)` suffix or `names` override: def's display name
 *  plus subtitle when the map calls for it. `undefined` when the printing's
 *  card is missing from `db` (an unknown printing after a dataset regen). */
function baseExportName(p: Printing, db: CardDb, shared: Set<string>, map: CardmarketMap): string | undefined {
  const def = db[p.cardId]
  if (!def) return undefined
  const withSubtitle = def.subtitle && (map.subtitle === 'always' || shared.has(def.name))
  return withSubtitle ? `${def.name}${map.separator}${def.subtitle}` : def.name
}

/** `printing key → " (V.n)"` for every printing whose Cardmarket expansion
 *  carries more than one printing of the same base name. Built once from the
 *  full `printings` dataset. */
function versionSuffixes(printings: Printing[], db: CardDb, map: CardmarketMap, shared: Set<string>): Map<string, string> {
  const groups = new Map<string, Printing[]>()
  for (const p of printings) {
    const m = map.expansions[p.setCode]
    if (!m) continue // unmapped: we don't know Cardmarket's grouping for it
    const name = baseExportName(p, db, shared, map)
    if (name === undefined) continue
    const groupKey = `${m.expansion}\u0000${name}`
    const list = groups.get(groupKey)
    if (list) list.push(p); else groups.set(groupKey, [p])
  }
  const suffixes = new Map<string, string>()
  for (const list of groups.values()) {
    if (list.length < 2) continue
    const ordered = [...list].sort((a, b) => collectorOrder(a.collectorNumber, b.collectorNumber) || a.key.localeCompare(b.key))
    ordered.forEach((p, i) => suffixes.set(p.key, ` (V.${i + 1})`))
  }
  return suffixes
}

export function buildExportGroups(lines: EffectiveLine[], printings: Printing[], db: CardDb, map: CardmarketMap): ExportGroup[] {
  const byKey = new Map(printings.map(p => [p.key, p]))
  const shared = sharedNames(db)
  const versions = versionSuffixes(printings, db, map, shared)
  const setOrder = Object.keys(map.expansions)
  const groups = new Map<string, ExportGroup & { rank: number }>()
  for (const line of lines) {
    const p = byKey.get(line.key)
    if (!p || line.count < 1) continue // unknown after a dataset regeneration, or nothing left to sell
    const m = map.expansions[p.setCode]
    const groupKey = m ? `m:${m.expansion}` : `u:${p.setCode}`
    const group = groups.get(groupKey) ?? { expansion: m?.expansion ?? p.setName, mapped: !!m, rows: [], copies: 0, rank: m ? setOrder.indexOf(p.setCode) : Infinity }
    if (m) group.rank = Math.min(group.rank, setOrder.indexOf(p.setCode))
    const base = baseExportName(p, db, shared, map)
    const name = map.names[p.key] ?? (base !== undefined ? `${base}${versions.get(p.key) ?? ''}` : p.cardId)
    const existing = group.rows.find(r => r.name === name && r.condition === line.condition && r.variant === m?.variant)
    if (existing) { existing.quantity += line.count; if (!existing.collectorNumbers.includes(p.collectorNumber)) existing.collectorNumbers.push(p.collectorNumber) }
    else group.rows.push({ name, collectorNumbers: [p.collectorNumber], quantity: line.count, condition: line.condition, ...(m?.variant ? { variant: m.variant } : {}) })
    group.copies += line.count
    groups.set(groupKey, group)
  }
  return [...groups.values()]
    .sort((a, b) => a.rank - b.rank || a.expansion.localeCompare(b.expansion))
    .map(g => ({ expansion: g.expansion, mapped: g.mapped, copies: g.copies, rows: g.rows.sort((a, b) => a.name.localeCompare(b.name) || collectorOrder(a.collectorNumbers[0], b.collectorNumbers[0])) }))
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
  return `cardmarket-sell-${localDate(today)}-${group.mapped ? '' : 'CHECK-'}${slug}.csv`
}
