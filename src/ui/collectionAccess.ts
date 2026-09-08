import { useSyncExternalStore } from 'react'

export type CollectionAccess = 'writer' | 'waiting' | 'unsupported'
let access: CollectionAccess = 'writer'
const listeners = new Set<() => void>()
export const canEditCollection = (): boolean => access === 'writer'
export function setCollectionAccess(next: CollectionAccess): void {
  access = next
  for (const listener of listeners) listener()
}
export function useCollectionAccess(): CollectionAccess {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    () => access,
  )
}
