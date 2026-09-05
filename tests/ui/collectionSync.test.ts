// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetCollectionCacheForTests,
  getCollection,
  readPendingBuffer,
  setCount,
} from '../../src/ui/collection'
import {
  _resetSyncForTests,
  flushNow,
  getSyncStatus,
  initCollectionSync,
  resolveConflict,
} from '../../src/ui/collectionSync'

const okFile = { version: 1, revision: 3, savedAt: '2026-09-05T00:00:00.000Z', counts: { 'a/1': 1 } }

function stubFetch(handler: (url: string, init?: RequestInit) => { status: number; body: unknown }) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const { status, body } = handler(String(url), init)
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
  }))
}

beforeEach(() => {
  localStorage.clear()
  _resetCollectionCacheForTests()
  _resetSyncForTests()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('initCollectionSync', () => {
  it('adopts the file from the endpoint', async () => {
    stubFetch(() => ({ status: 200, body: okFile }))
    await initCollectionSync()
    expect(getCollection().counts).toEqual({ 'a/1': 1 })
    expect(getSyncStatus().state).toBe('idle')
  })

  it('a pending buffer wins over the file and is flushed immediately', async () => {
    localStorage.setItem(
      'ctcg:collection:pending:v1',
      JSON.stringify({ counts: { 'b/2': 9 }, baseRevision: 3 })
    )
    _resetCollectionCacheForTests()
    const calls: string[] = []
    stubFetch((url, init) => {
      calls.push(String(init?.method ?? 'GET'))
      if ((init?.method ?? 'GET') === 'GET') return { status: 200, body: okFile }
      return { status: 200, body: { revision: 4, savedAt: 'now', git: { status: 'ok' } } }
    })
    await initCollectionSync()
    await flushNow()
    expect(getCollection().counts).toEqual({ 'b/2': 9 })
    expect(calls).toContain('PUT')
    expect(readPendingBuffer()).toBeUndefined()
  })

  it('migrates the legacy key when the file is empty', async () => {
    localStorage.setItem('ctcg:collection:v1', JSON.stringify({ counts: { 'legacy/1': 2 } }))
    _resetCollectionCacheForTests()
    stubFetch((_url, init) =>
      (init?.method ?? 'GET') === 'GET'
        ? { status: 200, body: { version: 1, revision: 0, savedAt: 'x', counts: {} } }
        : { status: 200, body: { revision: 1, savedAt: 'now', git: { status: 'ok' } } }
    )
    await initCollectionSync()
    await flushNow()
    expect(getCollection().counts).toEqual({ 'legacy/1': 2 })
  })

  it('falls back to the buffer and reports unsaved when the endpoint is unreachable', async () => {
    localStorage.setItem(
      'ctcg:collection:pending:v1',
      JSON.stringify({ counts: { 'b/2': 5 }, baseRevision: 0 })
    )
    _resetCollectionCacheForTests()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    await initCollectionSync()
    expect(getCollection().counts).toEqual({ 'b/2': 5 })
    expect(getSyncStatus().state).toBe('unsaved')
  })
})

describe('flushing', () => {
  it('a successful flush clears the buffer and reports idle', async () => {
    stubFetch((_url, init) =>
      (init?.method ?? 'GET') === 'GET'
        ? { status: 200, body: okFile }
        : { status: 200, body: { revision: 4, savedAt: '2026-09-05T01:00:00.000Z', git: { status: 'ok' } } }
    )
    await initCollectionSync()
    setCount('c/3', 2)
    await flushNow()
    expect(readPendingBuffer()).toBeUndefined()
    expect(getSyncStatus().state).toBe('idle')
    expect(getSyncStatus().lastSavedAt).toBe('2026-09-05T01:00:00.000Z')
  })

  it('a failed flush RETAINS the buffer and counts the unsaved copies', async () => {
    let allow = true
    stubFetch((_url, init) => {
      if ((init?.method ?? 'GET') === 'GET') return { status: 200, body: okFile }
      if (allow) return { status: 200, body: { revision: 4, savedAt: 'now', git: { status: 'ok' } } }
      throw new Error('ECONNREFUSED')
    })
    await initCollectionSync()
    allow = false
    setCount('c/3', 300)
    await flushNow()
    expect(readPendingBuffer()?.counts).toEqual({ 'a/1': 1, 'c/3': 300 })
    expect(getSyncStatus().state).toBe('unsaved')
    expect(getSyncStatus().pendingCount).toBe(300)
  })

  it('a 409 conflict stops retrying and surfaces the disk version', async () => {
    stubFetch((_url, init) =>
      (init?.method ?? 'GET') === 'GET'
        ? { status: 200, body: okFile }
        : { status: 409, body: { reason: 'conflict', message: 'moved', current: { ...okFile, revision: 8, counts: { 'z/9': 4 } } } }
    )
    await initCollectionSync()
    setCount('c/3', 1)
    await flushNow()
    expect(getSyncStatus().state).toBe('conflict')
    expect(readPendingBuffer()).toBeDefined()
  })

  it('resolveConflict("disk") discards the buffer and takes the file', async () => {
    stubFetch((_url, init) =>
      (init?.method ?? 'GET') === 'GET'
        ? { status: 200, body: { ...okFile, revision: 8, counts: { 'z/9': 4 } } }
        : { status: 409, body: { reason: 'conflict', message: 'moved', current: { ...okFile, revision: 8, counts: { 'z/9': 4 } } } }
    )
    await initCollectionSync()
    setCount('c/3', 1)
    await flushNow()
    await resolveConflict('disk')
    expect(getCollection().counts).toEqual({ 'z/9': 4 })
    expect(readPendingBuffer()).toBeUndefined()
    expect(getSyncStatus().state).toBe('idle')
  })

  it('surfaces a failed git push without changing the save state', async () => {
    stubFetch((_url, init) =>
      (init?.method ?? 'GET') === 'GET'
        ? { status: 200, body: okFile }
        : { status: 200, body: { revision: 4, savedAt: 'now', git: { status: 'failed', detail: 'rejected' } } }
    )
    await initCollectionSync()
    setCount('c/3', 1)
    await flushNow()
    expect(getSyncStatus().state).toBe('idle')
    expect(getSyncStatus().git).toBe('failed')
  })

  it('getSyncStatus is reference-stable between changes', async () => {
    stubFetch(() => ({ status: 200, body: okFile }))
    await initCollectionSync()
    expect(getSyncStatus()).toBe(getSyncStatus())
  })
})
