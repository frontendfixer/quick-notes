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

async function signIn(tab: Page) {
  await tab.goto(origin)
  await tab.getByRole('textbox', { name: 'Email' }).fill(email)
  await tab.getByLabel('Password', { exact: true }).fill(password)
  await tab.getByRole('button', { name: 'Sign in', exact: true }).click()
  await tab.getByRole('button', { name: 'New note' }).waitFor()
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
  await page.waitForFunction(
    async () => (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated',
  )
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) await page.reload()
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  console.log('Service worker active')
  await page.getByRole('button', { name: 'New note' }).click()
  const title = page.getByRole('textbox', { name: 'Note title' })
  const body = page.getByRole('textbox', { name: 'Note content' })
  await title.fill('Travel log')
  await body.fill('First entry')
  await body.press('End')
  await body.press('Enter')
  await page.getByRole('button', { name: 'Checklist' }).click()
  await body.pressSequentially('Pack charger')
  await page.getByRole('checkbox').check()
  await status(page, 'Saved to server')
  console.log('Rich text saved online')
  const row = page.getByRole('button', { name: 'Travel log', exact: true })
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
  assert.equal(await page.locator('.save-chip').textContent(), 'Saving…')
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
  assert(await readOnly.getByRole('button', { name: 'New note' }).isDisabled())
  await readOnly.close()

  console.log('Secondary tab stayed read-only')
  await context.setOffline(true)
  await page.getByText('Offline · showing notes on this device').waitFor()
  await title.fill('Travel log local')
  await status(page, 'Saved on device')
  for (const name of ['Offline two', 'Offline three']) {
    await page.getByRole('button', { name: 'New note' }).click()
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
  await page.close()
  const restarted = await context.newPage()
  restarted.on('pageerror', (error) => errors.push(error.message))
  restarted.setDefaultTimeout(15000)
  await restarted.goto(origin)
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
  await restarted.getByText('Review server version').click()
  await restarted.getByText('Travel log remote', { exact: false }).last().waitFor()
  await restarted.getByRole('button', { name: 'Save draft as a new note' }).click()
  await status(restarted, 'Saved to server')
  const exported = await restarted.request.get(origin + '/api/export')
  const backup = await exported.json()
  assert.deepEqual(backup.notes.map((note: { title: string }) => note.title).sort(), [
    'Offline three',
    'Offline two',
    'Travel log local',
    'Travel log remote',
  ])
  assert.deepEqual(errors, [])
  console.log(
    'Chromium passed offline restart, three durable drafts, mobile checklists, tab ownership, conflict copy, and export.',
  )
} finally {
  await browser.close()
}
