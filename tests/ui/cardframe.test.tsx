// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CardFrame } from '../../src/ui/CardFrame'
import { loadCardDb } from '../../src/engine/cardDb'
import type { CardDef } from '../../src/engine/types'

// Only the "official image" describe block below ever passes
// `useOfficialImages={true}`; every other test in this file passes `false`
// (never consulting this mock), so overriding it file-wide is safe. A fixed
// fake URL for exactly one card id lets tests exercise both the "resolves"
// and "does not resolve" branches of CardFrame without touching the real
// (gitignored, empty-until-Task-16) `data/images/` directory.
const FAKE_IMAGE_URL = 'https://cdn.example/mantis-blades.png'
vi.mock('../../src/ui/images', () => ({
  getOfficialImageUrl: (defId: string) =>
    defId === 'mantis-blades' ? FAKE_IMAGE_URL : undefined,
}))

afterEach(cleanup)

const db = loadCardDb()

function card(id: string): CardDef {
  const def = db[id]
  if (!def) throw new Error(`Unknown card id "${id}" in test fixtures.`)
  return def
}

// A real Legend with printed text and keywords ({Go Solo}, {Blocker}).
const GORO = card('goro-takemura-hands-unclean')
// A real Gear with sellTag: true.
const MANTIS_BLADES = card('mantis-blades')
// A real Unit with a static "can't attack" effect and no ram.value pips
// beyond 1, useful as a plain example.
const CORPO_SECURITY = card('corpo-security')
// Fixtures named per the brief's size-semantics tests. `unitDef` must be a
// def the file-wide image mock resolves (MANTIS_BLADES) so the image-mode
// power-chip test actually exercises image mode rather than falling back to
// the text face. `blockerDef` is a card whose printed text contains
// `{Blocker}` — GORO already qualifies, so it doubles as both fixtures.
const unitDef = MANTIS_BLADES
const blockerDef = GORO

describe('CardFrame', () => {
  it('shows the name, cost, power, and keyword text for a real card def', () => {
    // "medium" is now a compact hand-card rendition (no rules text/subtitle,
    // per the brief's size semantics) — this smoke test wants the full face,
    // so it moved to "zoom".
    const { container } = render(
      <CardFrame def={GORO} size="zoom" useOfficialImages={false} />
    )
    const text = container.textContent ?? ''
    expect(text).toContain('Goro Takemura')
    expect(text).toContain('Hands Unclean')
    expect(text).toContain(String(GORO.cost))
    expect(text).toContain(String(GORO.power))
    // Printed timing/keyword markers from the rules text.
    expect(text).toContain('{Go Solo}')
    expect(text).toContain('{Blocker}')
    expect(container.querySelectorAll('.card-frame__keyword')).toHaveLength(2)
  })

  it('small size omits rules text and subtitle', () => {
    render(<CardFrame def={unitDef} size="small" useOfficialImages={false} />)
    expect(screen.queryByText(unitDef.text)).toBeNull()
    // getByText throws if no match is found, which is assertion enough; the
    // explicit truthy check below is belt-and-suspenders. (`toBeInTheDocument`
    // needs @testing-library/jest-dom, which this project does not depend on
    // — "no new dependencies" is a binding constraint, so this uses only
    // built-in Vitest matchers.)
    expect(screen.getByText(unitDef.name)).toBeTruthy()
  })

  it('zoom size renders rules text with keyword capsules', () => {
    render(<CardFrame def={blockerDef} size="zoom" useOfficialImages={false} />)
    expect(screen.getByText(/redirect a rival/i)).toBeTruthy()
    expect(document.querySelector('.card-frame__keyword')).not.toBeNull()
  })

  it('image mode shows a power chip only when effective differs from printed', () => {
    const { rerender } = render(
      <CardFrame def={unitDef} size="small" useOfficialImages tempPower={0} />
    )
    expect(document.querySelector('.card-frame__power-chip')).toBeNull()
    rerender(<CardFrame def={unitDef} size="small" useOfficialImages tempPower={2} />)
    expect(document.querySelector('.card-frame__power-chip')?.textContent).toContain(
      String(unitDef.power! + 2)
    )
  })

  it('face-down back is keyed by owner', () => {
    render(
      <CardFrame def={unitDef} size="small" faceDown owner="rival" useOfficialImages={false} />
    )
    expect(document.querySelector('.card-frame--rival')).not.toBeNull()
  })

  it('hides the name when face down', () => {
    const { container } = render(
      <CardFrame def={GORO} size="medium" faceDown useOfficialImages={false} />
    )
    expect(container.textContent ?? '').not.toContain('Goro Takemura')
    expect(container.querySelector('.card-frame__back')).not.toBeNull()
  })

  it('shows a sell-tag icon when the card def has sellTag: true', () => {
    expect(MANTIS_BLADES.sellTag).toBe(true)
    const { container } = render(
      <CardFrame def={MANTIS_BLADES} size="small" useOfficialImages={false} />
    )
    expect(container.querySelector('.card-frame__sell-tag')).not.toBeNull()
  })

  it('does not show a sell-tag icon when the card def has sellTag: false', () => {
    expect(CORPO_SECURITY.sellTag).toBe(false)
    const { container } = render(
      <CardFrame def={CORPO_SECURITY} size="small" useOfficialImages={false} />
    )
    expect(container.querySelector('.card-frame__sell-tag')).toBeNull()
  })

  it('applies the spent rotation class when ready is false', () => {
    const { container } = render(
      <CardFrame def={CORPO_SECURITY} size="small" ready={false} useOfficialImages={false} />
    )
    expect(container.querySelector('.card-frame--spent')).not.toBeNull()
  })

  it('does not apply the spent rotation class when ready (the default)', () => {
    const { container } = render(
      <CardFrame def={CORPO_SECURITY} size="small" useOfficialImages={false} />
    )
    expect(container.querySelector('.card-frame--spent')).toBeNull()
  })

  it('renders a LAG chip and dims the card when lag is true', () => {
    const { container } = render(
      <CardFrame def={CORPO_SECURITY} size="small" lag useOfficialImages={false} />
    )
    expect(container.querySelector('.card-frame--lag')).not.toBeNull()
    expect(container.textContent ?? '').toContain('LAG')
  })

  it('does not render a LAG chip when lag is false (the default)', () => {
    // Class renamed card-frame__lag-chip -> card-frame__lag-band (a banner
    // across the art, not a bottom-row chip) as part of this task's restyle.
    const { container } = render(
      <CardFrame def={CORPO_SECURITY} size="small" useOfficialImages={false} />
    )
    expect(container.querySelector('.card-frame__lag-band')).toBeNull()
  })

  it('adds tempPower to the printed power in the displayed value', () => {
    const { container } = render(
      <CardFrame def={MANTIS_BLADES} size="small" tempPower={3} useOfficialImages={false} />
    )
    expect(container.querySelector('.card-frame__power')?.textContent).toContain(
      String((MANTIS_BLADES.power ?? 0) + 3)
    )
  })

  it('calls onClick when the card is clicked', () => {
    let clicks = 0
    const { container } = render(
      <CardFrame
        def={CORPO_SECURITY}
        size="small"
        useOfficialImages={false}
        onClick={() => {
          clicks += 1
        }}
      />
    )
    const el = container.querySelector('[data-testid="card-frame"]') as HTMLElement
    el.click()
    expect(clicks).toBe(1)
  })
})

