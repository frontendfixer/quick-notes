import { ToggleButton } from '@kobalte/core/toggle-button'
import { Button } from '@kobalte/core/button'
import { Popover } from '@kobalte/core/popover'
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Check,
  CircleAlert,
  Cloud,
  Download,
  Ellipsis,
  FileText,
  Folder as FolderIcon,
  Pin,
  Printer,
  RefreshCw,
  RotateCcw,
  Trash2,
  WifiOff,
} from 'lucide-solid'
import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import type { Folder, NoteFields } from '../../../../packages/contracts'
import { ConfirmationDialog } from './confirmation-dialog'
import { FolderPicker } from './folder-picker'

export function NoteToolbar(props: {
  visible: boolean
  fields: NoteFields
  folders: Folder[]
  canEdit: boolean
  canRestore: boolean
  canDeletePermanently: boolean
  title: string
  refreshing: boolean
  exportingPdf: boolean
  onPrint: () => void
  onDownloadPdf: () => void
  onRefresh: () => void
  onDeletePermanently: () => void
  hasSavedNote: boolean
  saveState: string
  saveLabel: string
  saveProblem: boolean
  offline: boolean
  onBack: () => void
  onMove: (folderId: string | null) => void
  onPin: () => void
  onArchive: () => void
  onTrash: () => void
  onRestore: () => void
}) {
  const compactLayout = matchMedia('(max-width: 900px)')
  const [compact, setCompact] = createSignal(compactLayout.matches)
  const [actionsOpen, setActionsOpen] = createSignal(false)
  let moreTrigger: HTMLButtonElement | undefined

  onMount(() => {
    const onLayout = () => setCompact(compactLayout.matches)
    compactLayout.addEventListener('change', onLayout)
    onCleanup(() => compactLayout.removeEventListener('change', onLayout))
  })

  createEffect(() => {
    if (!props.visible || !compact()) setActionsOpen(false)
  })

  const context = () => {
    if (props.fields.deleted) return { label: 'Trash', icon: Trash2 }
    if (props.fields.archived) return { label: 'Archive', icon: Archive }
    const folder = props.folders.find((folder) => folder.id === props.fields.folderId)
    return { label: folder?.name ?? 'Notes', icon: folder ? FolderIcon : FileText }
  }
  const saveIcon = () => {
    if (props.saveProblem) return CircleAlert
    if (props.saveState === 'Saved to server') return Check
    return props.offline ? WifiOff : Cloud
  }

  return (
    <header class="note-topbar">
      <div class="note-location">
        <Button
          class="icon-button back"
          aria-label="Back to notes"
          title="Back to notes"
          onClick={props.onBack}
        >
          <ArrowLeft size={19} aria-hidden="true" />
        </Button>
        <div class="note-context" title={context().label}>
          <Dynamic component={context().icon} size={16} aria-hidden="true" />
          <span>{context().label}</span>
        </div>
      </div>
      <div class="note-actions">
        <Show when={props.saveState}>
          <span
            classList={{ 'save-chip': true, 'save-problem': props.saveProblem }}
            title={props.saveLabel}
            role="status"
            data-save-state={props.saveState}
          >
            <Dynamic component={saveIcon()} size={15} aria-hidden="true" />
            <span>{props.saveLabel}</span>
          </span>
        </Show>
        <Button
          class="icon-button"
          title="Print this note as a PDF"
          aria-label="Print note"
          disabled={props.exportingPdf}
          onClick={props.onPrint}
        >
          <Printer size={17} aria-hidden="true" />
        </Button>
        <Button
          class="icon-button"
          title="Download this note as a PDF"
          aria-label="Download PDF"
          disabled={props.exportingPdf}
          onClick={props.onDownloadPdf}
        >
          <Download size={17} aria-hidden="true" />
        </Button>
        <Button
          class="icon-button"
          title="Refresh note"
          aria-label="Refresh note"
          disabled={props.refreshing}
          onClick={props.onRefresh}
        >
          <RefreshCw size={17} aria-hidden="true" />
        </Button>
        <Show when={props.hasSavedNote}>
          <Show
            when={!props.fields.deleted}
            fallback={
              <>
                <Button
                  class="secondary note-restore"
                  title="Restore note from Trash"
                  disabled={!props.canRestore}
                  onClick={props.onRestore}
                >
                  <RotateCcw size={16} aria-hidden="true" />
                  Restore
                </Button>
                <ConfirmationDialog
                  trigger={<Trash2 size={17} aria-hidden="true" />}
                  triggerClass="icon-button danger-action"
                  triggerLabel="Delete permanently"
                  disabled={!props.canDeletePermanently}
                  title="Delete note permanently?"
                  description={
                    <>
                      <strong>{props.title}</strong> will be permanently deleted. This cannot be
                      undone.
                    </>
                  }
                  confirmLabel="Delete permanently"
                  onConfirm={props.onDeletePermanently}
                />
              </>
            }
          >
            <Show when={props.fields.archived}>
              <Button
                class="secondary note-unarchive"
                title="Unarchive note"
                aria-label="Unarchive note"
                disabled={!props.canEdit}
                onClick={props.onArchive}
              >
                <ArchiveRestore size={16} aria-hidden="true" />
                <span>Unarchive</span>
              </Button>
            </Show>
            <Show when={compact()} fallback={<NoteActions {...props} />}>
              <Popover
                modal={false}
                placement="bottom-end"
                gutter={8}
                overflowPadding={12}
                open={actionsOpen()}
                onOpenChange={setActionsOpen}
              >
                <Popover.Trigger
                  class="icon-button note-more"
                  aria-label="More note actions"
                  title="More note actions"
                  ref={(node) => {
                    moreTrigger = node
                  }}
                >
                  <Ellipsis size={20} aria-hidden="true" />
                </Popover.Trigger>
                <Popover.Content
                  class="note-more-popover"
                  aria-label="Note actions"
                  onEscapeKeyDown={() =>
                    requestAnimationFrame(() => moreTrigger?.focus({ preventScroll: true }))
                  }
                >
                  <NoteActions
                    {...props}
                    onArchive={() => {
                      setActionsOpen(false)
                      props.onArchive()
                    }}
                    onTrash={() => {
                      setActionsOpen(false)
                      props.onTrash()
                    }}
                  />
                </Popover.Content>
              </Popover>
            </Show>
          </Show>
        </Show>
      </div>
    </header>
  )
}

