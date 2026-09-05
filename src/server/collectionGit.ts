// Auto-commit and push the collection file, batched so a pack of quick-adds
// becomes one commit rather than one per card.
//
// Two rules shape everything here. First, this must never break a save: by
// the time git runs, the collection is already durable on disk, so every
// failure is reported and swallowed, never thrown. Second, it touches
// nothing but the collection: commits pass an explicit pathspec so unrelated
// in-progress work is never swept in, and a rejected push is left for the
// user — resolving remote divergence is not a decision a background process
// should make in someone's repo.

import { execFile } from 'node:child_process'
import { dirname } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const DEBOUNCE_MS = 5000

export type GitResult = { status: 'ok' | 'skipped' | 'failed'; detail: string }

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd })
  return stdout.trim()
}

/** Tests point CTCG_COLLECTION_FILE at a scratch file; when it is set, git
 *  automation must be a no-op so tests never produce commits in the real
 *  repository. */
function gitAutomationDisabled(): boolean {
  return process.env.CTCG_COLLECTION_FILE !== undefined && process.env.CTCG_COLLECTION_FILE !== ''
}

export async function commitCollection(filePath: string, summary: string): Promise<GitResult> {
  if (gitAutomationDisabled()) {
    return { status: 'skipped', detail: 'CTCG_COLLECTION_FILE is set; git automation disabled' }
  }

  const cwd = dirname(filePath)
  try {
    const inside = await git(cwd, ['rev-parse', '--is-inside-work-tree'])
    if (inside !== 'true') return { status: 'skipped', detail: 'not a git work tree' }
  } catch {
    return { status: 'skipped', detail: 'not a git work tree' }
  }

  try {
    const status = await git(cwd, ['status', '--porcelain', '--', filePath])
    if (status === '') return { status: 'skipped', detail: 'collection file unchanged' }

    try {
      await git(cwd, ['add', '--', filePath])
      await git(cwd, ['commit', '-m', `chore(collection): ${summary}`, '--', filePath])
    } catch (err) {
      // A failed commit (a rejecting hook, a GPG-signing timeout, disk
      // pressure...) must not leave the collection file staged: until our
      // next successful attempt, any unrelated `git commit` the user runs by
      // hand would otherwise silently sweep our staged change in with it —
      // exactly the leak the explicit pathspec exists to prevent, just
      // inverted. Reset the index for this path only. Swallowing the
      // reset's own failure is correct here: we are already on a failure
      // path and must still return a GitResult rather than throw.
      await git(cwd, ['reset', '--', filePath]).catch(() => {})
      return { status: 'failed', detail: `commit failed: ${String(err)}` }
    }

    try {
      await git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
    } catch {
      return { status: 'ok', detail: 'committed; push skipped (no upstream configured)' }
    }

    try {
      await git(cwd, ['push'])
      return { status: 'ok', detail: 'committed and pushed' }
    } catch (err) {
      // A rejected push means the remote moved. The commit is safe locally;
      // resolving divergence is the user's call, not ours. Never auto-pull,
      // rebase, or force-push here.
      return { status: 'failed', detail: `committed, but push failed: ${String(err)}` }
    }
  } catch (err) {
    return { status: 'failed', detail: String(err) }
  }
}

let timer: ReturnType<typeof setTimeout> | undefined
let inFlight: Promise<void> | undefined

/** Debounced: a burst of saves produces one commit once writes go quiet.
 *
 *  Also guarded by CTCG_COLLECTION_FILE, in addition to the guard inside
 *  commitCollection: callers under test invoke this on every save, and
 *  arming a real 5s timer per call would outlive the test and keep
 *  Vitest's process handle open even though the eventual commit would be
 *  a no-op. Skipping here means no timer is ever armed when automation is
 *  disabled. */
export function scheduleCommit(
  filePath: string,
  summary: string,
  onResult: (result: GitResult) => void
): void {
  if (gitAutomationDisabled()) return
  if (timer !== undefined) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = undefined
    inFlight = commitCollection(filePath, summary)
      .then((result) => {
        // The spec promises a non-ok git outcome is LOGGED. `onResult` only
        // reaches the browser on the *next* PUT's response, so the last save
        // of a session would otherwise report its git outcome to nobody at
        // all. The dev-server console is the one place that is always there.
        if (result.status !== 'ok') {
          console.warn(`[collection] git ${result.status}: ${result.detail}`)
        }
        onResult(result)
      })
      .catch((err: unknown) => {
        // commitCollection is written not to throw, but an unhandled
        // rejection here is fatal by default in modern Node — it would take
        // the dev server down mid-entry-session over a background commit.
        // Nothing about the save is at risk (the file is already durable);
        // report it and carry on.
        console.warn(`[collection] git automation threw: ${String(err)}`)
        onResult({ status: 'failed', detail: String(err) })
      })
  }, DEBOUNCE_MS)
}

/** Test-only: run any pending debounced commit immediately and await it. */
export async function _flushCommitTimerForTests(): Promise<void> {
  if (timer !== undefined) {
    clearTimeout(timer)
    timer = undefined
  }
  await inFlight
}
