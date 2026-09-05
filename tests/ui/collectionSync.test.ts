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

  it('migrates the legacy key when the file is absent (revision 0) and empty', async () => {
    localStorage.setItem('ctcg:collection:v1', JSON.stringify({ counts: { 'legacy/1': 2 } }))
    _resetCollectionCacheForTests()
    stubFetch((_url, init) =>
      (init?.method ?? 'GET') === 'GET'
        ? { status: 200, body: { version: 1, revision: 0, savedAt: 'x', counts: {} } }
        : { status: 200, body: { revision: 1, savedAt: 'now', git: { status: 'ok' } } }
    )
    await initCollectionSync()
    // Ruling 2 regression: migration must write through replaceCollection
    // (which invalidates the snapshot cache and notifies subscribers), not a
    // raw localStorage.setItem(PENDING_KEY, ...). A raw write leaves the
    // in-memory cache holding the EMPTY file state that setCollectionFromFile
    // adopted just before the migration check ran, so getCollection() would
    // still read back {} right here — a live-until-the-next-unrelated-
    // cache-miss "collection looks empty after migrating" bug. This
    // assertion must run BEFORE flushNow(): a successful flush repaints the
    // cache regardless of which write path migration used, so a post-flush
    // assertion can't tell the two apart (see fix-report round 2).
    expect(getCollection().counts).toEqual({ 'legacy/1': 2 })
    // Documented resulting value, not a guard on ordering: baseRevision is
    // already file.revision (0) by the time migration runs, because
    // setCollectionFromFile set it moments earlier.
    expect(readPendingBuffer()?.baseRevision).toBe(0)
    await flushNow()
    expect(getCollection().counts).toEqual({ 'legacy/1': 2 })
  })

  // M1. The spec's condition is "the file is absent OR has revision 0 AND has
  // empty counts". Without the revision half, a collection the owner
  // deliberately emptied (file at some later revision, counts {}) is
  // re-seeded from the stale legacy key on EVERY load — cards they removed on
  // purpose keep coming back. Against the pre-fix condition this test fails:
  // getCollection() would read back { 'legacy/1': 2 }.
  it('does NOT re-seed a deliberately emptied collection sitting at a later revision', async () => {
    localStorage.setItem('ctcg:collection:v1', JSON.stringify({ counts: { 'legacy/1': 2 } }))
    _resetCollectionCacheForTests()
    let putCalls = 0
    stubFetch((_url, init) => {
      if ((init?.method ?? 'GET') === 'GET') {
        return { status: 200, body: { version: 1, revision: 50, savedAt: 'x', counts: {} } }
      }
      putCalls += 1
      return { status: 200, body: { revision: 51, savedAt: 'now', git: { status: 'ok' } } }
    })
    await initCollectionSync()
    expect(getCollection().counts).toEqual({})
    expect(readPendingBuffer()).toBeUndefined()
    expect(getSyncStatus().state).toBe('idle')
    expect(putCalls).toBe(0)
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

  // I4. A corrupt file makes the GET 500 with nothing to fall back on, so the
  // tab does not know what the player owns. Reporting `unsaved` let the store
  // fall through to empty and the header render "0 cards owned" + a buy-list
  // demanding every card in the game as fact. `error` is the state consumers
  // suppress derived figures in. Against the pre-fix code this fails on the
  // state assertion (it was 'unsaved').
  it('a non-ok GET with no buffer refuses the tab with `error`, carrying the server message', async () => {
    // The server responded — it just wasn't happy (e.g. a corrupt file on
    // disk) — so this must NOT be reported as "cannot reach the dev server".
    stubFetch(() => ({
      status: 500,
      body: { reason: 'invalid', message: 'data/collection.json is not valid JSON.' },
    }))
    await initCollectionSync()
    expect(getSyncStatus().state).toBe('error')
    expect(getSyncStatus().message).toBe('data/collection.json is not valid JSON.')
    expect(getSyncStatus().pendingCount).toBe(0)
  })

  it('a non-ok GET WITH a buffer stays `unsaved` — the buffer is real data, not a blank tab', async () => {
    localStorage.setItem(
      'ctcg:collection:pending:v1',
      JSON.stringify({ counts: { 'b/2': 7 }, baseRevision: 0 })
    )
    _resetCollectionCacheForTests()
    stubFetch(() => ({ status: 500, body: { reason: 'invalid', message: 'corrupt' } }))
    await initCollectionSync()
    expect(getSyncStatus().state).toBe('unsaved')
    expect(getCollection().counts).toEqual({ 'b/2': 7 })
    expect(getSyncStatus().retrying).toBe(true)
  })

  // M3. The client used to cast `await response.json()` straight to a file
  // shape, so a 200 lacking `counts` threw at `Object.keys(file.counts)` —
  // inside init, before the listener was registered (I1), leaving the session
  // with no auto-save at all while the header still read "Saved to disk".
  // Against the pre-fix code the first assertion fails: initCollectionSync()
  // rejects.
  it('a malformed 200 body does not throw, and auto-save is still live afterwards', async () => {
    let putCalls = 0
    stubFetch((_url, init) => {
      if ((init?.method ?? 'GET') === 'GET') return { status: 200, body: { hello: 'world' } }
      putCalls += 1
      return { status: 200, body: { revision: 1, savedAt: 'now', git: { status: 'ok' } } }
    })
    await expect(initCollectionSync()).resolves.toBeUndefined()
    expect(getSyncStatus().state).toBe('error')

    // The listener must exist despite the malformed response: a later edit
    // has to be noticed and flushed, not silently stranded.
    setCount('c/3', 1)
    expect(getSyncStatus().state).toBe('unsaved')
    await flushNow()
    expect(putCalls).toBe(1)
    expect(readPendingBuffer()).toBeUndefined()
  })

  // I1. The buffer used to be sampled BEFORE the GET await, so a card entered
  // during that window was invisible to init, which then took the no-buffer
  // branch and called setCollectionFromFile — clearing the pending buffer
  // that held the only copy of it. Against the pre-fix code this fails:
  // getCollection() reads back {}.
  it('a card entered while the startup GET is in flight is not wiped by the load', async () => {
    let releaseGet: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      releaseGet = resolve
    })
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') {
        await gate
        return {
          ok: true,
          status: 200,
          json: async () => ({ version: 1, revision: 0, savedAt: 'x', counts: {} }),
        } as Response
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ revision: 1, savedAt: 'now', git: { status: 'ok' } }),
      } as Response
    }))

    const init = initCollectionSync()
    setCount('typed/while-loading', 4) // the player is entering cards already
    releaseGet!()
    await init

    expect(getCollection().counts).toEqual({ 'typed/while-loading': 4 })
    expect(readPendingBuffer()?.counts).toEqual({ 'typed/while-loading': 4 })
    expect(getSyncStatus().state).toBe('unsaved')
  })
})

