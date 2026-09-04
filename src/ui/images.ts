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

/** The official art URL for `defId`, or `undefined` if none is bundled. */
export function getOfficialImageUrl(defId: string): string | undefined {
  return officialImageIndex.get(defId)
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
