// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { db, fixtureWithHand } from '../cards/fixtures'
import { applyAction } from '../../src/engine/reduce'
import { legalActions } from '../../src/engine/legal'
import { PlayView } from '../../src/ui/PlayView'
import { actionPayment, withPayment } from '../../src/ui/payments'

const mock = vi.hoisted(() => ({ api: {} as Record<string, unknown>, act: vi.fn() }))
vi.mock('../../src/ui/useGame', async importOriginal => ({ ...(await importOriginal<Record<string, unknown>>()), useGame: () => mock.api }))
afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear() })

describe('human payment selection', () => {
  it('renders the current public trash during an effect choice', () => {
    const { state } = fixtureWithHand(0, ['all-is-lost'])
    const program = state.players[0].hand[0]
    const units = state.players[0].deck.filter(uid => db[state.cards[uid].defId].type === 'unit').slice(0, 2)
    state.players[0].deck = [...units, ...state.players[0].deck.filter(uid => !units.includes(uid))]
    const action = legalActions(db, state).find(a => a.type === 'playCard' && a.card === program)!
    const pending = applyAction(db, state, action)
    mock.api = { state: pending, record: { actions: [action], config: { seed: 1 } }, legal: legalActions(db, pending),
      aiThinking: false, canUndo: false, loadError: null, eventsForLog: [], act: mock.act }
    render(<PlayView db={db} useOfficialImages={false} aiDelayMs={0} />)
    fireEvent.click(screen.getByTestId('cancel-setup'))
    expect(screen.getByTestId('resolving-programs').textContent).toContain(db['all-is-lost'].name)
    const details = screen.getByText('Inspect trash and removed cards').closest('details')!
    expect(details.textContent).toContain(db[state.cards[units[0]].defId].name)
    expect(details.textContent).toContain(db[state.cards[units[1]].defId].name)
  })
  it('allows replacing the proposed Eddie with a hidden Legend before committing a Call', () => {
    const { state } = fixtureWithHand(0, [])
    const legend = state.players[0].legends[0]
    state.cards[legend].ready = true
    mock.api = { state, record: { actions: [], config: { seed: 1 } }, legal: legalActions(db, state),
      aiThinking: false, canUndo: false, loadError: null, eventsForLog: [], act: mock.act }
    render(<PlayView db={db} useOfficialImages={false} aiDelayMs={0} />)
    fireEvent.click(screen.getByTestId('cancel-setup'))
    fireEvent.click(screen.getByTestId('call-legend'))
    expect(mock.act).not.toHaveBeenCalled()
    expect(screen.getByTestId('choice-bar').textContent).toContain('Choose payment: 1 / 1')
    const option = screen.getAllByTestId('target-option').find(button => button.textContent === 'Face-down Legend 1')!
    fireEvent.click(option)
    fireEvent.click(screen.getByRole('button', { name: 'Pay 1 €$ with selected cards' }))
    expect(mock.act).toHaveBeenCalledWith({ type: 'callLegend', payment: [legend] })
    expect(state.cards[legend].ready).toBe(true)
  })

  it('preserves the chosen targets and reaction shape when editing a Quick payment', () => {
    const action = { type: 'react' as const, reaction: { type: 'quick' as const, card: 4, payment: [1], targets: [8] } }
    const edited = withPayment(action, [2])
    expect(actionPayment(edited)).toEqual([2])
    expect(edited).toEqual({ ...action, reaction: { ...action.reaction, payment: [2] } })
    expect(action.reaction.payment).toEqual([1])
  })
})
