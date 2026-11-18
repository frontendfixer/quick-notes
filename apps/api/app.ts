import { createHash } from 'node:crypto'
import { and, asc, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { secureHeaders } from 'hono/secure-headers'
import { z } from 'zod'
import { mutation, plainText, folderName } from '../../packages/contracts'
import { auth, trustedOrigins } from './auth'
import { db } from './db'
import { notes, receipts, folders, signupWaitlist } from './schema'

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
const signupRequest = z.object({
  email: z.string().trim().max(254).toLowerCase().pipe(z.email()),
  password: z.string().min(12).max(128),
})
app.post('/api/signup-waitlist', bodyLimit({ maxSize: 4096 }), async (c) => {
  const input = signupRequest.safeParse(await c.req.json().catch(() => null))
  if (!input.success)
    return c.json({ error: 'Enter a valid email and a password of 12–128 characters.' }, 422)
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

const folderFields = { id: folders.id, name: folders.name }
const folderInput = z.object({ name: folderName })
const byFolder = (owner: string, id: string) => and(eq(folders.owner, owner), eq(folders.id, id))

app.get('/api/folders', async (c) => {
  return c.json(
    await db
      .select(folderFields)
      .from(folders)
      .where(eq(folders.owner, c.get('owner')))
      .orderBy(asc(folders.name)),
  )
})

app.post('/api/folders', bodyLimit({ maxSize: 2048 }), async (c) => {
  const input = folderInput.safeParse(await c.req.json().catch(() => null))
  if (!input.success) return c.json({ error: 'Enter a folder name up to 60 characters.' }, 422)
  const owner = c.get('owner')
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${owner}::text, 0))`)
    const [folder] = await tx
      .insert(folders)
      .values({ id: crypto.randomUUID(), owner, name: input.data.name })
      .onConflictDoNothing()
      .returning(folderFields)
    if (!folder) return c.json({ error: 'A folder with that name already exists.' }, 409)
    return c.json(folder, 201)
  })
})

app.on(['PATCH', 'DELETE'], '/api/folders/:id', bodyLimit({ maxSize: 2048 }), async (c) => {
  const id = z.uuid().safeParse(c.req.param('id'))
  if (!id.success) return c.json({ error: 'Folder unavailable.' }, 404)
  const owner = c.get('owner')
  const filter = byFolder(owner, id.data)
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${owner}::text, 0))`)
    const [existing] = await tx.select(folderFields).from(folders).where(filter)
    if (!existing) return c.json({ error: 'Folder unavailable.' }, 404)
    if (c.req.method === 'DELETE') {
      const now = new Date()
      await tx
        .update(notes)
        .set({
          folderId: null,
          deletedAt: sql`coalesce(${notes.deletedAt}, ${now.toISOString()}::timestamptz)`,
          updatedAt: now,
          revision: sql`${notes.revision} + 1`,
        })
        .where(and(eq(notes.owner, owner), eq(notes.folderId, id.data)))
      await tx.delete(folders).where(filter)
      return c.body(null, 204)
    }
    const input = folderInput.safeParse(await c.req.json().catch(() => null))
    if (!input.success) return c.json({ error: 'Enter a folder name up to 60 characters.' }, 422)
    const [duplicate] = await tx
      .select(folderFields)
      .from(folders)
      .where(
        and(
          eq(folders.owner, owner),
          sql`lower(${folders.name}) = lower(${input.data.name})`,
          sql`${folders.id} <> ${id.data}::uuid`,
        ),
      )
    if (duplicate) return c.json({ error: 'A folder with that name already exists.' }, 409)
    const [folder] = await tx
      .update(folders)
      .set({ name: input.data.name })
      .where(filter)
      .returning(folderFields)
    return c.json(folder)
  })
})

const summaries = {
  id: notes.id,
  title: notes.title,
  folderId: notes.folderId,
  pinned: notes.pinned,
  archived: notes.archived,
  deletedAt: notes.deletedAt,
  updatedAt: notes.updatedAt,
  revision: notes.revision,
}
function noteResponse<
  Row extends Omit<typeof notes.$inferSelect, 'owner' | 'searchText' | 'createdAt' | 'document'>,
