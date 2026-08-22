import { describe, it, expect } from 'vitest'
import { createRng, nextInt, rollDie, shuffle } from '../../src/engine/rng'

describe('rng', () => {
  it('is deterministic: same seed produces the same sequence', () => {
    const seq = (seed: number) => {
      let rng = createRng(seed)
      const out: number[] = []
      for (let i = 0; i < 20; i++) {
        const [v, next] = nextInt(rng, 1000)
        out.push(v)
        rng = next
      }
      return out
    }
    expect(seq(12345)).toEqual(seq(12345))
  })

  it('different seeds produce different sequences', () => {
    let rngA = createRng(1)
    let rngB = createRng(2)
    const outA: number[] = []
    const outB: number[] = []
    for (let i = 0; i < 10; i++) {
      const [va, na] = nextInt(rngA, 1000)
      const [vb, nb] = nextInt(rngB, 1000)
      outA.push(va)
      outB.push(vb)
      rngA = na
      rngB = nb
    }
    expect(outA).not.toEqual(outB)
  })

  it('nextInt returns a value in [0, maxExclusive)', () => {
    let rng = createRng(42)
    for (let i = 0; i < 1000; i++) {
      const [v, next] = nextInt(rng, 7)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(7)
      expect(Number.isInteger(v)).toBe(true)
      rng = next
    }
  })

  it('rollDie returns a value within 1..size', () => {
    let rng = createRng(7)
    const sizes: Array<4 | 6 | 8 | 10 | 12 | 20> = [4, 6, 8, 10, 12, 20]
    for (const size of sizes) {
      for (let i = 0; i < 200; i++) {
        const [v, next] = rollDie(rng, size)
        expect(v).toBeGreaterThanOrEqual(1)
        expect(v).toBeLessThanOrEqual(size)
        expect(Number.isInteger(v)).toBe(true)
        rng = next
      }
    }
  })

  it('rollDie is deterministic for a given state', () => {
    const rng = createRng(999)
    const [v1] = rollDie(rng, 20)
    const [v2] = rollDie(rng, 20)
    expect(v1).toBe(v2)
  })

  it('shuffle produces a permutation of the input', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    let rng = createRng(55)
    const [shuffled, next] = shuffle(rng, items)
    rng = next
    expect(shuffled.length).toBe(items.length)
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items)
  })

  it('shuffle is deterministic for a given seed', () => {
    const items = ['a', 'b', 'c', 'd', 'e']
    const [s1] = shuffle(createRng(321), items)
    const [s2] = shuffle(createRng(321), items)
    expect(s1).toEqual(s2)
  })

  it('shuffle does not mutate the input array', () => {
    const items = [1, 2, 3, 4, 5]
    const copy = [...items]
    shuffle(createRng(1), items)
    expect(items).toEqual(copy)
  })

  it('rollDie distribution is roughly uniform over 10k rolls of a d6', () => {
    let rng = createRng(2024)
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }
    for (let i = 0; i < 10000; i++) {
      const [v, next] = rollDie(rng, 6)
      counts[v] += 1
      rng = next
    }
    for (const face of [1, 2, 3, 4, 5, 6]) {
      expect(counts[face]).toBeGreaterThan(1300)
      expect(counts[face]).toBeLessThan(2000)
    }
  })
})
