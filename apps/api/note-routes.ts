import { createHash } from 'node:crypto'
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { mutation, reconciliationLimit, type View, plainText } from '../../packages/contracts'
import { db } from './db'
import { byFolder, folderFields } from './folder-queries'
import { notes, receipts, folders } from './schema'

export const noteRoutes = new Hono<{ Variables: { owner: string } }>()

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
  unfiled: z.literal('true').optional(),
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
noteRoutes.get('/api/notes', async (c) => {
  const filters = listQuery.safeParse(c.req.query())
  if (!filters.success) return c.json({ error: 'Invalid search parameters' }, 400)
  const { view, sort, q, cursor, folder, unfiled } = filters.data
  if (folder && unfiled) return c.json({ error: 'Invalid search parameters' }, 400)
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
    .select({ ...summaries, preview: sql<string>`left(${notes.searchText}, 180)` })
    .from(notes)
    .where(
      and(
        eq(notes.owner, c.get('owner')),
        folder ? eq(notes.folderId, folder) : unfiled ? isNull(notes.folderId) : undefined,
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
    rows.length > 50
      ? Buffer.from(JSON.stringify(cursorSchema.parse(page.at(-1)))).toString('base64url')
      : null
  return c.json({ notes: page, next })
})
noteRoutes.get('/api/notes/reconcile', async (c) => {
  const ids = z
    .array(z.uuid())
    .min(1)
    .max(reconciliationLimit)
    .safeParse(c.req.query('ids')?.split(','))
  if (!ids.success) return c.json({ error: 'Invalid reconciliation IDs' }, 400)
  const owner = c.get('owner')
  const rows = await db
    .select({
      id: notes.id,
      revision: notes.revision,
      deletedAt: notes.deletedAt,
      archived: notes.archived,
    })
    .from(notes)
    .where(and(eq(notes.owner, owner), inArray(notes.id, ids.data)))
  return c.json({
    owner,
    notes: rows.map(({ id, revision, deletedAt, archived }) => ({
      id,
      revision,
      state: (deletedAt ? 'trash' : archived ? 'archived' : 'active') satisfies View,
    })),
  })
})
noteRoutes.get('/api/notes/:id', async (c) => {
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
noteRoutes.delete('/api/notes/:id', async (c) => {
  const id = z.uuid().safeParse(c.req.param('id'))
  const revision = z
    .number()
    .int()
    .positive()
    .safeParse(Number(/^"(\d+)"$/.exec(c.req.header('If-Match') ?? '')?.[1]))
  if (!id.success || !revision.success) return c.json({ error: 'Invalid note or revision' }, 400)

  const owner = c.get('owner')
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${owner}::text, 0))`)
    const filter = and(eq(notes.owner, owner), eq(notes.id, id.data))
    const [current] = await tx
      .select({ revision: notes.revision, deletedAt: notes.deletedAt })
      .from(notes)
      .where(filter)
    if (!current) return c.body(null, 204)
    if (!current.deletedAt || current.revision !== revision.data)
      return c.json({ error: 'The note changed. Refresh it before deleting permanently.' }, 409)
    await tx.delete(notes).where(filter)
    return c.body(null, 204)
  })
})
noteRoutes.put('/api/notes/:id', bodyLimit({ maxSize: 512 * 1024 }), async (c) => {
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
    // Resolve a replay before checking the current note revision. The original response may have been lost.
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
noteRoutes.get('/api/export', async (c) => {
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
