#!/usr/bin/env node
// Task 16 Step 2: best-effort fetch of official card art.
//
// Re-queries the same netdeck.gg API used for card transcription (see
// data/transcription-report.md), across the same four `set` codes that
// together cover all 141 reconciled cards, and downloads each card's
// `image_url` (a short-lived signed CloudFront URL — `source_image_url` is
// the *unsigned* form and 403s directly, confirmed by hand before writing
// this script) to `data/images/<defId>.<ext>`.
//
// `<defId>` matches the API's own `slug` field, which is exactly the `id`
// used in `data/cards.json` (verified: both are the same lowercase-hyphenated
// strings) — so no id-mapping table is needed, and `src/ui/images.ts`'s
// `defId -> URL` index (stripping directory + extension from each glob path)
// lines up automatically.
//
// This script is deliberately tolerant end-to-end: a failure on one card
// (network error, missing image_url, non-2xx download) is logged and
// skipped, never fatal. A total API outage still exits 0 with "0/141
// fetched" rather than throwing, per the brief ("if zero images fetchable,
// note it in README").
//
// Usage: node scripts/fetch-images.mjs
//
// Not run in CI / the test suite — this is a one-off, best-effort data
// population step. `data/images/` is gitignored; the app works fully
// without it (CardFrame falls back to the HTML card face).

import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
// Must match the glob in src/ui/images.ts: `/data/images/*`.
const IMAGES_DIR = resolve(REPO_ROOT, 'data/images')
const CARDS_JSON_PATH = resolve(REPO_ROOT, 'data/cards.json')

const API_BASE = 'https://api.netdeck.gg/api/cards/cyberpunk'
const USER_AGENT = 'Mozilla/5.0 (cyberpunk-tcg-simulator fetch-images.mjs; personal playtesting tool)'
// The four set codes that together cover all 141 reconciled cards (see
// data/transcription-report.md's "Card count reconciliation" table).
const SETS = ['welcometonightcitybeta', 'arasakademodeck', 'mercdemodeck', 'PRM01']
const PAGE_LIMIT = 100 // the API silently caps `limit` at 100 regardless of what's requested
const DELAY_MS = 500

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms))
}

/** Fetch every card in one `set`, paginating in PAGE_LIMIT-sized pages. */
async function fetchSet(setCode) {
  const items = []
  let offset = 0
  for (;;) {
    const url = `${API_BASE}?set=${encodeURIComponent(setCode)}&limit=${PAGE_LIMIT}&offset=${offset}`
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
    if (!res.ok) {
      throw new Error(`GET ${url} -> HTTP ${res.status}`)
    }
    const data = await res.json()
    items.push(...data.items)
    offset += data.items.length
    if (items.length >= data.total || data.items.length === 0) break
  }
  return items
}

/** Build a slug -> image_url map across all SETS, deduping by slug. */
async function buildImageUrlIndex() {
  const index = new Map()
  for (const setCode of SETS) {
    let items
    try {
      items = await fetchSet(setCode)
    } catch (err) {
      console.error(`[fetch-images] failed to list set "${setCode}": ${String(err)}`)
      continue
    }
    for (const item of items) {
      if (typeof item.slug === 'string' && typeof item.image_url === 'string' && item.image_url.length > 0) {
        index.set(item.slug, item.image_url)
      }
    }
    await sleep(DELAY_MS)
  }
  return index
}

function extensionFor(url, contentType) {
  const fromContentType = {
    'image/webp': 'webp',
    'image/png': 'png',
    'image/jpeg': 'jpg',
  }[contentType]
  if (fromContentType !== undefined) return fromContentType
  const match = /\.(webp|png|jpe?g)(?:\?|$)/i.exec(url)
  if (match !== undefined) return match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase()
  return 'webp' // the API's own CDN renders are webp in every observed case
}

async function downloadOne(defId, imageUrl) {
  const res = await fetch(imageUrl)
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }
  const ext = extensionFor(imageUrl, res.headers.get('content-type') ?? '')
  const buf = Buffer.from(await res.arrayBuffer())
  await writeFile(resolve(IMAGES_DIR, `${defId}.${ext}`), buf)
}

async function main() {
  const cardsRaw = await import('node:fs/promises').then((fs) => fs.readFile(CARDS_JSON_PATH, 'utf-8'))
  const cards = JSON.parse(cardsRaw)
  const defIds = cards.map((c) => c.id)

  console.log(`[fetch-images] ${defIds.length} cards in data/cards.json; querying ${SETS.length} API sets...`)
  const urlIndex = await buildImageUrlIndex()
  console.log(`[fetch-images] resolved image URLs for ${urlIndex.size} slugs across all sets`)

  await mkdir(IMAGES_DIR, { recursive: true })

  let fetched = 0
  const failures = []
  for (const defId of defIds) {
    const imageUrl = urlIndex.get(defId)
    if (imageUrl === undefined) {
      failures.push(`${defId}: no image_url found in API response`)
      continue
    }
    try {
      await downloadOne(defId, imageUrl)
      fetched += 1
    } catch (err) {
      failures.push(`${defId}: ${String(err)}`)
    }
    await sleep(DELAY_MS)
  }

  console.log('')
  console.log(`[fetch-images] done: ${fetched}/${defIds.length} images saved to data/images/`)
  if (failures.length > 0) {
    console.log(`[fetch-images] ${failures.length} card(s) without an image:`)
    for (const line of failures) console.log(`  - ${line}`)
  }
  if (fetched === 0) {
    console.log(
      '[fetch-images] zero images fetched — the app works fully without official art ' +
        '(HTML card frames are the baseline visual, not a fallback). See README.'
    )
  }
}

main().catch((err) => {
  // Never let a top-level failure look like anything other than "0 images
  // fetched, app still works" — this script is explicitly best-effort.
  console.error(`[fetch-images] unexpected top-level failure: ${String(err)}`)
  console.log('[fetch-images] done: 0/? images saved (script aborted early)')
})
