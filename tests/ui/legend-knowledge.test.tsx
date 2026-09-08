// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { db, startedGame, mintInto, resolveEffectChoices } from '../cards/fixtures'
import { applyAction } from '../../src/engine/reduce'
import { BoardCard } from '../../src/ui/Field'
import { ZoomPanel } from '../../src/ui/ZoomPanel'
import { NO_AFFORDANCES } from '../../src/ui/playAffordances'

afterEach(cleanup)

describe('private Legend knowledge', () => {
  it('chooses a position without revealing names, peeks privately, and leaves only a marker', () => {
    const state = startedGame(0)
    const host = mintInto(state, 0, 'field', 'animals-wrecker')
    const gear = mintInto(state, 0, 'hand', 'kiroshi-optics')
    state.players[0].hand = state.players[0].hand.filter(uid => uid !== gear)
    state.cards[host].attachedGear.push(gear)
    state.players[1].gigArea = [{ size: 6, value: 3 }]
    const legend = state.players[0].legends[1]
    let next = applyAction(db, state, { type: 'attack', attacker: host, target: 'gigArea' })
    expect(next.pendingIntercept?.optionLabels?.[legend]).toBe('Face-down Legend 2')
    expect(next.pendingIntercept?.knownCards?.some(card => card.uid === legend)).toBe(false)
    next = applyAction(db, next, { type: 'answerIntercept', answer: legend })
    expect(next.pendingIntercept?.player).toBe(0)
    expect(next.pendingIntercept?.prompt).toContain(db[state.cards[legend].defId].name)
    expect(next.pendingIntercept?.knownCards).toContainEqual({ uid: legend, viewer: 0 })
    next = resolveEffectChoices(db, applyAction(db, next, { type: 'answerIntercept', answer: 0 }))
    expect(next.cards[legend]).toMatchObject({ faceUp: false, knownTo: [0] })
    expect(state.cards[legend].knownTo).toBeUndefined()
    const noop = () => {}
    const { container } = render(<>
      <BoardCard db={db} state={next} uid={legend} zone="legends" useOfficialImages={false}
        affordances={NO_AFFORDANCES} handlers={{ onCard: noop, onSell: noop, onAbility: noop, onFixerDie: noop, onGigDie: noop, onGigArea: noop }} />
      <ZoomPanel db={db} state={next} uid={legend} useOfficialImages={false} />
    </>)
    expect(screen.getByTestId('known-legend-marker').textContent).toBe('Previously seen by you')
    expect(container.textContent).not.toContain(db[state.cards[legend].defId].name)
    expect(container.querySelector('[data-def-id]')).toBeNull()
  })

  it('T-Bug still peeks after the turn Call allowance has already been used', () => {
    const state = startedGame(0)
    const tbug = mintInto(state, 0, 'field', 't-bug-amateur-philosopher')
    const rival = mintInto(state, 1, 'field', 'animals-wrecker', { ready: false })
    state.players[0].calledLegendThisTurn = true
    let next = applyAction(db, state, { type: 'attack', attacker: tbug, target: rival })
    next = applyAction(db, next, { type: 'react', reaction: { type: 'pass' } })
    expect(next.pendingIntercept?.prompt).toContain('Private peek:')
    next = resolveEffectChoices(db, next)
    expect(next.players[0].legends.every(uid => next.cards[uid].knownTo?.includes(0))).toBe(true)
    expect(next.players[0].legends.every(uid => !next.cards[uid].faceUp)).toBe(true)
  })
})