// C1. `PendingBuffer.baseRevision` records the state a buffer was derived
// from. It used to be written and never read: init stamped the buffer with
// whatever the file's revision happened to be, so the next PUT matched by
// construction and overwrote a file the buffer was never a descendant of.
describe('initCollectionSync divergence check', () => {
  it('the ordinary single-tab flow produces NO conflict across a reload', async () => {
    stubFetch((_url, init) =>
      (init?.method ?? 'GET') === 'GET'
        ? { status: 200, body: okFile } // revision 3
        : { status: 200, body: { revision: 4, savedAt: 'now', git: { status: 'ok' } } }
    )
    await initCollectionSync()
    setCount('c/3', 2) // stamped with baseRevision 3, the live file revision

    // Reload: module state is dropped, localStorage survives.
    _resetSyncForTests()
    _resetCollectionCacheForTests()
    await initCollectionSync()

    expect(getSyncStatus().state).toBe('unsaved')
    expect(getSyncStatus().state).not.toBe('conflict')
    await flushNow()
    expect(getSyncStatus().state).toBe('idle')
    expect(getCollection().counts).toEqual({ 'a/1': 1, 'c/3': 2 })
  })

  // The trigger from the review: tab A saves (file -> 5), stale tab B 409s,
  // the player reloads tab B. Init used to rebase B's buffer onto revision 5
  // and flush it, erasing tab A's save with the status reading "Saved to
  // disk". Against the pre-fix code this fails on every assertion: the state
  // was 'unsaved' and a PUT went out.
  it('a buffer based on an older revision than the file enters conflict, and sends nothing', async () => {
    localStorage.setItem(
      'ctcg:collection:pending:v1',
      JSON.stringify({ counts: { 'stale/1': 1 }, baseRevision: 3 })
    )
    _resetCollectionCacheForTests()
    let putCalls = 0
    stubFetch((_url, init) => {
      if ((init?.method ?? 'GET') === 'GET') {
        return { status: 200, body: { version: 1, revision: 5, savedAt: 'x', counts: { 'other-tab/9': 40 } } }
      }
      putCalls += 1
      return { status: 200, body: { revision: 6, savedAt: 'now', git: { status: 'ok' } } }
    })
    await initCollectionSync()

    expect(getSyncStatus().state).toBe('conflict')
    expect(getSyncStatus().conflictDisk).toEqual({ counts: { 'other-tab/9': 40 }, revision: 5 })
    // Nothing overwritten automatically: not now, and not by the retry loop.
    expect(putCalls).toBe(0)
    await flushNow()
    expect(putCalls).toBe(0)
    // The player's own work is still durable while they choose.
    expect(readPendingBuffer()?.counts).toEqual({ 'stale/1': 1 })
  })

  // The same shape as the "GET failed once, then the server came back" case:
  // a buffer built against nothing (baseRevision 0) versus a populated file.
  it('a buffer based on revision 0 does not silently replace a populated file', async () => {
    localStorage.setItem(
      'ctcg:collection:pending:v1',
      JSON.stringify({ counts: { 'entered-offline/1': 300 }, baseRevision: 0 })
    )
    _resetCollectionCacheForTests()
    stubFetch(() => ({
      status: 200,
      body: { version: 1, revision: 12, savedAt: 'x', counts: { 'real/1': 5000 } },
    }))
    await initCollectionSync()
    expect(getSyncStatus().state).toBe('conflict')
  })

  it('diverged bases but identical counts simply adopt the file, with no chooser shown', async () => {
    localStorage.setItem(
      'ctcg:collection:pending:v1',
      JSON.stringify({ counts: { 'a/1': 1 }, baseRevision: 3 })
    )
    _resetCollectionCacheForTests()
    stubFetch(() => ({
      status: 200,
      body: { version: 1, revision: 9, savedAt: 'x', counts: { 'a/1': 1 } },
    }))
    await initCollectionSync()
    expect(getSyncStatus().state).toBe('idle')
    expect(readPendingBuffer()).toBeUndefined()
    expect(getCollection().counts).toEqual({ 'a/1': 1 })
  })

  it('"keep mine" re-stamps the durable buffer, so a failed flush does not re-raise the conflict', async () => {
    localStorage.setItem(
      'ctcg:collection:pending:v1',
      JSON.stringify({ counts: { 'mine/1': 2 }, baseRevision: 3 })
    )
    _resetCollectionCacheForTests()
    let putWorks = false
    stubFetch((_url, init) => {
      if ((init?.method ?? 'GET') === 'GET') {
        return { status: 200, body: { version: 1, revision: 5, savedAt: 'x', counts: { 'theirs/1': 1 } } }
      }
      if (!putWorks) throw new Error('ECONNREFUSED')
      return { status: 200, body: { revision: 6, savedAt: 'now', git: { status: 'ok' } } }
    })
    await initCollectionSync()
    expect(getSyncStatus().state).toBe('conflict')

    await resolveConflict('mine') // the flush fails: the server is down
    expect(getSyncStatus().state).toBe('unsaved')
    expect(readPendingBuffer()?.baseRevision).toBe(5)

    // Reload before the retry lands. The decision must stick.
    _resetSyncForTests()
    _resetCollectionCacheForTests()
    putWorks = true
    await initCollectionSync()
    expect(getSyncStatus().state).not.toBe('conflict')
    await flushNow()
    expect(getCollection().counts).toEqual({ 'mine/1': 2 })
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

  // I3. The banner said "— retrying…" for every `unsaved` state, but the
  // terminal branch armed nothing. These two pin the flag the banner now
  // reads, and the 5xx retry: on this owner's machine a transient EPERM on
  // collection.backup.json (OneDrive, antivirus) makes every save 500, and
  // without a retry saving is stalled until someone happens to click Retry.
  it('a 500 keeps the buffer AND arms a backoff retry', async () => {
    vi.useFakeTimers()
    try {
      let putCalls = 0
      stubFetch((_url, init) => {
        if ((init?.method ?? 'GET') === 'GET') return { status: 200, body: okFile }
        putCalls += 1
        return { status: 500, body: { reason: 'invalid', message: 'EPERM: backup failed' } }
      })
      await initCollectionSync()
      setCount('c/3', 1)
      await flushNow()

      expect(putCalls).toBe(1)
      expect(getSyncStatus().state).toBe('unsaved')
      expect(getSyncStatus().retrying).toBe(true)
      expect(readPendingBuffer()?.counts).toEqual({ 'a/1': 1, 'c/3': 1 })

      // The retry is real, not just a claim on the status object.
      await vi.advanceTimersByTimeAsync(1200)
      expect(putCalls).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a 400 keeps the buffer but does NOT claim to be retrying', async () => {
    stubFetch((_url, init) =>
      (init?.method ?? 'GET') === 'GET'
        ? { status: 200, body: okFile }
        : { status: 400, body: { reason: 'invalid', message: 'Refusing to save invalid counts' } }
    )
    await initCollectionSync()
    setCount('c/3', 1)
    await flushNow()
    expect(getSyncStatus().state).toBe('unsaved')
    expect(getSyncStatus().retrying).toBe(false)
    expect(readPendingBuffer()).toBeDefined()
  })

  // M2. Both listeners are spec-mandated and are the mechanism that saves
  // work when a tab is hidden or closed; neither had any coverage, so a
  // regression that dropped the registration (or listened on the wrong
  // target) would have gone unnoticed.
  it('flushes when the tab is hidden (visibilitychange)', async () => {
    let putCalls = 0
    stubFetch((_url, init) => {
      if ((init?.method ?? 'GET') === 'GET') return { status: 200, body: okFile }
      putCalls += 1
      return { status: 200, body: { revision: 4, savedAt: 'now', git: { status: 'ok' } } }
    })
    await initCollectionSync()
    setCount('c/3', 1)
    expect(putCalls).toBe(0) // still inside the 1s debounce

    const original = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState')
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    try {
      window.dispatchEvent(new Event('visibilitychange'))
      await vi.waitFor(() => {
        expect(putCalls).toBe(1)
        expect(readPendingBuffer()).toBeUndefined()
      })
    } finally {
      delete (document as unknown as Record<string, unknown>).visibilityState
      if (original !== undefined) Object.defineProperty(Document.prototype, 'visibilityState', original)
    }
  })

  it('does NOT flush on visibilitychange while the tab is still visible', async () => {
    let putCalls = 0
    stubFetch((_url, init) => {
      if ((init?.method ?? 'GET') === 'GET') return { status: 200, body: okFile }
      putCalls += 1
      return { status: 200, body: { revision: 4, savedAt: 'now', git: { status: 'ok' } } }
    })
    await initCollectionSync()
    setCount('c/3', 1)
    window.dispatchEvent(new Event('visibilitychange')) // jsdom default: 'visible'
    await Promise.resolve()
    expect(putCalls).toBe(0)
  })

  it('flushes when the tab is closing (beforeunload)', async () => {
    let putCalls = 0
    stubFetch((_url, init) => {
      if ((init?.method ?? 'GET') === 'GET') return { status: 200, body: okFile }
      putCalls += 1
      return { status: 200, body: { revision: 4, savedAt: 'now', git: { status: 'ok' } } }
    })
    await initCollectionSync()
    setCount('c/3', 1)
    window.dispatchEvent(new Event('beforeunload'))
    await vi.waitFor(() => {
      expect(putCalls).toBe(1)
      expect(readPendingBuffer()).toBeUndefined()
    })
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
