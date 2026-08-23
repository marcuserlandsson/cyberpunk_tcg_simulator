// Everything the playmat is allowed to offer, derived from ONE source: the
// `legalActions` list the engine hands the hook.
//
// The rule this module exists to enforce is that the UI never invents an
// action. Every glow, every clickable target, every button below is a *view* of
// an entry in `legal` — so an affordance the engine would reject cannot be
// rendered, and an action the engine allows cannot be silently unreachable.
// Payments are never picked by hand: `legalActions` fills each entry with the
// canonical payment (economy.ts) and the UI passes it straight back (see
// docs/rulings.md — manual payment selection is a UI simplification; the engine
// accepts any valid combination).
//
// Pure: no React, no state, just selectors over an Action[].

import type { Action, DieSize, PlayerId } from '../engine/types'

export type PlayCardAction = Extract<Action, { type: 'playCard' }>
export type AttackAction = Extract<Action, { type: 'attack' }>
export type ActivateAbilityAction = Extract<Action, { type: 'activateAbility' }>

/** What each zone should currently be highlighting. */
export interface BoardAffordances {
  /** Hand/Legend cards with a legal `playCard` — glow cyan. */
  playable: ReadonlySet<number>
  /** Hand cards with a legal `sellCard` — get a Sell button. */
  sellable: ReadonlySet<number>
  /** Ready units with a legal `attack` — glow magenta. */
  attackers: ReadonlySet<number>
  /** In-play cards with a legal `activateAbility` — get an Ability button. */
  abilities: ReadonlySet<number>
  /** Cards the pending choice is asking the player to pick between. */
  targets: ReadonlySet<number>
  /** The attacker the player has selected, if any. */
  selected: number | null
  /** Fixer die sizes the `chooseGigDie` decision offers. */
  fixerSizes: ReadonlySet<DieSize>
  /** Indexes into the VICTIM's Gig area a pending steal may take. */
  stealableGigIndexes: ReadonlySet<number>
  /** True while the rival Gig area is a legal target of the current choice. */
  gigAreaTarget: boolean
}

/** The click handlers every zone shares. A no-op means "not interactive". */
export interface BoardHandlers {
  onCard: (uid: number) => void
  onSell: (uid: number) => void
  onAbility: (uid: number) => void
  onFixerDie: (size: DieSize) => void
  onGigDie: (index: number) => void
  onGigArea: () => void
}

export const NO_AFFORDANCES: BoardAffordances = {
  playable: new Set(),
  sellable: new Set(),
  attackers: new Set(),
  abilities: new Set(),
  targets: new Set(),
  selected: null,
  fixerSizes: new Set(),
  stealableGigIndexes: new Set(),
  gigAreaTarget: false,
}

function collect<T>(legal: readonly Action[], pick: (action: Action) => T | undefined): Set<T> {
  const out = new Set<T>()
  for (const action of legal) {
    const value = pick(action)
    if (value !== undefined) out.add(value)
  }
  return out
}

export function playableCards(legal: readonly Action[]): Set<number> {
  return collect(legal, (a) => (a.type === 'playCard' ? a.card : undefined))
}

export function sellableCards(legal: readonly Action[]): Set<number> {
  return collect(legal, (a) => (a.type === 'sellCard' ? a.card : undefined))
}

export function attackerUids(legal: readonly Action[]): Set<number> {
  return collect(legal, (a) => (a.type === 'attack' ? a.attacker : undefined))
}

export function abilityUids(legal: readonly Action[]): Set<number> {
  return collect(legal, (a) => (a.type === 'activateAbility' ? a.card : undefined))
}

export function fixerDieSizes(legal: readonly Action[]): Set<DieSize> {
  return collect(legal, (a) => (a.type === 'chooseGigDie' ? a.size : undefined))
}

export function stealableGigIndexes(legal: readonly Action[]): Set<number> {
  return collect(legal, (a) => (a.type === 'chooseGig' ? a.dieIndex : undefined))
}

export function playVariants(legal: readonly Action[], uid: number): PlayCardAction[] {
  return legal.filter((a): a is PlayCardAction => a.type === 'playCard' && a.card === uid)
}

export function abilityVariants(legal: readonly Action[], uid: number): ActivateAbilityAction[] {
  return legal.filter(
    (a): a is ActivateAbilityAction => a.type === 'activateAbility' && a.card === uid
  )
}

export function attacksBy(legal: readonly Action[], attacker: number): AttackAction[] {
  return legal.filter((a): a is AttackAction => a.type === 'attack' && a.attacker === attacker)
}

export function reactions(legal: readonly Action[]): Extract<Action, { type: 'react' }>[] {
  return legal.filter((a): a is Extract<Action, { type: 'react' }> => a.type === 'react')
}

export function findAction<T extends Action['type']>(
  legal: readonly Action[],
  type: T
): Extract<Action, { type: T }> | undefined {
  return legal.find((a): a is Extract<Action, { type: T }> => a.type === type)
}

/**
 * The sentinel for "this variant has no target in this slot at all" — a
 * `chooseOne` mode can bind fewer slots than its sibling, so two variants of
 * the same play legitimately differ in `targets.length`. Uids and Gig-die
 * indexes are both non-negative, so -1 can never collide with a real value.
 */
export const NO_TARGET = -1

export function slotValue(targets: readonly number[], slot: number): number {
  return slot < targets.length ? targets[slot] : NO_TARGET
}

/**
 * The first target slot on which the given variants disagree, or -1 when they
 * all bind the same targets (in which case any of them can just be applied).
 *
 * This is what makes target disambiguation *progressive*: the player is asked
 * about one slot at a time, each answer narrowing the candidate variants, and
 * the flow ends the moment the remaining variants are indistinguishable —
 * never asking about a slot whose value was already forced.
 */
export function firstDivergentSlot(variants: readonly { targets: number[] }[]): number {
  if (variants.length < 2) return -1
  const longest = Math.max(...variants.map((variant) => variant.targets.length))
  for (let slot = 0; slot < longest; slot++) {
    const values = new Set(variants.map((variant) => slotValue(variant.targets, slot)))
    if (values.size > 1) return slot
  }
  return -1
}

/** The distinct values the given variants offer for one slot, in first-seen order. */
export function slotOptions(
  variants: readonly { targets: number[] }[],
  slot: number
): number[] {
  const seen = new Set<number>()
  const out: number[] = []
  for (const variant of variants) {
    const value = slotValue(variant.targets, slot)
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

/** "Yours" / "Rival's" — used to label a target option unambiguously. */
export function sideLabel(owner: PlayerId, human: PlayerId): string {
  return owner === human ? 'yours' : "Rival's"
}
