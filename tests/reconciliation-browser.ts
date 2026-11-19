import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { createAuth } from '../apps/api/auth'
import type { Draft } from '../apps/web/src/storage'
import type { Note } from '../packages/contracts'

const origin = process.env.APP_ORIGIN ?? 'http://localhost:3000'
const password = 'quick-notes-reconciliation-test-password'
const email = crypto.randomUUID() + '@example.test'
await createAuth(true).api.signUpEmail({ body: { name: email, email, password } })

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_BIN ?? '/usr/bin/chromium',
})
const context = await browser.newContext()
const page = await context.newPage()
page.setDefaultTimeout(15000)
const errors: string[] = []
page.on('pageerror', (error) => errors.push(error.message))
const title = page.getByRole('textbox', { name: 'Note title' })
const saved = (state: string) => page.locator('[data-save-state="' + state + '"]').waitFor()
const button = (name: string) => page.getByRole('button', { name, exact: true })
const noteId = () => {
  const id = new URL(page.url()).searchParams.get('note')
  assert.ok(id)
  return id
}
async function create(name: string) {
  await button('Create menu').click()
  await page.getByRole('menuitem', { name: 'Create Note', exact: true }).click()
  await title.fill(name)
  await saved('Saved on device')
  return noteId()
}
async function trash() {
  await button('Move to trash').click()
  await page
    .getByRole('alertdialog', { name: 'Move note to Trash?' })
    .getByRole('button', { name: 'Move to Trash', exact: true })
    .click()
  await page.waitForURL((url) => !url.searchParams.has('note'))
  await page.locator('.note-title').waitFor({ state: 'hidden' })
}
async function openTrash() {
  await button('Account options').click()
  await page.getByRole('menuitem', { name: 'Trash', exact: true }).click()
}
async function purge() {
  await button('Delete permanently').click()
  await page
    .getByRole('alertdialog', { name: 'Delete note permanently?' })
    .getByRole('button', { name: 'Delete permanently', exact: true })
    .click()
  await page.waitForURL((url) => !url.searchParams.has('note'))
  await page.locator('.note-title').waitFor({ state: 'hidden' })
}
function getNote(id: string) {
  return page.request.get(origin + '/api/notes/' + id)
}
async function setRemoteTrash(id: string, deleted: boolean) {
  const { revision, updatedAt: _updatedAt, id: _id, ...fields } = await (await getNote(id)).json()
  const response = await page.request.put(origin + '/api/notes/' + id, {
    headers: { Origin: origin },
    data: {
      mutationId: crypto.randomUUID(),
      expectedRevision: revision,
      fields: { ...fields, deleted },
    },
  })
  assert.equal(response.status(), 200)
  return revision + 1
}
async function remotePurge(id: string, revision: number) {
  const response = await page.request.delete(origin + '/api/notes/' + id, {
    headers: { Origin: origin, 'If-Match': '"' + revision + '"' },
  })
  assert.equal(response.status(), 204)
}
async function waitLocal(id: string, expected: [boolean, boolean, boolean, boolean]) {
  const deadline = Date.now() + 15000
  let actual: boolean[]
  do {
    actual = await page.evaluate(async (id) => {
      const opening = indexedDB.open('quick-notes')
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        opening.onsuccess = () => resolve(opening.result)
        opening.onerror = () => reject(opening.error)
      })
      try {
        const tx = db.transaction(['drafts', 'snapshots'])
        const read = <T>(store: string) =>
          new Promise<T[]>((resolve, reject) => {
            const request = tx.objectStore(store).getAll()
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
          })
        const [drafts, snapshots] = await Promise.all([
          read<Draft>('drafts'),
          read<{ note: Note }>('snapshots'),
        ])
        const draft = drafts.find((value) => value.id === id)
        const snapshot = snapshots.find((value) => value.note.id === id)
        return [
          Boolean(draft),
          Boolean(snapshot),
          Boolean(snapshot?.note.deleted),
          Boolean(draft?.conflict),
        ]
      } finally {
        db.close()
      }
    }, id)
    if (actual.every((value, index) => value === expected[index])) return
    await Bun.sleep(50)
  } while (Date.now() < deadline)
  assert.deepEqual(actual, expected, 'Unexpected IndexedDB state for ' + id)
}
try {
  await page.goto(origin)
  await page.getByRole('textbox', { name: 'Email' }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await button('Sign in').click()
  await button('Create menu').waitFor()
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) await page.reload()
  await button('Create menu').waitFor()
  await context.setOffline(true)
  console.log('Verifying offline Trash and permanent deletion')
  const local = await create('Local trash')
  await trash()
  await openTrash()
  await page.reload()
  await button('Local trash').click()
  await button('Restore').click()
  await saved('Saved on device')
  await trash()
  await button('Local trash').click()
  await purge()
  await waitLocal(local, [false, false, false, false])
  await context.setOffline(false)
  assert.equal((await getNote(local)).status(), 404)
  await button('Back to home').click()

  console.log('Verifying an ambiguous create across reload')
  const committed = Promise.withResolvers<string>()
  let firstCreate = true
  let originalMutation = ''
  const retries: string[] = []
  await page.route('**/api/notes/*', async (route) => {
    if (route.request().method() !== 'PUT') return route.continue()
    const mutation = route.request().postDataJSON()
    if (firstCreate) {
      firstCreate = false
      const response = await route.fetch()
      assert.equal(response.status(), 200)
      originalMutation = mutation.mutationId
      committed.resolve(new URL(route.request().url()).pathname.split('/').at(-1)!)
    } else retries.push(mutation.mutationId)
    await route.abort()
  })
  const ambiguous = await create('Ambiguous upload')
  assert.equal(
    await Promise.race([
      committed.promise,
      Bun.sleep(15000).then(() => {
        throw new Error('Create did not reach the server')
      }),
    ]),
    ambiguous,
  )
  await trash()
  await openTrash()
  await button('Ambiguous upload').click()
  await purge()
  await page.reload()
  await button('Create menu').waitFor()
  const replay = page.waitForRequest(
    (request) =>
      request.url().endsWith('/api/notes/' + ambiguous) &&
      request.method() === 'PUT' &&
      request.postDataJSON().expectedRevision === null,
  )
  await page.unroute('**/api/notes/*')
  await waitLocal(ambiguous, [false, false, false, false])
  assert.equal((await replay).postDataJSON().mutationId, originalMutation)
  assert.ok(retries.every((id) => id === originalMutation))
  assert.equal((await getNote(ambiguous)).status(), 404)
  await button('Back to home').click()

  console.log('Verifying a lost permanent-delete response')
  const deleted = await create('Lost delete response')
  await saved('Saved to server')
  await trash()
  await openTrash()
  await button('Lost delete response').click()
  await saved('Saved to server')
  const deleteRoute = '**/api/notes/' + deleted
  let deleteRequests = 0
  await page.route(deleteRoute, async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue()
    assert.equal((await route.fetch()).status(), 204)
    deleteRequests++
    if (deleteRequests === 1) await route.abort()
    else await route.fulfill({ status: 204 })
  })
  await purge()
  await waitLocal(deleted, [false, false, false, false])
  assert.ok(deleteRequests >= 2)
  assert.equal((await getNote(deleted)).status(), 404)
  await page.unroute(deleteRoute)
  await button('Back to home').click()

  console.log('Verifying a concurrent restore blocks permanent deletion')
  const restored = await create('Restored on another device')
  await saved('Saved to server')
  await trash()
  await openTrash()
  await button('Restored on another device').click()
  await saved('Saved to server')
  const restoreRoute = '**/api/notes/' + restored
  await page.route(restoreRoute, async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue()
    await setRemoteTrash(restored, false)
    const response = await route.fetch()
    assert.equal(response.status(), 409)
    await route.fulfill({ response })
  })
  await purge()
  await waitLocal(restored, [true, true, false, true])
  const restoredNote = await getNote(restored)
  assert.equal(restoredNote.status(), 200)
  assert.equal((await restoredNote.json()).deleted, false)
  await page.unroute(restoreRoute)
  await button('Back to home').click()

  console.log('Verifying cross-device cache updates')
  const cached = await create('Remote trash and purge')
  await saved('Saved to server')
  await button('Back to notes').click()
  const trashedRevision = await setRemoteTrash(cached, true)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await waitLocal(cached, [false, true, true, false])
  await remotePurge(cached, trashedRevision)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await waitLocal(cached, [false, false, false, false])

  console.log('Verifying recovery of edits after remote permanent deletion')
  const conflict = await create('Recover after remote purge')
  await saved('Saved to server')
  await context.setOffline(true)
  await title.fill('Keep my unsynced edits')
  await saved('Saved on device')
  const conflictRevision = await setRemoteTrash(conflict, true)
  await remotePurge(conflict, conflictRevision)
  await context.setOffline(false)
  await waitLocal(conflict, [true, false, false, true])
  assert.equal(await title.inputValue(), 'Keep my unsynced edits')
  assert.equal(await button('Replace synced version').isEnabled(), false)
  await button('Keep both').click()
  await waitLocal(conflict, [false, false, false, false])
  assert.equal((await getNote(conflict)).status(), 404)
  assert.deepEqual(errors, [])
  console.log('All Chromium reconciliation scenarios passed.')
} finally {
  await browser.close()
}
