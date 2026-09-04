// CI guard on the *committed* dataset: printings.json must parse, join
// cleanly against cards.json in both directions, and keep unique keys.
// These mirror the fetch script's own refuse-to-write checks so a bad
// regeneration cannot land.
import { describe, expect, it } from 'vitest'
import rawPrintings from '../../data/printings.json'
import { parsePrintings, printingKey, printingsByCard } from '../../src/ui/printings'
import { loadCardDb } from '../../src/engine/cardDb'

const db = loadCardDb()
const printings = parsePrintings(rawPrintings)

describe('data/printings.json', () => {
  it('parses and has at least one printing per card in cards.json', () => {
    const byCard = printingsByCard(printings)
    const missing = Object.keys(db).filter((id) => !byCard.has(id))
    expect(missing).toEqual([])
  })

  it('references only card ids that exist in cards.json', () => {
    const unknown = printings.filter((p) => !(p.cardId in db)).map((p) => p.key)
    expect(unknown).toEqual([])
  })

  it('derives every key through printingKey (the fetch script duplicates this rule by hand)', () => {
    for (const p of printings) {
      expect(p.key).toBe(printingKey(p.setCode, p.collectorNumber, p.finish))
    }
  })

  // The finish segment was added to the key format *before* any finish
  // variant exists upstream, precisely so it costs nothing: while every row
  // is finish-null the committed keys must stay byte-identical to the
  // original `setCode/collectorNumber` form, or every saved collection would
  // need a migration. This pins that, and stays meaningful afterwards (it
  // then asserts the rule only for the rows it still applies to).
  it('keeps finish-null keys byte-identical to the historical setCode/collectorNumber form', () => {
    for (const p of printings) {
      if (p.finish === null) expect(p.key).toBe(`${p.setCode}/${p.collectorNumber}`)
    }
  })

  it('is sorted by (setCode, collectorNumber) for stable diffs', () => {
    const sorted = [...printings].sort(
      (a, b) => a.setCode.localeCompare(b.setCode) || a.collectorNumber.localeCompare(b.collectorNumber)
    )
    expect(printings.map((p) => p.key)).toEqual(sorted.map((p) => p.key))
  })
})