>(row: Row) {
  const { deletedAt, updatedAt, ...rest } = row
  return { ...rest, deleted: !!deletedAt, updatedAt: updatedAt.toISOString() }
}
const listQuery = z.object({
  folder: z.uuid().optional(),
  view: z.enum(['active', 'archived', 'trash']).default('active'),
  sort: z.enum(['updated', 'title']).default('updated'),
  q: z.string().trim().max(150).default(''),
  cursor: z.string().max(2048).optional(),
})
const cursorSchema = z.object({
  id: z.uuid(),
  title: z.string().max(200),
  updatedAt: z.iso.datetime(),
  pinned: z.boolean(),
})
function decodeCursor(value: string) {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')))
  } catch {
    return null
  }
}
app.get('/api/notes', async (c) => {
  const filters = listQuery.safeParse(c.req.query())
  if (!filters.success) return c.json({ error: 'Invalid search parameters' }, 400)
  const { view, sort, q, cursor, folder } = filters.data
  const after = cursor ? decodeCursor(cursor) : null
  if (cursor && !after) return c.json({ error: 'Invalid cursor' }, 400)

  const order = sort === 'title' ? asc(notes.title) : desc(notes.updatedAt)
  const pinOrder = view === 'active' ? [desc(notes.pinned)] : []
  const pageAfter =
    after &&
    (sort === 'title'
      ? sql`(${notes.title}, ${notes.id}) > (${after.title}, ${after.id}::uuid)`
      : sql`(${notes.updatedAt}, ${notes.id}) < (${after.updatedAt}::timestamptz, ${after.id}::uuid)`)
  const seek =
    after && view === 'active'
      ? sql`(${notes.pinned} < ${after.pinned} or (${notes.pinned} = ${after.pinned} and ${pageAfter}))`
      : pageAfter
  const rows = await db
    .select(summaries)
    .from(notes)
    .where(
      and(
        eq(notes.owner, c.get('owner')),
        folder ? eq(notes.folderId, folder) : undefined,
        view === 'trash'
          ? isNotNull(notes.deletedAt)
          : and(isNull(notes.deletedAt), eq(notes.archived, view === 'archived')),
        q
          ? sql`to_tsvector('simple', ${notes.title} || ' ' || ${notes.searchText}) @@ websearch_to_tsquery('simple', ${q})`
          : undefined,
        seek || undefined,
      ),
    )
    .orderBy(...pinOrder, order, sort === 'title' ? asc(notes.id) : desc(notes.id))
    .limit(51)
  const page = rows.slice(0, 50).map(noteResponse)
  const next =
    rows.length > 50 ? Buffer.from(JSON.stringify(page.at(-1))).toString('base64url') : null
  return c.json({ notes: page, next })
})
app.get('/api/notes/:id', async (c) => {
  const id = z.uuid().safeParse(c.req.param('id'))
  if (!id.success) return c.json({ error: 'Invalid note ID' }, 400)
  const [note] = await db
    .select({ ...summaries, document: notes.document })
    .from(notes)
    .where(and(eq(notes.owner, c.get('owner')), eq(notes.id, id.data)))
  if (!note) return c.json({ error: 'Note unavailable' }, 404)
  const tag = `"${note.revision}"`
  c.header('ETag', tag)
  if (c.req.header('If-None-Match') === tag) return c.body(null, 304)
  return c.json(noteResponse(note))
})
app.put('/api/notes/:id', bodyLimit({ maxSize: 512 * 1024 }), async (c) => {
  const id = z.uuid().safeParse(c.req.param('id'))
  const input = mutation.safeParse(await c.req.json().catch(() => null))
  if (!id.success || !input.success) return c.json({ error: 'Invalid note or formatting' }, 422)
  const owner = c.get('owner')
  const { mutationId, expectedRevision, fields } = input.data
  const fingerprint = createHash('sha256')
    .update(JSON.stringify([id.data, input.data]))
    .digest('hex')

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${owner}::text, 0))`)
    const [receipt] = await tx
      .select()
      .from(receipts)
      .where(and(eq(receipts.owner, owner), eq(receipts.mutationId, mutationId)))
    if (receipt)
      return receipt.fingerprint === fingerprint
        ? c.json(receipt.result)
        : c.json({ error: 'Mutation ID was already used' }, 422)
    const filter = and(eq(notes.owner, owner), eq(notes.id, id.data))
    const [current] = await tx
      .select({ ...summaries, document: notes.document })
      .from(notes)
      .where(filter)
    if ((current?.revision ?? null) !== expectedRevision) {
      return c.json({ current: current ? noteResponse(current) : null }, 409)
    }
    const { deleted, folderId, ...editable } = fields
    if (folderId) {
      const [folder] = await tx.select(folderFields).from(folders).where(byFolder(owner, folderId))
      if (!folder) return c.json({ error: 'Folder unavailable. Choose a different folder.' }, 422)
    }
    const updatedAt = new Date()
    const values = {
      ...editable,
      folderId: folderId === undefined ? (current?.folderId ?? null) : folderId,
      searchText: plainText(fields.document),
      deletedAt: deleted ? (current?.deletedAt ?? updatedAt) : null,
      revision: (expectedRevision ?? 0) + 1,
      updatedAt,
    }
    if (current) await tx.update(notes).set(values).where(filter)
    else await tx.insert(notes).values({ id: id.data, owner, ...values })
    const result = { mutationId, revision: values.revision, updatedAt: updatedAt.toISOString() }
    await tx.insert(receipts).values({ owner, mutationId, fingerprint, result })
    return c.json(result)
  })
})
app.get('/api/export', async (c) => {
  const rows = await db
    .select({ ...summaries, document: notes.document })
    .from(notes)
    .where(eq(notes.owner, c.get('owner')))
    .orderBy(notes.id)
  c.header('Content-Disposition', 'attachment; filename="quick-notes-backup.json"')
  return c.json({
    format: 'quick-notes',
    version: 1,
    exportedAt: new Date().toISOString(),
    notes: rows.map(noteResponse),
    folders: await db
      .select(folderFields)
      .from(folders)
      .where(eq(folders.owner, c.get('owner'))),
  })
})
app.all('/api/*', (c) => c.json({ error: 'Route unavailable' }, 404))
