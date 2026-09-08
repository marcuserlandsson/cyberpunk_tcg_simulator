// Fetch fresh public signed image links; unsigned provenance URLs cannot be downloaded.
import { readFile, mkdir, writeFile, access } from 'node:fs/promises'
const snapshot = JSON.parse(await readFile(new URL('../data/catalog-source.json', import.meta.url), 'utf8'))
const root = new URL('../data/images/printings/', import.meta.url)
await mkdir(root, { recursive: true })
let next = 0, completed = 0
const failures = []
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < snapshot.cards.length) {
    const card = snapshot.cards[next++]
    try {
      const response = await fetch(`https://api.netdeck.gg/api/cards/cyberpunk/${encodeURIComponent(card.slug)}`, { signal: AbortSignal.timeout(30000) })
      if (!response.ok) throw new Error(`Card API HTTP ${response.status}`)
      const current = await response.json()
      for (const p of card.printings) {
        const key = `${p.set.code}/${p.collector_number}${p.finish ? '/' + p.finish : ''}`
        const path = new URL(encodeURIComponent(key.replaceAll('/', '__')) + '.webp', root)
        try { await access(path); continue } catch { /* Download only missing files. */ }
        const live = current.printings.find(row => row.id === p.id)
        if (!live?.image_url) throw new Error(`No current image for ${key}`)
        const image = await fetch(live.image_url, { signal: AbortSignal.timeout(30000) })
        if (!image.ok) throw new Error(`Image HTTP ${image.status} for ${key}`)
        await writeFile(path, new Uint8Array(await image.arrayBuffer()))
      }
    } catch (error) { failures.push(`${card.slug}: ${error.message}`) }
    if (++completed % 25 === 0) console.log(`${completed}/${snapshot.cards.length} cards`)
  }
}))
console.log(`${completed} cards processed; ${failures.length} failures`)
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1 }
