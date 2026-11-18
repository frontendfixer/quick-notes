import { Alert } from '@kobalte/core/alert'
import { Button } from '@kobalte/core/button'
import * as Dialog from '@kobalte/core/dialog'
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
import { Editor, type JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { For, createEffect, createMemo, createSignal, Show, onCleanup, onMount } from 'solid-js'
import FormattingDock from './formatting-dock'
import { notify } from './components/activity-toasts'
import { TextInput } from './components/text-input'
import { noteLink, type NoteFields } from '../../../packages/contracts'

export default function RichEditor(props: {
  initial: NoteFields['document']
  editable: () => boolean
  changed: (read: () => JSONContent) => void
  composition: (active: boolean) => void
}) {
  let element!: HTMLDivElement
  let editor: Editor | undefined
  const [linkOpen, setLinkOpen] = createSignal(false)
  const [linkUrl, setLinkUrl] = createSignal('')
  const [linkError, setLinkError] = createSignal('')
  const [epoch, bump] = createSignal(0)
  const refreshToolbar = () => bump((value) => value + 1)
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

  onMount(() => {
    editor = new Editor({
      element,
      editable: props.editable(),
      injectCSS: false,
      content: props.initial,
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          link: { openOnClick: false, isAllowedUri: (url) => noteLink.safeParse(url).success },
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
    if (!editor?.isEditable) return
    setLinkUrl(editor.getAttributes('link').href ?? '')
    setLinkError('')
    setLinkOpen(true)
  }

  function saveLink(event: SubmitEvent) {
    event.preventDefault()
    if (!editor?.isEditable) return
    const url = linkUrl().trim()
    if (url && !noteLink.safeParse(url).success) {
      setLinkError('Enter a valid http, https, or mailto URL of up to 2,048 characters.')
      return
    }
    const command = editor.chain().extendMarkRange('link')
    const saved = !url
      ? command.unsetLink().run()
      : editor.state.selection.empty && !editor.isActive('link')
        ? command
            .insertContent({
              type: 'text',
              text: url,
              marks: [{ type: 'link', attrs: { href: url } }],
            })
            .command(({ tr, state }) => {
              tr.removeStoredMark(state.schema.marks.link)
              return true
            })
            .run()
        : command.setLink({ href: url }).run()
    if (!saved) {
      setLinkError('Select text that supports links or place the cursor in a paragraph.')
      return
    }
    setLinkOpen(false)
    notify(url ? 'Link saved' : 'Link removed')
  }

  const renderTools = (start: () => number, end: () => number) => (
    <For each={tools.slice(start(), end())}>
      {([label, Icon, mark, action, attributes]) => {
        const active = createMemo(() => {
          epoch()
          return mark ? (editor?.isActive(mark, attributes) ?? false) : undefined
        })
        const run = () => {
          if (editor) action(editor)
        }
        return (
          <Show
            when={mark && mark !== 'link'}
            fallback={
              <Button
                title={label}
                aria-label={label}
                aria-haspopup={mark === 'link' ? 'dialog' : undefined}
                onClick={run}
              >
                <Icon size={18} aria-hidden="true" />
              </Button>
            }
          >
            <ToggleButton title={label} aria-label={label} pressed={active()} onChange={run}>
              <Icon size={18} aria-hidden="true" />
            </ToggleButton>
          </Show>
        )
      }}
    </For>
  )

  return (
    <>
      <div
        ref={(node) => {
          element = node
        }}
        class="document"
        onCompositionStart={() => props.composition(true)}
        onCompositionEnd={() => props.composition(false)}
      />
      <Show when={props.editable()}>
        <FormattingDock toolCount={tools.length} tools={renderTools} />
      </Show>
      <Dialog.Root open={linkOpen() && props.editable()} onOpenChange={setLinkOpen}>
        <Dialog.Portal>
          <Dialog.Overlay class="confirmation-backdrop" />
          <Dialog.Content
            class="confirmation-dialog"
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              if (editor?.isEditable) editor.commands.focus()
            }}
          >
            <Dialog.Title as="h2">Edit link</Dialog.Title>
            <Dialog.Description>
              Select text to link it, or insert the URL at the cursor. Clear the URL to remove a
              link.
            </Dialog.Description>
            <form class="link-form" onSubmit={saveLink}>
              <label>
                Link URL
                <TextInput
                  name="url"
                  value={linkUrl()}
                  placeholder="https://"
                  aria-invalid={Boolean(linkError())}
                  aria-describedby={linkError() ? 'note-link-error' : undefined}
                  onInput={(event) => {
                    setLinkUrl(event.currentTarget.value)
                    setLinkError('')
                  }}
                />
              </label>
              <Show when={linkError()}>
                <Alert as="p" id="note-link-error" class="inline-error">
                  {linkError()}
                </Alert>
              </Show>
              <div class="confirmation-actions">
                <Dialog.CloseButton class="secondary" aria-label="Cancel">
                  Cancel
                </Dialog.CloseButton>
                <Button type="submit" class="primary">
                  Save link
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
