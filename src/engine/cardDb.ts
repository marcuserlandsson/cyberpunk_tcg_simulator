import { z } from 'zod'
import cardsJson from '../../data/cards.json'
import type { CardDb, CardDef, EffectDef, EffectNode } from './types'

// ---------------------------------------------------------------------------
// Effect system schema (mirrors the EffectNode/EffectDef union in types.ts)
// ---------------------------------------------------------------------------

const triggerSchema = z.enum([
  'onPlay',
  'onCall',
  'onAttack',
  'onDefeat',
  'onBlock',
  'onWinFight',
  'onSpend',
  'onFriendlyStealDie',
  'onFriendlyAttack',
  'onUnitDefeated',
  'onRivalAdjustFriendlyGig',
  'onEndTurn',
  'onFriendlyEquippedSpend',
  'onLoseFight',
  'onStartTurn',
  'onFriendlyBlock',
  'onFriendlyCardPlayed',
  'activated',
  'static',
])

const cardTypeSchema = z.enum(['legend', 'unit', 'program', 'gear'])

const targetSpecSchema = z.enum([
  'self',
  'chosen',
  'friendlyUnit',
  'rivalUnit',
  'rivalSpentUnit',
  'anyUnit',
  'friendlyUnitOrLegend',
  'friendlyGigDie',
  'rivalGigDie',
  'anyGigDie',
  'friendlyTrashCard',
  'friendlyHandCard',
  'friendlyHandOrTrashUnit',
  'friendlyGear',
  'anyGear',
  'fightFoe',
  'friendlyFaceUpLegend',
  'selfGear',
  'friendlyHandOrTrashProgram',
])

const gigDieSpecSchema = z.enum(['friendlyGigDie', 'rivalGigDie', 'anyGigDie'])

const whoseSchema = z.enum(['friendly', 'rival'])

const targetFilterSchema = z.strictObject({
  maxPower: z.number().optional(),
  minPower: z.number().optional(),
  keyword: z.string().optional(),
  excludeSelf: z.boolean().optional(),
  weakerThanAFriendlyUnit: z.boolean().optional(),
  cardType: cardTypeSchema.optional(),
  maxCost: z.number().optional(),
  maxPowerIfAheadOnStreetCred: z.number().optional(),
  maxPowerVsFriendlyD20: z.boolean().optional(),
  unequipped: z.boolean().optional(),
  spentOnly: z.boolean().optional(),
  lowestPower: z.boolean().optional(),
})

const costReductionSchema = z.discriminatedUnion('per', [
  z.strictObject({
    per: z.literal('friendlyGigValueAtLeast'),
    value: z.number(),
    amount: z.number(),
    minimum: z.number(),
  }),
  z.strictObject({
    per: z.literal('unitInTrash'),
    amount: z.number(),
    minimum: z.number(),
  }),
  z.strictObject({
    per: z.literal('friendlyFaceUpLegend'),
    amount: z.number(),
    minimum: z.number(),
  }),
])

const dynamicAmountSchema = z.union([
  z.literal('friendlyMaxGig'),
  z.literal('friendlyGigValuePairCount'),
  z.literal('friendlyFaceUpLegendCount'),
  z.strictObject({ perEquippedGear: z.number() }),
  z.strictObject({
    perFriendlyGigParity: z.strictObject({
      parity: z.enum(['even', 'odd']),
      amount: z.number(),
    }),
  }),
])

const powerAmountSchema = z.union([z.number(), dynamicAmountSchema])

const dieSizeSchema = z.union([
  z.literal(4),
  z.literal(6),
  z.literal(8),
  z.literal(10),
  z.literal(12),
  z.literal(20),
])

/**
 * The board facts an `EffectDef`/`conditionalEffect` can gate on
 * (`EffectCondition` in types.ts). Factored out so `conditionalEffect`
 * (docs/rulings.md §92 ff.) can reuse the exact same shape.
 */
