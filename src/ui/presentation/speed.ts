// The player's pacing speed, remembered per browser. Storage can be missing
// or throw (private windows, blocked site data), so every access is guarded
// and falls back to 'normal'.

export type Speed = 'slow' | 'normal' | 'fast' | 'instant'

export const SPEEDS: Speed[] = ['slow', 'normal', 'fast', 'instant']
export const SPEED_FACTOR: Record<Speed, number> = { slow: 1.5, normal: 1, fast: 0.5, instant: 0 }

const KEY = 'ctcg.pacingSpeed'

export function loadSpeed(): Speed {
  try {
    const stored = localStorage.getItem(KEY)
    return SPEEDS.includes(stored as Speed) ? (stored as Speed) : 'normal'
  } catch {
    return 'normal'
  }
}

export function saveSpeed(speed: Speed): void {
  try {
    localStorage.setItem(KEY, speed)
  } catch {
    // Remembering the speed is a convenience; failing to is harmless.
  }
}
