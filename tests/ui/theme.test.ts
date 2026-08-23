import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('design tokens', () => {
  const css = readFileSync('src/ui/styles/tokens.css', 'utf8')
  it.each([
    ['--void', '#07070d'],
    ['--panel', '#10101a'],
    ['--you', '#00e5ff'],
    ['--rival', '#ff3d5a'],
    ['--act', '#fcee0a'],
    ['--ram-red', '#ff4655'],
    ['--ram-yellow', '#fcee0a'],
    ['--ram-green', '#2dff87'],
    ['--ram-blue', '#38a8ff'],
  ])('defines %s: %s', (name, value) => {
    expect(css.toLowerCase()).toContain(`${name}: ${value}`)
  })
  it('imports no external font hosts anywhere in styles', () => {
    expect(css).not.toMatch(/https?:\/\//)
  })
})
