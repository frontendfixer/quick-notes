import { Editor, type JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { For, createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import type { NoteFields } from '../../../packages/contracts'

export default function RichEditor(props: {
  initial: NoteFields['document']
  editable: () => boolean
  changed: (read: () => JSONContent) => void
  composition: (active: boolean) => void
}) {
  let element!: HTMLDivElement
  let editor: Editor | undefined
  const [epoch, bump] = createSignal(0)
  const refreshToolbar = () => bump((value) => value + 1)
  const tools = [
    ['Bold', 'B', 'bold', (e: Editor) => e.chain().focus().toggleBold().run()],
    ['Italic', 'I', 'italic', (e: Editor) => e.chain().focus().toggleItalic().run()],
    ['Underline', 'U', 'underline', (e: Editor) => e.chain().focus().toggleUnderline().run()],
    ['Strikethrough', 'S', 'strike', (e: Editor) => e.chain().focus().toggleStrike().run()],
    [
      'Heading 1',
      'H1',
      'heading',
      (e: Editor) => e.chain().focus().toggleHeading({ level: 1 }).run(),
      { level: 1 },
    ],
    [
      'Heading 2',
      'H2',
      'heading',
      (e: Editor) => e.chain().focus().toggleHeading({ level: 2 }).run(),
      { level: 2 },
    ],
    [
      'Heading 3',
      'H3',
      'heading',
      (e: Editor) => e.chain().focus().toggleHeading({ level: 3 }).run(),
      { level: 3 },
    ],
    ['Bullets', '• List', 'bulletList', (e: Editor) => e.chain().focus().toggleBulletList().run()],
    [
      'Numbered list',
      '1. List',
      'orderedList',
      (e: Editor) => e.chain().focus().toggleOrderedList().run(),
    ],
    ['Checklist', '☑ List', 'taskList', (e: Editor) => e.chain().focus().toggleTaskList().run()],
    ['Highlight', 'Mark', 'highlight', (e: Editor) => e.chain().focus().toggleHighlight().run()],
    ['Undo', '↶', '', (e: Editor) => e.chain().focus().undo().run()],
    ['Redo', '↷', '', (e: Editor) => e.chain().focus().redo().run()],
  ] as const

  onMount(() => {
    editor = new Editor({
      element,
      editable: props.editable(),
      injectCSS: false,
      content: props.initial,
      extensions: [
        StarterKit.configure({
          blockquote: false,
          code: false,
          codeBlock: false,
          horizontalRule: false,
          heading: { levels: [1, 2, 3] },
          link: { openOnClick: false },
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Highlight,
      ],
      editorProps: {
        attributes: { 'aria-label': 'Note content', role: 'textbox', 'aria-multiline': 'true' },
      },
      onUpdate({ editor }) {
        const document = editor.state.doc
        props.changed(() => document.toJSON())
      },
      onTransaction: refreshToolbar,
    })
    refreshToolbar()
  })
  createEffect(() => {
    epoch()
    const editable = props.editable()
    if (editor && editor.isEditable !== editable) editor.setEditable(editable, false)
  })
  onCleanup(() => editor?.destroy())

  function editLink() {
    if (!editor) return
    const value = window.prompt(
      'Link URL (https:// or mailto:)',
      editor.getAttributes('link').href ?? '',
    )
    if (value === null) return
    if (!value.trim()) editor.chain().focus().extendMarkRange('link').unsetLink().run()
    else if (/^(https?:\/\/|mailto:)/i.test(value.trim())) {
      editor.chain().focus().extendMarkRange('link').setLink({ href: value.trim() }).run()
    } else window.alert('Enter an http, https, or mailto URL.')
  }

  return (
    <>
      <div class="toolbar" role="group" aria-label="Formatting">
        <For each={tools}>
          {([label, display, mark, action, attributes]) => (
            <button
              type="button"
              title={label}
              aria-label={label}
              disabled={!props.editable()}
              aria-pressed={
                mark ? (epoch(), editor?.isActive(mark, attributes) ?? false) : undefined
              }
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => editor && action(editor)}
            >
              {display}
            </button>
          )}
        </For>
        <button
          disabled={!props.editable()}
          onMouseDown={(event) => event.preventDefault()}
          onClick={editLink}
        >
          Link
        </button>
      </div>
      <div
        ref={(node) => {
          element = node
        }}
        class="document"
        onCompositionStart={() => props.composition(true)}
        onCompositionEnd={() => props.composition(false)}
      />
    </>
  )
}
