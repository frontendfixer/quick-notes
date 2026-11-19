import { onCleanup, type Accessor } from 'solid-js'
import type { Ack, Note, Summary } from '../../../../packages/contracts'
import { local, type Draft } from '../storage'
import { reconcileNotes } from '../reconciliation'
import { notify } from '../components/activity-toasts'

type SyncOptions = {
  owner: Accessor<string | undefined>
  writable: Accessor<boolean>
  authorized: Accessor<boolean>
  unavailable: Accessor<boolean>
  signingOut: Accessor<boolean>
  drafts: Accessor<Draft[]>
  flushEdits: () => Promise<boolean>
  loadLocal: (id: string) => Promise<void>
  ordered: <T>(work: () => Promise<T>) => Promise<T>
  expire: () => void
  storageError: () => void
  openNoteId: Accessor<string | undefined>
  hasPendingEdits: () => boolean
  onPurged: (id: string) => void
  onNoteUpdated: (owner: string, note: Summary) => void
  onUploaded: (owner: string) => void
  onAcknowledged: (draft: Draft, revision: number) => Promise<void>
}

export function createNoteSync({
  owner,
  writable,
  authorized,
  unavailable,
  signingOut,
  drafts,
  flushEdits,
  loadLocal,
  ordered,
  expire,
  storageError,
  openNoteId,
  hasPendingEdits,
  onPurged,
  onNoteUpdated,
  onUploaded,
  onAcknowledged,
}: SyncOptions) {
  let syncBusy = false
  let reconciliationRequested = false
  let uploadTimer: ReturnType<typeof setTimeout> | undefined
  let retryDelay = 1000

  onCleanup(() => clearTimeout(uploadTimer))

  function scheduleUpload(delay: number) {
    clearTimeout(uploadTimer)
    uploadTimer = setTimeout(() => {
      void upload()
    }, delay)
  }

  async function upload(reconcile = false) {
    const id = owner()
    if (!id || !writable() || !authorized() || unavailable() || signingOut()) return
    reconciliationRequested ||= reconcile
    if (syncBusy) return
    syncBusy = true
    const checkLocal = reconciliationRequested
    reconciliationRequested = false
    let uploadedSinceStart = false
    try {
      if (!(await flushEdits())) return
      await loadLocal(id)
      for (const candidate of drafts()) {
        if (!authorized() || owner() !== id || signingOut()) break
        if (candidate.conflict || candidate.error) continue
        // Permanent deletion can follow a confirmed Trash revision or finish locally.
        if (
          candidate.purge &&
          (candidate.purgeRevision || (candidate.base === null && !candidate.sent))
        ) {
          if (candidate.purgeRevision) {
            const result = await fetch('/api/notes/' + candidate.id, {
              method: 'DELETE',
              headers: { 'If-Match': '"' + candidate.purgeRevision + '"' },
              signal: AbortSignal.timeout(5000),
            })
            if (result.status === 401) {
              expire()
              break
            }
            if (result.status === 409) {
              const remote = await fetch('/api/notes/' + candidate.id, {
                signal: AbortSignal.timeout(5000),
              })
              if (remote.status === 401) {
                expire()
                break
              }
              if (remote.status !== 404 && !remote.ok) throw new Error('Deletion will retry')
              if (remote.ok) {
                const current: Note = await remote.json()
                await ordered(async () => {
                  await local.change(id, candidate.id, (draft) =>
                    draft?.generation === candidate.generation
                      ? {
                          ...draft,
                          purge: undefined,
                          purgeRevision: undefined,
                          conflict: { current },
                        }
                      : draft,
                  )
                  await local.cache(id, current, openNoteId() ?? current.id)
                })
                notify('The note changed before it could be permanently deleted.', { error: true })
                continue
              }
            } else if (!result.ok) throw new Error('Deletion will retry')
          }
          await ordered(() => local.finishPurge(candidate))
          if (owner() === id) {
            onPurged(candidate.id)
          }
          uploadedSinceStart = true
          continue
        }
        // Persist the exact request before sending it so a retry can replay the same mutation.
        const draft = await ordered(() =>
          local.change(id, candidate.id, (previous) => {
            if (!previous || previous.sent || previous.conflict || previous.purgeRevision)
              return previous
            if (previous.base === null && previous.fields.deleted) return previous
            return {
              ...previous,
              sent: {
                generation: previous.generation,
                mutation: {
                  mutationId: crypto.randomUUID(),
                  expectedRevision: previous.base,
                  fields: previous.fields,
                },
              },
            }
          }),
        )
        if (!draft?.sent || draft.conflict) continue
        const sent = draft.sent
        const response = await fetch('/api/notes/' + draft.id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sent.mutation),
          signal: AbortSignal.timeout(15000),
        })
        if (response.status === 401) {
          expire()
          break
        }
        if (response.status === 409) {
          const conflict: { current: Note | null } = await response.json()
          const purged = await ordered(async () => {
            const current = await local.change(id, draft.id, (latest) => {
              if (latest?.sent?.mutation.mutationId !== sent.mutation.mutationId) return latest
              if (latest.purge && conflict.current === null) return latest
              return { ...latest, conflict, purge: undefined, purgeRevision: undefined }
            })
            if (current?.purge && conflict.current === null) {
              await local.finishPurge(current)
              return true
            }
            return false
          })
          if (purged) {
            uploadedSinceStart = true
            continue
          }
          if (owner() === id)
            notify('A note changed on another device. Review the conflict to sync your draft.', {
              error: true,
            })
          continue
        }
        if ([400, 413, 422].includes(response.status)) {
          const problem: { error?: string } | null = await response.json().catch(() => null)
          const rejected = await ordered(() =>
            local.change(id, draft.id, (current) => {
              if (current?.sent?.mutation.mutationId !== sent.mutation.mutationId) return current
              if (current.purge && sent.mutation.expectedRevision === null)
                return { ...current, sent: undefined }
              return {
                ...current,
                sent: undefined,
                purge: undefined,
                purgeRevision: undefined,
                error:
                  current.purge || current.generation === sent.generation
                    ? (problem?.error ?? 'Server rejected this draft. Edit it or download a copy.')
                    : undefined,
              }
            }),
          )
          if (rejected?.error && owner() === id) notify(rejected.error, { error: true })
          continue
        }
        if (!response.ok) throw new Error('Upload will retry')
        const ack: Ack = await response.json()
        if (ack.mutationId !== sent.mutation.mutationId)
          throw new Error('Unexpected acknowledgement')
        await ordered(async () => {
          await local.acknowledge(
            draft,
            {
              id: draft.id,
              ...sent.mutation.fields,
              revision: ack.revision,
              updatedAt: ack.updatedAt,
            },
            openNoteId(),
          )
          if (owner() === id) {
            const { document: _document, ...metadata } = sent.mutation.fields
            const updated = {
              ...metadata,
              id: draft.id,
              revision: ack.revision,
              updatedAt: ack.updatedAt,
            }
            onNoteUpdated(id, updated)
          }
          await onAcknowledged(draft, ack.revision)
        })
        uploadedSinceStart = true
      }
      if ((checkLocal || uploadedSinceStart) && authorized() && owner() === id && !signingOut()) {
        await reconcileNotes(id, () => owner() === id && authorized() && !signingOut(), expire)
      }
      retryDelay = 1000
      await loadLocal(id)
      if (uploadedSinceStart) onUploaded(id)
      if (
        (reconciliationRequested ||
          drafts().some(
            (draft) =>
              !draft.conflict &&
              !draft.error &&
              (draft.purge || draft.sent || draft.base !== null || !draft.fields.deleted),
          )) &&
        authorized() &&
        !hasPendingEdits()
      )
        scheduleUpload(550)
    } catch {
      reconciliationRequested ||= checkLocal || uploadedSinceStart
      await loadLocal(id).catch(storageError)
      scheduleUpload(retryDelay)
      retryDelay = Math.min(retryDelay * 2, 30000)
    } finally {
      syncBusy = false
    }
  }

  return { scheduleUpload, upload }
}
