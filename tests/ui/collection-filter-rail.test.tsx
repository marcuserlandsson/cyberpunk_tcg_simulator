// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { loadPrintings } from '../../src/ui/printings'
import { CollectionFilterRail, EMPTY_FILTERS, activeFilterCount, type CollectionFilters } from '../../src/ui/CollectionFilterRail'

const printings = loadPrintings()
const rarities = [...new Set(printings.map(p => p.rarity))]
afterEach(cleanup)

function mount(filters: CollectionFilters = EMPTY_FILTERS, collapsed = false) {
  const onChange = vi.fn()
  render(<CollectionFilterRail filters={filters} onChange={onChange} printings={printings} rarities={rarities} setTotals={{ arasakademodeck: { owned: 3, total: 14 } }} collapsed={collapsed} />)
  return onChange
}

describe('CollectionFilterRail', () => {
  it('toggles a colour chip through onChange', () => {
    const onChange = mount()
    fireEvent.click(screen.getByTestId('collection-color-Red'))
    expect(onChange.mock.calls[0][0].colors.has('Red')).toBe(true)
  })
  it('rarity ids are slug-safe for two-word rarities', () => {
    mount()
    expect(screen.getByTestId('rarity-filter-nova-rare').textContent).toBe('Nova Rare')
  })
  it('lists every set with its owned/total and selects one', () => {
    const onChange = mount()
    const row = screen.getByTestId('set-filter-arasakademodeck')
    expect(row.textContent).toContain('3 / 14')
    fireEvent.click(row)
    expect(onChange.mock.calls[0][0].setCode).toBe('arasakademodeck')
    expect(screen.getAllByTestId(/^set-filter-/).length).toBe(new Set(printings.map(p => p.setCode)).size + 1)
  })
  it('the goal control is single-select', () => {
    const onChange = mount()
    fireEvent.click(screen.getByTestId('goal-filter-complete'))
    expect(onChange.mock.calls[0][0].goal).toBe('complete')
  })
  it('search edits go through onChange', () => {
    const onChange = mount()
    fireEvent.change(screen.getByTestId('collection-search'), { target: { value: 'mantis' } })
    expect(onChange.mock.calls[0][0].search).toBe('mantis')
  })
  it('counts active filters and offers clear links only when something is set', () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0)
    const f = { ...EMPTY_FILTERS, colors: new Set(['Red', 'Blue']), setCode: 'x' }
    expect(activeFilterCount(f)).toBe(3)
    mount(f)
    expect(screen.getByTestId('clear-colors')).toBeTruthy()
    expect(screen.queryByTestId('clear-types')).toBeNull()
  })
  it('collapsed mode wraps the groups in a summary that names the active count', () => {
    mount({ ...EMPTY_FILTERS, goal: 'missing-arts' }, true)
    expect(screen.getByTestId('filter-rail').querySelector('summary')!.textContent).toContain('1 active')
  })
})
