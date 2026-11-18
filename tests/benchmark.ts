import { chromium } from 'playwright-core'
import { createAuth } from '../apps/api/auth'

const origin = process.env.APP_ORIGIN ?? 'http://localhost:3000'
const email = crypto.randomUUID() + '@example.test'
const password = 'quick-notes-benchmark-password!'
await createAuth(true).api.signUpEmail({ body: { name: email, email, password } })
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_BIN ?? '/usr/bin/chromium',
})
const context = await browser.newContext()
const startup: number[] = []
const editing: { sizeKiB: number; open: number; paint: number; local: number; server: number }[] =
  []

try {
  let page = await context.newPage()
  await page.goto(origin)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  const title = 'Benchmark'
  const body = (tab: typeof page) => tab.getByRole('textbox', { name: 'Note content' })
  const save = (tab: typeof page, label: string) =>
    tab.getByRole('status').filter({ hasText: label }).waitFor({ timeout: 15000 })
  for (const sizeKiB of [10, 100]) {
    await page.getByRole('button', { name: '+ New' }).click()
    await page.waitForFunction(
      () => document.querySelector<HTMLInputElement>('.note-title')?.value === '',
    )
    await page.getByLabel('Note title').fill(title + ' ' + sizeKiB)
    await body(page).fill('text '.repeat(Math.floor((sizeKiB * 1024) / 5)))
    await save(page, 'Saved to server')
  }
  await page.waitForFunction(
    async () => (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated',
  )
  await page.close()
  for (const sizeKiB of [10, 100])
    for (let i = 0; i < 20; i++) {
      page = await context.newPage()
      const start = performance.now()
      await page.goto(origin, { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: '+ New' }).waitFor()
      startup.push(performance.now() - start)
      await page.evaluate(() => {
        document.addEventListener(
          'click',
          () => {
            performance.mark('open')
            const observe = new MutationObserver(() => {
              if (!document.querySelector('.tiptap')) return
              observe.disconnect()
              requestAnimationFrame(() =>
                requestAnimationFrame(() => performance.measure('editor-open', 'open')),
              )
            })
            observe.observe(document.body, { childList: true, subtree: true })
          },
          { once: true, capture: true },
        )
      })
      await page.getByRole('button', { name: title + ' ' + sizeKiB, exact: true }).click()
      await page.waitForFunction(() => performance.getEntriesByName('editor-open').length > 0)
      const open = await page.evaluate(
        () => performance.getEntriesByName('editor-open')[0].duration,
      )
      await body(page).press('End')
      await page.evaluate(() => {
        document.addEventListener(
          'input',
          () => {
            performance.mark('edit')
            requestAnimationFrame(() =>
              requestAnimationFrame(() => performance.measure('paint-proxy', 'edit')),
            )
            const status = document.querySelector('.note .save')!
            const observe = new MutationObserver(() => {
              if (status.textContent === 'Saved on device') performance.measure('local', 'edit')
              if (status.textContent === 'Saved to server') {
                performance.measure('server', 'edit')
                observe.disconnect()
              }
            })
            observe.observe(status, { childList: true, subtree: true, characterData: true })
          },
          { once: true, capture: true },
        )
      })
      await body(page).press(i % 2 ? 'b' : 'a')
      await save(page, 'Saved to server')
      const timings = await page.evaluate(() =>
        Object.fromEntries(
          performance.getEntriesByType('measure').map((entry) => [entry.name, entry.duration]),
        ),
      )
      editing.push({
        sizeKiB,
        open,
        paint: timings['paint-proxy'],
        local: timings.local,
        server: timings.server,
      })
      await page.close()
    }
  const p95 = (values: number[]) =>
    Math.round(values.sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1])
  console.log(
    JSON.stringify(
      {
        chromium: browser.version(),
        startupP95: p95(startup),
        documents: [10, 100].map((sizeKiB) => {
          const samples = editing.filter((sample) => sample.sizeKiB === sizeKiB)
          return {
            sizeKiB,
            ...Object.fromEntries(
              (['open', 'paint', 'local', 'server'] as const).map((key) => [
                key + 'P95',
                p95(samples.map((sample) => sample[key])),
              ]),
            ),
          }
        }),
      },
      null,
      2,
    ),
  )
} finally {
  await browser.close()
}
