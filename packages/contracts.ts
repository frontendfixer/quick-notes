import { z } from 'zod'

export type DocumentNode = {
  type: string
  content?: DocumentNode[]
  text?: string
  attrs?: Record<string, unknown>
  marks?: { type: string; attrs?: Record<string, unknown> }[]
}

const link = z
  .string()
  .max(2048)
  .refine((value) => /^(https?:\/\/|mailto:)/i.test(value))
const mark = z.union([
  z.object({ type: z.enum(['bold', 'italic', 'underline', 'strike', 'highlight']) }),
  z.object({ type: z.literal('link'), attrs: z.object({ href: link }) }),
])
const empty = z.undefined().optional()
const text = z.object({
  type: z.literal('text'),
  text: z.string().min(1),
  marks: z.array(mark).max(8).optional(),
})
const inline = z.union([text, z.object({ type: z.literal('hardBreak') })])
const paragraph = z.object({ type: z.literal('paragraph'), content: z.array(inline).optional() })
const heading = z.object({
  type: z.literal('heading'),
  attrs: z.object({ level: z.number().int().min(1).max(3) }),
  content: z.array(inline).optional(),
})
const block: z.ZodType<DocumentNode> = z.lazy(() =>
  z.union([
    paragraph,
    heading,
    z.object({ type: z.literal('bulletList'), content: z.array(listItem).min(1) }),
    z.object({
      type: z.literal('orderedList'),
      attrs: z.object({ start: z.number().int().min(1).max(1000000) }).optional(),
      content: z.array(listItem).min(1),
    }),
    z.object({ type: z.literal('taskList'), content: z.array(taskItem).min(1) }),
  ]),
)
const listItem: z.ZodType<DocumentNode> = z.object({
  type: z.literal('listItem'),
  attrs: empty,
  content: z.tuple([paragraph]).rest(block),
})
const taskItem: z.ZodType<DocumentNode> = z.object({
  type: z.literal('taskItem'),
  attrs: z.object({ checked: z.boolean() }),
  content: z.tuple([paragraph]).rest(block),
})

function boundedDocument(input: unknown) {
  const stack = [{ value: input, depth: 0 }]
  let count = 0
  while (stack.length) {
    const { value, depth } = stack.pop()!
    if (++count > 20000 || depth > 32) return false
    if (value && typeof value === 'object') {
      for (const child of Object.values(value)) stack.push({ value: child, depth: depth + 1 })
    }
  }
  return true
}

export const noteFields = z.object({
  title: z.string().max(200),
  document: z
    .unknown()
    .refine(boundedDocument, 'Document is too deeply nested or complex')
    .pipe(z.object({ type: z.literal('doc'), content: z.array(block).min(1) })),
  pinned: z.boolean(),
  archived: z.boolean(),
  deleted: z.boolean(),
})
export const mutation = z.object({
  mutationId: z.uuid(),
  expectedRevision: z.number().int().positive().nullable(),
  fields: noteFields,
})
export type NoteFields = z.infer<typeof noteFields>
export type Mutation = z.infer<typeof mutation>
export type Note = NoteFields & { id: string; revision: number; updatedAt: string }
export type Summary = Omit<Note, 'document'>
export type Ack = { mutationId: string; revision: number; updatedAt: string }
export type View = 'active' | 'archived' | 'trash' | 'offline'
export function plainText(node: DocumentNode): string {
  if (node.text) return node.text
  if (node.type === 'hardBreak') return ' '
  return (
    node.content
      ?.map(plainText)
      .join(node.type === 'paragraph' || node.type === 'heading' ? '' : ' ') ?? ''
  )
}
export const emptyNote = (): NoteFields => ({
  title: '',
  document: { type: 'doc', content: [{ type: 'paragraph' }] },
  pinned: false,
  archived: false,
  deleted: false,
})
