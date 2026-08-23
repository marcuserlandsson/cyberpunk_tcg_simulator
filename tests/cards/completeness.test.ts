// Task 8, step 4: the completeness test for the whole 141-card pool.
//
// The bar, per the plan: EVERY card in `data/cards.json` either carries at
// least one `EffectDef`, or has no rules text to carry one for. There are no
// deferral allowances — the "needs an engine feature nobody built yet" list
// that batches 1-8 maintained (docs/rulings.md §52, §72, §78, §79, §91, §105,
// §132, §140) is closed by the deferred slice (§141-§144), so a card appearing
// here with rules text and no effects is a regression, not a known gap.
//
// The one allowance is `NO_RULES_TEXT`: cards whose printed lines are flavour
// or a keyword reminder and therefore have nothing to encode. It is an
// explicit, per-card list with a rationale each, never a heuristic over the
// text — a new card must be added to it deliberately, in review, rather than
// slipping past a regex.

import { describe, expect, it } from 'vitest'
import { scriptedCards } from '../../src/cards/scripted/index'
import type { EffectNode } from '../../src/engine/types'
import { db } from './fixtures'

/**
 * The cards with `effects: []` on purpose: their whole printed `text` is
 * flavour, an equip/keyword reminder, or (for `rebecca-having-a-moment`)
 * literally empty. Every mechanical word on these cards is already handled by
 * the engine's own keyword machinery, with nothing left for card data to say.
 */
const NO_RULES_TEXT: Record<string, string> = {
  'animals-wrecker': 'flavour line, not rules (docs/rulings.md §51)',
  'emergency-atlus': 'flavour quote (docs/rulings.md §7 precedent)',
  'goro-takemura-hands-unclean': '{Go Solo} + {Blocker} reminders only',
  'mandibular-upgrade': 'equip line + {Blocker} reminder (docs/rulings.md §81 ff.)',
  'mantis-blades': 'equip line + flavour quote (docs/rulings.md §7)',
  'psycho-squad': 'flavour line (docs/rulings.md §9/§134 ff.)',
  'rebecca-having-a-moment': 'no printed rules text at all (empty string)',
  'riding-nomad': '{Adrenaline} reminder only',
  'rockn-rockerboy': 'flavour line (docs/rulings.md §9)',
  'secondhand-bombus': '{Blocker} + "power 0 does not steal" reminders only',
  'v-corporate-exile': '{Go Solo} reminder only (docs/rulings.md §134 ff.)',
}

/** Every node in an effect tree, flattened (any nesting, any node kind). */
function allNodes(node: EffectNode): EffectNode[] {
  const nested: EffectNode[] = []
  for (const value of Object.values(node as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== null && typeof item === 'object' && 'kind' in item) {
          nested.push(...allNodes(item as EffectNode))
        }
      }
    } else if (value !== null && typeof value === 'object' && 'kind' in value) {
      nested.push(...allNodes(value as EffectNode))
    }
  }
  return [node, ...nested]
}

const cards = Object.values(db)

describe('Task 8 completeness: all 141 cards are encoded', () => {
  it('holds exactly 141 cards with unique ids', () => {
    expect(cards).toHaveLength(141)
    expect(new Set(cards.map((card) => card.id)).size).toBe(141)
  })

  it('gives every card either an effect or a documented no-rules-text reason', () => {
    const unencoded = cards
      .filter((card) => card.effects.length === 0)
      .filter((card) => NO_RULES_TEXT[card.id] === undefined)
      .map((card) => `${card.id}: ${JSON.stringify(card.text)}`)
    expect(unencoded).toEqual([])
  })

  it('counts 141/141: encoded cards plus no-rules-text cards, with no deferrals', () => {
    const encoded = cards.filter((card) => card.effects.length > 0)
    const reminderOnly = cards.filter((card) => NO_RULES_TEXT[card.id] !== undefined)
    expect(encoded.length + reminderOnly.length).toBe(141)
    // No overlap, and therefore no third category (a "deferred" card would be
    // in neither, and a mis-listed one in both).
    expect(encoded.some((card) => NO_RULES_TEXT[card.id] !== undefined)).toBe(false)
  })

  it('keeps the no-rules-text list free of stale entries', () => {
    const stale = Object.keys(NO_RULES_TEXT).filter(
      (id) => db[id] === undefined || db[id].effects.length > 0
    )
    expect(stale).toEqual([])
  })

  it('resolves every scripted node name in the scripted registry', () => {
    const used = new Set<string>()
    for (const card of cards) {
      for (const def of card.effects) {
        for (const node of allNodes(def.effect)) {
          if (node.kind === 'scripted') used.add(node.name)
        }
      }
    }
    const missing = [...used].filter((name) => scriptedCards[name] === undefined)
    expect(missing).toEqual([])
    // ... and no dead scripts in the registry either.
    const unused = Object.keys(scriptedCards).filter((name) => !used.has(name))
    expect(unused).toEqual([])
  })

  it("keeps every card's informational `scripted` field honest", () => {
    const inconsistent = cards
      .filter((card) => card.scripted !== undefined)
      .filter(
        (card) =>
          !card.effects.some((def) =>
            allNodes(def.effect).some(
              (node) => node.kind === 'scripted' && node.name.startsWith(card.scripted as string)
            )
          )
      )
      .map((card) => card.id)
    expect(inconsistent).toEqual([])
  })
})
