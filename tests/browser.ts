import assert from 'node:assert/strict'
import { chromium, type Page } from 'playwright-core'
import { createAuth } from '../apps/api/auth'

const origin = process.env.APP_ORIGIN ?? 'http://localhost:3000'
const password = 'quick-notes-browser-test-password!'
const email = crypto.randomUUID() + '@example.test'
await createAuth(true).api.signUpEmail({ body: { name: email, email, password } })
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_BIN ?? '/usr/bin/chromium',
})
const context = await browser.newContext()
const secondContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
})
const errors: string[] = []
await context.addInitScript(() => {
  const transaction = IDBDatabase.prototype.transaction
  IDBDatabase.prototype.transaction = function (stores, mode, options) {
    if (
      mode === 'readwrite' &&
      stores === 'drafts' &&
      document.documentElement?.hasAttribute('data-test-quota')
    ) {
      throw new DOMException('Simulated storage quota error', 'QuotaExceededError')
    }
    return transaction.call(this, stores, mode, options)
  }
})
const page = await context.newPage()
page.setDefaultTimeout(12000)
page.on('pageerror', (error) => errors.push(error.message))

async function createFromMenu(page: Page, kind: 'Note' | 'Folder') {
  await page.getByRole('button', { name: 'Create menu', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Create ' + kind, exact: true }).click()
}
async function signIn(tab: Page) {
  await tab.goto(origin)
  await tab.getByRole('textbox', { name: 'Email' }).fill(email)
  const passwordInput = tab.getByLabel('Password', { exact: true })
  await passwordInput.fill(password)
  await tab.getByRole('button', { name: 'Show password' }).click()
  assert.equal(await passwordInput.getAttribute('type'), 'text')
  assert.equal(await passwordInput.inputValue(), password)
  await tab.getByRole('button', { name: 'Hide password' }).click()
  assert.equal(await passwordInput.getAttribute('type'), 'password')
  await tab.getByRole('button', { name: 'Sign in', exact: true }).click()
  await tab.getByRole('button', { name: 'Create menu', exact: true }).waitFor()
}
async function status(tab: Page, message: string) {
  await tab.locator(`[data-save-state="${message}"]`).waitFor({ timeout: 15000 })
}
async function readDraftTitles(tab: Page) {
  return tab.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const request = indexedDB.open('quick-notes')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const drafts = db.transaction('drafts').objectStore('drafts').getAll()
          drafts.onsuccess = () => {
            resolve(drafts.result.map((draft) => draft.fields.title).sort())
            db.close()
          }
          drafts.onerror = () => reject(drafts.error)
        }
      }),
  )
}

