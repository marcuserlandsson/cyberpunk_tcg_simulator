import type { Printing } from './printings'

export interface ArtworkGroup {
  id: string
  cardId: string
  printings: Printing[]
}

/** Only reviewed illustration identities contribute to the artwork goal. */
export function artworkGroups(printings: Printing[]): ArtworkGroup[] {
  const groups = new Map<string, ArtworkGroup>()
  for (const printing of printings) {
    if (!printing.artworkId) continue
    const group = groups.get(printing.artworkId) ?? { id: printing.artworkId, cardId: printing.cardId, printings: [] }
    group.printings.push(printing)
    groups.set(group.id, group)
  }
  return [...groups.values()]
}

export function ownedArtworkIds(printings: Printing[], counts: Record<string, number>): Set<string> {
  return new Set(printings.filter(p => p.artworkId && (counts[p.key] ?? 0) > 0).map(p => p.artworkId!))
}

export function missingArtworks(printings: Printing[], counts: Record<string, number>): ArtworkGroup[] {
  const owned = ownedArtworkIds(printings, counts)
  return artworkGroups(printings).filter(group => !owned.has(group.id))
}

/** Reserve 100% for actual completion; rounding 99.5% must not imply completion. */
export function completionPercentage(owned: number, target: number): number {
  return target === 0 ? 0 : owned >= target ? 100 : Math.min(99, Math.floor(owned / target * 100))
}
