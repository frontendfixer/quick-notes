import { Button } from '@kobalte/core/button'
import { ToggleButton } from '@kobalte/core/toggle-button'
import {
  Bold,
  Code,
  CodeXml,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
} from 'lucide-solid'
import { Editor } from '@tiptap/core'
import { For, createMemo, Show } from 'solid-js'
import FormattingDock from '../formatting-dock'

import { modifier, shortcutLabel, shortcuts } from './shortcuts'

export function createFormattingTools(editLink: () => void) {
  const tools = [
    ['Bold', Bold, 'bold', (e: Editor) => e.chain().focus().toggleBold().run()],
    ['Italic', Italic, 'italic', (e: Editor) => e.chain().focus().toggleItalic().run()],
    ['Underline', Underline, 'underline', (e: Editor) => e.chain().focus().toggleUnderline().run()],
    ['Bullets', List, 'bulletList', (e: Editor) => e.chain().focus().toggleBulletList().run()],
    ['Checklist', ListChecks, 'taskList', (e: Editor) => e.chain().focus().toggleTaskList().run()],
    [
      'Strikethrough',
      Strikethrough,
      'strike',
      (e: Editor) => e.chain().focus().toggleStrike().run(),
    ],
    [
      'Heading 1',
      Heading1,
      'heading',
      (e: Editor) => e.chain().focus().toggleHeading({ level: 1 }).run(),
      { level: 1 },
    ],
    [
      'Heading 2',
      Heading2,
      'heading',
      (e: Editor) => e.chain().focus().toggleHeading({ level: 2 }).run(),
      { level: 2 },
    ],
    [
      'Heading 3',
      Heading3,
      'heading',
      (e: Editor) => e.chain().focus().toggleHeading({ level: 3 }).run(),
      { level: 3 },
    ],
    [
      'Numbered list',
      ListOrdered,
      'orderedList',
      (e: Editor) => e.chain().focus().toggleOrderedList().run(),
    ],
    [
      'Highlight',
      Highlighter,
      'highlight',
      (e: Editor) => e.chain().focus().toggleHighlight().run(),
    ],
    ['Quote', Quote, 'blockquote', (e: Editor) => e.chain().focus().toggleBlockquote().run()],
    ['Inline code', Code, 'code', (e: Editor) => e.chain().focus().toggleCode().run()],
    ['Code block', CodeXml, 'codeBlock', (e: Editor) => e.chain().focus().toggleCodeBlock().run()],
    ['Divider', Minus, '', (e: Editor) => e.chain().focus().setHorizontalRule().run()],
    ['Undo', Undo2, '', (e: Editor) => e.chain().focus().undo().run()],
    ['Redo', Redo2, '', (e: Editor) => e.chain().focus().redo().run()],
    ['Link', Link2, 'link', editLink],
  ] as const

  const inlineTools = tools.filter((tool) => {
    const mark = tool[2]
    return (
      mark === 'bold' ||
      mark === 'italic' ||
      mark === 'underline' ||
      mark === 'strike' ||
      mark === 'highlight' ||
      mark === 'code' ||
      mark === 'link'
    )
  })

  return { tools, inlineTools }
}

type FormattingTools = ReturnType<typeof createFormattingTools>
export type InlineTool = FormattingTools['inlineTools'][number]

export function EditorFormatting({
  tools,
  getEditor,
  epoch,
}: {
  tools: FormattingTools['tools']
  getEditor: () => Editor | undefined
  epoch: () => number
}) {
  const renderTools = (start: () => number, end: () => number) => (
    <For each={tools.slice(start(), end())}>
      {([label, Icon, mark, action, attributes]) => {
        const active = createMemo(() => {
          epoch()
          return mark ? (getEditor()?.isActive(mark, attributes) ?? false) : undefined
        })
        const keys = label === 'Undo' || label === 'Redo' ? undefined : shortcuts[label]
        const run = () => {
          const editor = getEditor()
          if (editor) action(editor)
        }
        return (
          <Show
            when={mark && mark !== 'link'}
            fallback={
              <Button
                title={keys ? `${label} (${shortcutLabel(keys)})` : label}
                aria-keyshortcuts={keys ? `${modifier}+${keys}` : undefined}
                aria-label={label}
                aria-haspopup={mark === 'link' ? 'dialog' : undefined}
                onClick={run}
              >
                <Icon size={18} aria-hidden="true" />
              </Button>
            }
          >
            <ToggleButton
              title={keys ? `${label} (${shortcutLabel(keys)})` : label}
              aria-keyshortcuts={keys ? `${modifier}+${keys}` : undefined}
              aria-label={label}
              pressed={active()}
              onChange={run}
            >
              <Icon size={18} aria-hidden="true" />
            </ToggleButton>
          </Show>
        )
      }}
    </For>
  )

  return <FormattingDock toolCount={tools.length} tools={renderTools} />
}