async function open(tab: Page, title: string) {
  await tab.getByRole('button', { name: new RegExp(title) }).click()
  await tab.waitForFunction(
    (expected) => document.querySelector<HTMLInputElement>('.note-title')?.value === expected,
    title,
  )
}
try {
  await signIn(page)
  assert.equal(await page.getByRole('button', { name: 'All notes', exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Archive', exact: true }).count(), 0)
  await page.waitForFunction(
    async () => (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated',
  )
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) await page.reload()
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  console.log('Service worker active')
  await createFromMenu(page, 'Note')
  const title = page.getByRole('textbox', { name: 'Note title' })
  const body = page.getByRole('textbox', { name: 'Note content' })
  await title.fill('   ')
  await body.fill('   ')
  await page.getByRole('button', { name: 'Back to notes' }).click()
  await createFromMenu(page, 'Note')
  await title.waitFor()
  assert.equal(await title.inputValue(), '')
  assert.equal(await page.getByRole('button', { name: 'Untitled', exact: true }).count(), 0)
  const emptyBackup = await (await page.request.get(origin + '/api/export')).json()
  assert.deepEqual(emptyBackup.notes, [])
  await body.fill('First entry')
  await status(page, 'Saved to server')
  await title.fill('Travel log')
  await body.press('End')
  await body.press('Enter')
  await page.getByRole('button', { name: 'Open formatting' }).click()
  await page.getByRole('button', { name: 'Checklist' }).click()
  await page.getByRole('button', { name: 'More formatting' }).click()
  const overflow = page.getByRole('group', { name: 'More formatting tools' })
  await overflow.getByRole('button', { name: 'Link' }).waitFor()
  await page.waitForFunction(() => {
    const rail = document.getElementById('note-format-tools')?.getBoundingClientRect()
    const column = document.getElementById('note-format-overflow')?.getBoundingClientRect()
    return rail && column && column.bottom < rail.top
  })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  assert.equal(
    await page.getByRole('button', { name: 'Open formatting' }).getAttribute('aria-expanded'),
    'false',
  )
  await body.pressSequentially('Pack charger')
  await page.getByRole('checkbox').check()
  await status(page, 'Saved to server')
  console.log('Rich text saved online')
  const row = page.getByRole('button', { name: 'Travel log', exact: true })
  await page.getByRole('button', { name: 'Back to notes', exact: true }).click()
  await title.waitFor({ state: 'hidden' })
  await page.waitForFunction(
    () => document.activeElement?.getAttribute('aria-label') === 'Travel log',
  )
  await row.click()
  await title.waitFor()
  assert.equal(await title.inputValue(), 'Travel log')
  await row.evaluate((element) => {
    element.setAttribute('data-test-original', '')
  })
  await body.evaluate((element) => {
    element.setAttribute('data-test-original', '')
  })
  await body.press('End')
  const topbar = page.locator('.note-topbar')
  const startHeight = (await topbar.boundingBox())?.height
  await body.pressSequentially(' steadily', { delay: 100 })
  assert.equal(await page.locator('.note-row[data-test-original]').count(), 1)
  assert.equal(await page.locator('.tiptap[data-test-original]').count(), 1)
  assert.equal(await body.evaluate((element) => document.activeElement === element), true)
  assert.match(
    (await page.locator('.save-chip').textContent()) ?? '',
    /^(Saving on device…|Saved on device)$/,
  )
  assert.equal((await topbar.boundingBox())?.height, startHeight)
  await status(page, 'Saved to server')
  assert.equal(await page.locator('.note-row[data-test-original]').count(), 1)
  assert.equal(await page.locator('.tiptap[data-test-original]').count(), 1)
  assert.equal(await body.evaluate((element) => document.activeElement === element), true)
  console.log('Autosave kept editor focus, note row identity, and toolbar height stable')

  await page.getByRole('searchbox').fill('charger')
  await page.getByRole('button', { name: /Travel log/ }).waitFor()
  await page.getByRole('searchbox').clear()

  let droppedMutation: string | undefined
  let retried = false
  let markCommitted!: () => void
  const serverCommitted = new Promise<void>((resolve) => {
    markCommitted = resolve
  })
  let releaseReply!: () => void
  const responseGate = new Promise<void>((resolve) => {
    releaseReply = resolve
  })
  await page.route('**/api/notes/*', async (route) => {
    if (route.request().method() !== 'PUT') return route.continue()
    const mutation = route.request().postDataJSON()
    if (!droppedMutation) {
      const committed = await route.fetch()
      assert.equal(committed.status(), 200)
      droppedMutation = mutation.mutationId
      markCommitted()
      await responseGate
      return route.abort()
    }
    if (mutation.mutationId === droppedMutation) retried = true
    return route.continue()
  })
  await body.pressSequentially('!')
  await Promise.race([
    serverCommitted,
    Bun.sleep(15000).then(() => {
      throw new Error('Initial upload did not reach the server')
    }),
  ])
  await title.fill('Travel log temporary')
  await status(page, 'Saved on device')
  releaseReply()
  await status(page, 'Saved to server')
  assert(retried)
  await page.unroute('**/api/notes/*')
  await title.fill('Travel log')
  await status(page, 'Saved to server')
  console.log('Lost acknowledgement retried without dropping newer edits')

  await page.evaluate(() => document.documentElement.setAttribute('data-test-quota', ''))
  await title.fill('Travel log unsaved')
  await status(page, 'Save failed')
  assert.equal(await title.inputValue(), 'Travel log unsaved')
  await page.evaluate(() => document.documentElement.removeAttribute('data-test-quota'))
  await page.getByRole('button', { name: 'Retry save' }).click()
  await status(page, 'Saved to server')
  await title.fill('Travel log')
  await status(page, 'Saved to server')
  console.log('Storage failure retained edits and recovered on retry')

  const readOnly = await context.newPage()
  await readOnly.goto(origin)
  await readOnly.getByText('Editing is available in one tab at a time.').waitFor()
  assert(await readOnly.getByRole('button', { name: 'Create menu', exact: true }).isDisabled())
  await readOnly.close()

  console.log('Secondary tab stayed read-only')
  await context.setOffline(true)
  await page.getByText('Offline · showing notes on this device').waitFor()
  await title.fill('Travel log local')
  await status(page, 'Saved on device')
  for (const name of ['Offline two', 'Offline three']) {
    await createFromMenu(page, 'Note')
    await page.waitForFunction(
      () => document.querySelector<HTMLInputElement>('.note-title')?.value === '',
    )
    await title.fill(name)
    await body.fill(name + ' contents')
    await status(page, 'Saved on device')
  }
  assert.deepEqual(await readDraftTitles(page), [
    'Offline three',
    'Offline two',
    'Travel log local',
  ])
  const offlineNoteUrl = page.url()
  assert.ok(new URL(offlineNoteUrl).searchParams.get('note'))
  await page.close()
  const restarted = await context.newPage()
  restarted.on('pageerror', (error) => errors.push(error.message))
  restarted.setDefaultTimeout(15000)
  await restarted.goto(offlineNoteUrl)
  const restoredTitle = restarted.getByRole('textbox', { name: 'Note title' })
  await restoredTitle.waitFor()
  assert.equal(await restoredTitle.inputValue(), 'Offline three')
  assert.deepEqual(await readDraftTitles(restarted), [
    'Offline three',
    'Offline two',
    'Travel log local',
  ])
  for (const name of ['Travel log local', 'Offline two', 'Offline three']) {
    await open(restarted, name)
    assert.equal(await restarted.getByRole('textbox', { name: 'Note title' }).inputValue(), name)
  }
  console.log('Recovered all three drafts offline')
  const phone = await secondContext.newPage()
  await signIn(phone)
  await open(phone, 'Travel log')
  assert(await phone.getByRole('checkbox').isChecked())
  await phone.getByRole('textbox', { name: 'Note title' }).fill('Travel log remote')
  await status(phone, 'Saved to server')
  await phone.getByRole('button', { name: 'Back to notes' }).click()
  await phone.getByRole('button', { name: /Travel log remote/ }).waitFor()

  console.log('Second device changed the same note')
  await context.setOffline(false)
  await open(restarted, 'Travel log local')
  await status(restarted, 'Conflict')
  await restarted.getByText('Compare with synced version').click()
  await restarted.getByText('Travel log remote', { exact: false }).last().waitFor()
  await restarted.getByRole('button', { name: 'Keep both' }).click()
  await status(restarted, 'Saved to server')
  const exported = await restarted.request.get(origin + '/api/export')
  const backup = await exported.json()
  assert.deepEqual(backup.notes.map((note: { title: string }) => note.title).sort(), [
    'Offline three',
    'Offline two',
    'Travel log local',
    'Travel log remote',
  ])
  await createFromMenu(restarted, 'Folder')
  const createFolderDialog = restarted.getByRole('dialog', { name: 'Create folder' })
  const folderName = createFolderDialog.getByRole('textbox', { name: 'Folder name' })
  await folderName.waitFor()
  assert.equal(await folderName.evaluate((input) => input === document.activeElement), true)
  await folderName.fill('Trips')
  await createFolderDialog.getByRole('button', { name: 'Create', exact: true }).click()
  await createFolderDialog.waitFor({ state: 'hidden' })
  const folderList = restarted.getByRole('region', { name: 'Folders' })
  const trips = folderList.getByRole('button', { name: 'Trips', exact: true })
  await trips.waitFor()
  assert.equal(await restarted.getByRole('button', { name: 'Back to home' }).count(), 0)
  await trips.click()
  await restarted.getByRole('heading', { name: 'Trips', exact: true }).waitFor()
  const tripsUrl = restarted.url()
  assert.ok(new URL(tripsUrl).searchParams.get('folder'))
  await restarted.reload()
  await restarted.getByRole('heading', { name: 'Trips', exact: true }).waitFor()
  await restarted.goBack()
  await trips.waitFor()
  await restarted.goForward()
  await restarted.getByRole('heading', { name: 'Trips', exact: true }).waitFor()
  await createFromMenu(restarted, 'Folder')
  await folderName.fill('Discard this folder')
  await restarted.keyboard.press('Escape')
  await createFolderDialog.waitFor({ state: 'hidden' })
  await restarted.getByRole('heading', { name: 'Trips', exact: true }).waitFor()
  await folderList.waitFor({ state: 'hidden' })
  await restarted.getByRole('button', { name: 'Back to home' }).click()
  await trips.waitFor()
  assert.equal(await trips.evaluate((tile) => tile === document.activeElement), true)
  await trips.click()
  for (const name of ['Tickets', 'Map']) {
    await createFromMenu(restarted, 'Note')
    await restarted.waitForFunction(
      () => document.querySelector<HTMLInputElement>('.note-title')?.value === '',
    )
    await restarted.getByRole('textbox', { name: 'Note title' }).fill(name)
    await status(restarted, 'Saved to server')
    await restarted.getByRole('button', { name, exact: true }).waitFor()
  }
  const mapUrl = new URL(restarted.url())
  assert.equal(mapUrl.searchParams.get('folder'), new URL(tripsUrl).searchParams.get('folder'))
  assert.ok(mapUrl.searchParams.get('note'))
  await restarted.reload()
  await restoredTitle.waitFor()
  assert.equal(await restoredTitle.inputValue(), 'Map')
  await restarted.getByRole('button', { name: 'Back to notes', exact: true }).click()
  const search = restarted.getByRole('searchbox', { name: 'Search notes' })
  await search.fill('Map')
  await restarted.waitForURL((url) => url.searchParams.get('q') === 'Map')
  await restarted.reload()
  await search.waitFor()
  assert.equal(await search.inputValue(), 'Map')
  await open(restarted, 'Map')
  await search.press('Escape')
  const move = restarted.getByRole('button', { name: 'Move note to folder', exact: true })
  await move.click()
  const destinations = restarted.getByRole('listbox', { name: 'Destination folder' })
  assert.equal(
    await destinations
      .getByRole('option', { name: 'Trips', exact: true })
      .getAttribute('aria-selected'),
    'true',
  )
  await destinations.getByRole('option', { name: 'No folder', exact: true }).click()
  assert.equal(await move.getAttribute('aria-expanded'), 'false')
  await status(restarted, 'Saved to server')
  await restarted.getByRole('button', { name: 'Map', exact: true }).waitFor({ state: 'hidden' })
  await restarted.getByRole('button', { name: 'Back to home' }).click()
  await restarted.getByRole('button', { name: 'Map', exact: true }).waitFor()
  assert.equal(await restarted.getByRole('button', { name: 'Tickets', exact: true }).count(), 0)
  await trips.click()
  await restarted.getByRole('button', { name: 'Tickets', exact: true }).waitFor()
  await restarted.getByRole('button', { name: 'Rename folder' }).click()
  await restarted.getByRole('textbox', { name: 'Folder name' }).fill('Travel')
  await restarted.getByRole('button', { name: 'Save', exact: true }).click()
  await restarted.getByRole('heading', { name: 'Travel', exact: true }).waitFor()
  await restarted.getByRole('button', { name: 'Delete folder', exact: true }).click()
  await restarted.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click()
  await restarted.getByRole('heading', { name: 'Travel', exact: true }).waitFor()
  await restarted.getByRole('button', { name: 'Delete folder', exact: true }).click()
  await restarted.getByRole('alertdialog').getByRole('button', { name: 'Delete folder' }).click()
  await restarted.getByRole('heading', { name: 'Travel', exact: true }).waitFor({ state: 'hidden' })
  await restarted.getByRole('button', { name: 'Account options' }).click()
  await restarted.getByRole('menuitem', { name: 'Archive', exact: true }).click()
  await restarted.waitForURL((url) => url.searchParams.get('view') === 'archived')
  await restarted.reload()
  await restarted.getByRole('heading', { name: 'Archive', exact: true }).waitFor()
  await restarted.getByRole('heading', { name: 'Archive is empty' }).waitFor()
  assert.equal(await restarted.getByRole('textbox', { name: 'Note title' }).count(), 0)
  await restarted.getByRole('button', { name: 'Back to home' }).click()
  await restarted.getByRole('button', { name: 'Account options' }).click()
  await restarted.getByRole('menuitem', { name: 'Trash', exact: true }).click()
  await restarted.waitForURL((url) => url.searchParams.get('view') === 'trash')
  await restarted.reload()
  await restarted.getByRole('button', { name: 'Tickets', exact: true }).waitFor()
  await restarted.getByRole('heading', { name: 'Select a trashed note' }).waitFor()
  assert.equal(await restarted.getByRole('button', { name: 'Map', exact: true }).count(), 0)
  await open(restarted, 'Tickets')
  await restarted.reload()
  await restoredTitle.waitFor()
  assert.equal(await restoredTitle.inputValue(), 'Tickets')
  await restarted.getByRole('button', { name: 'Back to home' }).click()
  await open(restarted, 'Map')
  await restarted.getByRole('button', { name: 'Archive note', exact: true }).click()
  assert.equal(await restarted.getByRole('alertdialog').count(), 0)
  await restoredTitle.waitFor({ state: 'hidden' })
  await restarted.getByRole('button', { name: 'Account options' }).click()
  await restarted.getByRole('menuitem', { name: 'Archive', exact: true }).click()
  await open(restarted, 'Map')
  const trashTrigger = restarted.getByRole('button', { name: 'Move to trash', exact: true })
  const trashDialog = restarted.getByRole('alertdialog', { name: 'Move note to Trash?' })
  await trashTrigger.click()
  await trashDialog.getByRole('button', { name: 'Cancel' }).click()
  await trashDialog.waitFor({ state: 'hidden' })
  assert.equal(await restoredTitle.inputValue(), 'Map')
  await trashTrigger.click()
  await trashDialog.getByRole('button', { name: 'Move to Trash', exact: true }).click()
  await restoredTitle.waitFor({ state: 'hidden' })
  await restarted.getByRole('button', { name: 'Account options' }).click()
  await restarted.getByRole('menuitem', { name: 'Trash', exact: true }).click()
  await restarted.getByRole('button', { name: 'Map', exact: true }).waitFor()
  const signOutDialog = restarted.getByRole('alertdialog', { name: 'Sign out?' })
  await restarted.getByRole('button', { name: 'Account options' }).click()
  await restarted.getByRole('menuitem', { name: 'Sign out', exact: true }).click()
  await signOutDialog.getByRole('button', { name: 'Cancel' }).click()
  await restarted.getByRole('button', { name: 'Account options' }).click()
  await restarted.getByRole('menuitem', { name: 'Sign out', exact: true }).click()
  await signOutDialog.getByRole('button', { name: 'Sign out', exact: true }).click()
  await restarted.getByRole('heading', { name: 'Sign in', exact: true }).waitFor()
  console.log('Folders support create, rename, note moves, and immediate Trash on delete')
  const applicant = await browser.newPage()
  await applicant.goto(origin)
  await applicant.getByRole('button', { name: 'Sign up' }).click()
  await applicant.getByRole('heading', { name: 'Sign up', exact: true }).waitFor()
  await applicant.getByLabel('Email').fill('waitlist-review@example.test')
  await applicant.getByLabel('Password', { exact: true }).fill('m7#X9z!Q')
  await applicant.getByRole('button', { name: 'Join waitlist' }).click()
  await applicant.getByRole('heading', { name: 'Request received' }).waitFor()
  assert.match(
    (await applicant.locator('.waitlist-id code').textContent()) ?? '',
    /^[a-f0-9-]{36}$/,
  )
  await applicant.getByRole('button', { name: 'Back to sign in' }).click()
  await applicant.getByRole('heading', { name: 'Sign in' }).waitFor()
  await applicant.goto(origin + '/?signup=1')
  await applicant.getByRole('heading', { name: 'Sign up', exact: true }).waitFor()
  await applicant.close()
  assert.deepEqual(errors, [])
  console.log(
    'Chromium passed offline restart, three durable drafts, mobile checklists, tab ownership, conflict copy, and export.',
  )
} finally {
  await browser.close()
}
