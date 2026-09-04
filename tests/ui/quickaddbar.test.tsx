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

// The C2 fixture: a real card with MORE THAN ONE printing in a single set —
// on the shipped dataset, 31 card+set combinations across 30 cards (the
// in-set alt arts and Iconic variants this whole feature exists to track).
// Enter must refuse to pick between them.
const MULTI_SET = 'welcometonightcitybeta'
const MULTI_CARD = 'adam-smasher-ender-of-legends'
const multiInSet = printings.filter((p) => p.cardId === MULTI_CARD && p.setCode === MULTI_SET)
if (multiInSet.length < 2) {
  throw new Error(
    `fixture assumption failed: ${MULTI_CARD} no longer has 2+ printings in ${MULTI_SET}`
  )
}

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
    if (outsider === undefined) {
      throw new Error(
        `fixture assumption failed: every card now has a printing in ${target.setCode}, so there is no "absent from the session set" case left to exercise`
      )
    }
    const [cardId, list] = outsider
    const user = userEvent.setup()
    render(<QuickAddBar db={db} printings={printings} />)
    await user.selectOptions(screen.getByTestId('quick-add-set'), target.setCode)
    await user.type(screen.getByTestId('quick-add-input'), db[cardId].name.slice(0, 6))
    await user.click(screen.getByTestId(`quick-add-printing-${list[0].key}`))
    expect(getCollection().counts[list[0].key]).toBe(1)
  })
})

// C2. Enter used to `.find()` the FIRST printing in the session set, so a
// card with two printings there silently credited whichever came first —
// pull the Iconic Legend β141, type "adam smasher", press Enter, and the copy
// landed on the Epic β001 with nothing on screen saying so.
describe('QuickAddBar — a card with several printings in the session set', () => {
  async function search(user: ReturnType<typeof userEvent.setup>) {
    await user.selectOptions(screen.getByTestId('quick-add-set'), MULTI_SET)
    await user.type(screen.getByTestId('quick-add-input'), 'ender of legends')
  }

  it('Enter does not add anything — the keystroke never guesses which printing', async () => {
    const user = userEvent.setup()
    render(<QuickAddBar db={db} printings={printings} />)
    await search(user)
    await user.keyboard('{Enter}')
    expect(getCollection().counts).toEqual({})
    expect(screen.queryByTestId('quick-add-toast')).toBeNull()
  })

  it('offers each printing inline, labelled with collector number and rarity', async () => {
    const user = userEvent.setup()
    render(<QuickAddBar db={db} printings={printings} />)
    await search(user)
    for (const printing of multiInSet) {
      const button = screen.getByTestId(`quick-add-printing-${printing.key}`)
      expect(button.textContent).toContain(printing.collectorNumber)
      expect(button.textContent).toContain(printing.rarity)
    }
    // Honest copy: these printings ARE in this set, so the old wording is gone.
    const row = screen.getByTestId(`quick-add-match-${MULTI_CARD}`)
    expect(row.textContent).toContain('printings in this set')
    expect(row.textContent).not.toContain('not in this set')
  })

  it('clicking one credits exactly that printing, and the toast names it', async () => {
    const user = userEvent.setup()
    render(<QuickAddBar db={db} printings={printings} />)
    await search(user)
    const wanted = multiInSet[1] // deliberately NOT the first — the old bug
    await user.click(screen.getByTestId(`quick-add-printing-${wanted.key}`))

    expect(getCollection().counts[wanted.key]).toBe(1)
    expect(getCollection().counts[multiInSet[0].key]).toBeUndefined()
    // The toast has to carry the collector number, or a mis-attribution is
    // invisible and its Undo button is a coin flip.
    expect(screen.getByTestId('quick-add-toast').textContent).toContain(wanted.collectorNumber)
  })

  it('undo from that toast removes the copy from the printing it went to', async () => {
    const user = userEvent.setup()
    render(<QuickAddBar db={db} printings={printings} />)
    await search(user)
    const wanted = multiInSet[1]
    await user.click(screen.getByTestId(`quick-add-printing-${wanted.key}`))
    await user.click(screen.getByTestId('quick-add-undo'))
    expect(getCollection().counts[wanted.key]).toBeUndefined()
  })

  it('regression: a card with exactly ONE printing in the session set still adds on Enter', async () => {
    // The single-keystroke fast path is the reason this component exists —
    // 110 of the 141 cards take it. mantis-blades is one of them.
    const single = printings.filter(
      (p) => p.cardId === 'mantis-blades' && p.setCode === target.setCode
    )
    if (single.length !== 1) {
      throw new Error('fixture assumption failed: mantis-blades is no longer single-printing here')
    }
    const user = userEvent.setup()
    render(<QuickAddBar db={db} printings={printings} />)
    await user.selectOptions(screen.getByTestId('quick-add-set'), target.setCode)
    await user.type(screen.getByTestId('quick-add-input'), 'mantis')
    await user.keyboard('{Enter}')
    expect(getCollection().counts[single[0].key]).toBe(1)
  })
})
