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
    viewport: { width: 390, height: 844 },
  })
  page.setDefaultTimeout(8000)
  const notes = new Map<string, Note>()
  const errors: unknown[] = []
  page.on('pageerror', (error) => errors.push(error))
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/me') return route.fulfill({ json: { id: 'editor-test' } })
    if (path === '/api/folders') return route.fulfill({ json: [] })
    if (path === '/api/notes') return route.fulfill({ json: { notes: [...notes.values()] } })
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
    return note ? route.fulfill({ json: note }) : route.fulfill({ status: 404 })
  })
  await page.goto(process.env.APP_ORIGIN ?? 'http://127.0.0.1:4179')
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
  for (const mark of ['Bold', 'Italic', 'Underline', 'Strikethrough', 'Highlight'])
    await format(mark)
  await format('Link')
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
  await body.locator('p').last().click()
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
  console.log('Rich text toolbar, mixed content, autosave and reload passed in Chromium.')
} finally {
  await browser.close()
}
