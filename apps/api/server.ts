import { sql } from 'drizzle-orm'
import { serveStatic } from 'hono/bun'
import { app } from './app'
import { db } from './db'

app.get('/healthz', async (c) => {
  c.header('Cache-Control', 'no-store')
  try {
    await db.execute(sql`select 1 from "user" limit 1`)
    return c.text('ok')
  } catch {
    return c.text('Database unavailable', 503)
  }
})

const root = './apps/web/dist'
app.get(
  '/assets/*',
  async (c, next) => {
    c.header('Cache-Control', 'public, max-age=31536000, immutable')
    await next()
  },
  serveStatic({ root, onNotFound: (_path, c) => c.header('Cache-Control', 'no-store') }),
)
app.get(
  '*',
  async (c, next) => {
    c.header('Cache-Control', 'no-cache')
    await next()
  },
  serveStatic({ root }),
)
app.get('/', serveStatic({ path: root + '/index.html' }))
export default {
  hostname: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? 3000),
  fetch: app.fetch,
}
