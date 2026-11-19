import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { mutation, type Note } from '../packages/contracts'

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_BIN ?? '/usr/bin/chromium',
})
try {
  // Exercise the app and its autosave flow without needing a PostgreSQL instance.
  const page = await browser.newPage({
    serviceWorkers: 'block',
    viewport: process.env.EDITOR_SCREENSHOT
      ? { width: 1000, height: 740 }
      : { width: 390, height: 844 },
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  page.setDefaultTimeout(8000)
  const notes = new Map<string, Note>()
  const errors: unknown[] = []
  page.on('pageerror', (error) => errors.push(error))
  await page.route('**/api/**', async (route) => {
    const { pathname: path, searchParams } = new URL(route.request().url())
    if (path === '/api/me') return route.fulfill({ json: { id: 'editor-test' } })
    if (path === '/api/folders') return route.fulfill({ json: [] })
    if (path === '/api/notes') {
      const view = searchParams.get('view')
      return route.fulfill({
        json: {
          notes: [...notes.values()].filter((note) =>
            note.deleted ? view === 'trash' : view === 'active',
          ),
          next: null,
        },
      })
    }
    const id = path.split('/').at(-1)!
    if (route.request().method() === 'PUT') {
      const input = mutation.safeParse(route.request().postDataJSON())
      if (!input.success) {
        errors.push(input.error)
        return route.fulfill({ status: 422, json: { error: 'Invalid note or formatting' } })
      }
      const { fields, mutationId, expectedRevision } = input.data
      const revision = (expectedRevision ?? 0) + 1
      const updatedAt = new Date().toISOString()
      notes.set(id, { ...fields, id, revision, updatedAt })
      return route.fulfill({ json: { mutationId, revision, updatedAt } })
    }
    const note = notes.get(id)
    if (route.request().method() === 'DELETE') {
      assert.equal(note?.deleted, true)
      assert.equal(route.request().headers()['if-match'], '"' + note?.revision + '"')
      notes.delete(id)
      return route.fulfill({ status: 204 })
    }
    if (note && route.request().headers()['if-none-match'] === '"' + note.revision + '"')
      return route.fulfill({ status: 304 })
    return note ? route.fulfill({ json: note }) : route.fulfill({ status: 404 })
  })
  await page.goto(process.env.APP_ORIGIN ?? 'http://127.0.0.1:4179', { timeout: 30000 })
  const button = (name: string) => page.getByRole('button', { name, exact: true })
  await button('Create menu').click()
  await page.getByRole('menuitem', { name: 'Create Note' }).click()
  await page.getByRole('textbox', { name: 'Note title' }).fill('Field journal')
  const body = page.getByRole('textbox', { name: 'Note content' })
  const trail = body.locator('a[href="https://example.com/trail"]')
  async function format(name: string) {
    if (await button('Open formatting').isVisible()) await button('Open formatting').click()
    if (!(await button(name).isVisible())) await button('More formatting').click()
    await button(name).click()
  }

  for (const [level, title] of [
    'Field observations',
    'Trail conditions',
    'North ridge',
  ].entries()) {
    await format('Heading ' + (level + 1))
    await body.pressSequentially(title)
    await body.press('Enter')
    assert.equal(await body.locator('h' + (level + 1)).textContent(), title)
  }
  await body.pressSequentially('Read the trail report')
  await body.press('Enter')
  await body.press('ArrowUp')
  await body.press('Home')
  await body.press('Shift+End')
  await body.getByText('Read the trail report', { exact: true }).click({ button: 'right' })
  const editMenu = page.getByRole('menu', { name: 'Edit note' })
  assert.equal(
    await editMenu.getByRole('menuitem', { name: 'Copy', exact: true }).isEnabled(),
    true,
  )
  const menuItem = (name: string) => editMenu.getByRole('menuitem', { name, exact: true })
  const report = body.getByText('Read the trail report', { exact: true })
  const rightClickReport = () => report.click({ button: 'right' })
  const undo = await menuItem('Undo').boundingBox()
  const redo = await menuItem('Redo').boundingBox()
  assert.ok(undo && redo && undo.y === redo.y && undo.x < redo.x)
  assert.equal(await menuItem('Redo').isDisabled(), true)
  if (process.env.EDITOR_SCREENSHOT) {
    await page.screenshot({ path: process.env.EDITOR_SCREENSHOT, animations: 'disabled' })
    await page.setViewportSize({ width: 390, height: 844 })
  }
  await report.click({ position: { x: 4, y: 5 } })
  await editMenu.waitFor({ state: 'hidden' })
  await body.press('Home')
  await body.press('Shift+End')
  await rightClickReport()
  const title = page.getByRole('textbox', { name: 'Note title' })
  await title.click()
  await editMenu.waitFor({ state: 'hidden' })
  assert.equal(await title.evaluate((element) => element === document.activeElement), true)

  await report.click()
  await body.press('Home')
  await body.press('Shift+End')
  await body.press('Shift+F10')
  await editMenu.waitFor()
  await page.keyboard.press('ArrowDown')
  await editMenu.locator('[role="menuitem"]:focus').waitFor()
  await page.keyboard.press('Escape')
  await editMenu.waitFor({ state: 'hidden' })
  assert.equal(await body.evaluate((element) => element === document.activeElement), true)
  await body.press('ContextMenu')
  await editMenu.waitFor()
  await page.keyboard.press('Tab')
  await editMenu.waitFor({ state: 'hidden' })

  await report.click()
  await body.press('Home')
  await body.press('Shift+End')
  await rightClickReport()
  await menuItem('Copy').click()
  await editMenu.waitFor({ state: 'hidden' })
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'Read the trail report')
  await rightClickReport()
  await menuItem('Cut').click()
  await report.waitFor({ state: 'detached' })
  await body.locator('p').first().click({ button: 'right' })
  await menuItem('Paste').click()
  await report.waitFor()
  await body.press('Home')
  await body.press('Shift+End')
  await rightClickReport()
  await menuItem('Bold').click()
  await rightClickReport()
  await menuItem('Undo').click()
  assert.equal(await body.locator('strong').count(), 0)
  await rightClickReport()
  await menuItem('Redo').click()
  assert.equal(await body.locator('strong').textContent(), 'Read the trail report')
  await body.press('ControlOrMeta+i')
  for (const mark of ['Underline', 'Strikethrough', 'Highlight']) await format(mark)
  const touch = await page.context().newCDPSession(page)
  await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true })
  const reportBox = await report.boundingBox()
  assert.ok(reportBox)
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: reportBox.x + 6, y: reportBox.y + 6 }],
  })
  await editMenu.waitFor()
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  if (process.env.EDITOR_MOBILE_SCREENSHOT) {
    await page.screenshot({ path: process.env.EDITOR_MOBILE_SCREENSHOT, animations: 'disabled' })
  }
  const titleBox = await title.boundingBox()
  assert.ok(titleBox)
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: titleBox.x + 6, y: titleBox.y + 6 }],
  })
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await editMenu.waitFor({ state: 'hidden' })
  await touch.send('Emulation.setTouchEmulationEnabled', { enabled: false })
  await touch.detach()
  await report.click()
  await body.press('Home')
  await body.press('Shift+End')
  await body.press('ControlOrMeta+Shift+k')
  const url = page.getByRole('textbox', { name: 'Link URL' })
  await url.fill('https://')
  await button('Save link').click()
  await page.getByRole('alert').filter({ hasText: 'Enter a valid' }).waitFor()
  await url.fill('https://example.com/trail')
  await button('Save link').click()
  await body.locator('a strong, strong a').waitFor()
  for (const tag of ['em', 'u', 's', 'mark'])
    assert.equal(await body.locator(tag).textContent(), 'Read the trail report')
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.waitForFunction(() => document.activeElement?.classList.contains('tiptap'))
  await body.press('ControlOrMeta+End')
  if (await body.locator('p').last().textContent()) await body.press('Enter')
  await format('Quote')
  assert.equal(await trail.count(), 1, "await format('Quote')")
  await body.pressSequentially('Keep to the marked path.')
  await body.press('Enter')
  await body.press('Enter')
  await format('Bullets')
  await body.pressSequentially('Water')
  await body.press('Enter')
  await body.pressSequentially('Map')
  await body.press('Tab')
  await body.locator('ul ul').waitFor()
  await body.press('Shift+Tab')
  await format('Numbered list')
  await body.locator('ol li').last().waitFor()
  await format('Checklist')
  await body.locator('ul[data-type="taskList"] input').first().check()
  await body.press('Control+End')
  await body.press('Enter')
  await body.press('Enter')
  await format('Inline code')
  await body.pressSequentially('trail.json')
  await format('Inline code')
  await body.press('Enter')
  await format('Code block')
  await body.pressSequentially('route = "north"')
  await body.press('Enter')
  await body.pressSequentially('  ready = true')
  await body.press('ArrowDown')
  await body.press('Enter')
  await body.press('Enter')
  await body.press('Enter')
  await format('Divider')
  assert.equal(await trail.count(), 1, "await format('Divider')")
  await body.locator('hr').waitFor()
  await format('Undo')
  assert.equal(await body.locator('hr').count(), 0)
  await format('Redo')
  await body.locator('hr').waitFor()
  await body.pressSequentially('Meet at dawn 🌄')
  await body.press('Control+End')
  await body.press('Enter')
  const pastedSave = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      response.ok() &&
      JSON.stringify(response.request().postDataJSON()).includes('Spare batteries'),
  )
  await body.evaluate((element) => {
    const clipboardData = new DataTransfer()
    clipboardData.setData(
      'text/html',
      '<ol type="a" start="3"><li><p><strong>Spare batteries</strong></p></li></ol>',
    )
    element.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }),
    )
  })
  await body.locator('ol[type="a"][start="3"] strong').waitFor()
  await pastedSave
  assert.equal(await trail.count(), 1, 'await pastedSave')
  await body.press('Control+End')
  await format('Link')
  await url.fill('https://example.com/map')
  await button('Save link').click()
  const map = body.getByRole('link', { name: 'https://example.com/map' })
  await map.waitFor()
  assert.equal(await trail.count(), 1, 'await map.waitFor()')
  await body.press('ArrowLeft')
  await format('Link')
  assert.equal(await url.inputValue(), 'https://example.com/map')
  const unlinkedSave = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      response.ok() &&
      !JSON.stringify(response.request().postDataJSON()).includes(
        '"href":"https://example.com/map"',
      ),
  )
  await url.clear()
  await button('Save link').click()
  await map.waitFor({ state: 'detached' })
  assert.match((await body.textContent()) ?? '', /example.com\/map/)
  await unlinkedSave
  assert.equal(await trail.count(), 1, 'await unlinkedSave')
  await page.locator('[data-save-state="Saved to server"]').waitFor()
  await page.reload()
  await body.locator('hr').waitFor()
  assert.equal(await body.locator('pre').textContent(), 'route = "north"\n  ready = true')
  assert.equal(await body.locator('blockquote').textContent(), 'Keep to the marked path.')
  assert.equal(await body.locator('p > code').textContent(), 'trail.json')
  assert.equal(await trail.textContent(), 'Read the trail report')
  assert.equal(await map.count(), 0)
  assert.match((await body.textContent()) ?? '', /example.com\/map/)
  assert.equal(await body.locator('input:checked').count(), 1)
  assert.equal(
    await body.locator('ol[type="a"][start="3"] strong').textContent(),
    'Spare batteries',
  )
  assert.match((await body.textContent()) ?? '', /Meet at dawn 🌄/)
  assert.deepEqual(errors, [])
  const output = process.env.EDITOR_REVIEW_OUTPUT
  if (output) {
    const html = await body.evaluate((element) => {
      const copy = element.cloneNode(true) as HTMLElement
      for (const input of copy.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
        input.toggleAttribute('checked', input.closest('li')?.dataset.checked === 'true')
        input.disabled = true
      }
      return copy.innerHTML
    })
    await Bun.write(
      output + '.json',
      JSON.stringify({ format: 'quick-notes', version: 1, notes: [...notes.values()] }, null, 2) +
        '\n',
    )
    await Bun.write(
      output + '.html',
      `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Field journal</title>
<style>
body { max-width: 42rem; margin: 2rem auto; padding: 0 1rem; font: 1rem/1.6 system-ui, sans-serif; overflow-wrap: anywhere; }
blockquote { border-inline-start: 3px solid #aaa; padding-inline-start: 1rem; margin-inline: 0; }
pre { background: #eee; padding: 1rem; overflow: auto; }
ul[data-type="taskList"] > li { list-style: none; display: flex; gap: .5rem; }
</style>
<main><p>Quick Notes editor test</p>${html}</main>
</html>
`,
    )
  }
  const [journal] = notes.values()
  notes.set(journal.id, { ...journal, revision: journal.revision + 1, title: 'Updated journal' })
  await button('Refresh note').click()
  await page.waitForFunction(
    () => document.querySelector<HTMLInputElement>('.note-title')?.value === 'Updated journal',
  )
  await body.press('ControlOrMeta+k')
  await page.waitForFunction(
    () => document.activeElement?.getAttribute('aria-label') === 'Search notes',
  )
  const trashed = {
    ...journal,
    id: crypto.randomUUID(),
    revision: 1,
    title: 'Old journal',
    deleted: true,
  }
  notes.set(trashed.id, trashed)
  await page.getByRole('button', { name: 'Account options', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Trash', exact: true }).click()
  await button('Old journal').waitFor()
  await button('Old journal').click()
  await button('Delete permanently').click()
  const confirmation = page.getByRole('alertdialog', { name: 'Delete note permanently?' })
  await confirmation.getByRole('button', { name: 'Cancel' }).click()
  assert.equal(notes.has(trashed.id), true)
  await button('Delete permanently').click()
  const deletion = page.waitForResponse(
    (response) => response.request().method() === 'DELETE' && response.url().endsWith(trashed.id),
  )
  await confirmation.getByRole('button', { name: 'Delete permanently', exact: true }).click()
  assert.equal((await deletion).status(), 204)
  await page.getByRole('heading', { name: 'Trash is empty', exact: true }).waitFor()
  assert.equal(await button('Old journal').count(), 0)
  assert.equal(notes.has(trashed.id), false)
  await button('Back to home').click()
  const remote = { ...journal, id: crypto.randomUUID(), revision: 1, title: 'Remote journal' }
  notes.set(remote.id, remote)
  await button('Refresh notes list').click()
  await button('Remote journal').waitFor()
  assert.deepEqual(errors, [])
  console.log(
    'Rich text, autosave, manual refresh, and confirmed Trash deletion passed in Chromium.',
  )
} finally {
  await browser.close()
}
