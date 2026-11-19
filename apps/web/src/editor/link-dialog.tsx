import { Alert } from '@kobalte/core/alert'
import { Button } from '@kobalte/core/button'
import * as Dialog from '@kobalte/core/dialog'
import { Editor } from '@tiptap/core'
import { createSignal, Show } from 'solid-js'
import { notify } from '../components/activity-toasts'
import { TextInput } from '../components/text-input'
import { noteLink } from '../../../../packages/contracts'

export function createLinkDialog(getEditor: () => Editor | undefined, editable: () => boolean) {
  const [linkOpen, setLinkOpen] = createSignal(false)
  const [linkUrl, setLinkUrl] = createSignal('')
  const [linkError, setLinkError] = createSignal('')
  function editLink() {
    const editor = getEditor()
    if (!editor?.isEditable) return
    setLinkUrl(editor.getAttributes('link').href ?? '')
    setLinkError('')
    setLinkOpen(true)
  }

  function saveLink(event: SubmitEvent) {
    event.preventDefault()
    const editor = getEditor()
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

  const LinkDialog = () => (
    <Dialog.Root open={linkOpen() && editable()} onOpenChange={setLinkOpen}>
      <Dialog.Portal>
        <Dialog.Overlay class="confirmation-backdrop" />
        <Dialog.Content
          class="confirmation-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const editor = getEditor()
            if (editor?.isEditable) editor.commands.focus()
          }}
        >
          <Dialog.Title as="h2">Edit link</Dialog.Title>
          <Dialog.Description>
            Select text to link it, or insert the URL at the cursor. Clear the URL to remove a link.
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
              <Dialog.CloseButton class="secondary" aria-label="Cancel" title="Cancel">
                Cancel
              </Dialog.CloseButton>
              <Button type="submit" class="primary" title="Save link">
                Save link
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )

  return { editLink, LinkDialog }
}
