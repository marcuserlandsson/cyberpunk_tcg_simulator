import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { _flushCommitTimerForTests, commitCollection } from '../../src/server/collectionGit'

const run = promisify(execFile)
let dir = ''
let file = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ctcg-git-'))
  file = join(dir, 'collection.json')
  await run('git', ['init', '-b', 'main'], { cwd: dir })
  await run('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
  await run('git', ['config', 'user.name', 'Test'], { cwd: dir })
  await writeFile(join(dir, 'README.md'), 'seed\n', 'utf8')
  await run('git', ['add', 'README.md'], { cwd: dir })
  await run('git', ['commit', '-m', 'seed'], { cwd: dir })
})

afterEach(async () => {
  // A real scheduled commit must never leak into the next test's temp repo
  // (or into the real repo, though CTCG_COLLECTION_FILE already guards that).
  await _flushCommitTimerForTests()
  await rm(dir, { recursive: true, force: true })
})

async function log(): Promise<string> {
  const { stdout } = await run('git', ['log', '--oneline'], { cwd: dir })
  return stdout
}

describe('commitCollection', () => {
  it('commits the collection file', async () => {
    await writeFile(file, '{}', 'utf8')
    const result = await commitCollection(file, '3 cards')
    expect(result.status).toBe('ok')
    expect(await log()).toContain('3 cards')
  })

  it('commits ONLY the collection pathspec, leaving other work dirty', async () => {
    await writeFile(file, '{}', 'utf8')
    await writeFile(join(dir, 'unrelated.txt'), 'in progress\n', 'utf8')
    await commitCollection(file, '1 card')
    const { stdout } = await run('git', ['status', '--porcelain'], { cwd: dir })
    expect(stdout).toContain('unrelated.txt')
  })

  it('skips when the file has not changed', async () => {
    await writeFile(file, '{}', 'utf8')
    await commitCollection(file, 'first')
    const result = await commitCollection(file, 'second')
    expect(result.status).toBe('skipped')
    expect(await log()).not.toContain('second')
  })

  it('skips push when no upstream is configured, still reporting ok', async () => {
    await writeFile(file, '{}', 'utf8')
    const result = await commitCollection(file, 'no upstream')
    expect(result.status).toBe('ok')
    expect(result.detail).toMatch(/push skipped/i)
  })

  it('reports skipped, not failed, outside a git work tree', async () => {
    const bare = await mkdtemp(join(tmpdir(), 'ctcg-nogit-'))
    try {
      const loose = join(bare, 'collection.json')
      await writeFile(loose, '{}', 'utf8')
      const result = await commitCollection(loose, 'nowhere')
      expect(result.status).toBe('skipped')
    } finally {
      await rm(bare, { recursive: true, force: true })
    }
  })

  it('never throws, even on a nonsense path', async () => {
    const result = await commitCollection(join(dir, 'no', 'such', 'file.json'), 'missing')
    expect(['skipped', 'failed']).toContain(result.status)
  })

  it('is skipped entirely when CTCG_COLLECTION_FILE is set (tests never commit)', async () => {
    const previous = process.env.CTCG_COLLECTION_FILE
    process.env.CTCG_COLLECTION_FILE = file
    try {
      await writeFile(file, '{}', 'utf8')
      const result = await commitCollection(file, 'should not commit')
      expect(result.status).toBe('skipped')
      expect(await log()).not.toContain('should not commit')
    } finally {
      if (previous === undefined) delete process.env.CTCG_COLLECTION_FILE
      else process.env.CTCG_COLLECTION_FILE = previous
    }
  })
})