function NoteActions(props: {
  fields: NoteFields
  folders: Folder[]
  canEdit: boolean
  onMove: (folderId: string | null) => void
  onPin: () => void
  onArchive: () => void
  onTrash: () => void
}) {
  const pinLabel = () => (props.fields.pinned ? 'Unpin note' : 'Pin note')

  return (
    <div class="note-action-list">
      <Show when={props.folders.length > 0 || props.fields.folderId}>
        <FolderPicker
          folders={props.folders}
          selected={props.fields.folderId}
          disabled={!props.canEdit}
          onSelect={props.onMove}
        />
      </Show>
      <ToggleButton
        class="icon-button"
        pressed={props.fields.pinned}
        disabled={!props.canEdit}
        title={pinLabel()}
        aria-label={pinLabel()}
        onChange={props.onPin}
      >
        <Pin size={17} aria-hidden="true" />
        <span class="mobile-action-label">{pinLabel()}</span>
      </ToggleButton>
      <Show when={!props.fields.archived}>
        <Button
          class="icon-button"
          disabled={!props.canEdit}
          title="Archive note"
          aria-label="Archive note"
          onClick={props.onArchive}
        >
          <Archive size={17} aria-hidden="true" />
          <span class="mobile-action-label">Archive note</span>
        </Button>
      </Show>
      <Button
        class="icon-button danger-action"
        title="Move to trash"
        aria-label="Move to trash"
        disabled={!props.canEdit}
        onClick={props.onTrash}
      >
        <Trash2 size={17} aria-hidden="true" />
        <span class="mobile-action-label">Move to Trash</span>
      </Button>
    </div>
  )
}
