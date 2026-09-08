import { collectionFileSchema } from '../collection/format'
import { canEditCollection, setCollectionAccess } from './collectionAccess'
import { PENDING_KEY, readPendingBuffer, setReadOnlyCollection } from './collection'
import { initCollectionSync } from './collectionSync'

// Web Locks are origin-scoped and released by the browser on tab close/crash.
// Only the holder may clear/write the shared pending buffer or sync it.
export function startCollectionSession(): () => void {
  let disposed = false
  const abort = new AbortController()
  let release: (() => void) | undefined
  setCollectionAccess('waiting')
  async function refreshReader(): Promise<void> {
    if (disposed || canEditCollection()) return
    try {
      const response = await fetch('/__collection')
      const file = collectionFileSchema.safeParse(await response.json())
      if (disposed || canEditCollection()) return
      const pending = readPendingBuffer()
      if (pending) setReadOnlyCollection(pending.counts)
      else if (file.success) setReadOnlyCollection(file.data.counts)
    } catch { /* The writer owns recovery; this tab never writes. */ }
  }
  const onStorage = (event: StorageEvent): void => {
    if (event.key === PENDING_KEY || event.key === null) void refreshReader()
  }
  window.addEventListener('storage', onStorage)
  void refreshReader()
  if (!navigator.locks) {
    setCollectionAccess('unsupported')
  } else {
    void navigator.locks.request('ctcg:collection:writer', { signal: abort.signal }, async () => {
      if (disposed) return
      const held = new Promise<void>((resolve) => { release = resolve })
      setCollectionAccess('writer')
      await initCollectionSync()
      await held
    }).catch(() => {
      if (!disposed) setCollectionAccess('unsupported')
    })
  }
  return () => {
    disposed = true
    window.removeEventListener('storage', onStorage)
    setCollectionAccess('waiting')
    abort.abort()
    release?.()
  }
}
