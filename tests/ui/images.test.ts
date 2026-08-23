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
  it('returns undefined for any card id, since data/images/ is empty until Task 16', () => {
    // Real behavior against the actual (gitignored, empty) images directory —
    // not mocked. This is the state CardFrame sees today for every card.
    expect(getOfficialImageUrl('mantis-blades')).toBeUndefined()
    expect(getOfficialImageUrl('does-not-exist')).toBeUndefined()
  })
})
