import * as AlertDialog from '@kobalte/core/alert-dialog'
import { Button } from '@kobalte/core/button'
import { RefreshCw } from 'lucide-solid'
import { Show } from 'solid-js'

import type { Workspace } from '../workspace'

type Props = Workspace['updateDialog']

export function UpdateDialog(props: Props) {
  const { restartToUpdate, restarting, setUpdateDeferred, update, updateDeferred } = props
  let updateOrigin: HTMLElement | null = null
  let updateReminder: HTMLButtonElement | undefined
  return (
    <Show when={update()}>
      <AlertDialog.Root
        open={!updateDeferred()}
        onOpenChange={(open) => {
          if (!restarting()) setUpdateDeferred(!open)
        }}
      >
        <Show when={updateDeferred()}>
          <AlertDialog.Trigger
            class="secondary update-reminder"
            ref={(node) => {
              updateReminder = node
            }}
          >
            <RefreshCw size={14} aria-hidden="true" />
            Update available
          </AlertDialog.Trigger>
        </Show>
        <AlertDialog.Portal>
          <AlertDialog.Overlay class="confirmation-backdrop update-backdrop" />
          <AlertDialog.Content
            class="confirmation-dialog update-dialog"
            aria-busy={restarting()}
            onOpenAutoFocus={() => {
              const focused = document.activeElement
              updateOrigin = focused instanceof HTMLElement ? focused : null
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              const target =
                updateOrigin?.isConnected && updateOrigin !== document.body
                  ? updateOrigin
                  : updateReminder
              target?.focus({ preventScroll: true })
            }}
          >
            <span class="update-dialog-icon" aria-hidden="true">
              <RefreshCw size={19} />
            </span>
            <AlertDialog.Title as="h2">Update available</AlertDialog.Title>
            <AlertDialog.Description>
              Restart Quick Notes to get the latest version. Your changes are saved before the app
              reloads.
            </AlertDialog.Description>
            <div class="confirmation-actions">
              <AlertDialog.CloseButton class="secondary" aria-label="Later" disabled={restarting()}>
                Later
              </AlertDialog.CloseButton>
              <Button
                class="primary"
                disabled={restarting()}
                onClick={() => void restartToUpdate()}
              >
                {restarting() ? 'Restarting…' : 'Restart to update'}
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </Show>
  )
}
