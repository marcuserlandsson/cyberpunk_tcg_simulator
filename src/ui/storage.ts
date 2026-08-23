// Local persistence for the UI: decks, settings, saved game records, and the
// most recent simulation result. Everything lives in `localStorage` as small
// JSON blobs; bundled starter decks are shipped as static data and merged
// into `listDecks()` alongside whatever the player has saved.

import type { CardDb } from '../engine/types'
import type { DeckList } from '../engine/deck'
import arasakaDeck from '../../data/decks/arasaka-embracing-power.json'
import mercsDeck from '../../data/decks/mercs-the-heist.json'

// ---------------------------------------------------------------------------
// Storage keys & small JSON helpers
// ---------------------------------------------------------------------------

const DECKS_KEY = 'ctcg:decks:v1'
const SETTINGS_KEY = 'ctcg:settings:v1'
const GAME_RECORDS_KEY = 'ctcg:gameRecords:v1'
const SIM_RESULT_KEY = 'ctcg:lastSimResult:v1'

function readJson<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key)
  if (raw === null) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value))
}

// ---------------------------------------------------------------------------
// Decks
// ---------------------------------------------------------------------------

/**
 * Bundled starter decks, shipped as static data (`data/decks/*.json`).
 * Read-only: `deleteDeck` refuses to remove one that has no localStorage
 * override (see below).
 */
const STARTER_DECKS: DeckList[] = [
  arasakaDeck as unknown as DeckList,
  mercsDeck as unknown as DeckList,
]
const STARTER_DECK_NAMES = new Set(STARTER_DECKS.map((deck) => deck.name))

function readLocalDecks(): Record<string, DeckList> {
  return readJson<Record<string, DeckList>>(DECKS_KEY, {})
}

function writeLocalDecks(decks: Record<string, DeckList>): void {
  writeJson(DECKS_KEY, decks)
}

/** Saves `deck` to localStorage, keyed by name (a second save overwrites). */
export function saveDeck(deck: DeckList): void {
  const decks = readLocalDecks()
  decks[deck.name] = deck
  writeLocalDecks(decks)
}

/**
 * Bundled starter decks plus whatever the player has saved to localStorage.
 * A localStorage deck sharing a starter's name overrides it in the returned
 * list, mirroring `saveDeck`'s own overwrite-by-name behavior.
 */
export function listDecks(): DeckList[] {
  const local = readLocalDecks()
  const localNames = new Set(Object.keys(local))
  const starters = STARTER_DECKS.filter((deck) => !localNames.has(deck.name))
  return [...starters, ...Object.values(local)]
}

/**
 * True when `name` names a bundled starter deck that has no localStorage
 * override yet — i.e. editing it in the Deck Builder and hitting Save would
 * *fork* a local copy under the same name (which then shadows the bundled
 * deck in `listDecks`), rather than overwrite anything checked into the
 * repo. Mirrors `deleteDeck`'s own "is there a local override" check, so the
 * two stay consistent by construction (docs/rulings.md §152).
 */
export function isReadOnlyDeck(name: string): boolean {
  return STARTER_DECK_NAMES.has(name) && !(name in readLocalDecks())
}

/**
 * Deletes a localStorage deck by name. Bundled starter decks are read-only:
 * deleting one that has no localStorage override throws (a documented
 * choice, rather than silently no-oping on a name the caller clearly meant).
 * Deleting a name that is neither a starter nor saved locally is a silent
 * no-op — there is nothing to delete.
 */
export function deleteDeck(name: string): void {
  const decks = readLocalDecks()
  if (!(name in decks)) {
    if (STARTER_DECK_NAMES.has(name)) {
      throw new Error(`"${name}" is a bundled starter deck and cannot be deleted.`)
    }
    return
  }
  delete decks[name]
  writeLocalDecks(decks)
}

// ---------------------------------------------------------------------------
// Deck text export/import
//
// Format:
//   # <deck name>[ [demo]]
//
//   ## Legends
//   <Name or "Name — Subtitle">
//   ... (3 lines)
//
//   ## Cards
//   <N>x <Name or "Name — Subtitle">
//   ...
//
// Several printed cards share a bare `name` across different `subtitle`s
// (multiple "V"s, "Goro Takemura"s, etc.) — export disambiguates those with
// "Name — Subtitle" (an em dash); import accepts both the plain name (when
// unambiguous) and the "Name — Subtitle" form.
// ---------------------------------------------------------------------------

function buildNameIndex(db: CardDb): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const def of Object.values(db)) {
    const ids = index.get(def.name) ?? []
    ids.push(def.id)
    index.set(def.name, ids)
  }
  return index
}

/** `def.name`, or `"name — subtitle"` when another card shares that name. */
function cardDisplayName(db: CardDb, nameIndex: Map<string, string[]>, id: string): string {
  const def = db[id]
  if (!def) throw new Error(`Unknown card id: "${id}".`)
  const sharing = nameIndex.get(def.name) ?? []
  if (sharing.length > 1 && def.subtitle) {
    return `${def.name} — ${def.subtitle}`
  }
  return def.name
}

export function exportDeckText(db: CardDb, deck: DeckList): string {
  const nameIndex = buildNameIndex(db)
  const lines: string[] = []
  lines.push(`# ${deck.name}${deck.demo ? ' [demo]' : ''}`)
  lines.push('')
  lines.push('## Legends')
  for (const id of deck.legends) lines.push(cardDisplayName(db, nameIndex, id))
  lines.push('')
  lines.push('## Cards')
  for (const [id, count] of Object.entries(deck.cards)) {
    lines.push(`${count}x ${cardDisplayName(db, nameIndex, id)}`)
  }
  return lines.join('\n')
}

