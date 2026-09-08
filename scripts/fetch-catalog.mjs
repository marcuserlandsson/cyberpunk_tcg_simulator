// Discover the entire public catalog, including IDs not yet implemented locally.
// Fetches a review snapshot only: never overwrites effects or collection counts.
import { readFile, writeFile, rename } from 'node:fs/promises'
const base = 'https://api.netdeck.gg/api/cards/cyberpunk'
async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response.json()
}
const first = await get(`${base}?limit=100&offset=0`)
if (!Number.isInteger(first.total) || first.total < 1 || !Array.isArray(first.items)) throw new Error('Invalid catalog response')
const entries = [...first.items]
for (let offset = first.items.length; offset < first.total;) {
  const page = await get(`${base}?limit=100&offset=${offset}`)
  if (page.total !== first.total || !page.items?.length) throw new Error('Catalog changed during pagination; retry')
  entries.push(...page.items)
  offset += page.items.length
}
const ids = new Set(entries.map(card => card.slug))
if (ids.size !== first.total || entries.length !== first.total) throw new Error('Missing or duplicated catalog IDs')
const cards = []
for (let offset = 0; offset < entries.length; offset += 4) {
  const batch = await Promise.all(entries.slice(offset, offset + 4).map(card => get(`${base}/${encodeURIComponent(card.slug)}`)))
  for (const card of batch) {
    if (!ids.has(card.slug) || !card.printings?.length) throw new Error('Incomplete card detail')
    // Signed image URLs expire. Preserve the public source URL for provenance.
    delete card.image_url
    for (const printing of card.printings) delete printing.image_url
    cards.push(card)
  }
  process.stdout.write(`Fetched ${cards.length}/${entries.length}\n`)
}
cards.sort((a, b) => a.slug.localeCompare(b.slug))
const local = JSON.parse(await readFile(new URL('../data/cards.json', import.meta.url), 'utf8'))
const localIds = new Set(local.map(card => card.id))
const snapshot = { retrievedAt: new Date().toISOString(), source: base, total: cards.length, cards }
const destination = new URL('../data/catalog-source.json', import.meta.url)
const temp = new URL('../data/catalog-source.json.tmp', import.meta.url)
await writeFile(temp, JSON.stringify(snapshot) + '\n')
await rename(temp, destination)
console.log(JSON.stringify({ newCards: cards.filter(card => !localIds.has(card.slug)).map(card => card.slug), absentFromSource: local.filter(card => !ids.has(card.id)).map(card => card.id) }, null, 2))
