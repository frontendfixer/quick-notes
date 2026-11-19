import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { createAuth } from '../apps/api/auth'
import { db } from '../apps/api/db'
import { folders, notes } from '../apps/api/schema'
import { emptyNote } from '../packages/contracts'

const origin = process.env.APP_ORIGIN ?? 'http://localhost:3000'
const screenshots = process.env.QUICK_NOTES_SCREENSHOTS
if (screenshots) await mkdir(screenshots, { recursive: true })
const password = 'quick-notes-query-cache-test-password'

async function createAccount() {
  const email = crypto.randomUUID() + '@example.test'
  const { user } = await createAuth(true).api.signUpEmail({
    body: { name: email, email, password },
  })
  return { email, id: user.id }
}

const first = await createAccount()
const second = await createAccount()
const folderId = crypto.randomUUID()
await db.insert(folders).values({ id: folderId, owner: first.id, name: 'Field notes' })
const fixtures = Array.from({ length: 52 }, (_, index) => ({
  ...emptyNote(),
  id: crypto.randomUUID(),
  owner: first.id,
  title: 'Cache fixture ' + String(index + 1).padStart(2, '0'),
  searchText: '',
  revision: 1,
  updatedAt: new Date(1700000000000 - index * 1000),
}))
await db.insert(notes).values(fixtures)

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_BIN ?? '/usr/bin/chromium',
})
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
page.setDefaultTimeout(15000)
const errors: string[] = []
page.on('pageerror', (error) => errors.push(error.message))
const button = (name: string) => page.getByRole('button', { name, exact: true })
const screenshot = (name: string) =>
  screenshots && page.screenshot({ path: join(screenshots, name + '.png'), animations: 'disabled' })

