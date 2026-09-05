// Reading and writing data/collection.json — the collection's source of
// truth. Every guard here exists because this file is the only copy of data
// the player enters by hand, card by card:
//
//   * writes are atomic (temp file + rename), so a crash mid-write cannot
//     leave a truncated collection behind;
//   * the previous contents are copied to a sibling .backup.json first;
//   * a corrupt file is reported as an error rather than treated as empty,
//     because "empty" would then be written back over it;
//   * a write that would empty a non-empty collection needs explicit
//     confirmation;
//   * counts are validated with the same schema the browser reader uses, so
//     we never persist something that cannot be read back.
//
// Handlers take an explicit path so they can be tested against a temp
// directory without a running server.

import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  EMPTY_FILE,
  collectionFileSchema,
  collectionSchema,
  formatZodIssues,
  type CollectionFile,
} from '../collection/format'

/** `CTCG_COLLECTION_FILE` overrides the target — the lever that keeps tests
 *  and the e2e suite away from the real collection. */
export function resolveCollectionPath(): string {
  const override = process.env.CTCG_COLLECTION_FILE
  if (override !== undefined && override !== '') return resolve(override)
  return resolve(join(process.cwd(), 'data', 'collection.json'))
}

export function backupPathFor(filePath: string): string {
  return filePath.replace(/\.json$/i, '') + '.backup.json'
}

export async function readCollectionFile(filePath: string): Promise<CollectionFile> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY_FILE
    throw err
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`${filePath} is not valid JSON. The previous contents are in ${backupPathFor(filePath)}.`)
  }
  const result = collectionFileSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`${filePath} is not a valid collection file:\n${formatZodIssues(result.error)}`)
  }
  return result.data
}

export type WriteResult =
  | { ok: true; file: CollectionFile }
  | {
      ok: false
      status: 400 | 409
      reason: 'invalid' | 'conflict' | 'would-empty'
      message: string
      current?: CollectionFile
    }

export async function writeCollectionFile(
  filePath: string,
  body: { baseRevision: number; counts: unknown; confirmEmpty?: boolean }
): Promise<WriteResult> {
  const validated = collectionSchema.safeParse({ counts: body.counts })
  if (!validated.success) {
    return {
      ok: false,
      status: 400,
      reason: 'invalid',
      message: `Refusing to save invalid counts:\n${formatZodIssues(validated.error)}`,
    }
  }

  // Prune zero counts: absence means 0, matching the browser store.
  const counts: Record<string, number> = {}
  for (const [key, count] of Object.entries(validated.data.counts)) {
    if (count > 0) counts[key] = count
  }

  const current = await readCollectionFile(filePath)

  if (body.baseRevision !== current.revision) {
    return {
      ok: false,
      status: 409,
      reason: 'conflict',
      message: `The collection on disk changed (revision ${current.revision}, you sent ${body.baseRevision}).`,
      current,
    }
  }

  const wouldEmpty = Object.keys(counts).length === 0 && Object.keys(current.counts).length > 0
  if (wouldEmpty && body.confirmEmpty !== true) {
    return {
      ok: false,
      status: 409,
      reason: 'would-empty',
      message: 'Refusing to empty a non-empty collection without confirmation.',
      current,
    }
  }

  const next: CollectionFile = {
    version: 1,
    revision: current.revision + 1,
    savedAt: new Date().toISOString(),
    counts,
  }

  await mkdir(dirname(filePath), { recursive: true })
  if (current.revision > 0) {
    // Best-effort: a missing previous file is not a reason to refuse a write.
    try {
      await copyFile(filePath, backupPathFor(filePath))
    } catch {
      /* ignore */
    }
  }

  const tmp = `${filePath}.tmp`
  await writeFile(tmp, JSON.stringify(next, null, 1) + '\n', 'utf8')
  await rename(tmp, filePath)

  return { ok: true, file: next }
}
