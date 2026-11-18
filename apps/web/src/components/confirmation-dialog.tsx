import * as AlertDialog from '@kobalte/core/alert-dialog'
import { Show, type JSX } from 'solid-js'

export function ConfirmationDialog(props: {
  trigger?: JSX.Element
  triggerClass?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onCloseAutoFocus?: (event: Event) => void
  triggerLabel?: string
  disabled?: boolean
  title: string
  description: JSX.Element
  confirmLabel: string
  onConfirm: () => void
}) {
  let trigger: HTMLButtonElement | undefined
  return (
    <AlertDialog.Root
      open={props.open}
      onOpenChange={(open) => {
        props.onOpenChange?.(open)
        if (!open) requestAnimationFrame(() => trigger?.focus({ preventScroll: true }))
      }}
    >
      <Show when={props.trigger}>
        <AlertDialog.Trigger
          ref={(node) => {
            trigger = node
          }}
          class={props.triggerClass}
          title={props.triggerLabel}
          aria-label={props.triggerLabel}
          disabled={props.disabled}
        >
          {props.trigger}
        </AlertDialog.Trigger>
      </Show>
      <AlertDialog.Portal>
        <AlertDialog.Overlay class="confirmation-backdrop" />
        <AlertDialog.Content class="confirmation-dialog" onCloseAutoFocus={props.onCloseAutoFocus}>
          <AlertDialog.Title as="h2">{props.title}</AlertDialog.Title>
          <AlertDialog.Description>{props.description}</AlertDialog.Description>
          <div class="confirmation-actions">
            <AlertDialog.CloseButton class="secondary" aria-label="Cancel">
              Cancel
            </AlertDialog.CloseButton>
            <AlertDialog.CloseButton
              class="secondary danger-action"
              aria-label={props.confirmLabel}
              onClick={props.onConfirm}
            >
              {props.confirmLabel}
            </AlertDialog.CloseButton>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
