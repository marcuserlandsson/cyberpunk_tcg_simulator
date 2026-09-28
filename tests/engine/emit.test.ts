// Every engine event goes through `emit`, the one place a recorder can see
// it. A stray `events.push` would silently drop a beat from the UI's
// timeline, so this test also guards the source tree against new ones.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { emit, setEventRecorder } from '../../src/engine/emit'
import { freshGame } from './gameHelpers'
import type { GameEvent, GameState } from '../../src/engine/types'

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? sourceFiles(full) : /\.ts$/.test(entry.name) ? [full] : []
  })
}

describe('emit', () => {
  it('appends the event to the draft', () => {
    const state = freshGame()
    const before = state.events.length
    emit(state, { type: 'turnEnded', player: 0 })
    expect(state.events).toHaveLength(before + 1)
    expect(state.events.at(-1)).toEqual({ type: 'turnEnded', player: 0 })
  })

  it('hands every event to the active recorder after appending it', () => {
    const state = freshGame()
    const seen: [number, GameEvent][] = []
    const previous = setEventRecorder((draft: GameState, event) => seen.push([draft.events.length, event]))
    try {
      emit(state, { type: 'turnEnded', player: 1 })
    } finally {
      setEventRecorder(previous)
    }
    expect(seen).toEqual([[state.events.length, { type: 'turnEnded', player: 1 }]])
  })

  it('is the only place under src/engine and src/cards that pushes events', () => {
    const root = path.resolve(__dirname, '..', '..')
    const offenders = [...sourceFiles(path.join(root, 'src/engine')), ...sourceFiles(path.join(root, 'src/cards'))]
      .filter((file) => !file.endsWith(`${path.sep}emit.ts`))
      .filter((file) => /\.events\.push\(/.test(fs.readFileSync(file, 'utf-8')))
    expect(offenders).toEqual([])
  })
})
