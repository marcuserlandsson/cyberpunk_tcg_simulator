// The proof that the whole chain works: a card added in the browser reaches
// data/collection.json (here, a scratch file, see playwright.config.ts's
// webServer.env.CTCG_COLLECTION_FILE) and comes back after browser storage is
// wiped — which is only possible if it was read from disk.
import { test, expect } from '@playwright/test'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'

const SCRATCH = 'test-results/e2e-collection.json'
const SCRATCH_BACKUP = SCRATCH.replace(/\.json$/, '.backup.json')
// The printing the quick-add below resolves to. Asserting on it from Node is
// what makes "the card reached DISK" a real claim instead of an inference
// from a status class -- and it is the only thing in this suite that can
// notice if the server ignored CTCG_COLLECTION_FILE and wrote the owner's
// real data/collection.json instead.
const MANTIS_KEY = 'welcometonightcitybeta/β025'

test.beforeEach(async () => {
  await rm(SCRATCH, { force: true })
  // `recursive` because the failure-path test below turns the backup path
  // into a directory on purpose.
  await rm(SCRATCH_BACKUP, { recursive: true, force: true })
})

// Leave nothing behind for other specs (or a later `npx playwright test -g`)
// to trip over — the backup-path directory is this file's own contrivance.
test.afterEach(async () => {
  await rm(SCRATCH_BACKUP, { recursive: true, force: true })
})

test('a quick-added card survives clearing browser storage', async ({ page }) => {
  await page.goto('/?aiDelay=0')
  await page.getByTestId('tab-collection').click()

  await page.getByTestId('quick-add-set').selectOption('welcometonightcitybeta')
  await page.getByTestId('quick-add-input').fill('mantis')
  await page.getByTestId('quick-add-input').press('Enter')
  await expect(page.getByTestId('collection-count-mantis-blades')).toContainText('1/3')

  // Wait for the debounced flush to reach disk. Asserted against the
  // "--idle" state class rather than text containing /saved/i: the
  // "unsaved" state's own text ("N changes not yet saved to disk") also
  // contains the substring "saved", so a text-only regex would already be
  // satisfied the instant the card is added — before any PUT has even been
  // attempted — and would never actually fail if the save were broken.
  await expect(page.getByTestId('sync-status')).toHaveClass(/collection-header__sync--idle/, {
    timeout: 10_000,
  })

  // Read the scratch file from Node. Two things this pins that the browser
  // side cannot: that the count actually landed in a FILE, and that it landed
  // in THIS file -- if resolveCollectionPath ever stopped honoring
  // CTCG_COLLECTION_FILE, or a stale server on this port were reused, the
  // write would go to the owner's real collection and every other assertion
  // in this test would still pass.
  const onDisk = JSON.parse(await readFile(SCRATCH, 'utf8')) as {
    version: number
    revision: number
    counts: Record<string, number>
  }
  expect(onDisk.version).toBe(1)
  expect(onDisk.revision).toBeGreaterThan(0)
  expect(onDisk.counts[MANTIS_KEY]).toBe(1)

  // Wipe every browser-side copy (the pending buffer AND the last-confirmed
  // snapshot cache both live in localStorage — see src/ui/collection.ts):
  // only the file can supply the count now.
  await page.evaluate(() => window.localStorage.clear())
  await page.reload()
  await page.getByTestId('tab-collection').click()
  await expect(page.getByTestId('collection-count-mantis-blades')).toContainText('1/3')
})

// The failure path, which is the whole reason the buffer exists: with saving
// broken, entered cards must survive a reload rather than being discarded.
test('cards entered while saving is broken survive a reload', async ({ page }) => {
  // Saving is broken at BOTH layers here, and the second one is not
  // redundancy for its own sake:
  //
  //  * `page.route` aborts the PUT the debounced flush issues — but Chromium
  //    does not route `keepalive` fetches issued during unload, and the
  //    beforeunload flush uses exactly that. It escapes the route entirely
  //    and reaches the server, so a route-only setup does not actually have
  //    saving broken across the reload this test is about;
  //  * so the server is made to refuse the write too, by turning the backup
  //    path into a directory. `writeCollectionFile` propagates a non-ENOENT
  //    backup failure rather than overwriting a collection it could not back
  //    up first, which is a real failure mode on this machine (a sync client
  //    or antivirus holding collection.backup.json open) and yields a 500
  //    with the file untouched.
  //
  // The file has to exist for that to bite: with no file there is nothing to
  // back up, the ENOENT is correctly ignored, and the write proceeds.
  await writeFile(
    SCRATCH,
    JSON.stringify({ version: 1, revision: 1, savedAt: new Date().toISOString(), counts: {} }),
    'utf8'
  )
  await mkdir(SCRATCH_BACKUP, { recursive: true })

  await page.goto('/?aiDelay=0')
  // Let the initial GET through, then break every write.
  await page.route('**/__collection', async (route) => {
    if (route.request().method() === 'PUT') return route.abort()
    return route.continue()
  })

  await page.getByTestId('tab-collection').click()
  await page.getByTestId('quick-add-set').selectOption('welcometonightcitybeta')
  await page.getByTestId('quick-add-input').fill('mantis')
  await page.getByTestId('quick-add-input').press('Enter')

  await expect(page.getByTestId('sync-status')).toContainText('not yet saved', { timeout: 10_000 })
  await expect(page.getByTestId('sync-retry')).toBeVisible()

  // The card is still there after a reload, and still reported as unsaved —
  // nothing was silently dropped and nothing was silently claimed as saved.
  await page.reload()
  await page.getByTestId('tab-collection').click()
  await expect(page.getByTestId('collection-count-mantis-blades')).toContainText('1/3')
  await expect(page.getByTestId('sync-status')).toContainText('not yet saved')

  // And the claim is true: the file really is untouched. Without this, a save
  // that quietly succeeded (as the beforeunload keepalive PUT does when only
  // page.route is used) would leave every assertion above still passing.
  const onDisk = JSON.parse(await readFile(SCRATCH, 'utf8')) as {
    revision: number
    counts: Record<string, number>
  }
  expect(onDisk.revision).toBe(1)
  expect(onDisk.counts).toEqual({})
})
