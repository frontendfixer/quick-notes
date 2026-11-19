import { z } from 'zod'
import { noteDocument } from './note-document'

export { noteImage, noteLink, plainText, type DocumentNode } from './note-document'

export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 128

export const folderName = z.string().trim().min(1).max(60)
export const folderResponse = z.object({
  id: z.uuid(),
  name: folderName,
  noteCount: z.number().int().nonnegative().optional(),
  updatedAt: z.iso.datetime().optional(),
})
export type Folder = z.infer<typeof folderResponse>

export const noteFields = z.object({
  folderId: z.uuid().nullable().optional(),
  title: z.string().max(200),
  document: noteDocument,
  pinned: z.boolean(),
  archived: z.boolean(),
  deleted: z.boolean(),
})
export const mutation = z.object({
  mutationId: z.uuid(),
  expectedRevision: z.number().int().positive().nullable(),
  fields: noteFields,
})
export const reconciliationLimit = 100
export const reconciliationResponse = z.object({
  owner: z.string(),
  notes: z.array(
    z.object({
      id: z.uuid(),
      revision: z.number().int().positive(),
      state: z.enum(['active', 'archived', 'trash']),
    }),
  ),
})
export type NoteFields = z.infer<typeof noteFields>
export type Mutation = z.infer<typeof mutation>
export type Note = NoteFields & { id: string; revision: number; updatedAt: string }
export type Summary = Omit<Note, 'document'> & { preview?: string }
export type Ack = { mutationId: string; revision: number; updatedAt: string }
export type View = 'active' | 'archived' | 'trash'
export const emptyNote = (): NoteFields => ({
  title: '',
  document: { type: 'doc', content: [{ type: 'paragraph' }] },
  pinned: false,
  archived: false,
  deleted: false,
})
