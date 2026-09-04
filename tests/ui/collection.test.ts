// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  getCollection,
  getStorageError,
  setCount,
  adjustCount,
  subscribeCollection,
  useCollection,
  _resetCollectionCacheForTests,
} from '../../src/ui/collection'

beforeEach(() => {
  localStorage.clear()
  _resetCollectionCacheForTests()
})

describe('counts', () => {
  it('starts empty', () => {
    expect(getCollection().counts).toEqual({})
  })

  it('setCount stores and getCollection reads back', () => {
    setCount('welcometonightcitybeta/β025', 2)
    expect(getCollection().counts['welcometonightcitybeta/β025']).toBe(2)
  })

  it('setCount clamps negatives to 0 and prunes zero counts', () => {
    setCount('a/1', 2)
    setCount('a/1', -5)
    expect(getCollection().counts).toEqual({})
    expect(JSON.parse(localStorage.getItem('ctcg:collection:v1')!)).toEqual({ counts: {} })
  })

  it('adjustCount adds and subtracts with a floor of 0', () => {
    adjustCount('a/1', 1)
    adjustCount('a/1', 1)
    adjustCount('a/1', -5)
    expect(getCollection().counts['a/1']).toBeUndefined()
  })

  it('preserves unknown keys already in storage across writes', () => {
    localStorage.setItem('ctcg:collection:v1', JSON.stringify({ counts: { 'ghost/999': 4 } }))
    _resetCollectionCacheForTests()
    setCount('a/1', 1)
    expect(getCollection().counts['ghost/999']).toBe(4)
  })

  it('falls back to empty on a malformed blob', () => {
    localStorage.setItem('ctcg:collection:v1', '{not json')
    _resetCollectionCacheForTests()
    expect(getCollection().counts).toEqual({})
  })

  it('surfaces a storage error instead of throwing when the write fails', () => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    try {
      expect(() => setCount('a/1', 1)).not.toThrow()
      expect(getStorageError()).toContain('Could not save')
    } finally {
      Storage.prototype.setItem = original
    }
    setCount('a/1', 1) // a later successful write clears the error
    expect(getStorageError()).toBe('')
  })
})

describe('subscription', () => {
  it('notifies on write and stops after unsubscribe', () => {
    let calls = 0
    const unsubscribe = subscribeCollection(() => calls++)
    setCount('a/1', 1)
    expect(calls).toBe(1)
    unsubscribe()
    setCount('a/1', 2)
    expect(calls).toBe(1)
  })

  it('useCollection re-renders with fresh counts and keeps a stable snapshot otherwise', () => {
    const { result, rerender } = renderHook(() => useCollection())
    const first = result.current
    rerender()
    expect(result.current).toBe(first) // stable reference, no write between
    act(() => setCount('a/1', 3))
    expect(result.current.counts['a/1']).toBe(3)
  })
})
