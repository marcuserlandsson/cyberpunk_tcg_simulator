import { z } from 'zod'
import cardsJson from '../../data/cards.json'
import type { CardDb, CardDef, EffectDef, EffectNode } from './types'

// ---------------------------------------------------------------------------
// Effect system schema (mirrors the EffectNode/EffectDef union in types.ts)
// ---------------------------------------------------------------------------

const triggerSchema = z.enum(['onPlay', 'onCall', 'onAttack', 'onDefeat', 'activated', 'static'])

const targetSpecSchema = z.enum([
  'self',
  'friendlyUnit',
  'rivalUnit',
  'rivalSpentUnit',
  'anyUnit',
  'friendlyUnitOrLegend',
])

const whoseSchema = z.enum(['friendly', 'rival'])

export const effectNodeSchema: z.ZodType<EffectNode> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('draw'), count: z.number() }),
    z.strictObject({ kind: z.literal('discardRandomRival'), count: z.number() }),
    z.strictObject({
      kind: z.literal('buffPower'),
      amount: z.number(),
      target: targetSpecSchema,
      duration: z.enum(['turn', 'permanent']),
    }),
    z.strictObject({ kind: z.literal('staticPower'), amount: z.number() }),
    z.strictObject({ kind: z.literal('defeat'), target: targetSpecSchema }),
    z.strictObject({ kind: z.literal('bounce'), target: targetSpecSchema }),
    z.strictObject({ kind: z.literal('readyCard'), target: targetSpecSchema }),
    z.strictObject({ kind: z.literal('spendCard'), target: targetSpecSchema }),
    z.strictObject({ kind: z.literal('stealGig'), count: z.number() }),
    z.strictObject({ kind: z.literal('returnGig'), count: z.number() }),
    z.strictObject({ kind: z.literal('rerollGig'), whose: whoseSchema }),
    z.strictObject({ kind: z.literal('trashFromDeck'), whose: whoseSchema, count: z.number() }),
    z.strictObject({ kind: z.literal('bottomDeck'), target: targetSpecSchema }),
    z.strictObject({ kind: z.literal('gainEddieFromTopDeck'), count: z.number() }),
    z.strictObject({ kind: z.literal('sequence'), effects: z.array(effectNodeSchema) }),
    z.strictObject({ kind: z.literal('scripted'), name: z.string() }),
    z.strictObject({ kind: z.literal('cantAttack') }),
  ])
)

const effectDefSchema: z.ZodType<EffectDef> = z.strictObject({
  trigger: triggerSchema,
  cost: z
    .strictObject({
      selfSpend: z.boolean().optional(),
      eddies: z.number().optional(),
    })
    .optional(),
  condition: z
    .strictObject({
      streetCredAtLeast: z.number().optional(),
    })
    .optional(),
  quick: z.boolean().optional(),
  effect: effectNodeSchema,
})

// ---------------------------------------------------------------------------
// Card schema
// ---------------------------------------------------------------------------

const ramSchema = z.strictObject({ color: z.string(), value: z.number() })

const cardSchema: z.ZodType<CardDef> = z.strictObject({
  id: z.string(),
  name: z.string(),
  subtitle: z.string().optional(),
  color: z.string(),
  faction: z.string().optional(),
  type: z.enum(['legend', 'unit', 'program', 'gear']),
  cost: z.number(),
  power: z.number().nullable(),
  ram: ramSchema.nullable(),
  ramLimit: ramSchema.nullable(),
  sellTag: z.boolean(),
  keywords: z.array(z.string()),
  text: z.string(),
  effects: z.array(effectDefSchema),
  scripted: z.string().optional(),
})

export const cardDbSchema: z.ZodType<CardDef[]> = z.array(cardSchema)

export function loadCardDb(): CardDb {
  const cards = cardDbSchema.parse(cardsJson)
  const db: CardDb = {}
  for (const card of cards) {
    db[card.id] = card
  }
  return db
}
