import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readCollectionFile,
  writeCollectionFile,
  backupPathFor,
} from '../../src/server/collectionFile'

let dir = ''
let file = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ctcg-collection-'))
  file = join(dir, 'collection.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('readCollectionFile', () => {
  it('returns an empty file when none exists', async () => {
    const result = await readCollectionFile(file)
    expect(result.revision).toBe(0)
    expect(result.counts).toEqual({})
  })

  it('round-trips what writeCollectionFile wrote', async () => {
    await writeCollectionFile(file, { baseRevision: 0, counts: { 'a/1': 2 } })
    const result = await readCollectionFile(file)
    expect(result.counts).toEqual({ 'a/1': 2 })
    expect(result.revision).toBe(1)
  })

  it('throws on a corrupt file rather than reporting empty', async () => {
    await writeFile(file, '{ not json', 'utf8')
    await expect(readCollectionFile(file)).rejects.toThrow()
  })

  it('throws on a structurally invalid file', async () => {
    await writeFile(file, JSON.stringify({ version: 1, counts: {} }), 'utf8')
    await expect(readCollectionFile(file)).rejects.toThrow()
  })
})

describe('writeCollectionFile', () => {
  it('increments the revision on each write', async () => {
    const first = await writeCollectionFile(file, { baseRevision: 0, counts: { 'a/1': 1 } })
    if (!first.ok) throw new Error('fixture assumption failed: first write should succeed')
    expect(first.file.revision).toBe(1)
    const second = await writeCollectionFile(file, { baseRevision: 1, counts: { 'a/1': 2 } })
    if (!second.ok) throw new Error('fixture assumption failed: second write should succeed')
    expect(second.file.revision).toBe(2)
  })

  it('rejects invalid counts without touching the file', async () => {
    await writeCollectionFile(file, { baseRevision: 0, counts: { 'a/1': 5 } })
    const before = await readFile(file, 'utf8')
    const result = await writeCollectionFile(file, { baseRevision: 1, counts: { 'a/1': 1e20 } })
    expect(result).toMatchObject({ ok: false, status: 400, reason: 'invalid' })
    expect(await readFile(file, 'utf8')).toBe(before)
  })

  it('rejects a stale baseRevision and returns the current file', async () => {
    await writeCollectionFile(file, { baseRevision: 0, counts: { 'a/1': 1 } })
    const result = await writeCollectionFile(file, { baseRevision: 0, counts: { 'a/1': 9 } })
    expect(result).toMatchObject({ ok: false, status: 409, reason: 'conflict' })
    if (result.ok) throw new Error('fixture assumption failed: expected a conflict')
    expect(result.current?.counts).toEqual({ 'a/1': 1 })
  })

  it('refuses to empty a non-empty collection without confirmEmpty', async () => {
    await writeCollectionFile(file, { baseRevision: 0, counts: { 'a/1': 1 } })
    const result = await writeCollectionFile(file, { baseRevision: 1, counts: {} })
    expect(result).toMatchObject({ ok: false, status: 409, reason: 'would-empty' })
    expect((await readCollectionFile(file)).counts).toEqual({ 'a/1': 1 })
  })

  it('allows emptying with confirmEmpty', async () => {
    await writeCollectionFile(file, { baseRevision: 0, counts: { 'a/1': 1 } })
    const result = await writeCollectionFile(file, { baseRevision: 1, counts: {}, confirmEmpty: true })
    expect(result.ok).toBe(true)
    expect((await readCollectionFile(file)).counts).toEqual({})
  })

  it('writes a backup of the previous contents before overwriting', async () => {
    await writeCollectionFile(file, { baseRevision: 0, counts: { 'a/1': 1 } })
    await writeCollectionFile(file, { baseRevision: 1, counts: { 'a/1': 2 } })
    const backup = JSON.parse(await readFile(backupPathFor(file), 'utf8'))
    expect(backup.counts).toEqual({ 'a/1': 1 })
  })

  it('prunes zero counts', async () => {
    const result = await writeCollectionFile(file, { baseRevision: 0, counts: { 'a/1': 0, 'b/2': 3 } })
    if (!result.ok) throw new Error('fixture assumption failed: write should succeed')
    expect(result.file.counts).toEqual({ 'b/2': 3 })
  })

  it('leaves no .tmp file behind', async () => {
    await writeCollectionFile(file, { baseRevision: 0, counts: { 'a/1': 1 } })
    expect((await readdir(dir)).filter((n) => n.endsWith('.tmp'))).toEqual([])
  })
})
