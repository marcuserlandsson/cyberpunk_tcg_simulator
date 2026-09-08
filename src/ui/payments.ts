import type { Action } from '../engine/types'

export function actionPayment(action: Action): number[] | null {
  if (action.type === 'playCard' || action.type === 'callLegend') return action.payment
  if (action.type === 'react' && (action.reaction.type === 'quick' || action.reaction.type === 'callLegend')) return action.reaction.payment
  return null
}

export function withPayment(action: Action, payment: number[]): Action {
  if (action.type === 'playCard' || action.type === 'callLegend') return { ...action, payment }
  if (action.type === 'react' && (action.reaction.type === 'quick' || action.reaction.type === 'callLegend')) return { ...action, reaction: { ...action.reaction, payment } }
  return action
}
