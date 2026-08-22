// Deterministic seeded RNG (mulberry32). Every function is pure: it takes a
// state and returns [value, newState] rather than mutating anything, so game
// simulation stays fully reproducible from a seed. No Math.random/Date.now.

import type { DieSize } from './types'

export type RngState = number

export function createRng(seed: number): RngState {
  return seed >>> 0
}

/** One mulberry32 step: advances the state and derives a float in [0, 1). */
function step(state: RngState): [number, RngState] {
  const a = (state + 0x6d2b79f5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296
  return [value, a >>> 0]
}

export function nextInt(rng: RngState, maxExclusive: number): [number, RngState] {
  const [f, newState] = step(rng)
  return [Math.floor(f * maxExclusive), newState]
}

export function rollDie(rng: RngState, size: DieSize): [number, RngState] {
  const [n, newState] = nextInt(rng, size)
  return [n + 1, newState]
}

export function shuffle<T>(rng: RngState, items: readonly T[]): [T[], RngState] {
  const arr = items.slice()
  let state = rng
  for (let i = arr.length - 1; i > 0; i--) {
    const [j, newState] = nextInt(state, i + 1)
    state = newState
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
  return [arr, state]
}
