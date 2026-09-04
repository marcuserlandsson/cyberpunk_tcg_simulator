// Generates data/printings.json from the netdeck.gg API (the same primary
// source cards.json was transcribed from — see data/transcription-report.md).
// One row per printing of each of the 141 cards in cards.json, keyed
// "<setCode>/<collectorNumber>". Refuses to write on any validation failure
// (missing/malformed fields, non-unique keys, missing cards, unknown cards)
// and prints a report instead.
//
// Usage:
//   npm run fetch:printings            # regenerate data/printings.json
//   npm run fetch:printings -- --images  # ...and download printing art to
//                                        # data/images/printings/ (gitignored)
//
// Unlike fetch-images.mjs (best-effort, always exits 0), this script's output
// is committed and load-bearing — a failed fetch for any card aborts with a
// non-zero exit rather than writing a dataset with holes.
//
// Note on validation duplication: this script deliberately does NOT import
// `parsePrintings`/`Printing` from `src/ui/printings.ts`. That module (via
// Task 3) statically imports `data/printings.json`, so importing it here
// would make this generator depend on the very file it produces — a missing
// or malformed printings.json would break the generator meant to fix it. The
// checks below duplicate that module's zod schema by hand (required fields,
// non-empty where the schema demands non-empty, unique keys, key format) plus
// the cards.json join in both directions. `tests/data/printings.test.ts` is
// the CI gate that catches drift between this script's checks and the real
// schema in src/ui/printings.ts.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const CARDS_JSON_PATH = resolve(REPO_ROOT, 'data/cards.json')
const PRINTINGS_JSON_PATH = resolve(REPO_ROOT, 'data/printings.json')
const PRINTING_IMAGES_DIR = resolve(REPO_ROOT, 'data/images/printings')

const API_BASE = 'https://api.netdeck.gg/api/cards/cyberpunk'
const USER_AGENT =
  'Mozilla/5.0 (cyberpunk-tcg-simulator fetch-printings.ts; personal playtesting tool)'
const DELAY_MS = 500

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))

/** Mirrors the `Printing` interface in src/ui/printings.ts (kept in sync by
 *  hand; tests/data/printings.test.ts is the drift-catcher). */
interface Printing {
  key: string
  cardId: string
  setCode: string
  setName: string
  collectorNumber: string
  rarity: string
  finish: string | null
  artist: string
  sourcePrintingId: string
}

/** Shape of the API's per-card `printings[]` entries (fields we consume). */
interface ApiPrinting {
  id: string
  collector_number: string
  set: { code: string; name: string }
  rarity: string
  finish: string | null
  artist: string
  image_url: string
}

async function fetchCardPrintings(slug: string): Promise<ApiPrinting[]> {
  const res = await fetch(`${API_BASE}/${encodeURIComponent(slug)}`, {
    headers: { 'User-Agent': USER_AGENT },
  })
  if (!res.ok) throw new Error(`GET ${slug} -> HTTP ${res.status}`)
  const data = (await res.json()) as { printings?: ApiPrinting[] }
  if (!Array.isArray(data.printings) || data.printings.length === 0) {
    throw new Error(`card "${slug}" has no printings[] in the API response`)
  }
  return data.printings
}

async function downloadImage(url: string, filePath: string): Promise<void> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`image download -> HTTP ${res.status}`)
  await writeFile(filePath, Buffer.from(await res.arrayBuffer()))
}

/** Inline re-implementation of src/ui/printings.ts's zod checks (required
 *  fields non-empty where the schema demands it, `finish` nullable, `artist`
 *  may be empty) — see the file-header note on why this isn't imported. */
