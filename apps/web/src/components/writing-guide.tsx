import * as Dialog from '@kobalte/core/dialog'
import { Button } from '@kobalte/core/button'
import { Show, Suspense, createSignal } from 'solid-js'
import source from '../../../../docs/writing-notes.md?raw'
import { RichEditor } from '../workspace'

const heading = source.indexOf('\n')
export const writingGuideTitle = source.slice(2, heading)

export function createWritingGuide(owner: () => string | undefined) {
  const [open, setOpen] = createSignal(false)
  const [removedFor, setRemovedFor] = createSignal<string>()
  const storageKey = () => `quick-notes:writing-guide-removed:${owner()}`
  const pinned = () => {
    const account = owner()
    if (!account || removedFor() === account) return false
    try {
      return localStorage.getItem(storageKey()) !== 'true'
    } catch {
      return true
    }
  }
  const remove = () => {
    setRemovedFor(owner())
    try {
      localStorage.setItem(storageKey(), 'true')
    } catch {
      // Keep the guide hidden for the current session when storage is unavailable.
    }
    setOpen(false)
  }

  let returnFocus: (() => HTMLElement | null | undefined) | undefined
  const Guide = () => (
    <Dialog.Root open={open()} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay class="confirmation-backdrop" />
        <Dialog.Content
          class="confirmation-dialog writing-guide"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            returnFocus?.()?.focus({ preventScroll: true })
          }}
        >
          <header class="writing-guide-header">
            <Dialog.Title as="h2">{writingGuideTitle}</Dialog.Title>
            <Dialog.CloseButton class="secondary" aria-label="Close">
              Close
            </Dialog.CloseButton>
          </header>
          <div class="writing-guide-body">
            <Suspense fallback={<p>Opening guide…</p>}>
              <RichEditor
                initial={source.slice(heading + 1)}
                editable={() => false}
                changed={() => undefined}
                composition={() => undefined}
              />
            </Suspense>
          </div>
          <Show when={pinned()}>
            <footer class="confirmation-actions">
              <Button class="secondary" onClick={remove}>
                Remove from note list
              </Button>
            </footer>
          </Show>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
  return {
    pinned,
    show: (trigger: () => HTMLElement | null | undefined) => {
      returnFocus = trigger
      setOpen(true)
    },
    Guide,
  }
}
