// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { LogPanel } from '../../src/ui/LogPanel'

afterEach(cleanup)

describe('LogPanel highlight', () => {
  it('highlights the lines of the current beat', () => {
    render(<LogPanel lines={[{ text: 'a', turn: 1 }, { text: 'b', turn: 1 }, { text: 'c', turn: 1 }]} highlight={{ from: 1, to: 2 }} />)
    const lines = screen.getAllByTestId('log-line')
    expect(lines.map((line) => line.classList.contains('log-panel__line--current'))).toEqual([false, true, true])
  })
})
