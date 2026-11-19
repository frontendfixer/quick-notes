import type { Editor, JSONContent } from '@tiptap/core'
import { noteFields } from '../../../../packages/contracts'
import { notify } from '../components/activity-toasts'
import { pasteImageUrl } from './images'
import { shortcutLabel } from './shortcuts'

function wrapStandaloneImages(node: JSONContent): JSONContent {
  if (!node.content || node.type === 'paragraph' || node.type === 'heading') return node
  return {
    ...node,
    // Tiptap's Markdown parser unwraps image-only paragraphs for its block image schema.
    content: node.content.map((child) =>
      child.type === 'image'
        ? { type: 'paragraph', content: [child] }
        : wrapStandaloneImages(child),
    ),
  }
}

export async function clipboardAction(
  current: Editor | undefined,
  command: 'copy' | 'paste' | 'cut',
) {
  if (!current?.isEditable) return
  current.view.focus()
  if (command !== 'paste') {
    if (!document.execCommand(command)) {
      notify(`Use ${shortcutLabel(command === 'copy' ? 'C' : 'X')} to ${command}.`, {
        error: true,
      })
    }
    return
  }

  // A clipboard read can outlive the selection it was requested for.
  const { doc, selection } = current.state
  try {
    const items = await navigator.clipboard.read()
    const rich = items.find((item) => item.types.includes('text/html'))
    const plain = items.find((item) => item.types.includes('text/plain'))
    const [html, text] = await Promise.all([
      rich?.getType('text/html').then((blob) => blob.text()),
      plain?.getType('text/plain').then((blob) => blob.text()),
    ])
    if (
      !current.isDestroyed &&
      current.isEditable &&
      current.state.doc === doc &&
      current.state.selection.eq(selection)
    ) {
      if (
        !items.some((item) => item.types.some((type) => type.startsWith('image/'))) &&
        pasteImageUrl(current, text)
      )
        return
      if (html) current.view.pasteHTML(html)
      else if (text) current.view.pasteText(text)
    }
  } catch {
    notify(`Use ${shortcutLabel('V')} to paste.`, { error: true })
  }
}

export async function markdownClipboardAction(
  current: Editor | undefined,
  action: 'copy' | 'paste',
) {
  if (!current?.isEditable || !current.markdown) return
  const { doc, selection } = current.state
  try {
    if (action === 'copy') {
      const content = selection.empty ? doc.content : selection.content().content
      await navigator.clipboard.writeText(
        current.markdown.serialize({ type: 'doc', content: content.toJSON() ?? [] }),
      )
      return
    }

    const source = await navigator.clipboard.readText()
    if (
      !source ||
      current.isDestroyed ||
      !current.isEditable ||
      current.state.doc !== doc ||
      !current.state.selection.eq(selection)
    )
      return

    const parsed = noteFields.shape.document.safeParse(
      wrapStandaloneImages(current.markdown.parse(source)),
    )
    if (!parsed.success || !current.chain().focus().insertContent(parsed.data.content).run()) {
      notify('Could not paste this Markdown. Check its links, images, and nesting.', {
        error: true,
      })
    }
  } catch {
    notify(action === 'copy' ? 'Could not copy Markdown.' : 'Could not paste Markdown.', {
      error: true,
    })
  }
}
