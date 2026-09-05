import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  collectionSchema,
  collectionFileSchema,
  formatZodIssues,
  EMPTY_FILE,
  type CollectionFile,
} from '../../src/collection/format'

describe('collectionSchema', () => {
  it('accepts non-negative safe integer counts', () => {
    expect(collectionSchema.safeParse({ counts: { 'a/1': 0, 'b/2': 3 } }).success).toBe(true)
  })

  it('rejects a non-safe integer (the 1e20 case that poisoned the blob)', () => {
    expect(collectionSchema.safeParse({ counts: { 'a/1': 1e20 } }).success).toBe(false)
  })

  it('rejects negatives and fractions', () => {
    expect(collectionSchema.safeParse({ counts: { 'a/1': -1 } }).success).toBe(false)
    expect(collectionSchema.safeParse({ counts: { 'a/1': 1.5 } }).success).toBe(false)
  })
})

describe('collectionFileSchema', () => {
  const file: CollectionFile = {
    version: 1,
    revision: 7,
    savedAt: '2026-09-05T10:00:00.000Z',
    counts: { 'a/1': 2 },
  }

  it('accepts a well-formed file', () => {
    expect(collectionFileSchema.safeParse(file).success).toBe(true)
  })

  it('rejects a wrong version', () => {
    expect(collectionFileSchema.safeParse({ ...file, version: 2 }).success).toBe(false)
  })

  it('rejects a negative revision', () => {
    expect(collectionFileSchema.safeParse({ ...file, revision: -1 }).success).toBe(false)
  })

  it('EMPTY_FILE is itself valid and empty', () => {
    expect(collectionFileSchema.safeParse(EMPTY_FILE).success).toBe(true)
    expect(EMPTY_FILE.counts).toEqual({})
    expect(EMPTY_FILE.revision).toBe(0)
  })
})

describe('formatZodIssues', () => {
  it('renders readable lines, not a raw JSON dump', () => {
    const result = collectionSchema.safeParse({ counts: { 'a/1': -1 } })
    if (result.success) throw new Error('fixture assumption failed: expected a parse failure')
    const text = formatZodIssues(result.error)
    expect(text).toContain('counts')
    expect(text).not.toContain('"code"')
    expect(text).not.toContain('[\n')
  })
})