function validateRowShape(row: Printing, errors: string[]): void {
  const nonEmptyStringFields: [keyof Printing, string][] = [
    ['key', row.key],
    ['cardId', row.cardId],
    ['setCode', row.setCode],
    ['setName', row.setName],
    ['collectorNumber', row.collectorNumber],
    ['rarity', row.rarity],
    ['sourcePrintingId', row.sourcePrintingId],
  ]
  for (const [field, value] of nonEmptyStringFields) {
    if (typeof value !== 'string' || value.length === 0) {
      errors.push(`printing "${row.key}": field "${field}" must be a non-empty string, got ${JSON.stringify(value)}`)
    }
  }
  if (row.finish !== null && typeof row.finish !== 'string') {
    errors.push(`printing "${row.key}": field "finish" must be a string or null, got ${JSON.stringify(row.finish)}`)
  }
  if (typeof row.artist !== 'string') {
    errors.push(`printing "${row.key}": field "artist" must be a string, got ${JSON.stringify(row.artist)}`)
  }
}

async function main(): Promise<void> {
  const withImages = process.argv.includes('--images')
  const cards = JSON.parse(await readFile(CARDS_JSON_PATH, 'utf8')) as { id: string }[]
  if (withImages) await mkdir(PRINTING_IMAGES_DIR, { recursive: true })

  const rows: Printing[] = []
  const errors: string[] = []

  for (const [index, card] of cards.entries()) {
    process.stdout.write(`[${index + 1}/${cards.length}] ${card.id}\n`)
    let apiPrintings: ApiPrinting[]
    try {
      apiPrintings = await fetchCardPrintings(card.id)
    } catch (err) {
      errors.push(String(err))
      await sleep(DELAY_MS)
      continue
    }
    for (const p of apiPrintings) {
      const key = `${p.set.code}/${p.collector_number}`
      rows.push({
        key,
        cardId: card.id,
        setCode: p.set.code,
        setName: p.set.name,
        collectorNumber: p.collector_number,
        rarity: p.rarity,
        finish: p.finish,
        artist: p.artist ?? '',
        sourcePrintingId: p.id,
      })
      if (withImages) {
        const filePath = resolve(PRINTING_IMAGES_DIR, `${key.replace('/', '__')}.webp`)
        try {
          await downloadImage(p.image_url, filePath)
        } catch (err) {
          // Images are best-effort (the app falls back to base art / the
          // drawn frame); data rows are not.
          console.error(`[images] ${key}: ${String(err)}`)
        }
      }
    }
    await sleep(DELAY_MS)
  }

  rows.sort(
    (a, b) => a.setCode.localeCompare(b.setCode) || a.collectorNumber.localeCompare(b.collectorNumber)
  )

  // Refuse-to-write validation (inline — see file header for why this
  // doesn't import src/ui/printings.ts): per-row shape, key format, key
  // uniqueness, then the both-direction join against cards.json.
  const seenKeys = new Set<string>()
  for (const row of rows) {
    validateRowShape(row, errors)
    const expectedKey = `${row.setCode}/${row.collectorNumber}`
    if (row.key !== expectedKey) {
      errors.push(`printing "${row.key}": key does not equal "\${setCode}/\${collectorNumber}" ("${expectedKey}")`)
    }
    if (seenKeys.has(row.key)) {
      errors.push(`duplicate printing key: "${row.key}"`)
    }
    seenKeys.add(row.key)
  }
  const cardIds = new Set(cards.map((c) => c.id))
  const covered = new Set(rows.map((r) => r.cardId))
  for (const id of cardIds) {
    if (!covered.has(id)) errors.push(`card "${id}" has no printings`)
  }
  for (const row of rows) {
    if (!cardIds.has(row.cardId)) errors.push(`printing "${row.key}" references unknown card "${row.cardId}"`)
  }

  if (errors.length > 0) {
    console.error(`\nREFUSING TO WRITE — ${errors.length} problem(s):`)
    for (const e of errors) console.error(`  - ${e}`)
    process.exit(1)
  }

  await writeFile(PRINTINGS_JSON_PATH, JSON.stringify(rows, null, 1) + '\n', 'utf8')
  console.log(`\nWrote ${rows.length} printings for ${covered.size} cards to data/printings.json`)
}

main().catch((err) => {
  console.error(String(err))
  process.exit(1)
})
