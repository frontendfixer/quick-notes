import { Button } from '@kobalte/core/button'
import { Calendar, CircleAlert, FileText, Folder, Pin } from 'lucide-solid'
import { Show } from 'solid-js'
import type { Summary } from '../../../../packages/contracts'

const dateFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

export function NoteRow(props: {
  id: string
  note: Summary | undefined
  title: string
  current: boolean
  folderName?: string
  hasConflict: boolean
  onOpen: () => void
}) {
  return (
    <Button
      class="note-row"
      data-note-id={props.id}
      aria-current={props.current ? 'true' : undefined}
      aria-label={props.title}
      onClick={props.onOpen}
    >
      <span class="row-icon">
        <FileText size={22} aria-hidden="true" />
      </span>
      <span class="row-copy">
        <strong>{props.title}</strong>
        <Show when={props.note?.preview}>
          <small class="row-preview">{props.note?.preview}</small>
        </Show>
        <small class="row-meta">
          <Calendar size={12} aria-hidden="true" />
          <span>{props.note ? dateFormat.format(new Date(props.note.updatedAt)) : ''}</span>
          <Show when={props.folderName}>
            <span aria-hidden="true">·</span>
            <Folder size={12} aria-hidden="true" />
            <span class="row-folder">{props.folderName}</span>
          </Show>
        </small>
      </span>
      <span class="row-state">
        <Show when={props.hasConflict}>
          <CircleAlert size={14} aria-label="Conflict" />
        </Show>
        <Show when={props.note?.pinned}>
          <Pin size={15} fill="currentColor" aria-label="Pinned" />
        </Show>
      </span>
    </Button>
  )
}
