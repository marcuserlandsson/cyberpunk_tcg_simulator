import { createAgent } from './agents'
import { legalActions } from '../engine/legal'
import type { AiRequest, AiResponse } from './workerProtocol'

declare const self: Worker
self.onmessage = (event: MessageEvent<AiRequest>) => {
  try {
    const { db, state, seed, difficulty } = event.data
    const agent = createAgent(difficulty, seed, { onProgress: action => self.postMessage({ type: 'progress', action } satisfies AiResponse) })
    const action = agent.chooseAction(db, state, legalActions(db, state))
    self.postMessage({ type: 'action', action } satisfies AiResponse)
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) } satisfies AiResponse)
  }
}
