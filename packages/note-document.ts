import { z } from 'zod'

export type DocumentNode = {
  type: string
  content?: DocumentNode[]
  text?: string
  attrs?: Record<string, unknown>
  marks?: { type: string; attrs?: Record<string, unknown> }[]
}

const storedLink = z
  .string()
  .max(2048)
  .refine((value) => /^(https?:\/\/|mailto:)/i.test(value))

export const noteLink = storedLink.refine((value) => {
  if (/\s/.test(value)) return false
  try {
    const url = new URL(value)
    return Boolean(url.protocol === 'mailto:' ? url.pathname : url.hostname)
  } catch {
    return false
  }
})
export const noteImage = noteLink.refine((value) => /^https?:\/\//i.test(value))
const mark = z.union([
  z.object({ type: z.enum(['bold', 'italic', 'underline', 'strike', 'highlight', 'code']) }),
  z.object({
    type: z.literal('link'),
    attrs: z.object({ href: storedLink, title: z.string().nullish() }),
  }),
])
const empty = z.undefined().optional()
const text = z.object({
  type: z.literal('text'),
  text: z.string().min(1),
  marks: z.array(mark).max(8).optional(),
})
const inline = z.union([
  text,
  z.object({ type: z.literal('hardBreak') }),
  z.object({
    type: z.literal('image'),
    attrs: z.object({ src: noteImage, alt: z.string().nullish(), title: z.string().nullish() }),
    marks: z.array(mark).max(8).optional(),
  }),
])
const paragraph = z.object({ type: z.literal('paragraph'), content: z.array(inline).optional() })
const heading = z.object({
  type: z.literal('heading'),
  attrs: z.object({ level: z.number().int().min(1).max(6) }),
  content: z.array(inline).optional(),
})
const block: z.ZodType<DocumentNode> = z.lazy(() =>
  z.union([
    paragraph,
    heading,
    z.object({ type: z.literal('blockquote'), content: z.array(block).min(1) }),
    z.object({ type: z.literal('horizontalRule') }),
    z.object({
      type: z.literal('codeBlock'),
      attrs: z.object({ language: z.string().nullable() }).optional(),
      content: z.array(text.omit({ marks: true })).optional(),
    }),
    z.object({ type: z.literal('bulletList'), content: z.array(listItem).min(1) }),
    z.object({
      type: z.literal('orderedList'),
      attrs: z
        .object({
          start: z.number().int(),
          type: z.enum(['1', 'a', 'A', 'i', 'I']).nullish().catch(null),
        })
        .optional(),
      content: z.array(listItem).min(1),
    }),
    z.object({ type: z.literal('taskList'), content: z.array(taskItem).min(1) }),
    z.object({ type: z.literal('table'), content: z.array(tableRow).min(1) }),
  ]),
)
const tableCell: z.ZodType<DocumentNode> = z.object({
  type: z.enum(['tableCell', 'tableHeader']),
  attrs: z
    .object({
      colspan: z.number().int().positive().optional(),
      rowspan: z.number().int().positive().optional(),
      colwidth: z.array(z.number()).nullish(),
      align: z.enum(['left', 'center', 'right']).nullish(),
    })
    .optional(),
  content: z.array(block).min(1),
})
const tableRow = z.object({ type: z.literal('tableRow'), content: z.array(tableCell).min(1) })
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

// Check resource bounds before parsing the recursive node schema.
export const noteDocument = z
  .unknown()
  .refine(boundedDocument, 'Document is too deeply nested or complex')
  .pipe(z.object({ type: z.literal('doc'), content: z.array(block).min(1) }))

export function plainText(node: DocumentNode): string {
  if (node.text) return node.text
  if (node.type === 'image') return String(node.attrs?.alt ?? '')
  if (node.type === 'hardBreak') return ' '
  if (node.type === 'horizontalRule') return ''
  return (
    node.content
      ?.map(plainText)
      .join(node.type === 'paragraph' || node.type === 'heading' ? '' : ' ') ?? ''
  )
}
