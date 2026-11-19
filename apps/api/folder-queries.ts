import { and, eq } from 'drizzle-orm'
import { folders } from './schema'

export const folderFields = { id: folders.id, name: folders.name }
export const byFolder = (owner: string, id: string) =>
  and(eq(folders.owner, owner), eq(folders.id, id))
