import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from '../../packages/contracts'
import { auth } from './auth'
import { db } from './db'
import { signupWaitlist } from './schema'

export const waitlistRoutes = new Hono()

const signupRequest = z.object({
  email: z.string().trim().max(254).toLowerCase().pipe(z.email()),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
})
waitlistRoutes.post('/api/signup-waitlist', bodyLimit({ maxSize: 4096 }), async (c) => {
  const input = signupRequest.safeParse(await c.req.json().catch(() => null))
  if (!input.success)
    return c.json(
      {
        error: `Enter a valid email and a password of ${MIN_PASSWORD_LENGTH}–${MAX_PASSWORD_LENGTH} characters.`,
      },
      422,
    )
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended('quick-notes-signup-waitlist', 0))`,
    )
    const [recent] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(signupWaitlist)
      .where(sql`${signupWaitlist.requestedAt} > now() - interval '1 minute'`)
    if (recent.total >= 10) return c.json({ error: 'Too many requests. Try again shortly.' }, 429)
    const { password } = await auth.$context
    const id = crypto.randomUUID()
    await tx.insert(signupWaitlist).values({
      id,
      email: input.data.email,
      passwordHash: await password.hash(input.data.password),
    })
    return c.json({ id }, 202)
  })
})
