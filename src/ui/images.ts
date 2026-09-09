// Looks up official card art for `CardFrame`'s image variant.
//
// Kept in its own tiny module (rather than inlined in CardFrame.tsx) so it can
// be exercised/mocked independently of the component, and so CardFrame itself
// never has to know that the lookup is backed by `import.meta.glob` — the
// `data/images/` directory is gitignored and does not exist until Task 16
// populates it. `import.meta.glob` does not require the directory to exist:
// with no matching files it simply resolves to an empty object, so this
// module (and anything importing it) loads cleanly today, under both Vite and
// Vitest (which shares Vite's transform pipeline for `import.meta.glob`).
import { listSets, loadPrintings, type Printing } from './printings'
import { biggestSet, comparePrintings } from './collectionSort'

const officialImageModules = import.meta.glob('/data/images/*', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

/**
 * Turns an `import.meta.glob` result (path -> resolved URL) into a
 * `defId -> URL` lookup, stripping the directory and the image extension.
 * Exported (pure, no glob involved) so tests can exercise the parsing logic
 * directly with a synthetic modules record, without depending on
 * `data/images/` actually containing anything.
 */
export function buildImageIndex(modules: Record<string, string>): Map<string, string> {
  const index = new Map<string, string>()
  for (const [path, url] of Object.entries(modules)) {
    const filename = path.split('/').pop() ?? ''
    const defId = filename.replace(/\.(png|jpg|jpeg|webp)$/i, '')
    index.set(defId, url)
  }
  return index
}

const officialImageIndex = buildImageIndex(officialImageModules)

/** The official art URL for `defId`: the bundled base image when there is
 *  one, otherwise the image of the card's canonical printing (its lowest
 *  collector number in the biggest set, else its first printing) — cards
 *  added after the base-art fetch have printing images but no base file.
 *  `undefined` when neither exists. */
export function getOfficialImageUrl(defId: string): string | undefined {
  return officialImageIndex.get(defId) ?? canonicalPrintingImage(defId)
}

let canonicalIndex: Map<string, string> | undefined
function canonicalPrintingImage(defId: string): string | undefined {
  if (canonicalIndex === undefined) {
    canonicalIndex = new Map()
    try {
      const prints = loadPrintings()
      const preferred = biggestSet(prints)
      const setOrder = listSets(prints).map(s => s.code)
      const byCard = new Map<string, Printing[]>()
      for (const p of prints) byCard.set(p.cardId, [...(byCard.get(p.cardId) ?? []), p])
      for (const [cardId, list] of byCard) {
        const withImage = list.filter(p => printingImageIndex.has(p.key)).sort((a, b) => comparePrintings(a, b, preferred, setOrder))
        if (withImage.length > 0) canonicalIndex.set(cardId, printingImageIndex.get(withImage[0].key)!)
      }
    } catch { /* an unloadable dataset means no fallback; the Collection tab reports it */ }
  }
  return canonicalIndex.get(defId)
}

const printingImageModules = import.meta.glob('/data/images/printings/*', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

/** Like buildImageIndex, but filenames encode printing keys with '/'
 *  replaced by '__' (a '/' cannot appear in a filename). Exported pure for
 *  the same test-with-synthetic-records reason as buildImageIndex. */
export function buildPrintingImageIndex(modules: Record<string, string>): Map<string, string> {
  const index = new Map<string, string>()
  for (const [path, url] of Object.entries(modules)) {
    const filename = path.split('/').pop() ?? ''
    const stem = filename.replace(/\.(png|jpg|jpeg|webp)$/i, '')
    index.set(stem.replace(/__/g, '/'), url)
  }
  return index
}

const printingImageIndex = buildPrintingImageIndex(printingImageModules)

/** The art URL for a specific printing, or undefined if none is bundled —
 *  callers then fall back to getOfficialImageUrl(cardId), then the drawn
 *  CardFrame, exactly like base art falls back today. */
export function getPrintingImageUrl(printingKey: string): string | undefined {
  return printingImageIndex.get(printingKey)
}