async function signIn(email: string) {
  await page.getByRole('textbox', { name: 'Email' }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await button('Sign in').click()
  await button('Create menu').waitFor()
}
async function trash() {
  await button('Account options').click()
  await page.getByRole('menuitem', { name: 'Trash', exact: true }).click()
}
async function signOut() {
  await button('Account options').click()
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click()
  await page
    .getByRole('alertdialog', { name: 'Sign out?' })
    .getByRole('button', { name: 'Sign out', exact: true })
    .click()
  await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor()
}
const focus = () => page.evaluate(() => window.dispatchEvent(new Event('focus')))
const listRoute = '**/api/notes?*'
async function hold(path: string, match: (url: URL) => boolean, failure = false) {
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const handled = Promise.withResolvers<void>()
  let intercepted = false
  const handler: Parameters<typeof page.route>[1] = async (route) => {
    if (intercepted || !match(new URL(route.request().url()))) return route.fallback()
    intercepted = true
    started.resolve()
    await release.promise
    try {
      if (failure) await route.fulfill({ status: 503 })
      else await route.continue()
      handled.resolve()
    } catch (error) {
      handled.reject(error)
    }
  }
  await page.route(path, handler)
  return {
    async started() {
      await Promise.race([
        started.promise,
        Bun.sleep(15000).then(() => {
          throw new Error('Expected request did not start: ' + path)
        }),
      ])
    },
    async finish() {
      release.resolve()
      await handled.promise
      await page.unroute(path, handler)
    },
  }
}
const homeList = (url: URL) =>
  url.searchParams.get('view') === 'active' && !url.searchParams.has('cursor')
const trashList = (url: URL) => url.searchParams.get('view') === 'trash'
const refreshList = () => button('Refresh notes list')
const loading = () => page.getByText('Loading notes…', { exact: true })
const emptyTrash = () => page.getByRole('heading', { name: 'Trash is empty', exact: true })
try {
  await page.goto(origin)
  await signIn(first.email)
  await button('Cache fixture 01').waitFor()
  await page.getByText('Signed in', { exact: true }).waitFor({ state: 'hidden' })
  await page.getByText('Field notes', { exact: true }).first().waitFor()

  const folderRefresh = await hold('**/api/folders', () => true)
  const background = await hold(listRoute, homeList)
  const noteEdit = await page.request.put(origin + '/api/notes/' + fixtures[0].id, {
    headers: { Origin: origin },
    data: {
      mutationId: crypto.randomUUID(),
      expectedRevision: 1,
      fields: { ...emptyNote(), title: 'Fresh result from server' },
    },
  })
  assert.equal(noteEdit.status(), 200)
  const folderEdit = await page.request.patch(origin + '/api/folders/' + folderId, {
    headers: { Origin: origin },
    data: { name: 'Updated field notes' },
  })
  assert.equal(folderEdit.status(), 200)
  await focus()
  await Promise.all([folderRefresh.started(), background.started()])
  assert.equal(await button('Cache fixture 01').isVisible(), true)
  assert.equal(await page.getByText('Field notes', { exact: true }).first().isVisible(), true)
  assert.equal(await refreshList().isEnabled(), true)
  assert.equal(await loading().count(), 0)
  assert.equal(await button('Load more').isVisible(), true)
  assert.equal(await button('Loading more…').count(), 0)
  await screenshot('01-list-during-background-refresh')
  await Promise.all([folderRefresh.finish(), background.finish()])
  await button('Fresh result from server').waitFor()
  await page.getByText('Updated field notes', { exact: true }).first().waitFor()
  await screenshot('02-list-after-background-refresh')

  const more = await hold(listRoute, (url) => url.searchParams.has('cursor'))
  await button('Load more').click()
  await more.started()
  await button('Loading more…').waitFor()
  assert.equal(await button('Fresh result from server').isVisible(), true)
  await screenshot('03-explicit-pagination')
  await more.finish()
  await button('Cache fixture 52').waitFor()
  const moreRefresh = await hold(listRoute, homeList)
  await focus()
  await moreRefresh.started()
  assert.equal(await button('Cache fixture 52').count(), 1)
  await moreRefresh.finish()

  const warm = page.waitForResponse((response) => trashList(new URL(response.url())))
  await trash()
  await warm
  await emptyTrash().waitFor()
  await button('Back to home').click()
  await button('Fresh result from server').waitFor()
  const staleTrash = await hold(listRoute, trashList, true)
  await trash()
  await staleTrash.started()
  assert.equal(await emptyTrash().isVisible(), true)
  assert.equal(await loading().count(), 0)
  assert.equal(await button('Fresh result from server').count(), 0)
  await screenshot('04-cached-empty-trash')
  await staleTrash.finish()

  const backgroundFailure = await hold(listRoute, trashList, true)
  await focus()
  await backgroundFailure.started()
  const failed = page.waitForResponse(
    (response) => response.status() === 503 && trashList(new URL(response.url())),
  )
  await backgroundFailure.finish()
  await failed
  assert.equal(await emptyTrash().isVisible(), true)
  assert.equal(await page.getByText('Could not refresh the notes list.').count(), 0)
  assert.equal(await page.getByText('Refresh paused. Reconnect or try again.').count(), 0)
  const recovery = await hold(listRoute, trashList)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await recovery.started()
  assert.equal(await emptyTrash().isVisible(), true)
  await recovery.finish()

  const homeReturned = page.waitForResponse((response) => homeList(new URL(response.url())))
  await button('Back to home').click()
  await homeReturned
  await button('Fresh result from server').waitFor()
  const manual = await hold(listRoute, homeList, true)
  await refreshList().click()
  await manual.started()
  assert.equal(await refreshList().isDisabled(), true)
  assert.equal(await button('Fresh result from server').isVisible(), true)
  await manual.finish()
  await page.getByText('Could not refresh the notes list.').first().waitFor()
  await button('Retry loading notes').click()
  await page.getByText('Could not refresh the notes list.').first().waitFor({ state: 'hidden' })
  assert.equal(await button('Cache fixture 52').count(), 1)

  const noteRoute = '**/api/notes/' + fixtures[0].id
  const openingNote = await hold(noteRoute, () => true)
  await button('Fresh result from server').click()
  await openingNote.started()
  await page.getByText('Opening note…', { exact: true }).waitFor()
  await openingNote.finish()
  await page.getByRole('textbox', { name: 'Note title' }).waitFor()
  const noteRefresh = await hold(noteRoute, () => true)
  await focus()
  await noteRefresh.started()
  assert.equal(await button('Refresh note').isEnabled(), true)
  assert.equal(await page.getByText('Opening note…', { exact: true }).count(), 0)
  await noteRefresh.finish()
  await button('Back to notes').click()

  await signOut()
  const uncached = await hold(listRoute, homeList)
  await signIn(second.email)
  await uncached.started()
  await loading().waitFor()
  await screenshot('05-first-load-for-another-account')
  assert.equal(await button('Fresh result from server').count(), 0)
  assert.equal(await page.getByText('Updated field notes', { exact: true }).count(), 0)
  await uncached.finish()
  assert.deepEqual(errors, [])
  console.log(
    'Query cache browser checks passed for quiet refresh, folders, pagination, cached views, manual errors and account isolation.',
  )
} finally {
  await browser.close()
}
