// Lint-style sweep (docs/rulings.md §148 — Task 9 fuzz harness, fix round 3):
// every `fireTriggerOnDraft` call inside `src/cards/scripted/index.ts` fires a
// NESTED trigger from within a hand-written script — a card's own onPlay/
// onCall effect, which can end the game outright (a forced draw off an empty
// deck). Unlike the engine's own resolution choke points (`resolveAttack`,
// `fight`, `defeatUnit`, the trigger wrappers themselves — docs/rulings.md
// §147), a script's own body can't be guarded "by construction" from the
// outside: only the script knows what, if anything, still needs to run after
// its own nested fire. So this file statically checks the one thing that
// matters — is there a mutation/event push AFTER the fire with nothing
// stopping it — instead of trusting a one-time human sweep to stay correct as
// scripted/index.ts grows.
//
// A call site passes if, scanning forward from it, one of these is reached
// BEFORE any `state.events.push(`:
//   * a bare `return state` — the fire (or whatever ran after it) was the
//     script's last act, so nothing else can run regardless of what fired;
//   * a `stillLive(state)` check — the script explicitly stops there if the
//     fire just ended the game;
//   * another `fireTriggerOnDraft(` call — a distinct site, checked on its
//     own.
// A plain zone-only mutation in between (e.g. `p.deck.push(...)` finishing a
// "bottom-deck it after you play it" — deliberately placed AFTER the fire so
// an `onPlay` draw effect can't re-draw the very card being bottom-decked,
// see `alt-cunningham-soulkiller-architect`/`lizzy-wizzy-delicate-weapon`)
// does not by itself violate any invariant the fuzz harness checks, so it
// does not fail this scan on its own — only an EVENT logged with nothing
// stopping it first would show up as a real symptom (the terminal
// `gameEnded` event no longer being last). Whether that zone-only mutation
// itself leaves every card in exactly one zone is human-reviewed and
// recorded per-site in docs/rulings.md §148, not re-derived here.

import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const FILE = path.resolve(__dirname, '../../src/cards/scripted/index.ts')
const lines = fs.readFileSync(FILE, 'utf-8').split('\n')

function isBlankOrComment(line: string): boolean {
  const trimmed = line.trim()
  return trimmed === '' || trimmed.startsWith('//')
}

/** The nearest enclosing `'card-id': (...) => {` above `index`, for readable failures. */
function enclosingScriptName(index: number): string {
  for (let i = index; i >= 0; i--) {
    const m = lines[i].match(/^ {2}'([^']+)':\s*\(/)
    if (m) return m[1]
  }
  return '(unknown script)'
}

/** A registry entry's own closing line (2-space indent), e.g. `  },`. */
function isEntryClose(line: string): boolean {
  return /^ {2}\},?$/.test(line)
}

/**
 * Scans forward from `index` (0-based, the line AFTER a `fireTriggerOnDraft`
 * call), bounded by the enclosing script's own closing brace. Safe if a
 * `stillLive(state)` check, a bare `return state`, or another
 * `fireTriggerOnDraft(` call is reached before any `state.events.push(` —
 * see the file-header comment for why a bare zone-only mutation in between
 * doesn't itself fail the scan.
 */
function isSafeFollowUp(index: number): boolean {
  for (let i = index; i < lines.length; i++) {
    const line = lines[i]
    if (isBlankOrComment(line)) continue
    if (line.includes('stillLive(state)')) return true
    if (line.trim() === 'return state') return true
    if (line.includes('fireTriggerOnDraft(')) return true
    if (line.includes('state.events.push(')) return false
    if (isEntryClose(line)) return false // exited the script with no safe stop
    // Anything else (a zone-only mutation, a local `const`, ...) — keep
    // scanning; only an unguarded event push is the mechanically-checkable
    // symptom this sweep exists to catch.
  }
  return false
}

// The full sweep from docs/rulings.md §148, one entry per call site, in file
// order — kept here (not just in the doc) so a NEW call site changes this
// list's length and forces a deliberate update, not a silent pass.
const EXPECTED_SITES = [
  'arasaka-emergency-radioport',
  'yorinobu-arasaka-steel-dragon',
  't-bug-amateur-philosopher',
  'the-heist',
  'the-relic-experimental-biochip',
  'river-ward-detective-on-the-hunt:free-gear',
  'viktor-vektor-you-might-feel-a-little-pinch',
  'alt-cunningham-soulkiller-architect',
  'chrome-reverie',
  'judy-a-lvarez-nothing-to-doubt',
  'lizzy-wizzy-delicate-weapon',
]

describe('scripted cards: no mutation/event survives a nested fire that ends the game', () => {
  it('finds exactly the swept call sites, in the swept order', () => {
    const found: string[] = []
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('fireTriggerOnDraft(')) found.push(enclosingScriptName(i))
    }
    expect(found).toEqual(EXPECTED_SITES)
  })

  it('every fireTriggerOnDraft call site is terminal or checks stillLive right after', () => {
    const problems: string[] = []
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes('fireTriggerOnDraft(')) continue
      if (!isSafeFollowUp(i + 1)) {
        problems.push(`${enclosingScriptName(i)} (line ${i + 1}): ${lines[i].trim()}`)
      }
    }
    expect(problems).toEqual([])
  })
})
