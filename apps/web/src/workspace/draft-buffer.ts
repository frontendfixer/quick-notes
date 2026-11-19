import { createMemo, createSignal, type Accessor } from 'solid-js'
import { plainText, type NoteFields } from '../../../../packages/contracts'
import { local, type Draft } from '../storage'

type PendingEdit = {
  owner: string
  id: string
  base: number | null
  fields: () => NoteFields
  changedAt: string
  generation: string
}
type DraftBufferOptions = {
  owner: Accessor<string | undefined>
  open: Accessor<{ id: string; base: number | null } | undefined>
  scheduleUpload: () => void
  onPersisted: (id: string) => void
  onSaveStatus: (status: string) => void
  onFlushSuccess: () => void
  onStorageError: () => void
}

export function createDraftBuffer({
  owner,
  open,
  scheduleUpload,
  onPersisted,
  onSaveStatus,
  onFlushSuccess,
  onStorageError,
}: DraftBufferOptions) {
  const [drafts, setDrafts] = createSignal<Draft[]>([])
  let draftEpoch = 0
  let queue: Promise<unknown> = Promise.resolve()
  let localTimer: ReturnType<typeof setTimeout> | undefined
  const pending = new Map<string, PendingEdit>()

  // Local edits and upload acknowledgements share one queue to preserve generation ordering.
  const ordered = <T>(work: () => Promise<T>) => {
    const result = queue.then(work)
    queue = result.catch(() => undefined)
    return result
  }
  const draftById = createMemo(() => new Map(drafts().map((draft) => [draft.id, draft])))
  const draftFor = (id: string) => draftById().get(id)
  async function loadLocal(id = owner()) {
    if (!id) return
    const check = ++draftEpoch
    const items = await local.drafts(id)
    if (owner() === id && draftEpoch === check) setDrafts(items)
  }

  function queueEdit(edit: PendingEdit) {
    pending.set(edit.id, edit)
    localTimer ??= setTimeout(() => {
      void flushEdits()
    }, 45)
    scheduleUpload()
  }

  async function flushEdits() {
    clearTimeout(localTimer)
    localTimer = undefined
    return ordered(async () => {
      try {
        // Snapshot the queue before awaiting writes so new edits get their own flush.
        const edits = Array.from(pending.values())
        for (const item of edits) {
          const current = open()
          const fields = item.fields()
          const base = current?.id === item.id ? current.base : item.base
          const saved = await local.change(item.owner, item.id, (previous) => {
            if (
              !previous &&
              base === null &&
              !fields.title.trim() &&
              !plainText(fields.document).trim()
            ) {
              return undefined
            }
            return {
              ...previous,
              owner: item.owner,
              id: item.id,
              changedAt: item.changedAt,
              generation: item.generation,
              fields,
              base: previous ? previous.base : base,
              error: undefined,
            }
          })
          if (pending.get(item.id) === item) pending.delete(item.id)
          if (saved && owner() === item.owner) {
            onPersisted(item.id)
            ++draftEpoch
            setDrafts((current) => {
              const index = current.findIndex(({ id }) => id === saved.id)
              return index === -1
                ? [saved, ...current]
                : current.map((item, i) => (i === index ? saved : item))
            })
          }
          if (open()?.id === item.id && !pending.has(item.id))
            onSaveStatus(saved ? 'Saved on device' : '')
        }
        onFlushSuccess()
        return true
      } catch {
        onStorageError()
        return false
      }
    })
  }

  return {
    drafts,
    draftFor,
    loadLocal,
    queueEdit,
    flushEdits,
    ordered,
    pending: pending as ReadonlyMap<string, PendingEdit>,
    clearDrafts: () => setDrafts([]),
  }
}
