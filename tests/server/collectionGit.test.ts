import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { _flushCommitTimerForTests, commitCollection, scheduleCommit, type GitResult } from '../../src/server/collectionGit'

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

  it('leaves nothing staged when the commit itself fails (pre-commit hook rejects)', async () => {
    // A rejecting hook is the most reliable way to force `git commit` to fail
    // without touching child_process mocks. Git for Windows runs hooks
    // through its bundled `sh`, recognizing the shebang regardless of the
    // NTFS execute bit, so this fires the same way cross-platform.
    const hookPath = join(dir, '.git', 'hooks', 'pre-commit')
    await writeFile(hookPath, '#!/bin/sh\nexit 1\n', { mode: 0o755 })

    await writeFile(file, '{}', 'utf8')
    const result = await commitCollection(file, 'should fail')
    expect(result.status).toBe('failed')

    // If `git add` were left in place after the failed commit, an unrelated
    // manual commit the user runs next would silently sweep the collection
    // file in. Confirm the index was restored: an untracked new file goes
    // back to "??", not the staged "A " a leaked `git add` would leave.
    const { stdout } = await run('git', ['status', '--porcelain', '--', file], { cwd: dir })
    expect(stdout.trim().startsWith('??')).toBe(true)
  })
})

describe('scheduleCommit', () => {
  // Only fake setTimeout/clearTimeout: commitCollection's real work is a real
  // child_process, and faking setImmediate/process.nextTick/Date alongside it
  // risks starving Node's own internals that ferry that process's output
  // back to us.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('collapses a burst of saves into exactly one commit', async () => {
    await writeFile(file, '{}', 'utf8')
    const results: GitResult[] = []
    scheduleCommit(file, 'first', (r) => results.push(r))
    scheduleCommit(file, 'second', (r) => results.push(r))
    scheduleCommit(file, 'third', (r) => results.push(r))

    await vi.advanceTimersByTimeAsync(5000)
    await _flushCommitTimerForTests()

    const output = await log()
    // seed commit + exactly one new commit, carrying the latest summary.
    expect(output.trim().split('\n')).toHaveLength(2)
    expect(output).toContain('third')
    expect(output).not.toContain('first')
    expect(output).not.toContain('second')
    expect(results).toHaveLength(1)
    expect(results[0]?.status).toBe('ok')
  })

  it('resets the timer on a later call instead of stacking it', async () => {
    await writeFile(file, '{}', 'utf8')
    const results: GitResult[] = []
    scheduleCommit(file, 'first', (r) => results.push(r))
    await vi.advanceTimersByTimeAsync(3000) // short of the 5s debounce
    scheduleCommit(file, 'second', (r) => results.push(r)) // resets the clock
    await vi.advanceTimersByTimeAsync(3000) // 6s since the first call, but only 3s since the reset

    expect(await log()).not.toContain('second')
    expect(results).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(2000) // 5s since the reset
    await _flushCommitTimerForTests()

    expect(await log()).toContain('second')
    expect(results).toHaveLength(1)
  })

  it('_flushCommitTimerForTests genuinely awaits the in-flight commit', async () => {
    await writeFile(file, '{}', 'utf8')
    scheduleCommit(file, 'flushed', () => {})

    await vi.advanceTimersByTimeAsync(5000) // fires the timer; commitCollection starts (real child_process)
    await _flushCommitTimerForTests() // must not resolve until that commit is actually done

    expect(await log()).toContain('flushed')
  })
})
