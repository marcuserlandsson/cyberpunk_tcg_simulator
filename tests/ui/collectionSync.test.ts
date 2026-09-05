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
  confirmEmptySave,
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
    // revision 5 (not 0, the module's own default) so a reversal of ruling 2's
    // ordering — replaceCollection before setBaseRevision — is distinguishable:
    // it would stamp the buffer with the stale default (0) instead of 5.
    stubFetch((_url, init) =>
      (init?.method ?? 'GET') === 'GET'
        ? { status: 200, body: { version: 1, revision: 5, savedAt: 'x', counts: {} } }
        : { status: 200, body: { revision: 6, savedAt: 'now', git: { status: 'ok' } } }
    )
    await initCollectionSync()
    // Ruling 2 regression: setBaseRevision(file.revision) must run BEFORE
    // replaceCollection, so the migrated buffer records the file's actual
    // revision as its base.
    expect(readPendingBuffer()?.baseRevision).toBe(5)
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

  it('a non-ok GET surfaces the server message rather than the unreachable text', async () => {
    // The server responded — it just wasn't happy (e.g. a corrupt file on
    // disk) — so this must NOT be reported as "cannot reach the dev server".
    stubFetch(() => ({
      status: 500,
      body: { reason: 'invalid', message: 'data/collection.json is not valid JSON.' },
    }))
    await initCollectionSync()
    expect(getSyncStatus().state).toBe('unsaved')
    expect(getSyncStatus().message).toBe('data/collection.json is not valid JSON.')
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
    // Ruling 1 regression: the old clearPendingBuffer() + setBaseRevision()
    // implementation never touched the snapshot cache, so this would read
    // back {} (the cache was invalidated by setCount and nothing repainted
    // it) even though the buffer and status both look fine.
    expect(getCollection().counts).toEqual({ 'a/1': 1, 'c/3': 2 })
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
    // Important 6: the disk version must be exposed on status, or a chooser
    // UI has nothing to show for what "keep mine" would overwrite.
    expect(getSyncStatus().conflictDisk).toEqual({ ...okFile, revision: 8, counts: { 'z/9': 4 } })
  })

  it('a 409 without a well-shaped `current` stays retryable rather than wedging', async () => {
    stubFetch((_url, init) =>
      (init?.method ?? 'GET') === 'GET'
        ? { status: 200, body: okFile }
        : { status: 409, body: { reason: 'conflict', message: 'moved' } } // no `current`
    )
    await initCollectionSync()
    setCount('c/3', 1)
    await flushNow()
    expect(getSyncStatus().state).not.toBe('conflict')
    expect(getSyncStatus().state).toBe('unsaved')
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

  it('an edit made during an in-flight PUT is preserved and re-flushed, not reverted', async () => {
    let resolvePut: ((result: { status: number; body: unknown }) => void) | undefined
    const putGate = new Promise<{ status: number; body: unknown }>((resolve) => {
      resolvePut = resolve
    })
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET') {
        return { ok: true, status: 200, json: async () => okFile } as Response
      }
      const { status, body } = await putGate
      return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
    }))

    await initCollectionSync()
    setCount('c/3', 2)
    const flushPromise = flushNow()
    // The PUT above is now suspended on putGate — simulate the player typing
    // (or visibilitychange/beforeunload firing another flush) during the
    // await window the fix exists for.
    setCount('c/4', 5)
    resolvePut!({ status: 200, body: { revision: 4, savedAt: 'now', git: { status: 'ok' } } })
    await flushPromise

    // Not reverted: the screen must show the newer edit, not the snapshot
    // that was actually sent.
    expect(getCollection().counts).toEqual({ 'a/1': 1, 'c/3': 2, 'c/4': 5 })
    // Not dropped: the newer edit must still be durable in the buffer.
    expect(readPendingBuffer()?.counts).toEqual({ 'a/1': 1, 'c/3': 2, 'c/4': 5 })
    expect(getSyncStatus().state).toBe('unsaved')
  })

  it('two overlapping flushNow calls issue one PUT and do not end in conflict', async () => {
    let putCalls = 0
    stubFetch((_url, init) => {
      if ((init?.method ?? 'GET') === 'GET') return { status: 200, body: okFile }
      putCalls += 1
      return { status: 200, body: { revision: 4, savedAt: 'now', git: { status: 'ok' } } }
    })
    await initCollectionSync()
    setCount('c/3', 1)
    const first = flushNow()
    const second = flushNow()
    await Promise.all([first, second])
    expect(putCalls).toBe(1)
    expect(getSyncStatus().state).not.toBe('conflict')
    expect(getSyncStatus().state).toBe('idle')
  })

  it('a would-empty refusal is distinguishable and confirmEmptySave() proceeds', async () => {
    let sawConfirmEmpty = false
    stubFetch((_url, init) => {
      if ((init?.method ?? 'GET') === 'GET') return { status: 200, body: okFile }
      const sent = init?.body ? (JSON.parse(String(init.body)) as { confirmEmpty?: boolean }) : {}
      if (sent.confirmEmpty === true) {
        sawConfirmEmpty = true
        return { status: 200, body: { revision: 4, savedAt: 'now', git: { status: 'ok' } } }
      }
      return {
        status: 409,
        body: {
          reason: 'would-empty',
          message: 'Refusing to empty a non-empty collection without confirmation.',
          current: okFile,
        },
      }
    })
    await initCollectionSync()
    setCount('a/1', 0) // clears the only owned printing -> an empty collection
    await flushNow()
    expect(getSyncStatus().state).toBe('would-empty')
    expect(readPendingBuffer()).toBeDefined()

    await confirmEmptySave()
    expect(sawConfirmEmpty).toBe(true)
    expect(getSyncStatus().state).toBe('idle')
    expect(readPendingBuffer()).toBeUndefined()
  })
})
