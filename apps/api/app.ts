import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { secureHeaders } from 'hono/secure-headers'
import { auth, trustedOrigins } from './auth'
import { waitlistRoutes } from './waitlist-routes'
import { folderRoutes } from './folder-routes'
import { noteRoutes } from './note-routes'

export const app = new Hono<{ Variables: { owner: string } }>()
app.use(
  '*',
  secureHeaders({
    referrerPolicy: 'no-referrer',
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  }),
)
app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store')
  if (
    !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) &&
    !trustedOrigins.includes(c.req.header('Origin') ?? '')
  ) {
    return c.json({ error: 'Unexpected origin' }, 403)
  }
  await next()
})
// Public entry points precede the session middleware.
app.route('/', waitlistRoutes)
app.on(['GET', 'POST'], '/api/auth/*', bodyLimit({ maxSize: 16384 }), (c) =>
  auth.handler(c.req.raw),
)
app.use('/api/*', async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: 'Sign in to continue' }, 401)
  c.set('owner', session.user.id)
  await next()
})
app.get('/api/me', (c) => c.json({ id: c.get('owner') }))

app.route('/', folderRoutes)
app.route('/', noteRoutes)

app.all('/api/*', (c) => c.json({ error: 'Route unavailable' }, 404))
