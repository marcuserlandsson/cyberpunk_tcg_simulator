import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { COLLECTION_ROUTE, collectionPlugin, handleCollectionRequest } from '../../src/server/collectionPlugin'

let dir = ''
let file = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ctcg-plugin-'))
  file = join(dir, 'collection.json')
  process.env.CTCG_COLLECTION_FILE = file // also disables git automation
})

afterEach(async () => {
  delete process.env.CTCG_COLLECTION_FILE
  await rm(dir, { recursive: true, force: true })
})

describe('handleCollectionRequest', () => {
  it('GET returns an empty file before anything is saved', async () => {
    const result = await handleCollectionRequest(file, 'GET', undefined)
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ version: 1, revision: 0, counts: {} })
  })

  it('PUT saves and GET reads it back', async () => {
    const put = await handleCollectionRequest(file, 'PUT', { baseRevision: 0, counts: { 'a/1': 2 } })
    expect(put.status).toBe(200)
    expect(put.body).toMatchObject({ revision: 1 })
    const get = await handleCollectionRequest(file, 'GET', undefined)
    expect(get.body).toMatchObject({ counts: { 'a/1': 2 }, revision: 1 })
  })

  it('PUT with invalid counts returns 400 with reason "invalid"', async () => {
    const result = await handleCollectionRequest(file, 'PUT', { baseRevision: 0, counts: { 'a/1': -3 } })
    expect(result.status).toBe(400)
    expect(result.body).toMatchObject({ reason: 'invalid' })
  })

  it('PUT with a stale revision returns 409 "conflict" carrying the current file', async () => {
    await handleCollectionRequest(file, 'PUT', { baseRevision: 0, counts: { 'a/1': 1 } })
    const result = await handleCollectionRequest(file, 'PUT', { baseRevision: 0, counts: { 'a/1': 5 } })
    expect(result.status).toBe(409)
    expect(result.body).toMatchObject({ reason: 'conflict' })
    expect((result.body as { current: { counts: Record<string, number> } }).current.counts).toEqual({ 'a/1': 1 })
  })

  it('PUT that would empty a non-empty collection returns 409 "would-empty"', async () => {
    await handleCollectionRequest(file, 'PUT', { baseRevision: 0, counts: { 'a/1': 1 } })
    const result = await handleCollectionRequest(file, 'PUT', { baseRevision: 1, counts: {} })
    expect(result.status).toBe(409)
    expect(result.body).toMatchObject({ reason: 'would-empty' })
  })

  it('PUT with a malformed body returns 400 rather than throwing', async () => {
    const result = await handleCollectionRequest(file, 'PUT', { nonsense: true })
    expect(result.status).toBe(400)
    expect(result.body).toMatchObject({ reason: 'invalid' })
  })

  it('an unsupported method returns 405', async () => {
    const result = await handleCollectionRequest(file, 'DELETE', undefined)
    expect(result.status).toBe(405)
  })

  it('a corrupt file surfaces as 500 rather than being overwritten', async () => {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(file, 'not json', 'utf8')
    const result = await handleCollectionRequest(file, 'GET', undefined)
    expect(result.status).toBe(500)
    expect(await (await import('node:fs/promises')).readFile(file, 'utf8')).toBe('not json')
  })

  // Ruling 1: two overlapping PUTs must not interleave their read-then-write.
  // Both requests can observe the same baseRevision before either writes, so
  // the conflict check alone does not close the race -- PUT handling must be
  // serialized. Fire both without awaiting the first, then check that either
  // both land against ascending revisions, or the second is cleanly rejected
  // as a conflict once serialized behind the first -- never a torn write.
  it('serializes two concurrent PUTs so neither corrupts the file', async () => {
    await handleCollectionRequest(file, 'PUT', { baseRevision: 0, counts: { 'a/1': 1 } })

    const first = handleCollectionRequest(file, 'PUT', { baseRevision: 1, counts: { 'a/1': 2 } })
    const second = handleCollectionRequest(file, 'PUT', { baseRevision: 1, counts: { 'b/2': 3 } })

    const [firstResult, secondResult] = await Promise.all([first, second])

    // Both requests read baseRevision 1, so at most one can succeed; the
    // other must see a clean conflict rather than a torn/interleaved write.
    const results = [firstResult, secondResult]
    const oks = results.filter((r) => r.status === 200)
    const conflicts = results.filter((r) => r.status === 409)
    expect(oks).toHaveLength(1)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.body).toMatchObject({ reason: 'conflict' })

    const { readFile } = await import('node:fs/promises')
    const onDisk = JSON.parse(await readFile(file, 'utf8'))
    // The file holds exactly one of the two payloads, never a mix.
    const isFirstPayload = JSON.stringify(onDisk.counts) === JSON.stringify({ 'a/1': 2 })
    const isSecondPayload = JSON.stringify(onDisk.counts) === JSON.stringify({ 'b/2': 3 })
    expect(isFirstPayload || isSecondPayload).toBe(true)
    expect(onDisk.revision).toBe(2)
  })
})

// I5. Connect does not catch async middleware rejections, so anything the
// handler throws becomes an unhandled rejection -- fatal by default in modern
// Node, i.e. the dev server dies. `readBody`'s `for await (const chunk of
// req)` rejects on an ordinary aborted request (tab closed mid-PUT), so this
// is not a hypothetical path.
describe('the Vite middleware', () => {
  type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => unknown

  function mountMiddleware(): Middleware {
    const plugin = collectionPlugin()
    const registered: Middleware[] = []
    const fakeServer = { middlewares: { use: (handler: Middleware) => registered.push(handler) } }
    const configure = plugin.configureServer as unknown as (server: unknown) => void
    configure(fakeServer)
    expect(registered).toHaveLength(1)
    return registered[0]
  }

  function fakeResponse() {
    const res = {
      statusCode: 0,
      headersSent: false,
      headers: {} as Record<string, string>,
      body: '',
      setHeader(name: string, value: string) {
        this.headers[name] = value
      },
      end(chunk?: string) {
        if (chunk !== undefined) this.body = chunk
        this.headersSent = true
      },
    }
    return res
  }

  it('answers 500 instead of rejecting when reading the request body fails', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const middleware = mountMiddleware()
      // An aborted request: iterating the stream rejects.
      const req = {
        url: COLLECTION_ROUTE,
        method: 'PUT',
        async *[Symbol.asyncIterator]() {
          throw new Error('aborted')
          // eslint-disable-next-line no-unreachable
          yield Buffer.from('')
        },
      } as unknown as IncomingMessage
      const res = fakeResponse()

      // The assertion that matters: this settles rather than rejecting. An
      // unhandled rejection here takes the dev server down.
      await expect(
        middleware(req, res as unknown as ServerResponse, () => {
          throw new Error('next() must not be called for the collection route')
        })
      ).resolves.not.toThrow()

      expect(res.statusCode).toBe(500)
      expect(JSON.parse(res.body)).toMatchObject({ reason: 'invalid' })
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('passes unrelated URLs straight through to next()', async () => {
    const middleware = mountMiddleware()
    let nexted = false
    await middleware(
      { url: '/index.html', method: 'GET' } as IncomingMessage,
      fakeResponse() as unknown as ServerResponse,
      () => {
        nexted = true
      }
    )
    expect(nexted).toBe(true)
  })
})
