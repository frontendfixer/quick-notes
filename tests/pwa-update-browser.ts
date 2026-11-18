import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { build } from 'vite'

const root = await mkdtemp(join(tmpdir(), 'quick-notes-pwa-'))
try {
  for (const version of ['A', 'B']) {
    await build({
      build: { outDir: join(root, version) },
      plugins: [
        {
          name: 'test-deployment-version',
          transformIndexHtml: () => [
            { tag: 'meta', attrs: { name: 'test-version', content: version } },
          ],
        },
      ],
    })
  }
  let deployed = 'A'
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname
      if (path === '/api/me') return Response.json({ id: 'pwa-test' })
      if (path === '/api/folders') return Response.json([])
      if (path === '/api/notes') return Response.json({ notes: [] })
      if (path.startsWith('/api/')) return new Response(null, { status: 503 })
      const relative = path === '/' ? '/index.html' : path
      const file = Bun.file(join(root, deployed, relative))
      if (await file.exists())
        return new Response(file, { headers: { 'Cache-Control': 'no-cache' } })
      // Keep the previous build's lazy chunks available during rollout.
      const previous = Bun.file(join(root, 'A', relative))
      if (relative.startsWith('/assets/') && (await previous.exists()))
        return new Response(previous)
      return new Response(null, { status: 404 })
    },
  })
  try {
    const browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_BIN ?? '/usr/bin/chromium',
    })
    try {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      })
      await context.addInitScript(() => {
        const transaction = IDBDatabase.prototype.transaction
        IDBDatabase.prototype.transaction = function (stores, mode, options) {
          if (
            stores === 'drafts' &&
            mode === 'readwrite' &&
            document.documentElement.dataset.rejectDraft
          )
            throw new DOMException('Test quota failure', 'QuotaExceededError')
          return transaction.call(this, stores, mode, options)
        }
      })
      const page = await context.newPage()
      const other = await context.newPage()
      page.setDefaultTimeout(15000)
      other.setDefaultTimeout(15000)
      const base = server.url.href
      const version = (tab: typeof page) =>
        tab.locator('meta[name="test-version"]').getAttribute('content')
      const restart = (tab: typeof page) =>
        tab.getByRole('button', { name: 'Restart to update', exact: true })
      await page.goto(base)
      await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
      await page.getByRole('button', { name: 'Create menu', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Create Note', exact: true }).click()
      await page.getByRole('textbox', { name: 'Note title' }).fill('Release draft')
      const body = page.getByRole('textbox', { name: 'Note content' })
      await body.fill('Before deployment')
      await page.locator('[data-save-state="Saved on device"]').waitFor()
      await other.goto(base)
      assert.equal(await version(other), 'A')
      await page.bringToFront()

      deployed = 'B'
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
      await restart(page).waitFor()
      assert.equal(await version(page), 'A')
      assert.equal(await body.textContent(), 'Before deployment')

      await page.evaluate(() => {
        document.documentElement.dataset.rejectDraft = 'true'
      })
      await body.fill('Before deployment and after the update appeared')
      await restart(page).click()
      await restart(page).waitFor()
      assert.equal(await version(page), 'A')
      assert.equal(
        await page.evaluate(async () =>
          Boolean((await navigator.serviceWorker.getRegistration())?.waiting),
        ),
        true,
      )
      await page.evaluate(() => {
        delete document.documentElement.dataset.rejectDraft
      })

      await restart(page).click()
      await page.waitForFunction(
        () => document.querySelector('meta[name="test-version"]')?.getAttribute('content') === 'B',
      )
      await body.waitFor()
      assert.equal(await body.textContent(), 'Before deployment and after the update appeared')
      assert.equal(
        await page.getByRole('textbox', { name: 'Note title' }).inputValue(),
        'Release draft',
      )
      await restart(other).waitFor()
      assert.equal(await version(other), 'A')
      await restart(other).click()
      await other.waitForFunction(
        () => document.querySelector('meta[name="test-version"]')?.getAttribute('content') === 'B',
      )
      console.log(
        'PWA updated after approval, recovered the draft, and left the other tab open until approved.',
      )
    } finally {
      await browser.close()
    }
  } finally {
    server.stop(true)
  }
} finally {
  await rm(root, { recursive: true, force: true })
}