const conditionSchema = z.strictObject({
  streetCredAtLeast: z.number().optional(),
  friendlyGigValueAtLeast: z.number().optional(),
  rivalGigLeadAtLeast: z.number().optional(),
  stolenDieSize: dieSizeSchema.optional(),
  streetCredAheadOfRival: z.boolean().optional(),
  streetCredBelow: z.number().optional(),
  duringOwnTurn: z.boolean().optional(),
  sourcePowerAtLeast: z.number().optional(),
  selfIsStealer: z.boolean().optional(),
  attackerKeyword: z.string().optional(),
  defeatedKeyword: z.string().optional(),
  friendlyGigsAtLeastValueCount: z.strictObject({ value: z.number(), count: z.number() }).optional(),
  friendlyGigDistinctValuesAtLeast: z.number().optional(),
  friendlyGigEvenAndOdd: z.boolean().optional(),
  friendlyGigValueEquals: z.number().optional(),
  streetCredDiffAtLeast: z.number().optional(),
  sourceEquipped: z.boolean().optional(),
  stealerIsLegend: z.boolean().optional(),
  stolenDieValueParity: z.enum(['even', 'odd']).optional(),
  defeatedIsFriendly: z.boolean().optional(),
  defeatedWasEquipped: z.boolean().optional(),
  streetCredParity: z.enum(['even', 'odd']).optional(),
  allFriendlyLegendsFaceUp: z.boolean().optional(),
  sourceSpent: z.boolean().optional(),
  friendlyGigValuePair: z.boolean().optional(),
  friendlyEquippedCountAtLeast: z.number().optional(),
  sourceStoleGigThisTurn: z.boolean().optional(),
  friendlyProgramNotPlayedThisTurn: z.boolean().optional(),
  playedCardColor: z.string().optional(),
  playedCardType: cardTypeSchema.optional(),
  playedCardKeyword: z.string().optional(),
  stealerKeywordAnyOf: z.array(z.string()).optional(),
})

