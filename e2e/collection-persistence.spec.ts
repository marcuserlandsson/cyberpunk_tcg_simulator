import { test, expect } from '@playwright/test'

test('collection endpoint persists counts and exposes background backup status', async ({ request }) => {
  const before = await request.get('/__collection')
  expect(before.ok()).toBe(true)
  const file = await before.json()
  const counts = { ...file.counts, 'test/preview': 7 }
  const saved = await request.put('/__collection', { data: { baseRevision: file.revision, counts } })
  expect(saved.ok()).toBe(true)
  const after = await (await request.get('/__collection')).json()
  expect(after.counts).toEqual(counts)
  expect(after.revision).toBe(file.revision + 1)
  const status = await (await request.get('/__collection/status')).json()
  expect(status.git.status).toBe('skipped')
  expect(status.git.detail).toContain('disabled')
})
