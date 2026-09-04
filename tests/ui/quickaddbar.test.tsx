// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { loadCardDb } from '../../src/engine/cardDb'
import { loadPrintings, printingsByCard } from '../../src/ui/printings'
import { _resetCollectionCacheForTests, getCollection } from '../../src/ui/collection'
import { QuickAddBar } from '../../src/ui/QuickAddBar'

const db = loadCardDb()
const printings = loadPrintings()
// A card + one of its printings to target via the session set.
const target = printings.find((p) => p.cardId === 'mantis-blades')!

beforeEach(() => {
  localStorage.clear()
  _resetCollectionCacheForTests()
})

afterEach(cleanup)

async function typeAndPickSet(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByTestId('quick-add-set'), target.setCode)
  await user.type(screen.getByTestId('quick-add-input'), 'mantis')
}

describe('QuickAddBar', () => {
  it('shows matches while typing and Enter adds 1 in the session set', async () => {
    const user = userEvent.setup()
    render(<QuickAddBar db={db} printings={printings} />)
    await typeAndPickSet(user)
    expect(screen.getByTestId('quick-add-match-mantis-blades')).toBeTruthy()
    await user.keyboard('{Enter}')
    expect(getCollection().counts[target.key]).toBe(1)
    expect((screen.getByTestId('quick-add-input') as HTMLInputElement).value).toBe('')
  })

  it('undo decrements the just-added printing', async () => {
    const user = userEvent.setup()
    render(<QuickAddBar db={db} printings={printings} />)
    await typeAndPickSet(user)
    await user.keyboard('{Enter}')
    await user.click(screen.getByTestId('quick-add-undo'))
    expect(getCollection().counts[target.key]).toBeUndefined()
  })

  it('remembers the session set across mounts', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<QuickAddBar db={db} printings={printings} />)
    await user.selectOptions(screen.getByTestId('quick-add-set'), target.setCode)
    unmount()
    render(<QuickAddBar db={db} printings={printings} />)
    expect((screen.getByTestId('quick-add-set') as HTMLSelectElement).value).toBe(target.setCode)
  })

  it('a card absent from the session set offers its printings inline', async () => {
    // Find a card that is NOT in `target.setCode` but has printings elsewhere.
    const byCard = printingsByCard(printings)
    const outsider = [...byCard.entries()].find(
      ([, list]) => !list.some((p) => p.setCode === target.setCode)
    )
    if (!outsider) return // every card is in the session set — nothing to assert
    const [cardId, list] = outsider
    const user = userEvent.setup()
    render(<QuickAddBar db={db} printings={printings} />)
    await user.selectOptions(screen.getByTestId('quick-add-set'), target.setCode)
    await user.type(screen.getByTestId('quick-add-input'), db[cardId].name.slice(0, 6))
    await user.click(screen.getByTestId(`quick-add-printing-${list[0].key}`))
    expect(getCollection().counts[list[0].key]).toBe(1)
  })
})
