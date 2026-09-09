// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { loadCardDb } from '../../src/engine/cardDb'
import { loadPrintings } from '../../src/ui/printings'
import { _resetCollectionCacheForTests, setCount } from '../../src/ui/collection'
import { saveDeck } from '../../src/ui/storage'
import { PlanPurchasesMode } from '../../src/ui/PlanPurchasesMode'

const db = loadCardDb()
const printings = loadPrintings()
const legends: [string, string, string] = ['goro-takemura-hands-unclean', 'yorinobu-arasaka-embracing-destruction', 'saburo-arasaka-stubborn-patriarch']
beforeEach(() => {
  localStorage.clear(); _resetCollectionCacheForTests()
  saveDeck({ name: 'Plan A', demo: true, legends, cards: { 'industrial-assembly': 3 } })
  saveDeck({ name: 'Plan B', demo: true, legends, cards: { 'industrial-assembly': 2 } })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
const mount = () => render(<PlanPurchasesMode db={db} printings={printings} known />)

describe('PlanPurchasesMode', () => {
  it('lists decks as checkbox chips and computes shared vs kept requirements', () => {
    setCount('arasakademodeck/006', 2)
    mount()
    fireEvent.click(screen.getByLabelText('Plan A', { exact: true }))
    fireEvent.click(screen.getByLabelText('Plan B', { exact: true }))
    const buy = () => screen.getAllByTestId('acquisition-row').find(r => r.getAttribute('data-card-id') === 'industrial-assembly')!.querySelectorAll('td')[4].textContent
    expect(buy()).toBe('1')
    fireEvent.click(screen.getByTestId('acquisition-mode-assembled'))
    expect(buy()).toBe('3')
    fireEvent.click(screen.getByTestId('reserve-artwork'))
    expect(buy()).toBe('4')
    expect(screen.getByTestId('acquisition-total').textContent).toMatch(/10 copies/)
    expect((screen.getByTestId('acquisition-list') as HTMLTextAreaElement).value).toMatch(/4x Industrial Assembly/)
  })
  it('flags an invalid deck on its chip', () => {
    saveDeck({ name: 'Broken', legends: ['', '', ''], cards: {} })
    mount()
    expect(screen.getByTestId('acquisition-deck-Broken').closest('label')!.textContent).toMatch(/errors?/)
  })
  it('copies the shopping list and the three goal lists', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    mount()
    fireEvent.click(screen.getByLabelText('Plan A', { exact: true }))
    fireEvent.click(screen.getByLabelText('Plan B', { exact: true }))
    fireEvent.click(screen.getByTestId('acquisition-copy'))
    fireEvent.click(screen.getByTestId('copy-buylist'))
    fireEvent.click(screen.getByTestId('copy-playset-list'))
    fireEvent.click(screen.getByTestId('copy-artwork-list'))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(4))
    expect(writeText.mock.calls[1][0]).toContain('## Missing for playset')
  })
  it('surfaces a rejected clipboard write', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true })
    mount()
    fireEvent.click(screen.getByTestId('copy-buylist'))
    await waitFor(() => expect(screen.getByTestId('copy-error').textContent).toContain('Could not copy'))
  })
  it('clears a prior copy error on a subsequent successful copy', async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    mount()
    fireEvent.click(screen.getByTestId('copy-buylist'))
    await waitFor(() => expect(screen.getByTestId('copy-error')).toBeTruthy())
    fireEvent.click(screen.getByTestId('copy-buylist'))
    await waitFor(() => expect(screen.queryByTestId('copy-error')).toBeNull())
  })
  it('says why nothing is computed when ownership is unknown', () => {
    render(<PlanPurchasesMode db={db} printings={printings} known={false} />)
    expect(screen.getByTestId('acquisition-planner').textContent).toMatch(/Ownership unavailable/)
  })
})
