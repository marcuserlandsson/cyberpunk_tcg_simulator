/** Two-sided 95% Wilson score interval; NIST handbook §7.2.4.1. */
export function wilson(wins: number, games: number): [number, number] | null {
  if (games <= 0) return null
  const z = 1.959963984540054, p = wins / games, d = 1 + z * z / games
  const center = (p + z * z / (2 * games)) / d
  const radius = z * Math.sqrt(p * (1 - p) / games + z * z / (4 * games * games)) / d
  return [Math.max(0, center - radius), Math.min(1, center + radius)]
}

export function intervalLabel(wins: number, games: number): string {
  const interval = wilson(wins, games)
  return interval ? `${(interval[0] * 100).toFixed(1)}–${(interval[1] * 100).toFixed(1)}%` : 'No sample'
}
