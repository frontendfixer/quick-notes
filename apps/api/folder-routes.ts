import { and, asc, eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { folderName } from '../../packages/contracts'
import { db } from './db'
import { byFolder, folderFields } from './folder-queries'
import { folders, notes } from './schema'

export const folderRoutes = new Hono<{ Variables: { owner: string } }>()

const folderDetails = { ...folderFields, updatedAt: folders.updatedAt }
const folderInput = z.object({ name: folderName })

folderRoutes.get('/api/folders', async (c) => {
  return c.json(
    await db
      .select({
        ...folderDetails,
        noteCount: sql<number>`(
          select count(*)::int from ${notes} as folder_note
          where folder_note.folder_id = folders.id
            and folder_note.owner = folders.owner
            and folder_note.deleted_at is null
            and not folder_note.archived
        )`,
      })
      .from(folders)
      .where(eq(folders.owner, c.get('owner')))
      .orderBy(asc(folders.name)),
  )
})

folderRoutes.post('/api/folders', bodyLimit({ maxSize: 2048 }), async (c) => {
  const input = folderInput.safeParse(await c.req.json().catch(() => null))
  if (!input.success) return c.json({ error: 'Enter a folder name up to 60 characters.' }, 422)
  const owner = c.get('owner')
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${owner}::text, 0))`)
    const [folder] = await tx
      .insert(folders)
      .values({ id: crypto.randomUUID(), owner, name: input.data.name })
      .onConflictDoNothing()
      .returning(folderDetails)
    if (!folder) return c.json({ error: 'A folder with that name already exists.' }, 409)
    return c.json(folder, 201)
  })
})

folderRoutes.on(
  ['PATCH', 'DELETE'],
  '/api/folders/:id',
  bodyLimit({ maxSize: 2048 }),
  async (c) => {
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
        .set({ name: input.data.name, updatedAt: new Date() })
        .where(filter)
        .returning(folderDetails)
      return c.json(folder)
    })
  },
)
