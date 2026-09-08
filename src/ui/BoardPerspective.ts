import { createContext, useContext } from 'react'
import type { PlayerId } from '../engine/types'
export const BoardPerspective = createContext<PlayerId>(0)
export function useBoardPerspective(): { HUMAN: PlayerId; AI: PlayerId } {
  const HUMAN = useContext(BoardPerspective)
  return { HUMAN, AI: HUMAN === 0 ? 1 : 0 }
}
