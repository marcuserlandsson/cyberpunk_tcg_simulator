// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildImageIndex, getOfficialImageUrl } from '../../src/ui/images'

const IMAGES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../data/images')

/**
 * The on-disk filename for `defId` in the real (gitignored) `data/images/`
 * directory, or `undefined` if there is none — either because the
 * directory doesn't exist at all (fresh clone, nothing fetched yet) or
 * because it exists but has no file for this particular id. Used to make
 * the `getOfficialImageUrl` tests below strict in BOTH environments,
 * instead of a tautology that passes no matter what the function returns.
 */
function realImageFilenameFor(defId: string): string | undefined {
  let files: string[]
  try {
    files = readdirSync(IMAGES_DIR)
  } catch {
    return undefined
  }
  return files.find((f) => f.replace(/\.(png|jpg|jpeg|webp)$/i, '') === defId)
}

describe('buildImageIndex', () => {
  it('maps a glob-module record to defId -> url, stripping directory and extension', () => {
    const index = buildImageIndex({
      '/data/images/mantis-blades.png': 'https://cdn.example/mantis-blades.png',
      '/data/images/corpo-security.jpg': 'https://cdn.example/corpo-security.jpg',
      '/data/images/goro-takemura-hands-unclean.jpeg':
        'https://cdn.example/goro-takemura-hands-unclean.jpeg',
    })
    expect(index.get('mantis-blades')).toBe('https://cdn.example/mantis-blades.png')
    expect(index.get('corpo-security')).toBe('https://cdn.example/corpo-security.jpg')
    expect(index.get('goro-takemura-hands-unclean')).toBe(
      'https://cdn.example/goro-takemura-hands-unclean.jpeg'
    )
  })

  it('strips the extension case-insensitively', () => {
    const index = buildImageIndex({
      '/data/images/weird-card.WEBP': 'https://cdn.example/weird-card.webp',
    })
    expect(index.get('weird-card')).toBe('https://cdn.example/weird-card.webp')
  })

  it('returns an empty index for an empty modules record', () => {
    expect(buildImageIndex({}).size).toBe(0)
  })
})

describe('getOfficialImageUrl', () => {
  // Real behavior against the actual `data/images/` directory and the real
  // `import.meta.glob` wiring in src/ui/images.ts — not mocked. The
  // directory is gitignored, so what's in it (nothing on a fresh clone, up
  // to 141 files after `node scripts/fetch-images.mjs`) varies by
  // environment. Rather than loosening the assertion to tolerate both
  // outcomes (a tautology that can't catch a broken lookup), each test below
  // independently discovers which branch this environment is actually in
  // (via `realImageFilenameFor`, a plain `fs.readdirSync` — not the glob
  // under test) and then asserts that specific, strict outcome.
  it('returns undefined for an id that is not a real card', () => {
    expect(realImageFilenameFor('does-not-exist')).toBeUndefined()
    expect(getOfficialImageUrl('does-not-exist')).toBeUndefined()
  })

  it('resolves to a URL naming the on-disk file when data/images/ has one for this id, and to undefined otherwise', () => {
    const filename = realImageFilenameFor('mantis-blades')
    const url = getOfficialImageUrl('mantis-blades')
    if (filename === undefined) {
      // Fresh clone / no fetch run yet: the glob has nothing to resolve.
      expect(url).toBeUndefined()
    } else {
      // `node scripts/fetch-images.mjs` has been run: the glob must resolve
      // to a URL that actually names the real file it found on disk.
      expect(url).toBeDefined()
      expect(url).toContain(filename)
    }
  })
})
