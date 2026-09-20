import type { CardDb } from './types'

/** Bump when engine behavior or the AI policy changes. */
export const ENGINE_VERSION = 'planning-ai-2026-09-16-v4'
export const RULES_VERSION = '2026-09-01T19:28:10.028Z'

/** Reproducibility fingerprint, not a security checksum. */
export function cardDataFingerprint(db: CardDb): string {
  const text = JSON.stringify(Object.entries(db).sort(([a], [b]) => a.localeCompare(b)))
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  return (hash >>> 0).toString(16).padStart(8, '0')
}
