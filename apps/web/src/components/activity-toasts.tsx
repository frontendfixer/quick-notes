import { Button } from '@kobalte/core/button'
import * as Toast from '@kobalte/core/toast'
import { Check, CircleAlert, X } from 'lucide-solid'
import { Show } from 'solid-js'

export function notify(message: string, options: { error?: boolean; undo?: () => void } = {}) {
  Toast.toaster.show(
    ({ toastId }) => (
      <Toast.Root
        toastId={toastId}
        class="activity-toast"
        data-error={options.error ? '' : undefined}
        duration={options.error ? 5000 : 3000}
        priority="high"
      >
        <span class="activity-toast-icon">
          <Show when={options.error} fallback={<Check size={16} aria-hidden="true" />}>
            <CircleAlert size={16} aria-hidden="true" />
          </Show>
        </span>
        <Toast.Title class="activity-toast-title">{message}</Toast.Title>
        <Show when={options.undo} keyed>
          {(undo) => (
            <Button
              class="activity-toast-undo"
              onClick={() => {
                Toast.toaster.dismiss(toastId)
                undo()
              }}
            >
              Undo
            </Button>
          )}
        </Show>
        <Toast.CloseButton
          class="icon-button activity-toast-close"
          aria-label="Dismiss notification"
        >
          <X size={16} aria-hidden="true" />
        </Toast.CloseButton>
      </Toast.Root>
    ),
    { region: 'activity' },
  )
}

export function clearNotifications() {
  Toast.toaster.clear()
}

export function ActivityToasts(props: { editorOpen: boolean }) {
  return (
    <Toast.Region
      regionId="activity"
      aria-label="Notifications"
      classList={{ 'activity-region': true, 'activity-region-editor': props.editorOpen }}
      duration={3000}
      pauseOnPageIdle={false}
      limit={3}
      swipeDirection="down"
      topLayer
    >
      <Toast.List class="activity-list" />
    </Toast.Region>
  )
}