type Resolved = { id: string } | { error: string }

/** Resolves one exported name (plain, or "Name — Subtitle") back to a card id. */
function resolveCardName(db: CardDb, nameIndex: Map<string, string[]>, raw: string): Resolved {
  const dashMatch = raw.match(/^(.+?)\s+—\s+(.+)$/)
  if (dashMatch) {
    const [, name, subtitle] = dashMatch
    const candidates = nameIndex.get(name) ?? []
    const match = candidates.find((id) => db[id].subtitle === subtitle)
    if (match) return { id: match }
    return { error: `Unknown card: "${raw}".` }
  }

  const candidates = nameIndex.get(raw) ?? []
  if (candidates.length === 1) return { id: candidates[0] }
  if (candidates.length > 1) {
    const options = candidates.map((id) => cardDisplayName(db, nameIndex, id)).join('", "')
    return {
      error: `"${raw}" is ambiguous — ${candidates.length} cards share this name ("${options}"). Use "Name — Subtitle" to disambiguate.`,
    }
  }
  return { error: `Unknown card: "${raw}".` }
}

export function importDeckText(db: CardDb, text: string): DeckList {
  const nameIndex = buildNameIndex(db)

  let name = ''
  let demo = false
  let section: 'legends' | 'cards' | null = null
  const legendLines: string[] = []
  const cardLines: { count: number; name: string }[] = []

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '') continue
    if (line.startsWith('# ')) {
      const header = line.slice(2).trim()
      const demoMatch = header.match(/^(.*)\s+\[demo\]$/)
      if (demoMatch) {
        name = demoMatch[1].trim()
        demo = true
      } else {
        name = header
      }
      section = null
      continue
    }
    if (line === '## Legends') {
      section = 'legends'
      continue
    }
    if (line === '## Cards') {
      section = 'cards'
      continue
    }
    if (section === 'legends') {
      legendLines.push(line)
    } else if (section === 'cards') {
      const match = line.match(/^(\d+)\s*x\s+(.+)$/i)
      if (!match) throw new Error(`Could not import deck: malformed card line "${line}".`)
      cardLines.push({ count: Number(match[1]), name: match[2] })
    }
  }

  const errors: string[] = []

  const legends: string[] = []
  for (const raw of legendLines) {
    const resolved = resolveCardName(db, nameIndex, raw)
    if ('error' in resolved) errors.push(resolved.error)
    else legends.push(resolved.id)
  }

  const cards: Record<string, number> = {}
  for (const { count, name: cardName } of cardLines) {
    const resolved = resolveCardName(db, nameIndex, cardName)
    if ('error' in resolved) errors.push(resolved.error)
    else cards[resolved.id] = (cards[resolved.id] ?? 0) + count
  }

  if (errors.length > 0) {
    throw new Error(`Could not import deck:\n${errors.join('\n')}`)
  }
  if (legends.length !== 3) {
    throw new Error(`Could not import deck: expected 3 legends, found ${legends.length}.`)
  }

  const deck: DeckList = {
    name,
    legends: [legends[0], legends[1], legends[2]],
    cards,
  }
  if (demo) deck.demo = true
  return deck
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface Settings {
  useOfficialImages: boolean
}

const DEFAULT_SETTINGS: Settings = { useOfficialImages: false }

export function getSettings(): Settings {
  return readJson(SETTINGS_KEY, DEFAULT_SETTINGS)
}

export function saveSettings(settings: Settings): void {
  writeJson(SETTINGS_KEY, settings)
}

// ---------------------------------------------------------------------------
// Game records
//
// The real record type lives in the engine (`src/engine/replay.ts`): a
// `NewGameConfig` plus the ordered action list, which is JSON-safe by
// construction and replays back into the exact game state. This module only
// persists it; re-exported here so UI callers need one import, not two.
// ---------------------------------------------------------------------------

export type { GameRecord } from '../engine/replay'
import type { GameRecord } from '../engine/replay'

function readGameRecords(): Record<string, GameRecord> {
  return readJson<Record<string, GameRecord>>(GAME_RECORDS_KEY, {})
}

export function saveGameRecord(name: string, record: GameRecord): void {
  const records = readGameRecords()
  records[name] = record
  writeJson(GAME_RECORDS_KEY, records)
}

export function listGameRecords(): { name: string; record: GameRecord }[] {
  return Object.entries(readGameRecords()).map(([name, record]) => ({ name, record }))
}

/**
 * Deletes a saved game record by name. A silent no-op when `name` names
 * nothing — e.g. a slot deleted twice, once from a stale render. Used by the
 * Play view to let a player clear out a save that no longer replays (a
 * rules/card-data change made it incompatible), which is otherwise stuck:
 * loading it always fails, and there is no other way to get rid of it.
 */
export function deleteGameRecord(name: string): void {
  const records = readGameRecords()
  if (!(name in records)) return
  delete records[name]
  writeJson(GAME_RECORDS_KEY, records)
}

// ---------------------------------------------------------------------------
// Last simulation result
//
// Added per the Task 12 pre-flight ruling (needed by a later task's UI, not
// specified in the original brief's interface list). `SimResult` is left
// untyped on purpose: the sim runner's own result shape (src/sim) isn't a UI
// concern, and pinning a shape here would just be guessing ahead of the task
// that actually defines it.
// ---------------------------------------------------------------------------

export type SimResult = unknown

export function saveSimResult(result: SimResult): void {
  writeJson(SIM_RESULT_KEY, result)
}

export function getLastSimResult(): SimResult | undefined {
  return readJson<SimResult | undefined>(SIM_RESULT_KEY, undefined)
}
