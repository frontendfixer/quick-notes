import type { QueryClient } from '@tanstack/solid-query'
import { createMemo, createSignal, type Accessor } from 'solid-js'
import { folderName, folderResponse, type Folder } from '../../../../packages/contracts'
import type { NoteSort } from '../components/note-menus'
import { notify } from '../components/activity-toasts'
import { local, type Draft } from '../storage'

type FolderOptions = {
  queryClient: QueryClient
  owner: Accessor<string | undefined>
  authorized: Accessor<boolean>
  writable: Accessor<boolean>
  unavailable: Accessor<boolean>
  signingOut: Accessor<boolean>
  folder: Accessor<string | undefined>
  sort: Accessor<NoteSort>
  drafts: Accessor<Draft[]>
  flushEdits: () => Promise<boolean>
  expire: () => void
  invalidateCachedLists: (owner: string) => void
  onFolderMissing: () => void
  onFolderDeleted: (id: string) => void
}

export function createFolders({
  queryClient,
  owner,
  authorized,
  writable,
  unavailable,
  signingOut,
  folder,
  sort,
  drafts,
  flushEdits,
  expire,
  invalidateCachedLists,
  onFolderMissing,
  onFolderDeleted,
}: FolderOptions) {
  const [folders, setFolders] = createSignal<Folder[]>([])
  const [folderForm, setFolderForm] = createSignal<'create' | 'rename'>()
  const [folderBusy, setFolderBusy] = createSignal(false)
  const [folderError, setFolderError] = createSignal('')
  const chosenFolder = () => folders().find(({ id }) => id === folder())
  let folderEpoch = 0
  const folderNames = new Intl.Collator(undefined, { sensitivity: 'base' })
  const sortedFolders = createMemo(() =>
    [...folders()].sort((a, b) => {
      if (sort() === 'updated') {
        const newest = (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
        if (newest) return newest
      }
      return folderNames.compare(a.name, b.name)
    }),
  )

  async function loadFolders(id: string, cached = false) {
    const request = ++folderEpoch
    const items = cached
      ? await local.folders(id)
      : await queryClient.query({
          queryKey: ['folders', id],
          queryFn: async ({ signal }) => {
            const response = await fetch('/api/folders', {
              signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
            })
            if (!response.ok) throw new Error('Could not load folders')
            return folderResponse.array().parse(await response.json())
          },
        })
    if (owner() !== id || request !== folderEpoch) return
    setFolders(items)
    if (!cached && folder() && !items.some((item) => item.id === folder())) onFolderMissing()
    if (!cached) await local.cacheFolders(id, items).catch(() => undefined)
  }

  async function saveFolder(event?: SubmitEvent) {
    event?.preventDefault()
    const account = owner()
    if (!account || !canManageFolders()) return
    const existing = event && folderForm() === 'create' ? undefined : chosenFolder()
    if (!event && !existing) return
    const input = folderName.safeParse(
      event ? new FormData(event.currentTarget as HTMLFormElement).get('name') : null,
    )
    if (event && !input.success) {
      setFolderError('Enter a folder name up to 60 characters.')
      notify('Enter a folder name up to 60 characters.', { error: true })
      return
    }
    setFolderBusy(true)
    setFolderError('')
    ++folderEpoch
    try {
      if (!event && existing) {
        if (!(await flushEdits())) return
        if (drafts().some((draft) => draft.fields.folderId === existing.id)) {
          throw new Error('Wait for the notes in this folder to finish syncing before deleting it.')
        }
      }
      const response = await fetch('/api/folders' + (existing ? '/' + existing.id : ''), {
        method: event ? (existing ? 'PATCH' : 'POST') : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: event ? JSON.stringify({ name: input.data }) : undefined,
      })
      if (response.status === 401) expire()
      if (!response.ok) {
        const problem = await response.json().catch(() => null)
        throw new Error(problem?.error ?? 'Could not update the folder.')
      }
      const saved = event
        ? folderResponse.safeParse(await response.json().catch(() => null))
        : undefined
      if (owner() !== account) return
      if (saved && !saved.success) {
        void loadFolders(account).catch(() => undefined)
        throw new Error('Could not confirm the folder change. Check your folders before retrying.')
      }
      const items = folders().filter(
        (item) => item.id !== existing?.id && item.id !== saved?.data.id,
      )
      if (saved) items.push({ ...saved.data, noteCount: existing ? existing.noteCount : 0 })
      items.sort((a, b) => a.name.localeCompare(b.name))
      // A read started before the mutation must not replace the confirmed folder state.
      ++folderEpoch
      await queryClient.cancelQueries({ queryKey: ['folders', account] })
      if (owner() !== account) return
      queryClient.setQueryData(['folders', account], items)
      invalidateCachedLists(account)
      setFolders(items)
      void local.cacheFolders(account, items).catch(() => undefined)
      if (!event && existing) {
        await local.dropFolderSnapshots(account, existing.id).catch(() => undefined)
        onFolderDeleted(existing.id)
      }
      setFolderForm(undefined)
      notify(event ? (existing ? 'Folder renamed' : 'Folder created') : 'Folder deleted')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not update the folder.'
      setFolderError(message)
      notify(message, { error: true })
    } finally {
      setFolderBusy(false)
    }
  }

  const canManageFolders = () =>
    authorized() && writable() && !unavailable() && !folderBusy() && !signingOut()

  return {
    folders,
    folderForm,
    setFolderForm,
    folderBusy,
    folderError,
    setFolderError,
    chosenFolder,
    sortedFolders,
    loadFolders,
    saveFolder,
    canManageFolders,
    clearFolders: () => setFolders([]),
  }
}
