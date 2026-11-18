import { Alert } from '@kobalte/core/alert'
import * as Dialog from '@kobalte/core/dialog'
import { TextInput } from './text-input'
import { Button } from '@kobalte/core/button'
import {
  Archive,
  ArrowLeft,
  ChevronRight,
  Folder as FolderIcon,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-solid'
import { createSignal, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import type { Folder } from '../../../../packages/contracts'
import { ConfirmationDialog } from './confirmation-dialog'

export function FolderRow(props: { folder: Folder; onOpen: () => void }) {
  return (
    <Button
      class="note-row folder-row"
      data-color={props.folder.id.charCodeAt(0) % 5}
      data-folder-id={props.folder.id}
      aria-label={props.folder.name}
      title={props.folder.name}
      onClick={props.onOpen}
    >
      <span class="row-icon">
        <FolderIcon size={22} aria-hidden="true" />
      </span>
      <span class="row-copy">
        <strong>{props.folder.name}</strong>
        <Show when={props.folder.noteCount !== undefined}>
          <small>
            {props.folder.noteCount} {props.folder.noteCount === 1 ? 'note' : 'notes'}
          </small>
        </Show>
      </span>
      <ChevronRight size={17} class="folder-row-chevron" aria-hidden="true" />
    </Button>
  )
}

const collectionAppearance = {
  folder: {
    icon: FolderIcon,
    emptyTitle: 'No notes in this folder',
    emptyText: 'Create a note to start using this folder.',
  },
  archived: {
    icon: Archive,
    emptyTitle: 'Archive is empty',
    emptyText: 'Notes you archive will appear here.',
    description: 'Keep notes out of your library until you need them again.',
  },
  trash: {
    icon: Trash2,
    emptyTitle: 'Trash is empty',
    emptyText: 'Notes you move to Trash will appear here.',
    description: 'Open a deleted note to restore it.',
  },
}

export type CollectionKind = keyof typeof collectionAppearance

export function EmptyCollection(props: {
  kind: CollectionKind
  mobile?: boolean
  offline: boolean
  canCreate: boolean
  onCreate: () => void
  onBack: () => void
}) {
  const appearance = () => collectionAppearance[props.kind]
  return (
    <section
      classList={{ empty: true, 'collection-empty': true, 'collection-empty-mobile': props.mobile }}
      data-collection-kind={props.kind}
    >
      <div class="empty-icon">
        <Dynamic component={appearance().icon} size={26} aria-hidden="true" />
      </div>
      <h2>{props.offline ? 'No notes on this device' : appearance().emptyTitle}</h2>
      <p>{props.offline ? 'Reconnect to see synced notes.' : appearance().emptyText}</p>
      <Show
        when={props.kind === 'folder'}
        fallback={
          <Button class="secondary" onClick={props.onBack}>
            <ArrowLeft size={16} aria-hidden="true" />
            Back to notes
          </Button>
        }
      >
        <Button class="primary" onClick={props.onCreate} disabled={!props.canCreate}>
          <Plus size={17} aria-hidden="true" />
          Create a note
        </Button>
      </Show>
    </section>
  )
}

export function CollectionPreviewPrompt(props: { kind: 'archived' | 'trash' }) {
  return (
    <section class="empty collection-preview" data-collection-kind={props.kind}>
      <div class="empty-icon">
        <Dynamic component={collectionAppearance[props.kind].icon} size={26} aria-hidden="true" />
      </div>
      <h1>{props.kind === 'archived' ? 'Select an archived note' : 'Select a trashed note'}</h1>
      <p>
        {props.kind === 'archived'
          ? 'Open a note to read, edit, or unarchive it.'
          : 'Open a note to preview or restore it.'}
      </p>
    </section>
  )
}

export function CollectionHeading(props: {
  title: string
  kind: CollectionKind
  canManage: boolean
  onBack: () => void
  onRename: () => void
  onDelete: () => void
}) {
  const description = () => {
    const kind = props.kind
    if (kind !== 'folder') return collectionAppearance[kind].description
  }
  return (
    <header class="collection-heading collection-page-heading" data-collection-kind={props.kind}>
      <Button
        class="icon-button collection-back"
        aria-label="Back to home"
        title="Back to home"
        data-collection-back
        onClick={props.onBack}
      >
        <ArrowLeft size={19} aria-hidden="true" />
        <span>{props.kind === 'folder' ? 'Folders' : 'Notes'}</span>
      </Button>
      <div class="collection-title">
        <span class="collection-icon">
          <Dynamic component={collectionAppearance[props.kind].icon} size={21} aria-hidden="true" />
        </span>
        <div class="collection-title-copy">
          <h2>{props.title}</h2>
          <Show when={description()}>
            <p>{description()}</p>
          </Show>
        </div>
      </div>
      <Show when={props.canManage}>
        <div class="collection-actions">
          <Button
            class="icon-button"
            title="Rename folder"
            aria-label="Rename folder"
            onClick={props.onRename}
          >
            <Pencil size={16} aria-hidden="true" />
          </Button>
          <ConfirmationDialog
            trigger={<Trash2 size={16} aria-hidden="true" />}
            triggerClass="icon-button"
            triggerLabel="Delete folder"
            title="Delete folder?"
            description={
              <>
                <strong>{props.title}</strong> will be deleted. Its notes will move to Trash.
              </>
            }
            confirmLabel="Delete folder"
            onConfirm={props.onDelete}
          />
        </div>
      </Show>
    </header>
  )
}

export function FolderNameForm(props: {
  mode: 'rename' | 'create'
  initialName: string
  busy: boolean
  disabled: boolean
  error: string
  onSubmit: (event: SubmitEvent) => void
  onEdit: () => void
  onCancel: () => void
}) {
  const [folderNameLength, setFolderNameLength] = createSignal(0)
  return (
    <form
      class="folder-form"
      onSubmit={props.onSubmit}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !props.busy) props.onCancel()
      }}
    >
      <label for="folder-name">Folder name</label>
      <div class="folder-form-controls">
        <TextInput
          id="folder-name"
          name="name"
          aria-describedby={props.error ? 'folder-name-help folder-name-error' : 'folder-name-help'}
          aria-invalid={Boolean(props.error)}
          placeholder="Folder name"
          required
          defaultValue={props.initialName}
          onInput={(event) => {
            setFolderNameLength(event.currentTarget.value.trim().length)
            props.onEdit()
          }}
          ref={(input) =>
            queueMicrotask(() => {
              if (!input.isConnected) return
              setFolderNameLength(input.value.length)
              input.focus()
            })
          }
        />
        <div class="folder-form-actions">
          <Button type="button" class="secondary" disabled={props.busy} onClick={props.onCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            class={props.mode === 'create' ? 'primary' : 'secondary'}
            disabled={props.disabled}
          >
            {props.mode === 'create' ? 'Create' : 'Save'}
          </Button>
        </div>
      </div>
      <small id="folder-name-help" class="muted">
        {folderNameLength()}/60 characters
      </small>
      <Show when={props.error}>
        <Alert as="p" id="folder-name-error" class="inline-error">
          {props.error}
        </Alert>
      </Show>
    </form>
  )
}

export function CreateFolderDialog(props: {
  open: boolean
  busy: boolean
  disabled: boolean
  error: string
  onSubmit: (event: SubmitEvent) => void
  onEdit: () => void
  onCancel: () => void
  onClose: () => void
}) {
  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={(open) => {
        if (!open && !props.busy) props.onCancel()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="confirmation-backdrop create-folder-backdrop" />
        <Dialog.Content
          class="confirmation-dialog create-folder-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            props.onClose()
          }}
        >
          <Dialog.Title as="h2">Create folder</Dialog.Title>
          <FolderNameForm
            mode="create"
            initialName=""
            busy={props.busy}
            disabled={props.disabled}
            error={props.error}
            onSubmit={props.onSubmit}
            onEdit={props.onEdit}
            onCancel={props.onCancel}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
