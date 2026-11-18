import { expect, test } from 'bun:test'
import { emptyNote, noteFields, plainText } from '../packages/contracts'

test('rich document round-trips and search text preserves word boundaries', () => {
  const value = noteFields.parse({
    ...emptyNote(),
    document: {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 3 },
          content: [{ type: 'text', text: 'Today', marks: [{ type: 'bold' }] }],
        },
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'Write' },
                    { type: 'hardBreak' },
                    { type: 'text', text: 'notes' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  })
  expect(plainText(value.document)).toBe('Today Write notes')
  expect(noteFields.parse(JSON.parse(JSON.stringify(value)))).toEqual(value)
})

test('rejects oversized nesting and unsupported content', () => {
  const long = emptyNote()
  let nested: unknown = { type: 'paragraph' }
  for (let i = 0; i < 40; i++)
    nested = {
      type: 'bulletList',
      content: [{ type: 'listItem', content: [{ type: 'paragraph' }, nested] }],
    }
  expect(
    noteFields.safeParse({ ...long, document: { type: 'doc', content: [nested] } }).success,
  ).toBeFalse()
  expect(
    noteFields.safeParse({ ...long, document: { type: 'doc', content: [{ type: 'image' }] } })
      .success,
  ).toBeFalse()
  expect(
    noteFields.safeParse({
      ...long,
      document: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'bad link',
                marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
              },
            ],
          },
        ],
      },
    }).success,
  ).toBeFalse()
})
