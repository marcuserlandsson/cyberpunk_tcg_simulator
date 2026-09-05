// The collection's on-the-wire and on-disk format, shared by the browser
// store (src/ui/collection.ts) and the Node-side dev-server plugin
// (src/server/**). It lives outside both because the plugin cannot import a
// React module and the store cannot import Node built-ins — and because two
// copies of this schema would drift, which is exactly how a validated write
// path stops protecting anything.

import { z } from 'zod'

export interface Collection {
  counts: Record<string, number>
}

/** Counts are non-negative SAFE integers: zod 4's `.int()` is `safeint`, and
 *  the reader refuses anything it cannot re-read, so 1e20 (an integer, but
 *  not a safe one) must fail here rather than poison the stored blob. */
export const collectionSchema = z.object({
  counts: z.record(z.string(), z.number().int().nonnegative()),
})

export interface CollectionFile {
  version: 1
  revision: number
  savedAt: string
  counts: Record<string, number>
}

export const collectionFileSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  savedAt: z.string(),
  counts: z.record(z.string(), z.number().int().nonnegative()),
})

/** The state of a collection that has never been written: revision 0 is what
 *  a client sends as `baseRevision` when it has never seen a file. */
export const EMPTY_FILE: CollectionFile = {
  version: 1,
  revision: 0,
  savedAt: '1970-01-01T00:00:00.000Z',
  counts: {},
}

/** Zod's own `error.message` is a JSON dump of issue objects; these messages
 *  reach the user, so render them as readable lines instead. */
export function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map((segment) => String(segment)).join('.')
      return path === '' ? issue.message : `${path}: ${issue.message}`
    })
    .join('\n')
}
