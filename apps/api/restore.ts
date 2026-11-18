import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { noteFields, plainText, folderName } from '../../packages/contracts'
import { db } from './db'
import { notes, user, folders } from './schema'

const [, , email, path] = Bun.argv
if (!email || !path) throw new Error('Usage: bun run backup:restore EMAIL BACKUP.json')
const [owner] = await db
  .select({ id: user.id })
  .from(user)
  .where(eq(user.email, email.toLowerCase()))
if (!owner) throw new Error('Provision the destination account first')
const backup = z
  .object({
    format: z.literal('quick-notes'),
    version: z.literal(1),
    notes: z.array(noteFields),
    folders: z.array(z.object({ id: z.uuid(), name: folderName })).optional(),
  })
  .parse(await Bun.file(path).json())
await db.transaction(async (tx) => {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${owner.id}::text, 0))`)
  const restored = new Map<string, string>()
  for (const folder of backup.folders ?? []) {
    const [existing] = await tx
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.owner, owner.id), sql`lower(${folders.name}) = lower(${folder.name})`))
    const id = existing?.id ?? crypto.randomUUID()
    if (!existing) await tx.insert(folders).values({ id, owner: owner.id, name: folder.name })
    restored.set(folder.id, id)
  }
  for (const { deleted, folderId, ...fields } of backup.notes) {
    await tx.insert(notes).values({
      ...fields,
      folderId: folderId ? (restored.get(folderId) ?? null) : null,
      id: crypto.randomUUID(),
      owner: owner.id,
      revision: 1,
      searchText: plainText(fields.document),
      deletedAt: deleted ? new Date() : null,
    })
  }
})
console.log(`Restored ${backup.notes.length} notes as new copies`)
process.exit(0)
