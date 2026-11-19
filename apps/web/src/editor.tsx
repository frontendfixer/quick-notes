import { EditorContextMenu } from './editor/context-menu'
import { createFormattingTools, EditorFormatting } from './editor/formatting'
import { NoteImage, pasteImageUrl } from './editor/images'
import { createLinkDialog } from './editor/link-dialog'
import { Editor, Extension, type JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { Markdown } from '@tiptap/markdown'
import { createEffect, createSignal, Show, onCleanup, onMount } from 'solid-js'
import { noteLink, type NoteFields } from '../../../packages/contracts'

export default function RichEditor(props: {
  initial: NoteFields['document']
  editable: () => boolean
  changed: (read: () => JSONContent) => void
  composition: (active: boolean) => void
}) {
  let element!: HTMLDivElement
  let editor: Editor | undefined
  const getEditor = () => editor
  const { editLink, LinkDialog } = createLinkDialog(getEditor, props.editable)
  const { tools, inlineTools } = createFormattingTools(editLink)
  const [epoch, bump] = createSignal(0)
  const refreshToolbar = () => bump((value) => value + 1)
  onMount(() => {
    editor = new Editor({
      element,
      editable: props.editable(),
      injectCSS: false,
      content: props.initial,
      extensions: [
        StarterKit.configure({
          link: {
            openOnClick: false,
            markdownLinks: true,
            isAllowedUri: (url) => noteLink.safeParse(url).success,
          },
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Highlight,
        NoteImage,
        TableKit,
        Markdown.configure({ markedOptions: { gfm: true } }),
        Extension.create({
          name: 'noteShortcuts',
          addKeyboardShortcuts() {
            return {
              'Mod-Shift-k': () => {
                if (!this.editor.isEditable) return false
                editLink()
                return true
              },
              'Mod-Alt-Shift-d': () =>
                this.editor.isEditable && this.editor.commands.setHorizontalRule(),
            }
          },
        }),
      ],
      editorProps: {
        attributes: { 'aria-label': 'Note content', role: 'textbox', 'aria-multiline': 'true' },
        handlePaste: (_view, event) =>
          Boolean(
            editor?.isEditable &&
            !event.clipboardData?.files.length &&
            pasteImageUrl(editor, event.clipboardData?.getData('text/plain')),
          ),
        clipboardTextSerializer: ({ content }) =>
          content.textBetween(0, content.size, '\n', (node) => {
            if (node.type.name === 'hardBreak') return '\n'
            if (node.type.name === 'image') return node.attrs.alt ?? ''
            return ''
          }),
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

  return (
    <>
      <EditorContextMenu
        ref={(node) => {
          element = node
        }}
        getEditor={getEditor}
        editable={props.editable()}
        composition={props.composition}
        epoch={epoch}
        inlineTools={inlineTools}
      />
      <Show when={props.editable()}>
        <EditorFormatting tools={tools} getEditor={getEditor} epoch={epoch} />
      </Show>
      <LinkDialog />
    </>
  )
}
