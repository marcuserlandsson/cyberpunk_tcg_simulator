// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { buildImageIndex, getOfficialImageUrl } from '../../src/ui/images'

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
  // Real behavior against the actual `data/images/` directory — not mocked.
  // The directory is gitignored, so what's in it (nothing on a fresh clone,
  // up to 141 files after `node scripts/fetch-images.mjs`) varies by
  // environment. Both outcomes are legitimate: assert only what's true of
  // BOTH — a resolved URL is a non-empty string when present, and an id that
  // is not a real card id is never resolved.
  it('returns undefined for an id that is not a real card', () => {
    expect(getOfficialImageUrl('does-not-exist')).toBeUndefined()
  })

  it('returns undefined or a non-empty URL for a real card id, never anything else', () => {
    const url = getOfficialImageUrl('mantis-blades')
    expect(url === undefined || (typeof url === 'string' && url.length > 0)).toBe(true)
  })
})
