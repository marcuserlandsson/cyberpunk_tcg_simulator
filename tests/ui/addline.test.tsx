// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { loadCardDb } from '../../src/engine/cardDb'
import { loadPrintings, printingsByCard } from '../../src/ui/printings'
import { _resetCollectionCacheForTests, getCollection } from '../../src/ui/collection'
import { _resetDraftForTests, getDraft, updateDraft } from '../../src/ui/sessionDraft'
import { AddLine } from '../../src/ui/AddLine'

const db = loadCardDb()
const printings = loadPrintings()
const target = printings.find((p) => p.cardId === 'mantis-blades')!
const MULTI_SET = 'welcometonightcitybeta'
const MULTI_CARD = 'adam-smasher-ender-of-legends'
const multiInSet = printings.filter((p) => p.cardId === MULTI_CARD && p.setCode === MULTI_SET)
if (multiInSet.length < 2) throw new Error(`fixture assumption failed: ${MULTI_CARD} no longer has 2+ printings in ${MULTI_SET}`)

beforeEach(() => { localStorage.clear(); _resetCollectionCacheForTests(); _resetDraftForTests() })
afterEach(cleanup)

async function typeMantis(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByTestId('quick-add-set'), target.setCode)
  await user.type(screen.getByTestId('quick-add-input'), 'mantis')
}

describe('AddLine', () => {
  it('Enter stages +1 in the session set and never touches the collection', async () => {
    const user = userEvent.setup()
    render(<AddLine db={db} printings={printings} testIdPrefix="quick-add" />)
    await typeMantis(user)
    expect(screen.getByTestId('quick-add-match-mantis-blades')).toBeTruthy()
    await user.keyboard('{Enter}')
    expect(getDraft().lines).toEqual([{ key: target.key, delta: 1 }])
    expect(getCollection().counts).toEqual({})
    expect((screen.getByTestId('quick-add-input') as HTMLInputElement).value).toBe('')
    expect(screen.getByTestId('quick-add-toast').textContent).toContain('+1')
  })

  it('Shift+Enter stages −1', async () => {
    const user = userEvent.setup()
    render(<AddLine db={db} printings={printings} testIdPrefix="quick-add" />)
    await typeMantis(user)
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    expect(getDraft().lines).toEqual([{ key: target.key, delta: -1 }])
  })

  it('in exact mode Enter stages "exactly 1"', async () => {
    updateDraft({ mode: 'exact' })
    const user = userEvent.setup()
    render(<AddLine db={db} printings={printings} testIdPrefix="quick-add" />)
    await typeMantis(user)
    await user.keyboard('{Enter}')
    expect(getDraft().lines).toEqual([{ key: target.key, exact: 1 }])
  })

  it('remembers the session set across mounts', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<AddLine db={db} printings={printings} testIdPrefix="quick-add" />)
    await user.selectOptions(screen.getByTestId('quick-add-set'), target.setCode)
    unmount()
    render(<AddLine db={db} printings={printings} testIdPrefix="quick-add" />)
    expect((screen.getByTestId('quick-add-set') as HTMLSelectElement).value).toBe(target.setCode)
  })

  it('a card absent from the session set offers its printings as chips', async () => {
    const byCard = printingsByCard(printings)
    const outsider = [...byCard.entries()].find(([, list]) => !list.some((p) => p.setCode === target.setCode))
    if (outsider === undefined) throw new Error('fixture assumption failed: every card has a printing in the target set')
    const [cardId, list] = outsider
    const user = userEvent.setup()
    render(<AddLine db={db} printings={printings} testIdPrefix="quick-add" />)
    await user.selectOptions(screen.getByTestId('quick-add-set'), target.setCode)
    await user.type(screen.getByTestId('quick-add-input'), db[cardId].name.slice(0, 6))
    await user.click(screen.getByTestId(`quick-add-printing-${list[0].key}`))
    expect(getDraft().lines).toEqual([{ key: list[0].key, delta: 1 }])
  })

  it('Enter refuses to guess between several printings in the set', async () => {
    const user = userEvent.setup()
    render(<AddLine db={db} printings={printings} testIdPrefix="quick-add" />)
    await user.selectOptions(screen.getByTestId('quick-add-set'), MULTI_SET)
    await user.type(screen.getByTestId('quick-add-input'), 'ender of legends')
    await user.keyboard('{Enter}')
    expect(getDraft().lines).toEqual([])
    for (const p of multiInSet) {
      const chip = screen.getByTestId(`quick-add-printing-${p.key}`)
      expect(chip.textContent).toContain(p.collectorNumber)
      expect(chip.textContent).toContain(p.rarity)
    }
  })

  it('uses the given test-id prefix so two instances can coexist', () => {
    render(<AddLine db={db} printings={printings} testIdPrefix="add-line" />)
    expect(screen.getByTestId('add-line-input')).toBeTruthy()
  })
})
