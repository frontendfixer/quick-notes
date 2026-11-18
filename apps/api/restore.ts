import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { noteFields, plainText } from '../../packages/contracts'
import { db } from './db'
import { notes, user } from './schema'

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
  })
  .parse(await Bun.file(path).json())
await db.transaction(async (tx) => {
  for (const { deleted, ...fields } of backup.notes) {
    await tx.insert(notes).values({
      ...fields,
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
