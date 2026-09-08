// Import reviewed source metadata without replacing hand-authored mechanics.
// New cards remain explicitly pending until their effects are implemented.
import { readFile, writeFile } from 'node:fs/promises'
const path = name => new URL(`../data/${name}`, import.meta.url)
const read = async name => JSON.parse(await readFile(path(name), 'utf8'))
const snapshot = await read('catalog-source.json')
const previous = await read('cards.json')
const oldPrintings = await read('printings.json')
const byId = new Map(previous.map(card => [card.id, card]))
const factions = new Set(previous.map(card => card.faction).filter(Boolean))
if (snapshot.total !== snapshot.cards.length || new Set(snapshot.cards.map(card => card.slug)).size !== snapshot.total) throw new Error('Incomplete catalog')
const cards = snapshot.cards.map(source => {
  const old = byId.get(source.slug)
  const type = source.card_type.toLowerCase()
  const text = source.rules_text ?? ''
  const ram = source.ram === null ? null : { color: source.color, value: source.ram }
  const keywords = [...(source.classifications ?? []).map(tag => tag.toLowerCase()),
    ...[...text.matchAll(/\{(Quick|Adrenaline|Blocker|Go Solo)\}/g)].map(match => match[1].toLowerCase().replace(' ', '-'))]
  return {
    ...(old ?? {
      id: source.slug, name: source.name, ...(source.subname ? { subtitle: source.subname } : {}),
      color: source.color, ...(source.classifications.find(tag => factions.has(tag)) ? { faction: source.classifications.find(tag => factions.has(tag)) } : {}),
      type, cost: source.cost ?? 0, power: source.power,
      ram: type === 'legend' ? null : ram, ramLimit: type === 'legend' ? ram : null,
      sellTag: source.is_eddiable, keywords: [...new Set(keywords)], text: source.rules_text,
      effects: [], implementation: 'pending',
    }),
    printedCost: source.cost,
    // The source's flavour labels are editorial, not printed rules text.
    text: text.replace(/^\[Flavou?r(?: Text)?\]\s*/, ''),
    sellTag: source.is_eddiable,
  }
})
const ids = new Set(cards.map(card => card.id))
if (previous.some(card => !ids.has(card.id))) throw new Error('Source removed a local card; review before importing')
const printingRows = new Map(oldPrintings.map(printing => [printing.key, printing]))
const currentKeys = new Set()
for (const source of snapshot.cards) for (const printing of source.printings) {
  const key = `${printing.set.code}/${printing.collector_number}${printing.finish ? `/${printing.finish}` : ''}`
  if (currentKeys.has(key)) throw new Error(`Duplicate printing key ${key}`)
  currentKeys.add(key)
  const previousPrinting = printingRows.get(key)
  if (previousPrinting && previousPrinting.cardId !== source.slug) throw new Error(`Printing identity changed: ${key}`)
  printingRows.set(key, {
    ...(previousPrinting?.sourcePrintingId === printing.id && (!previousPrinting?.sourceImageUrl || previousPrinting.sourceImageUrl === printing.source_image_url) ? previousPrinting : {}), key, cardId: source.slug, setCode: printing.set.code, setName: printing.set.name,
    collectorNumber: printing.collector_number, rarity: printing.rarity, finish: printing.finish,
    artist: source.slug === 'nocturne-op55-n1' ? 'Daniel Valaisis' : printing.artist ?? '', sourcePrintingId: printing.id, sourceImageUrl: printing.source_image_url,
  })
}
const printings = [...printingRows.values()].sort((a,b) => a.key.localeCompare(b.key))
const status = {
  retrievedAt: snapshot.retrievedAt, source: 'https://cyberpunktcg.com/cards', cardCount: cards.length,
  printingCount: printings.length, setCount: new Set(printings.map(p => p.setCode)).size,
  pendingCards: cards.filter(card => card.implementation === 'pending').map(card => card.id),
  retainedPrintingKeys: oldPrintings.filter(p => !currentKeys.has(p.key)).map(p => p.key),
  rulesUpdatedAt: '2026-09-01T19:28:10.028Z', rulesAudit: 'implemented-with-interpretations',
}
// All validation precedes writing; collection counts and keys are never rewritten.
await writeFile(path('cards.json'), JSON.stringify(cards, null, 2) + '\n')
await writeFile(path('printings.json'), JSON.stringify(printings, null, 1) + '\n')
await writeFile(path('catalog-status.json'), JSON.stringify(status, null, 2) + '\n')
console.log(JSON.stringify(status, null, 2))
