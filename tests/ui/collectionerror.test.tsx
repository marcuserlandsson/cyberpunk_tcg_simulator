// @vitest-environment jsdom
//
// I6 / spec §5: "printings.json failing zod validation at load: the Collection
// tab renders an error state naming the problem; the rest of the app is
// untouched." `CollectionView` wraps `loadPrintings()` in a try/catch to do
// that, but nothing exercised the catch — deleting it left every test green.
//
// The throwing loader needs a module mock, and `vi.mock` is file-wide, so this
// lives in its own file rather than inside collectionview.test.tsx (which
// deliberately renders against the real dataset).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const BOOM = 'printings.json is malformed:\n0.rarity: Invalid input'

vi.mock('../../src/ui/printings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/ui/printings')>()
  return {
    ...actual,
    loadPrintings: () => {
      throw new Error(BOOM)
    },
  }
})

const { loadCardDb } = await import('../../src/engine/cardDb')
const { CollectionView } = await import('../../src/ui/CollectionView')
const { DeckBuilderView } = await import('../../src/ui/DeckBuilderView')

const db = loadCardDb()

beforeEach(() => {
  localStorage.clear()
})

afterEach(cleanup)

describe('CollectionView with an unloadable printings dataset', () => {
  it('renders the error state instead of the grid', () => {
    render(<CollectionView db={db} useOfficialImages={false} />)
    const error = screen.getByTestId('collection-error')
    expect(error.textContent).toContain('Collection unavailable')
    // The message names the actual problem, in readable lines.
    expect(error.textContent).toContain('0.rarity')
    expect(screen.queryByTestId('collection-grid')).toBeNull()
  })

  it('does not take the Deck Builder down with it', () => {
    // Same failing loader, different call site: DeckBuilderView degrades to an
    // empty dataset (every badge reads "owned 0/T") rather than erroring.
    render(<DeckBuilderView db={db} useOfficialImages={false} />)
    expect(screen.getByTestId('deck-builder')).toBeTruthy()
    expect(screen.getByTestId('owned-mantis-blades').textContent).toBe('owned 0/3')
  })
})
