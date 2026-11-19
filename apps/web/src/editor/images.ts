import type { Editor } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import { noteImage } from '../../../../packages/contracts'

export const NoteImage = Image.extend({
  parseHTML() {
    return [
      {
        tag: 'img[src]',
        getAttrs: (element) =>
          noteImage.safeParse(element.getAttribute('src')).success ? null : false,
      },
    ]
  },
  addInputRules: () => [],
}).configure({ inline: true, HTMLAttributes: { referrerpolicy: 'no-referrer' } })

export function pasteImageUrl(editor: Editor, text: string | undefined) {
  if (editor.state.selection.$from.parent.type.spec.code) return false
  const url = noteImage.safeParse(text?.trim())
  if (
    !url.success ||
    !/\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(new URL(url.data).pathname)
  )
    return false

  return editor.commands.setImage({ src: url.data })
}