describe('CardFrame official images (useOfficialImages: true)', () => {
  it('renders the official image when the lookup resolves', () => {
    const { container } = render(
      <CardFrame def={MANTIS_BLADES} size="medium" useOfficialImages />
    )
    const img = container.querySelector('img.card-frame__image') as HTMLImageElement | null
    expect(img).not.toBeNull()
    expect(img?.src).toBe(FAKE_IMAGE_URL)
    expect(img?.alt).toBe(MANTIS_BLADES.name)
  })

  it('falls back to the plain text face when the official image fails to load', () => {
    // The always-mounted `.card-frame__zoom-fallback` (hover-to-reveal text
    // behind the art) is removed by this task — a dedicated zoom panel
    // (Task 6) now owns that job. The image face's only remaining fallback
    // path is `onError`: if the official image 404s/fails, flip to the same
    // text face so the card is never blank.
    const { container } = render(
      <CardFrame def={MANTIS_BLADES} size="medium" useOfficialImages />
    )
    expect(container.querySelector('.card-frame__zoom-fallback')).toBeNull()
    const img = container.querySelector('img.card-frame__image') as HTMLImageElement
    expect(img).not.toBeNull()
    fireEvent.error(img)
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent ?? '').toContain('Mantis Blades')
    expect(container.textContent ?? '').toContain(String(MANTIS_BLADES.power))
  })

  it('falls back to the plain text frame when no official image resolves for this def', () => {
    const { container } = render(
      <CardFrame def={CORPO_SECURITY} size="medium" useOfficialImages />
    )
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('.card-frame__zoom-fallback')).toBeNull()
    expect(container.textContent ?? '').toContain('Corpo Security')
  })

  it('falls back to the plain text frame when useOfficialImages is false, even for a def with a resolvable image', () => {
    const { container } = render(
      <CardFrame def={MANTIS_BLADES} size="medium" useOfficialImages={false} />
    )
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('.card-frame__zoom-fallback')).toBeNull()
  })
})
