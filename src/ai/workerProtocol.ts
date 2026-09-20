import type { AiDifficulty } from './agents'
import type { Action, CardDb, GameState } from '../engine/types'

export interface AiRequest { db: CardDb; state: GameState; seed: number; difficulty: AiDifficulty }
export type AiResponse = { type: 'action'; action: Action } | { type: 'progress'; action: Action } | { type: 'error'; message: string }
export type AiWorker = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror'>
