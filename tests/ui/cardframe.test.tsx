// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { CardFrame } from '../../src/ui/CardFrame'
import { loadCardDb } from '../../src/engine/cardDb'
import type { CardDef } from '../../src/engine/types'

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

describe('CardFrame', () => {
  it('shows the name, cost, power, and keyword text for a real card def', () => {
    const { container } = render(
      <CardFrame def={GORO} size="medium" useOfficialImages={false} />
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
    const { container } = render(
      <CardFrame def={CORPO_SECURITY} size="small" useOfficialImages={false} />
    )
    expect(container.querySelector('.card-frame__lag-chip')).toBeNull()
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
