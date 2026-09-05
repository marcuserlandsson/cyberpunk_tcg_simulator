// The dev-server endpoint backing data/collection.json.
//
// The transport-free core (`handleCollectionRequest`) is separated from the
// Vite plumbing so the whole contract -- status codes, reason discriminators,
// conflict payloads -- is unit tested by calling a function, with no server
// to start and no ports to bind.
//
// PUT handling is serialized through a module-level promise chain. Without
// it, two overlapping PUTs can both read the same on-disk revision before
// either writes back, so the revision check alone does not prevent a lost
// update -- it only prevents a *stale* write, not a *concurrent* one that
// reads the same current state. Chaining every PUT behind the previous one's
// completion closes that gap: by the time a PUT actually reads the file, any
// earlier PUT has already finished writing (or failed cleanly), so the second
// of two racing requests always sees the first one's result and is correctly
// treated as stale if it is.

import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  readCollectionFile,
  resolveCollectionPath,
  writeCollectionFile,
} from './collectionFile.ts'
import { scheduleCommit, type GitResult } from './collectionGit.ts'

export const COLLECTION_ROUTE = '/__collection'

let lastGitResult: GitResult = { status: 'skipped', detail: 'no save yet' }

async function handlePut(
  filePath: string,
  body: unknown
): Promise<{ status: number; body: unknown }> {
  const input = body as { baseRevision?: unknown; counts?: unknown; confirmEmpty?: unknown }
  if (
    input === null ||
    typeof input !== 'object' ||
    typeof input.baseRevision !== 'number' ||
    typeof input.counts !== 'object' ||
    input.counts === null
  ) {
    return {
      status: 400,
      body: { reason: 'invalid', message: 'Expected { baseRevision: number, counts: object }.' },
    }
  }

  const result = await writeCollectionFile(filePath, {
    baseRevision: input.baseRevision,
    counts: input.counts,
    confirmEmpty: input.confirmEmpty === true,
  })

  if (!result.ok) {
    return {
      status: result.status,
      body: { reason: result.reason, message: result.message, current: result.current },
    }
  }

  const cards = Object.values(result.file.counts).reduce((sum, n) => sum + n, 0)
  const printings = Object.keys(result.file.counts).length
  scheduleCommit(filePath, `${cards} cards, ${printings} printings`, (r) => {
    lastGitResult = r
  })

  return {
    status: 200,
    body: { revision: result.file.revision, savedAt: result.file.savedAt, git: lastGitResult },
  }
}

// Serializes PUTs across overlapping requests. Chaining onto the queue with
// both a success and a failure handler means a rejected predecessor still
// lets the queue proceed -- and handlePut genuinely CAN reject:
// writeCollectionFile propagates a non-ENOENT backup failure by design (an
// EPERM/EBUSY on collection.backup.json from a sync client or antivirus, say)
// rather than overwriting the collection without having backed it up. Without
// both handlers here, one such failure would wedge every subsequent PUT of
// the session behind a permanently-rejected promise.
let queue: Promise<unknown> = Promise.resolve()

function enqueuePut(filePath: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const result = queue.then(
    () => handlePut(filePath, body),
    () => handlePut(filePath, body)
  )
  // Swallow only for the queue's own bookkeeping -- the real result, and any
  // rejection from handlePut, is still returned to the caller below (where
  // handleCollectionRequest's try/catch turns it into a 500).
  queue = result.catch(() => undefined)
  return result
}

export async function handleCollectionRequest(
  filePath: string,
  method: string,
  body: unknown
): Promise<{ status: number; body: unknown }> {
  try {
    if (method === 'GET') {
      return { status: 200, body: await readCollectionFile(filePath) }
    }

    if (method === 'PUT') {
      return await enqueuePut(filePath, body)
    }

    return { status: 405, body: { reason: 'invalid', message: `${method} is not supported.` } }
  } catch (err) {
    // A corrupt or unreadable file lands here, and so does a propagated
    // backup failure from writeCollectionFile. Reporting it is the whole
    // point: the alternative is treating it as empty and overwriting it.
    return { status: 500, body: { reason: 'invalid', message: String(err) } }
  }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  if (chunks.length === 0) return undefined
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return undefined
  }
}

export function collectionPlugin(): Plugin {
  return {
    name: 'ctcg-collection',
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const url = (req.url ?? '').split('?')[0]
        if (url !== COLLECTION_ROUTE) return next()
        // Connect does not catch async middleware rejections, so anything
        // that throws in here becomes an unhandled rejection -- fatal by
        // default in modern Node, i.e. the dev server dies mid-entry-session.
        // `readBody`'s `for await (const chunk of req)` rejects whenever a
        // request aborts (tab closed mid-PUT, a navigation), which is an
        // entirely ordinary event. No data is lost when it happens (the
        // browser-side buffer still holds the work), but the server must
        // survive it.
        try {
          const filePath = resolveCollectionPath()
          const body = req.method === 'PUT' ? await readBody(req) : undefined
          const result = await handleCollectionRequest(filePath, req.method ?? 'GET', body)
          res.statusCode = result.status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(result.body))
        } catch (err) {
          console.error('[collection] request handling failed:', err)
          if (res.headersSent) {
            res.end()
            return
          }
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ reason: 'invalid', message: String(err) }))
        }
      })
    },
  }
}