export const effectNodeSchema: z.ZodType<EffectNode> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('draw'), count: powerAmountSchema }),
    z.strictObject({ kind: z.literal('discardRandomRival'), count: z.number() }),
    z.strictObject({
      kind: z.literal('buffPower'),
      amount: powerAmountSchema,
      target: targetSpecSchema,
      filter: targetFilterSchema.optional(),
      duration: z.enum(['turn', 'permanent']),
    }),
    z.strictObject({ kind: z.literal('staticPower'), amount: powerAmountSchema }),
    z.strictObject({
      kind: z.literal('defeat'),
      target: targetSpecSchema,
      filter: targetFilterSchema.optional(),
    }),
    z.strictObject({
      kind: z.literal('bounce'),
      target: targetSpecSchema,
      filter: targetFilterSchema.optional(),
    }),
    z.strictObject({
      kind: z.literal('readyCard'),
      target: targetSpecSchema,
      filter: targetFilterSchema.optional(),
    }),
    z.strictObject({
      kind: z.literal('spendCard'),
      target: targetSpecSchema,
      filter: targetFilterSchema.optional(),
    }),
    z.strictObject({
      kind: z.literal('stealGig'),
      count: z.number(),
      distinctValueOnly: z.boolean().optional(),
    }),
    z.strictObject({ kind: z.literal('returnGig'), count: z.number() }),
    z.strictObject({ kind: z.literal('rerollGig'), whose: whoseSchema }),
    z.strictObject({ kind: z.literal('trashFromDeck'), whose: whoseSchema, count: z.number() }),
    z.strictObject({
      kind: z.literal('bottomDeck'),
      target: targetSpecSchema,
      filter: targetFilterSchema.optional(),
    }),
    z.strictObject({ kind: z.literal('gainEddieFromTopDeck'), count: z.number() }),
    z.strictObject({ kind: z.literal('sequence'), effects: z.array(effectNodeSchema) }),
    z.strictObject({
      kind: z.literal('scripted'),
      name: z.string(),
      targets: z.array(targetSpecSchema).optional(),
      filters: z.array(targetFilterSchema).optional(),
    }),
    z.strictObject({ kind: z.literal('cantAttack') }),
    z.strictObject({
      kind: z.literal('changeGig'),
      amount: z.number(),
      target: gigDieSpecSchema,
      adjust: z.boolean().optional(),
    }),
    z.strictObject({
      kind: z.literal('sameTarget'),
      target: targetSpecSchema,
      filter: targetFilterSchema.optional(),
      effects: z.array(effectNodeSchema),
    }),
    z.strictObject({
      kind: z.literal('grantKeyword'),
      keyword: z.string(),
      target: targetSpecSchema,
      filter: targetFilterSchema.optional(),
      duration: z.literal('turn'),
    }),
    z.strictObject({
      kind: z.literal('chooseOne'),
      modes: z.array(effectNodeSchema),
      chooser: z
        .enum(['controller', 'rivalIfBehindStreetCred', 'allUnlessBehindStreetCred'])
        .optional(),
    }),
    z.strictObject({ kind: z.literal('defeatShield') }),
    z.strictObject({ kind: z.literal('winsFightVsKeyword'), keyword: z.string() }),
    z.strictObject({ kind: z.literal('costReduction'), reduction: costReductionSchema }),
    z.strictObject({
      kind: z.literal('powerVsCardType'),
      cardType: cardTypeSchema,
      amount: z.number(),
    }),
    z.strictObject({
      kind: z.literal('retrieveFromTrash'),
      target: targetSpecSchema,
      filter: targetFilterSchema.optional(),
    }),
    z.strictObject({
      kind: z.literal('discardCard'),
      target: targetSpecSchema,
      filter: targetFilterSchema.optional(),
    }),
    z.strictObject({ kind: z.literal('attackReadyWithKeyword'), keyword: z.string() }),
    z.strictObject({ kind: z.literal('cantAttackGigArea') }),
    z.strictObject({ kind: z.literal('grantKeywordWhile'), keyword: z.string() }),
    z.strictObject({ kind: z.literal('rivalCantAttackWhenPlayed') }),
    z.strictObject({
      kind: z.literal('firstMatchingPlayDiscount'),
      cardType: cardTypeSchema,
      keyword: z.string(),
      amount: z.number(),
      minimum: z.number(),
    }),
    z.strictObject({ kind: z.literal('swapGig') }),
    z.strictObject({
      kind: z.literal('skipNextReady'),
      target: targetSpecSchema,
      filter: targetFilterSchema.optional(),
    }),
    z.strictObject({ kind: z.literal('attackGigAreaDespiteLag') }),
    z.strictObject({
      kind: z.literal('conditionalEffect'),
      condition: conditionSchema,
      effect: effectNodeSchema,
    }),
    z.strictObject({ kind: z.literal('matchGig') }),
    z.strictObject({ kind: z.literal('freeLegendCall') }),
    z.strictObject({ kind: z.literal('goSoloTax'), amount: z.number() }),
    z.strictObject({
      kind: z.literal('attackPowerBonus'),
      amount: z.number(),
      keyword: z.string().optional(),
      excludeSelf: z.boolean().optional(),
    }),
    z.strictObject({ kind: z.literal('attackUnitDespiteLag') }),
    z.strictObject({
      kind: z.literal('buffFightPower'),
      amount: powerAmountSchema,
      target: targetSpecSchema,
      filter: targetFilterSchema.optional(),
    }),
    z.strictObject({ kind: z.literal('readyEddies'), count: z.number() }),
  ])
)

const effectDefSchema: z.ZodType<EffectDef> = z.strictObject({
  trigger: triggerSchema,
  cost: z
    .strictObject({
      selfSpend: z.boolean().optional(),
      eddies: z.number().optional(),
      reduction: costReductionSchema.optional(),
    })
    .optional(),
  condition: conditionSchema.optional(),
  quick: z.boolean().optional(),
  oncePerTurn: z.boolean().optional(),
  onceKey: z.string().optional(),
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
  type: cardTypeSchema,
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
