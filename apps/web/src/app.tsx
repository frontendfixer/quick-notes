import { TextField } from '@kobalte/core/text-field'
import { Collapsible } from '@kobalte/core/collapsible'
import { TextInput } from './components/text-input'
import { Alert } from '@kobalte/core/alert'
import { Button } from '@kobalte/core/button'
import { animate } from 'motion/mini'
import {
  ChevronDown,
  CircleAlert,
  Download,
  LockKeyhole,
  Plus,
  RefreshCw,
  Search,
  WifiOff,
} from 'lucide-solid'
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  lazy,
  on,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from 'solid-js'
import { registerAppWorker } from './pwa-update'
import {
  emptyNote,
  folderName,
  folderResponse,
  plainText,
  type Ack,
  type Note,
  type NoteFields,
  type Summary,
  type View,
  type Folder,
} from '../../../packages/contracts'
import { local, type Draft } from './storage'
import { readScreen, writeScreen } from './location'
import { ActivityToasts, clearNotifications, notify } from './components/activity-toasts'
import { AccountAccess, PasswordField } from './components/account-access'
import {
  CollectionHeading,
  CreateFolderDialog,
  CollectionPreviewPrompt,
  EmptyCollection,
  type CollectionKind,
  FolderNameForm,
  FolderRow,
} from './components/folder-views'
import { CreateMenu, createShortcuts } from './components/create-menu'
import { AccountMenu, SortMenu, type NoteSort } from './components/note-menus'
import { NoteToolbar } from './components/note-toolbar'
import { NoteRow } from './components/note-row'
import { ConfirmationDialog } from './components/confirmation-dialog'

const RichEditor = lazy(() => import('./editor'))
type OpenNote = {
  id: string
  owner: string
  title: string
  fields: NoteFields
  base: number | null
  composing: boolean
}
type PendingEdit = {
  owner: string
  id: string
  base: number | null
  fields: () => NoteFields
  changedAt: string
  generation: string
}
const label = (title: string) => title.trim() || 'Untitled'
function belongsTo(note: Pick<Summary, 'deleted' | 'archived'>, view: View) {
  return view === 'trash' ? note.deleted : !note.deleted && note.archived === (view === 'archived')
}

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  )
  const anchor = Object.assign(document.createElement('a'), { href: url, download: name })
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function App() {
  const initialScreen = readScreen()
  const [joiningWaitlist, setJoiningWaitlist] = createSignal(
    new URLSearchParams(location.search).get('signup') === '1',
  )
  const [owner, setOwner] = createSignal<string>()
  const [ready, setReady] = createSignal(false)
  const [authorized, setAuthorized] = createSignal(false)
  const [mustSignIn, setMustSignIn] = createSignal(false)
  const [writable, setWritable] = createSignal(false)
  const [unavailable, setUnavailable] = createSignal(false)
  const [folders, setFolders] = createSignal<Folder[]>([])
  const [folder, setFolder] = createSignal(initialScreen.folder)
  const [folderForm, setFolderForm] = createSignal<'create' | 'rename'>()
  const [folderBusy, setFolderBusy] = createSignal(false)
  const [folderError, setFolderError] = createSignal('')
  const chosenFolder = () => folders().find(({ id }) => id === folder())
  const [view, setView] = createSignal<View>(initialScreen.view)
  const [sort, setSort] = createSignal<NoteSort>(initialScreen.sort)
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
  const [query, setQuery] = createSignal(initialScreen.query)
  const [notes, setNotes] = createSignal<Summary[]>([])
  const [next, setNext] = createSignal<string | null>(null)
  const [drafts, setDrafts] = createSignal<Draft[]>([])
  const [open, setOpen] = createSignal<OpenNote>()
  const [title, setTitle] = createSignal('')
  const [fields, setFields] = createSignal(emptyNote())
  const [loadingNotes, setLoadingNotes] = createSignal(false)
  let homeScroll = 0
  let sidebar: HTMLElement | undefined
  let libraryScroll = 0
  let notesPanel: HTMLDivElement | undefined
  let listRequests = 0
  const [showEditor, setShowEditor] = createSignal(false)
  const [status, setStatus] = createSignal('')
  const [notice, setNotice] = createSignal('')
  const [update, setUpdate] = createSignal(false)
  const [signingIn, setSigningIn] = createSignal(false)
  const [opening, setOpening] = createSignal(false)
  const [creating, setCreating] = createSignal(false)
  const [confirmSignOut, setConfirmSignOut] = createSignal(false)
  const [noteToTrash, setNoteToTrash] = createSignal<string>()
  let accountTrigger: HTMLButtonElement | undefined
  let createTrigger: HTMLButtonElement | undefined
  let folderDialogOrigin: HTMLElement | undefined
  const [signingOut, setSigningOut] = createSignal(false)
  const [restarting, setRestarting] = createSignal(false)
  let worker: ReturnType<typeof registerAppWorker>
  let releaseWriter: (() => void) | undefined
  let lockOwner: string | undefined
  let requestedLock = 0
  const sessionChanges = new BroadcastChannel('quick-notes-session')
  let selection = 0
  let editEpoch = 0
  let listEpoch = 0
  let folderEpoch = 0
  let draftEpoch = 0
  let syncBusy = false
  const [refreshing, setRefreshing] = createSignal(false)
  const [deletingNote, setDeletingNote] = createSignal<string>()
  let refreshAgain = false
  let queue: Promise<unknown> = Promise.resolve()
  let localTimer: ReturnType<typeof setTimeout> | undefined
  let uploadTimer: ReturnType<typeof setTimeout> | undefined
  let listTimer: ReturnType<typeof setTimeout> | undefined
  let retryDelay = 1000
  const pending = new Map<string, PendingEdit>()
  let documentReader: (() => NoteFields['document']) | undefined
  let searchInput: HTMLInputElement | undefined

  const ordered = <T,>(work: () => Promise<T>) => {
    const result = queue.then(work)
    queue = result.catch(() => undefined)
    return result
  }
  const draftById = createMemo(() => new Map(drafts().map((draft) => [draft.id, draft])))
  const draftFor = (id: string) => draftById().get(id)
  const activeDraft = () => draftFor(open()?.id ?? '')
  const canEdit = () =>
    writable() && !fields().deleted && !signingOut() && !creating() && !folderBusy()

  function acquireWriter(id: string) {
    if (lockOwner === id) return
    releaseWriter?.()
    lockOwner = id
    setWritable(false)
    if (!navigator.locks) {
      setNotice('This browser cannot safely coordinate offline editing.')
      return
    }
    const request = ++requestedLock
    void navigator.locks
      .request('quick-notes:' + id, async () => {
        if (request !== requestedLock || owner() !== id) return
        setWritable(true)
        void refresh()
        await new Promise<void>((resolve) => {
          releaseWriter = resolve
        })
      })
      .catch(() => setNotice('Could not enable local editing.'))
  }

  async function loadLocal(id = owner()) {
    if (!id) return
    const check = ++draftEpoch
    const items = await local.drafts(id)
    if (owner() === id && draftEpoch === check) setDrafts(items)
  }

  const inView = (note: Pick<NoteFields, 'folderId' | 'deleted' | 'archived'>) => {
    const currentFolder = folder()
    const currentView = view()
    if (!belongsTo(note, currentView)) return false
    if (currentFolder) return note.folderId === currentFolder
    return currentView !== 'active' || !note.folderId
  }

  function updateScreen(mode: 'push' | 'replace', note?: string) {
    writeScreen({ view: view(), folder: folder(), note, query: query(), sort: sort() }, mode)
  }

  function changeView(tab: View, id?: string, historyMode: 'push' | 'replace' | 'none' = 'push') {
    if (tab === view() && id === folder()) return
    if (view() === 'active' && !folder() && !query().trim())
      homeScroll = notesPanel?.scrollTop ?? libraryScroll
    clearTimeout(listTimer)
    ++selection
    setOpening(false)
    libraryScroll = 0
    batch(() => {
      setFolderForm(undefined)
      setFolderError('')
      setFolder(id)
      setView(tab)
      setQuery('')
      setNotes([])
      setNext(null)
      setShowEditor(false)
    })
    if (historyMode !== 'none') {
      updateScreen(historyMode)
      void safeList()
    }
  }

  async function loadFolders(id: string, cached = false) {
    const request = ++folderEpoch
    const items: Folder[] = cached
      ? await local.folders(id)
      : await fetch('/api/folders', { signal: AbortSignal.timeout(5000) }).then(
          async (response) => {
            if (!response.ok) throw new Error('Could not load folders')
            return folderResponse.array().parse(await response.json())
          },
        )
    if (owner() !== id || request !== folderEpoch) return
    setFolders(items)
    if (!cached && folder() && !items.some((item) => item.id === folder())) {
      const note = readScreen().note
      changeView('active', undefined, 'none')
      updateScreen('replace', note)
      setNotice('This folder is no longer available.')
      void safeList()
    }
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
      setFolders(items)
      ++folderEpoch
      void local.cacheFolders(account, items).catch(() => undefined)
      if (!event && existing) {
        await local.dropFolderSnapshots(account, existing.id).catch(() => undefined)
        const current = open()
        if (
          current &&
          fields().folderId === existing.id &&
          !draftFor(current.id) &&
          !pending.has(current.id)
        ) {
          ++selection
          setOpen(undefined)
          setShowEditor(false)
        }
        changeView('active', undefined, 'replace')
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

  async function list(append = false) {
    const id = owner()
    if (!id) return
    const request = ++listEpoch
    const tab = view()
    if (unavailable() || mustSignIn()) {
      const snapshots = await local.snapshots(id)
      const entries = new Map(snapshots.map((note) => [note.id, note]))
      for (const draft of drafts())
        entries.set(draft.id, {
          ...draft.fields,
          id: draft.id,
          revision: draft.base ?? 0,
          updatedAt: draft.changedAt,
        })
      if (request === listEpoch && owner() === id) {
        const offline = [...entries.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        setNotes(
          offline.filter(inView).map((note) => ({
            ...note,
            preview: plainText(note.document).slice(0, 180),
          })),
        )
        setNext(null)
      }
      return
    }
    if (!authorized()) return
    const params = new URLSearchParams({ view: tab, sort: sort(), q: query() })
    const currentFolder = folder()
    if (currentFolder) params.set('folder', currentFolder)
    else if (tab === 'active') params.set('unfiled', 'true')
    if (append && next()) params.set('cursor', next()!)
    const response = await fetch('/api/notes?' + params, { signal: AbortSignal.timeout(5000) })
    if (request !== listEpoch || owner() !== id) return
    if (response.status === 401) return expire()
    if (!response.ok) throw new Error('Could not load notes')
    const page: { notes: Summary[]; next: string | null } = await response.json()
    if (request !== listEpoch || owner() !== id) return
    setNotes((previous) =>
      append
        ? [...new Map([...previous, ...page.notes].map((note) => [note.id, note])).values()]
        : page.notes,
    )
    setNext(page.next)
  }

  function expire() {
    setAuthorized(false)
    setMustSignIn(true)
  }

  function loadEditor(id: string, account: string, base: number | null, initial: NoteFields) {
    documentReader = undefined
    setTitle(initial.title)
    setFields(initial)
    setOpen({ id, owner: account, title: initial.title, fields: initial, base, composing: false })
    setShowEditor(true)
    setStatus(
      pending.has(id)
        ? 'Editing'
        : draftFor(id)
          ? 'Saved on device'
          : base
            ? 'Saved to server'
            : '',
    )
  }

  async function select(id: string, fromUrl = false) {
    const matchCollection = (note: NoteFields) => {
      if (fromUrl && !inView(note)) {
        const targetView = note.deleted ? 'trash' : note.archived ? 'archived' : 'active'
        const targetFolder = targetView === 'active' ? (note.folderId ?? undefined) : undefined
        batch(() => {
          setView(targetView)
          setFolder(targetFolder)
          setNotes([])
          setNext(null)
        })
        void safeList()
      }
    }
    const showNote = (account: string, base: number | null, note: NoteFields) => {
      matchCollection(note)
      loadEditor(id, account, base, note)
      updateScreen(fromUrl ? 'replace' : 'push', id)
    }
    if (!showEditor()) libraryScroll = notesPanel?.scrollTop ?? 0
    const account = owner()
    if (!account) return
    if (open()?.id === id) {
      ++selection
      setOpening(false)
      matchCollection(fields())
      setShowEditor(true)
      updateScreen(fromUrl ? 'replace' : 'push', id)
      return
    }
    const request = ++selection
    setOpening(true)
    setNotice('')
    try {
      if (!(await flushEdits())) return
      if (request !== selection || owner() !== account) return
      const draft = draftFor(id)
      let cached = await local.snapshot(account, id)
      if (request !== selection || owner() !== account) return
      if (draft || cached) {
        const initial = draft?.fields ?? cached!
        showNote(account, draft ? draft.base : cached!.revision, initial)
        if (cached) void local.cache(account, cached, id).catch(storageError)
      }
      if (!authorized() || unavailable()) {
        if (!draft && !cached) setNotice('This note is unavailable offline.')
        return
      }
      const edit = editEpoch
      const response = await fetch('/api/notes/' + id, {
        headers: cached ? { 'If-None-Match': '"' + cached.revision + '"' } : {},
        signal: AbortSignal.timeout(5000),
      })
      if (response.status === 401) return expire()
      if (response.status === 304) return
      if (
        response.status === 404 &&
        !draft &&
        edit === editEpoch &&
        !draftFor(id) &&
        !pending.has(id)
      ) {
        if (request === selection && owner() === account) {
          await local.dropSnapshot(account, id).catch(storageError)
          if (request !== selection || owner() !== account || edit !== editEpoch) return
          closeUnavailableNote(id)
          setNotice('This note is no longer available.')
        }
        return
      }
      if (!response.ok) throw new Error('Could not open note')
      const note: Note = await response.json()
      if (request !== selection || owner() !== account) return
      await local.cache(account, note, open()?.id ?? id).catch(storageError)
      if (
        request === selection &&
        owner() === account &&
        edit === editEpoch &&
        !draftFor(id) &&
        !open()?.composing
      ) {
        cached = await local.snapshot(account, id).catch(() => undefined)
        if (
          request === selection &&
          owner() === account &&
          edit === editEpoch &&
          !draftFor(id) &&
          !open()?.composing
        ) {
          const latest = cached ?? note
          if (open()?.id !== id || latest.revision > (open()?.base ?? 0)) {
            showNote(account, latest.revision, latest)
          }
        }
      }
    } catch {
      if (request === selection) setNotice('Could not open note. Try again when connected.')
    } finally {
      if (request === selection) setOpening(false)
    }
  }

  function closeUnavailableNote(id: string) {
    if (open()?.id === id) {
      setOpen(undefined)
      setShowEditor(false)
    }
    if (readScreen().note === id) updateScreen('replace')
    setNotes((previous) => previous.filter((note) => note.id !== id))
  }

  function canDeletePermanently() {
    const current = open()
    return Boolean(
      current?.base &&
      fields().deleted &&
      writable() &&
      authorized() &&
      !unavailable() &&
      !signingOut() &&
      !folderBusy() &&
      !deletingNote() &&
      !activeDraft() &&
      status() === 'Saved to server' &&
      !pending.has(current.id),
    )
  }

  async function deletePermanently() {
    const current = open()
    if (!current || !canDeletePermanently()) return
    setDeletingNote(current.id)
    try {
      const response = await fetch('/api/notes/' + current.id, {
        method: 'DELETE',
        headers: { 'If-Match': '"' + current.base + '"' },
        signal: AbortSignal.timeout(5000),
      })
      if (response.status === 401) return expire()
      if (response.status === 409) {
        notify('The note changed. Refresh it before deleting permanently.', { error: true })
        return
      }
      if (!response.ok) throw new Error('Could not delete note')
      await local.dropSnapshot(current.owner, current.id).catch(storageError)
      if (owner() === current.owner) {
        ++listEpoch
        closeUnavailableNote(current.id)
        notify('Note permanently deleted')
        void safeList()
        requestAnimationFrame(() => {
          if (!showEditor())
            collectionPanel?.querySelector<HTMLButtonElement>('[data-collection-back]')?.focus()
        })
      }
    } catch {
      notify('Could not delete note. Try again when connected.', { error: true })
    } finally {
      setDeletingNote(undefined)
    }
  }

  async function restoreNoteFromUrl() {
    const id = readScreen().note
    if (id && owner() && !opening() && (!showEditor() || open()?.id !== id)) {
      await select(id, true)
      return true
    }
    return false
  }

  function restoreScreen() {
    const screen = readScreen()
    setConfirmSignOut(false)
    setNoteToTrash(undefined)
    const changedList =
      view() !== screen.view ||
      folder() !== screen.folder ||
      query() !== screen.query ||
      sort() !== screen.sort
    ++selection
    setOpening(false)
    setNotice('')
    setJoiningWaitlist(new URLSearchParams(location.search).get('signup') === '1')
    clearTimeout(listTimer)
    batch(() => {
      changeView(screen.view, screen.folder, 'none')
      setSort(screen.sort)
      setQuery(screen.query)
      if (!screen.note || open()?.id !== screen.note) setShowEditor(false)
    })
    if (changedList) void safeList()
    void restoreNoteFromUrl()
    if (screen.folder && authorized() && !chosenFolder()) void refresh()
  }

  function showWaitlist(show: boolean) {
    setJoiningWaitlist(show)
    const url = new URL(location.href)
    if (show) url.searchParams.set('signup', '1')
    else url.searchParams.delete('signup')
    if (url.href !== location.href) history.pushState(null, '', url)
  }

  const storageNotice =
    'Device storage could not save your changes. Retry or download a recovery copy.'
  function storageError() {
    if (notice() !== storageNotice) notify(storageNotice, { error: true })
    setStatus('Save failed')
    setNotice(storageNotice)
  }

  function record(overrides: Partial<NoteFields> = {}) {
    const current = open()
    if (!current || !writable() || signingOut()) return
    editEpoch++
    const currentFields = { ...fields(), ...overrides, title: title() }
    const reader = documentReader
    if (Object.keys(overrides).length) setFields(currentFields)
    queueEdit({
      id: current.id,
      owner: current.owner,
      base: current.base,
      generation: crypto.randomUUID(),
      fields: () => ({ ...currentFields, document: reader?.() ?? currentFields.document }),
      changedAt: new Date().toISOString(),
    })
    setStatus('Editing')
  }

  function queueEdit(edit: PendingEdit) {
    pending.set(edit.id, edit)
    localTimer ??= setTimeout(() => {
      void flushEdits()
    }, 45)
    scheduleUpload(550)
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
          if (saved && owner() === item.owner) {
            if (showEditor() && open()?.id === item.id && !readScreen().note)
              updateScreen('push', item.id)
            ++draftEpoch
            setDrafts((current) => {
              const index = current.findIndex(({ id }) => id === saved.id)
              return index === -1
                ? [saved, ...current]
                : current.map((item, i) => (i === index ? saved : item))
            })
          }
          if (pending.get(item.id) === item) pending.delete(item.id)
          if (open()?.id === item.id && !pending.has(item.id))
            setStatus(saved ? 'Saved on device' : '')
        }
        if (notice() === storageNotice) setNotice('')
        return true
      } catch {
        storageError()
        return false
      }
    })
  }

  function scheduleUpload(delay: number) {
    clearTimeout(uploadTimer)
    uploadTimer = setTimeout(() => {
      void upload()
    }, delay)
  }

  async function upload() {
    const id = owner()
    if (!id || !writable() || !authorized() || unavailable() || syncBusy || signingOut()) return
    syncBusy = true
    try {
      await flushEdits()
      let uploaded = false
      for (const candidate of drafts()) {
        if (!authorized() || owner() !== id || signingOut()) break
        if (candidate.conflict || candidate.error) continue
        const draft = await ordered(() =>
          local.change(id, candidate.id, (previous) => {
            if (!previous || previous.sent || previous.conflict) return previous
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
          await ordered(() =>
            local.change(id, draft.id, (current) => current && { ...current, conflict }),
          )
          if (owner() === id)
            notify('A note changed on another device. Review the conflict to sync your draft.', {
              error: true,
            })
          continue
        }
        if ([400, 413, 422].includes(response.status)) {
          const problem: { error?: string } | null = await response.json().catch(() => null)
          const rejected = await ordered(() =>
            local.change(
              id,
              draft.id,
              (current) =>
                current && {
                  ...current,
                  sent: undefined,
                  error:
                    current.generation === sent.generation
                      ? (problem?.error ??
                        'Server rejected this draft. Edit it or download a copy.')
                      : undefined,
                },
            ),
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
            open()?.id,
          )
          if (owner() === id) {
            const { document: _document, ...metadata } = sent.mutation.fields
            const updated = {
              ...metadata,
              id: draft.id,
              revision: ack.revision,
              updatedAt: ack.updatedAt,
            }
            setNotes((previous) => {
              const exists = previous.some(({ id }) => id === updated.id)
              if (!inView(updated)) return previous.filter(({ id }) => id !== updated.id)
              if (exists) return previous.map((note) => (note.id === updated.id ? updated : note))
              return query().trim() ? previous : [updated, ...previous]
            })
          }
          const current = open()
          if (current?.owner === id && current.id === draft.id) {
            current.base = ack.revision
            if (
              !pending.has(draft.id) &&
              !(await local.drafts(id)).some((item) => item.id === draft.id)
            )
              setStatus('Saved to server')
          }
        })
        uploaded = true
      }
      retryDelay = 1000
      await loadLocal(id)
      if (uploaded) {
        void safeList()
        if (!folderBusy()) void loadFolders(id).catch(() => undefined)
      }
      if (
        drafts().some((draft) => !draft.conflict && !draft.error) &&
        authorized() &&
        !pending.size
      )
        scheduleUpload(550)
    } catch {
      await loadLocal(id).catch(storageError)
      scheduleUpload(retryDelay)
      retryDelay = Math.min(retryDelay * 2, 30000)
    } finally {
      syncBusy = false
    }
  }

  async function safeList(append = false) {
    ++listRequests
    setLoadingNotes(true)
    try {
      await list(append)
      if (notice() === 'Could not refresh the notes list.') setNotice('')
    } catch {
      setNotice('Could not refresh the notes list.')
    } finally {
      setLoadingNotes(--listRequests > 0)
    }
  }

  async function refresh(manual = false) {
    if (refreshing() || signingIn() || signingOut()) {
      refreshAgain = true
      return
    }
    setRefreshing(true)
    try {
      let response: Response | undefined
      try {
        response = await fetch('/api/me', { signal: AbortSignal.timeout(5000) })
      } catch {
        /* offline */
      }
      if (signingIn() || signingOut()) return
      setUnavailable(!response?.ok && response?.status !== 401)
      if (response?.ok) {
        const account: { id: string } = await response.json()
        if (owner() && owner() !== account.id) {
          if (!(await flushEdits())) return
          setOpen(undefined)
          setNotes([])
          setDrafts([])
          setFolders([])
          setShowEditor(false)
        }
        setOwner(account.id)
        await local.setOwner(account.id).catch(storageError)
        setAuthorized(true)
        setMustSignIn(false)
      } else if (response?.status === 401 && owner()) expire()
      else setAuthorized(false)
      if (owner()) {
        acquireWriter(owner()!)
        await loadLocal().catch(storageError)
        if (authorized()) await loadFolders(owner()!).catch(() => undefined)
        await safeList()
        const restored = await restoreNoteFromUrl()
        if (authorized()) {
          if (manual) await upload()
          else void upload()
          const current = open()
          if (
            current &&
            current.base !== null &&
            deletingNote() !== current.id &&
            !restored &&
            showEditor() &&
            !opening() &&
            !current.composing &&
            !draftFor(current.id) &&
            !pending.has(current.id)
          ) {
            const epoch = editEpoch
            const request = selection
            const result = await fetch('/api/notes/' + current.id, {
              headers: { 'If-None-Match': '"' + current.base + '"' },
              signal: AbortSignal.timeout(5000),
            })
            const stillCurrent = () =>
              open() === current &&
              owner() === current.owner &&
              deletingNote() !== current.id &&
              !current.composing &&
              epoch === editEpoch &&
              request === selection &&
              !draftFor(current.id) &&
              !pending.has(current.id)
            if (result.status === 401) expire()
            else if (result.status === 404 && stillCurrent()) {
              await local.dropSnapshot(current.owner, current.id).catch(storageError)
              if (stillCurrent()) {
                closeUnavailableNote(current.id)
                notify('This note is no longer available.')
              }
            } else if (result.ok) {
              const note: Note = await result.json()
              if (!stillCurrent()) return
              await local.cache(current.owner, note, current.id).catch(storageError)
              if (stillCurrent() && note.revision > (current.base ?? 0))
                loadEditor(current.id, current.owner, note.revision, note)
            } else if (manual && result.status !== 304 && result.status !== 404) {
              throw new Error('Could not refresh note')
            }
          }
        }
      }
    } catch {
      setNotice('Refresh paused. Reconnect or try again.')
    } finally {
      setRefreshing(false)
      setReady(true)
      if (refreshAgain && !signingIn() && !signingOut()) {
        refreshAgain = false
        void refresh()
      }
    }
  }

  async function signIn(event: SubmitEvent) {
    event.preventDefault()
    if (signingIn()) return
    setSigningIn(true)
    setNotice('')
    const form = new FormData(event.currentTarget as HTMLFormElement)
    try {
      const response = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
      })
      if (!response.ok) {
        const message =
          response.status === 429
            ? 'Too many attempts. Try again shortly.'
            : response.status === 403
              ? 'This address is not allowed to sign in. Open Quick Notes from its original address.'
              : response.status === 401
                ? 'Sign-in failed. Check your email and password.'
                : 'Sign-in is unavailable right now. Try again shortly.'
        setNotice(message)
        notify(message, { error: true })
      } else {
        notify('Signed in')
        void navigator.storage?.persist?.().catch(() => false)
      }
    } catch {
      setNotice('Could not connect to sign in.')
      notify('Could not connect to sign in.', { error: true })
    } finally {
      setSigningIn(false)
      void refresh()
    }
  }

  function closeSession() {
    setConfirmSignOut(false)
    setNoteToTrash(undefined)
    ++requestedLock
    ++selection
    releaseWriter?.()
    lockOwner = undefined
    setWritable(false)
    setOwner(undefined)
    setAuthorized(false)
    setMustSignIn(false)
    setOpen(undefined)
    setDrafts([])
    setNotes([])
    setNext(null)
    setView('active')
    setFolder(undefined)
    setFolders([])
    setFolderForm(undefined)
    setFolderError('')
    setQuery('')
    setShowEditor(false)
    updateScreen('replace')
    clearNotifications()
    homeScroll = 0
    libraryScroll = 0
  }

  async function signOut() {
    const account = owner()
    if (!account || !writable() || signingOut()) return
    setSigningOut(true)
    try {
      if (!(await flushEdits()) || owner() !== account) return
      const response = await fetch('/api/auth/sign-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (!response.ok) throw new Error('Sign-out failed')
      await local.hideOwner()
      const id = owner()
      closeSession()
      sessionChanges.postMessage({ closed: id })
      notify('Signed out')
    } catch {
      setNotice('Could not sign out. Please reconnect and retry.')
      notify('Could not sign out. Please reconnect and retry.', { error: true })
    } finally {
      setSigningOut(false)
    }
  }

  async function create(initial: NoteFields, saveCopy = false) {
    const account = owner()
    if (!account || !writable() || creating() || signingOut()) return
    const request = ++selection
    setOpening(false)
    setCreating(true)
    try {
      if (!(await flushEdits()) || owner() !== account || request !== selection) return
      const id = crypto.randomUUID()
      loadEditor(id, account, null, initial)
      updateScreen('push')
      if (saveCopy) record()
      return id
    } finally {
      setCreating(false)
    }
  }

  async function resolveConflict(copy: boolean) {
    const currentId = open()?.id
    if (!currentId || !writable() || !(await flushEdits()) || open()?.id !== currentId) return
    const draft = activeDraft()
    if (!draft?.conflict) return
    const remote = draft.conflict.current
    if (copy) {
      const copyId = await create({ ...draft.fields, deleted: false }, true)
      if (!copyId || !(await flushEdits()) || !draftFor(copyId)) return
      if (remote) await local.cache(draft.owner, remote, copyId).catch(storageError)
      await ordered(() => local.change(draft.owner, draft.id, () => undefined))
    } else {
      await ordered(() =>
        local.change(
          draft.owner,
          draft.id,
          (current) =>
            current && {
              ...current,
              base: remote?.revision ?? null,
              sent: undefined,
              conflict: undefined,
            },
        ),
      )
      const current = open()
      if (current?.id === draft.id) current.base = remote?.revision ?? null
    }
    await loadLocal()
    void upload()
    notify(copy ? 'Draft copied to a new note' : 'Replacement queued for sync')
  }

  function exportDrafts() {
    const items = new Map(drafts().map((draft) => [draft.id, draft]))
    const edits = [...pending.values()].map(({ fields: read, ...edit }) => ({
      ...edit,
      fields: read(),
    }))
    download('quick-notes-recovery.json', {
      format: 'quick-notes-recovery',
      version: 1,
      drafts: [...items.values()],
      edits,
    })
    notify('Draft export started')
  }

  createEffect(() => {
    if (!ready() || !owner() || typeof requestIdleCallback !== 'function') return
    const idle = requestIdleCallback(
      () => {
        void RichEditor.preload().catch(() => undefined)
      },
      { timeout: 1200 },
    )
    onCleanup(() => cancelIdleCallback(idle))
  })

  onMount(() => {
    updateScreen('replace', initialScreen.note)
    sessionChanges.onmessage = (event) => {
      if (owner() && event.data?.closed === owner()) closeSession()
    }
    worker = registerAppWorker(() => setUpdate(true))
    onCleanup(() => worker?.dispose())
    void (async () => {
      try {
        setOwner(await local.owner())
      } catch {
        storageError()
      }
      if (owner()) {
        setUnavailable(true)
        acquireWriter(owner()!)
        await loadLocal().catch(storageError)
        await loadFolders(owner()!, true).catch(() => undefined)
        void safeList()
      }
      await refresh()
    })()
    const visible = () => {
      if (document.visibilityState === 'visible') resume()
      else if (pending.size) void flushEdits()
    }
    const handleShortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        document.querySelector('.confirmation-dialog[data-expanded]')
      )
        return
      if ((event.metaKey || event.ctrlKey) && event.altKey && !event.shiftKey) {
        if (event.code === createShortcuts.note.code && canCreate()) {
          event.preventDefault()
          newNote()
        } else if (event.code === createShortcuts.folder.code && canManageFolders()) {
          event.preventDefault()
          newFolder()
        }
        return
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'k' &&
        searchInput?.isConnected
      ) {
        event.preventDefault()
        if (showEditor() || opening()) backToNotes('push', false)
        searchInput.focus()
      }
    }
    window.addEventListener('popstate', restoreScreen)
    window.addEventListener('keydown', handleShortcut)
    const resume = () => {
      void worker?.check()
      void refresh()
    }
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') resume()
    }, 60000)
    window.addEventListener('online', resume)
    window.addEventListener('offline', resume)
    window.addEventListener('focus', resume)
    document.addEventListener('visibilitychange', visible)
    onCleanup(() => {
      clearInterval(interval)
      window.removeEventListener('popstate', restoreScreen)
      window.removeEventListener('keydown', handleShortcut)
      sessionChanges.close()
      window.removeEventListener('online', resume)
      window.removeEventListener('offline', resume)
      window.removeEventListener('focus', resume)
      document.removeEventListener('visibilitychange', visible)
      releaseWriter?.()
    })
  })

  const visibleNotes = createMemo(() => {
    const cachedView = unavailable() || mustSignIn()
    if (!cachedView && query().trim()) return notes()
    const ordered = new Map(notes().map((note) => [note.id, note]))
    const added: Summary[] = []
    for (const draft of drafts()) {
      if (!inView(draft.fields)) {
        ordered.delete(draft.id)
        continue
      }
      const { document, ...metadata } = draft.fields
      const previous = ordered.get(draft.id)
      const summary = {
        ...metadata,
        preview: plainText(document).slice(0, 180),
        id: draft.id,
        revision: draft.base ?? 0,
        updatedAt: previous?.updatedAt ?? draft.changedAt,
      }
      if (previous) ordered.set(draft.id, summary)
      else added.push(summary)
    }
    return [...added, ...ordered.values()]
  })
  const visibleById = createMemo(() => new Map(visibleNotes().map((note) => [note.id, note])))
  const visibleIds = createMemo(() => visibleNotes().map((note) => note.id), undefined, {
    equals: (previous, next) =>
      previous.length === next.length && previous.every((id, index) => id === next[index]),
  })

  const reauthForm = () => (
    <form class="reauth" onSubmit={signIn}>
      <strong>Sign in to resume sync</strong>
      <small class="reauth-description muted">
        Your drafts stay on this device while sync is paused.
      </small>
      <TextInput
        name="email"
        type="email"
        aria-label="Email"
        placeholder="Email"
        autocomplete="username"
        required
      />
      <PasswordField placeholder="Password" />
      <Button type="submit" class="primary" disabled={signingIn()}>
        Sign in
      </Button>
    </form>
  )

  async function restartToUpdate() {
    if (!worker || restarting()) return
    const saveBeforeReload = async () => {
      do {
        if (open()?.composing) {
          notify('Finish typing before restarting to update.')
          return false
        }
        if (!(await flushEdits())) return false
      } while (pending.size)
      return true
    }

    setRestarting(true)
    try {
      if (!(await saveBeforeReload())) return
      await worker.activate()
      // The editor stays usable while the new worker activates.
      if ((await saveBeforeReload()) && !pending.size && !open()?.composing)
        window.location.reload()
    } catch {
      notify('The update could not finish. Try restarting to update again.', { error: true })
    } finally {
      setRestarting(false)
    }
  }

  const saveText = () =>
    activeDraft()?.conflict ? 'Conflict' : activeDraft()?.error ? 'Save rejected' : status()
  const saveLabel = () => {
    const state = saveText()
    if (state === 'Editing') return 'Saving on device…'
    if (state === 'Saved on device' && mustSignIn()) return 'Sync paused'
    if (state === 'Saved on device') return 'Saved on device'
    return state === 'Saved to server' ? 'Up to date' : state
  }
  const saveProblem = () => ['Conflict', 'Save rejected', 'Save failed'].includes(saveText())
  const newNote = () => {
    if (view() !== 'active') changeView('active')
    if (!showEditor()) libraryScroll = notesPanel?.scrollTop ?? 0
    void create({ ...emptyNote(), folderId: folder() ?? null })
  }
  const cancelFolderForm = () => {
    setFolderError('')
    setFolderForm(undefined)
  }
  const newFolder = () => {
    if (!canManageFolders()) return
    folderDialogOrigin =
      document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    setFolderError('')
    setFolderForm('create')
  }
  const restoreFolderDialogFocus = () => {
    const origin = folderDialogOrigin
    folderDialogOrigin = undefined
    if (
      origin &&
      origin !== document.body &&
      origin.isConnected &&
      origin.getClientRects().length
    ) {
      origin.focus({ preventScroll: true })
    } else {
      createTrigger?.focus({ preventScroll: true })
    }
  }
  const backToNotes = (mode: 'push' | 'replace' = 'push', focusRow = true) => {
    const scrollTop = notesPanel?.clientHeight ? notesPanel.scrollTop : libraryScroll
    ++selection
    setOpening(false)
    setShowEditor(false)
    updateScreen(mode)
    requestAnimationFrame(() => {
      const panel = notesPanel
      if (!panel) return
      panel.scrollTop = scrollTop
      const id = open()?.id
      if (!id || !focusRow) return
      const row = panel.querySelector<HTMLElement>('[data-note-id="' + CSS.escape(id) + '"]')
      row?.focus({ preventScroll: true })
    })
  }
  async function undoNoteChange(
    account: string,
    id: string,
    key: 'archived' | 'deleted',
    value: boolean,
  ) {
    if (owner() !== account || !writable() || signingOut() || deletingNote() === id) return
    const queued = await ordered(async () => {
      const alreadyOpen = () => open()?.id === id
      const undoOpen = () => {
        if (fields()[key] !== value) return false
        record({ [key]: !value })
        return true
      }
      if (alreadyOpen()) return undoOpen()
      const [snapshot, saved] = await Promise.all([
        local.snapshot(account, id),
        local.drafts(account),
      ])
      if (owner() !== account || !writable() || signingOut() || deletingNote() === id) return false
      if (alreadyOpen()) return undoOpen()
      const edit = pending.get(id)
      const draft = saved.find((item) => item.id === id)
      const latest = edit?.fields() ?? draft?.fields ?? snapshot
      if (!latest || latest[key] !== value) return false
      const { title, document, folderId, pinned, archived, deleted } = latest
      queueEdit({
        id,
        owner: account,
        base: edit?.base ?? draft?.base ?? snapshot?.revision ?? null,
        generation: crypto.randomUUID(),
        changedAt: new Date().toISOString(),
        fields: () => ({ title, document, folderId, pinned, archived, deleted, [key]: !value }),
      })
      return true
    }).catch(() => {
      storageError()
      return false
    })
    if (queued && (await flushEdits())) notify('Note change undone')
    else if (owner() === account && notice() !== storageNotice)
      notify('This change could not be undone.', { error: true })
  }

  function changeNoteState(key: 'archived' | 'deleted', value: boolean, message: string) {
    const note = open()
    if (!note || !writable() || signingOut()) return
    record({ [key]: value })
    if (value) backToNotes('replace')
    void flushEdits().then((saved) => {
      if (saved && owner() === note.owner) {
        notify(message, { undo: () => void undoNoteChange(note.owner, note.id, key, value) })
      }
    })
  }

  function updateNote(change: Partial<NoteFields>, message: string) {
    const account = owner()
    if (!open() || !writable() || signingOut()) return
    record(change)
    void flushEdits().then((saved) => {
      if (saved && owner() === account) notify(message)
    })
  }
  const clearSearch = () => {
    clearTimeout(listTimer)
    setQuery('')
    updateScreen('replace', readScreen().note)
    if (notesPanel) notesPanel.scrollTop = 0
    void safeList()
    searchInput?.focus()
  }
  const canCreate = () => writable() && !creating() && !signingOut() && !folderBusy()
  const home = () => view() === 'active' && !folder()
  const collection = () => folder() ?? view()
  const activeView = () =>
    chosenFolder()?.name ??
    (view() === 'archived' ? 'Archive' : view() === 'trash' ? 'Trash' : 'Notes')
  const collectionKind = (): CollectionKind => {
    const current = view()
    return current === 'active' ? 'folder' : current
  }
  const collectionIsEmpty = () =>
    !home() &&
    ready() &&
    !loadingNotes() &&
    !notice() &&
    !query().trim() &&
    visibleIds().length === 0
  let collectionPanel: HTMLDivElement | undefined
  createEffect(
    on(
      collection,
      (current, previous) => {
        const panel = collectionPanel
        if (!panel) return
        const isHome = current === 'active'
        if (notesPanel) notesPanel.scrollTop = isHome ? homeScroll : 0
        window.scrollTo(0, 0)
        const target =
          isHome && previous
            ? (panel.querySelector<HTMLElement>(
                '[data-folder-id="' + CSS.escape(previous) + '"]',
              ) ?? accountTrigger)
            : panel.querySelector<HTMLElement>('[data-collection-back]')
        target?.focus({ preventScroll: true })
        if (isHome) target?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
        const transition = animate(
          panel,
          {
            opacity: [0.68, 1],
            transform: [isHome ? 'translateX(-8px)' : 'translateX(8px)', 'translateX(0)'],
          },
          { duration: 0.16, ease: [0.22, 1, 0.36, 1] },
        )
        onCleanup(() => transition.stop())
      },
      { defer: true },
    ),
  )
  const folderFormControls = () => (
    <>
      <Show when={folderForm() === 'rename'}>
        <FolderNameForm
          mode="rename"
          initialName={chosenFolder()?.name ?? ''}
          busy={folderBusy()}
          disabled={!canManageFolders()}
          error={folderError()}
          onSubmit={saveFolder}
          onEdit={() => setFolderError('')}
          onCancel={cancelFolderForm}
        />
      </Show>
      <Show when={!folderForm() && folderError()}>
        <Alert as="p" class="inline-error">
          {folderError()}
        </Alert>
      </Show>
    </>
  )
  const emptyHeadings: Record<View, string> = {
    active: 'No notes yet',
    archived: 'Archive is empty',
    trash: 'Trash is empty',
  }

  const app = (
    <div class="app">
      <ActivityToasts editorOpen={showEditor()} />
      <Show
        when={owner()}
        fallback={
          <AccountAccess
            ready={ready()}
            joiningWaitlist={joiningWaitlist()}
            notice={notice()}
            signingIn={signingIn()}
            unavailable={unavailable()}
            onSignIn={signIn}
            onBackToSignIn={() => showWaitlist(false)}
            onSignUp={() => {
              setNotice('')
              showWaitlist(true)
            }}
          />
        }
      >
        <aside
          classList={{ sidebar: true, 'mobile-hidden': showEditor() }}
          ref={(node) => {
            sidebar = node
          }}
        >
          <header class="sidebar-header">
            <div class="brand">
              <span class="brand-mark">
                <span class="note-logo" aria-hidden="true" />
              </span>
              <span class="brand-copy">
                <strong>Quick Notes</strong>
              </span>
            </div>

            <AccountMenu
              view={view()}
              onView={changeView}
              hasDrafts={drafts().length > 0 || status() === 'Save failed'}
              onDownloadDrafts={exportDrafts}
              canSignOut={writable() && !signingOut() && !unavailable()}
              onSignOut={() => requestAnimationFrame(() => setConfirmSignOut(true))}
              triggerRef={(button) => {
                accountTrigger = button
              }}
            />
          </header>
          <ConfirmationDialog
            open={confirmSignOut()}
            onOpenChange={setConfirmSignOut}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              accountTrigger?.focus()
            }}
            title="Sign out?"
            description={
              drafts().length || status() === 'Editing' || status() === 'Save failed'
                ? 'Your unsynced drafts stay on this device and will be available the next time you sign in.'
                : 'You’ll need to sign in again to access your notes.'
            }
            confirmLabel="Sign out"
            onConfirm={() => void signOut()}
          />
          <Show when={!writable() && ready()}>
            <p class="sidebar-read-only message">
              <LockKeyhole size={16} /> Another tab has editing access.
            </p>
          </Show>
          <Show when={mustSignIn() && !showEditor()}>{reauthForm()}</Show>
          <Show when={authorized() && !unavailable()}>
            <div class="search">
              <Search size={17} />
              <TextInput
                type="search"
                placeholder="Search notes…"
                aria-label="Search notes"
                maxlength="150"
                ref={(node) => {
                  searchInput = node
                }}
                value={query()}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && query()) clearSearch()
                }}
                onInput={(event) => {
                  setQuery(event.currentTarget.value)
                  updateScreen('replace', readScreen().note)
                  if (notesPanel) notesPanel.scrollTop = 0
                  setLoadingNotes(true)
                  ++listEpoch
                  clearTimeout(listTimer)
                  listTimer = setTimeout(() => void safeList(), 220)
                }}
              />
              <kbd aria-hidden="true">{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'} K</kbd>
            </div>
          </Show>
          <div
            class="collection-panel"
            ref={(node) => {
              collectionPanel = node
            }}
          >
            <Show when={!home()}>
              <CollectionHeading
                title={activeView()}
                kind={collectionKind()}
                canManage={Boolean(chosenFolder()) && canManageFolders()}
                onBack={() => changeView('active')}
                onRename={() => {
                  setFolderError('')
                  setFolderForm(folderForm() === 'rename' ? undefined : 'rename')
                }}
                onDelete={() => void saveFolder()}
              />
            </Show>
            <Show when={query().trim()}>
              <p class="search-scope muted">
                Searching {home() ? 'notes outside folders' : activeView()}{' '}
                <Button class="secondary" onClick={clearSearch}>
                  Clear search
                </Button>
              </p>
            </Show>
            <div
              class="notes"
              aria-busy={loadingNotes()}
              ref={(node) => {
                notesPanel = node
              }}
            >
              <Show when={!showEditor() && notice()}>
                <div class="list-error">
                  <Alert as="p" class="inline-error">
                    {notice()}
                  </Alert>
                  <Show when={notice() === storageNotice}>
                    <Button
                      class="secondary"
                      onClick={() => void flushEdits().then(() => upload())}
                    >
                      Retry save
                    </Button>
                  </Show>
                  <Show when={notice() === 'Could not refresh the notes list.'}>
                    <Button
                      class="secondary"
                      disabled={loadingNotes()}
                      onClick={() => void safeList(Boolean(next()))}
                    >
                      Retry loading notes
                    </Button>
                  </Show>
                </div>
              </Show>
              <Show when={opening() && !showEditor()}>
                <p class="muted" role="status">
                  Opening note…
                </p>
              </Show>
              <Show when={unavailable()}>
                <p class="offline-notice">
                  <WifiOff size={15} />
                  Offline · showing notes on this device
                </p>
              </Show>
              <Show when={!collectionIsEmpty()}>
                <div class="list-heading">
                  <h2>
                    {query().trim()
                      ? 'Search results'
                      : view() === 'archived'
                        ? 'Archived notes'
                        : view() === 'trash'
                          ? 'Deleted notes'
                          : 'Notes'}
                  </h2>
                  <div class="list-heading-actions">
                    <Show
                      when={
                        authorized() &&
                        !unavailable() &&
                        (visibleIds().length > 0 || (home() && folders().length > 0))
                      }
                    >
                      <SortMenu
                        value={sort()}
                        mount={sidebar}
                        onChange={(value) => {
                          if (sort() === value) return
                          setSort(value)
                          updateScreen('replace', readScreen().note)
                          if (notesPanel && (!home() || query().trim())) notesPanel.scrollTop = 0
                          void safeList()
                        }}
                      />
                    </Show>
                    <Button
                      class="icon-button"
                      title="Refresh notes list"
                      aria-label="Refresh notes list"
                      disabled={refreshing() || signingOut()}
                      onClick={() => void refresh(true)}
                    >
                      <RefreshCw size={17} aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              </Show>
              <Show when={home() && !query().trim()}>
                <section class="folder-list" aria-label="Folders">
                  <For each={sortedFolders()}>
                    {(item) => (
                      <FolderRow folder={item} onOpen={() => changeView('active', item.id)} />
                    )}
                  </For>
                </section>
              </Show>
              {folderFormControls()}
              <For
                each={visibleIds()}
                fallback={
                  <Show
                    when={!collectionIsEmpty()}
                    fallback={
                      <EmptyCollection
                        kind={collectionKind()}
                        onBack={() => changeView('active')}
                        mobile
                        offline={unavailable() || mustSignIn()}
                        canCreate={canCreate()}
                        onCreate={newNote}
                      />
                    }
                  >
                    <div class="list-empty" aria-busy={!ready() || loadingNotes()}>
                      <span class="collection-icon" aria-hidden="true">
                        <Show when={query().trim()} fallback={<span class="note-logo" />}>
                          <Search size={18} />
                        </Show>
                      </span>
                      <p role="status">
                        {ready() && !loadingNotes()
                          ? query().trim() && !unavailable()
                            ? 'No matching notes'
                            : folder()
                              ? 'No notes in this folder'
                              : home() && folders().length > 0
                                ? 'No notes outside folders'
                                : emptyHeadings[view()]
                          : 'Loading notes…'}
                      </p>
                      <Show
                        when={ready() && !loadingNotes() && !query().trim() && view() === 'active'}
                      >
                        <Button class="secondary" onClick={newNote} disabled={!canCreate()}>
                          <Plus size={16} aria-hidden="true" />
                          Create a note
                        </Button>
                      </Show>
                    </div>
                  </Show>
                }
              >
                {(id) => {
                  const note = () => visibleById().get(id)
                  const current = () => open()?.id === id
                  return (
                    <NoteRow
                      id={id}
                      note={note()}
                      current={current()}
                      title={label(current() ? title() : (note()?.title ?? ''))}
                      folderName={folders().find((item) => item.id === note()?.folderId)?.name}
                      hasConflict={Boolean(draftFor(id)?.conflict)}
                      onOpen={() => void select(id)}
                    />
                  )
                }}
              </For>
              <Show when={next()}>
                <Button
                  class="load-more"
                  disabled={loadingNotes()}
                  onClick={() => void safeList(true)}
                >
                  {loadingNotes() ? 'Loading more…' : 'Load more'}
                  <ChevronDown size={15} />
                </Button>
              </Show>
            </div>
          </div>
        </aside>

        <main classList={{ workspace: true, 'mobile-hidden': !showEditor() }}>
          <Show when={mustSignIn() && showEditor()}>{reauthForm()}</Show>
          <Show when={!writable() && ready()}>
            <p class="message">
              <LockKeyhole size={16} />
              Editing is available in one tab at a time.
            </p>
          </Show>
          <Show when={notice()}>
            <Alert as="p" class="message inline-error">
              <CircleAlert size={16} />
              {notice()}
            </Alert>
          </Show>
          <Show when={!showEditor() || !open()}>
            <Show
              when={!collectionIsEmpty()}
              fallback={
                <EmptyCollection
                  kind={collectionKind()}
                  onBack={() => changeView('active')}
                  offline={unavailable() || mustSignIn()}
                  canCreate={canCreate()}
                  onCreate={newNote}
                />
              }
            >
              <Show
                when={view() === 'active'}
                fallback={
                  <CollectionPreviewPrompt kind={view() === 'trash' ? 'trash' : 'archived'} />
                }
              >
                <section class="empty">
                  <div class="empty-icon">
                    <span class="note-logo note-logo-large" aria-hidden="true" />
                  </div>
                  <h1>Select a note</h1>
                  <p>Choose a note from the sidebar.</p>
                  <Button class="secondary" onClick={newNote} disabled={!canCreate()}>
                    <Plus size={16} />
                    Create a note
                  </Button>
                </section>
              </Show>
            </Show>
          </Show>
          <Show when={open()} keyed>
            {(note) => (
              <div class="editor-pane" hidden={!showEditor()}>
                <NoteToolbar
                  visible={showEditor()}
                  fields={fields()}
                  folders={folders()}
                  canEdit={canEdit()}
                  canRestore={
                    writable() && !signingOut() && !folderBusy() && deletingNote() !== note.id
                  }
                  canDeletePermanently={canDeletePermanently()}
                  refreshing={refreshing() || deletingNote() === note.id}
                  onRefresh={() => void refresh(true)}
                  onDeletePermanently={() => void deletePermanently()}
                  title={label(title())}
                  hasSavedNote={note.base !== null || Boolean(activeDraft())}
                  saveState={saveText()}
                  saveLabel={saveLabel()}
                  saveProblem={saveProblem()}
                  offline={unavailable() || mustSignIn()}
                  onBack={() => backToNotes()}
                  onMove={(folderId) =>
                    updateNote(
                      { folderId },
                      folderId ? 'Note moved to folder' : 'Note removed from folder',
                    )
                  }
                  onPin={() =>
                    updateNote(
                      { pinned: !fields().pinned },
                      fields().pinned ? 'Note unpinned' : 'Note pinned',
                    )
                  }
                  onArchive={() =>
                    changeNoteState(
                      'archived',
                      !fields().archived,
                      fields().archived ? 'Note unarchived' : 'Note archived',
                    )
                  }
                  onTrash={() => setNoteToTrash(note.id)}
                  onRestore={() =>
                    changeNoteState(
                      'deleted',
                      false,
                      fields().archived ? 'Note restored to Archive' : 'Note restored to Notes',
                    )
                  }
                />
                <article class="note">
                  <Show when={status() === 'Save failed' && !activeDraft()?.error}>
                    <div class="note-recovery">
                      <Button
                        class="secondary"
                        onClick={() => void flushEdits().then(() => upload())}
                      >
                        <RefreshCw size={16} aria-hidden="true" />
                        Retry save
                      </Button>
                      <Button class="secondary" onClick={exportDrafts}>
                        <Download size={16} aria-hidden="true" />
                        Download all drafts
                      </Button>
                    </div>
                  </Show>
                  <Show when={activeDraft()?.error}>
                    <section class="conflict" aria-label="Save rejected">
                      <h2>
                        <CircleAlert size={16} /> Save rejected
                      </h2>
                      <Alert as="p">{activeDraft()?.error}</Alert>
                      <p>
                        Your draft is saved on this device. If its folder is unavailable, choose a
                        different folder or No folder.
                      </p>
                      <div class="conflict-actions">
                        <Button
                          class="secondary"
                          disabled={!canEdit() || unavailable() || mustSignIn()}
                          onClick={() => {
                            record()
                            void flushEdits().then(() => upload())
                          }}
                        >
                          Retry save
                        </Button>
                        <Button class="secondary" onClick={exportDrafts}>
                          Download all drafts
                        </Button>
                      </div>
                    </section>
                  </Show>
                  <Show when={activeDraft()?.conflict}>
                    {(conflict) => (
                      <section class="conflict">
                        <h2>
                          <CircleAlert size={19} />
                          This note changed on another device
                        </h2>
                        <p>Your draft is open below. Keep both to save it as a separate note.</p>
                        <Collapsible>
                          <Collapsible.Trigger class="conflict-compare-trigger">
                            Compare with synced version
                            <ChevronDown size={14} aria-hidden="true" />
                          </Collapsible.Trigger>
                          <Collapsible.Content>
                            <div class="conflict-comparison">
                              <section>
                                <h3>Your draft</h3>
                                <pre>
                                  {label(title()) +
                                    '\n' +
                                    plainText(
                                      activeDraft()?.fields.document ?? note.fields.document,
                                    )}
                                </pre>
                              </section>
                              <section>
                                <h3>Synced version</h3>
                                <pre>
                                  {conflict().current
                                    ? label(conflict().current!.title) +
                                      '\n' +
                                      describe(conflict().current!.document)
                                    : 'No server version'}
                                </pre>
                              </section>
                            </div>
                          </Collapsible.Content>
                        </Collapsible>
                        <div class="conflict-actions">
                          <Button
                            class="secondary"
                            disabled={!writable()}
                            onClick={() => void resolveConflict(true)}
                          >
                            Keep both
                          </Button>
                          <ConfirmationDialog
                            trigger="Replace synced version"
                            triggerClass="secondary"
                            disabled={!writable()}
                            title="Replace synced version?"
                            description="This will replace the synced version of this note with your draft."
                            confirmLabel="Replace synced version"
                            onConfirm={() => void resolveConflict(false)}
                          />
                          <Button class="secondary" onClick={exportDrafts}>
                            <Download size={16} />
                            Download all drafts
                          </Button>
                        </div>
                      </section>
                    )}
                  </Show>
                  <TextField class="field-root" value={title()} readOnly={!canEdit()}>
                    <TextField.TextArea
                      class="note-title"
                      rows={1}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' || event.isComposing) return
                        event.preventDefault()
                        event.currentTarget
                          .closest('article')
                          ?.querySelector<HTMLElement>('.tiptap')
                          ?.focus()
                      }}
                      aria-label="Note title"
                      placeholder="Untitled"
                      maxlength="200"
                      onCompositionStart={() => {
                        note.composing = true
                      }}
                      onCompositionEnd={() => {
                        note.composing = false
                      }}
                      onInput={(event) => {
                        const value = event.currentTarget.value.replace(/[\r\n]+/g, ' ')
                        event.currentTarget.value = value
                        setTitle(value)
                        record()
                      }}
                    />
                  </TextField>
                  <Suspense fallback={<div class="editor-loading" aria-label="Opening editor" />}>
                    <RichEditor
                      initial={note.fields.document}
                      editable={canEdit}
                      changed={(read) => {
                        documentReader = () => read() as NoteFields['document']
                        record()
                      }}
                      composition={(active) => {
                        note.composing = active
                      }}
                    />
                  </Suspense>
                </article>
              </div>
            )}
          </Show>
        </main>
        <ConfirmationDialog
          open={Boolean(noteToTrash() && noteToTrash() === open()?.id && showEditor())}
          onOpenChange={(isOpen) => {
            if (!isOpen) setNoteToTrash(undefined)
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (!showEditor()) return
            const toolbar = document.querySelector('.editor-pane:not([hidden]) .note-topbar')
            const trigger = toolbar?.querySelector<HTMLButtonElement>(
              '.note-more, button[aria-label="Move to trash"]',
            )
            trigger?.focus({ preventScroll: true })
          }}
          title="Move note to Trash?"
          description={
            <>
              <strong>{label(title())}</strong> can be restored from Trash.
            </>
          }
          confirmLabel="Move to Trash"
          onConfirm={() => {
            if (noteToTrash() === open()?.id && canEdit())
              changeNoteState('deleted', true, 'Note moved to Trash')
          }}
        />
        <CreateMenu
          editorOpen={showEditor()}
          canCreateNote={canCreate()}
          canCreateFolder={canManageFolders()}
          onCreateNote={newNote}
          onCreateFolder={newFolder}
          onTriggerRef={(button) => {
            createTrigger = button
          }}
        />
        <CreateFolderDialog
          open={folderForm() === 'create'}
          busy={folderBusy()}
          disabled={!canManageFolders()}
          error={folderError()}
          onSubmit={saveFolder}
          onEdit={() => setFolderError('')}
          onCancel={cancelFolderForm}
          onClose={restoreFolderDialogFocus}
        />
      </Show>
    </div>
  )

  return (
    <>
      <Show when={update()}>
        <section class="update-alert" aria-label="App update">
          <span class="update-alert-icon">
            <RefreshCw size={18} aria-hidden="true" />
          </span>
          <div class="update-alert-copy" role="status">
            <strong>{restarting() ? 'Updating Quick Notes…' : 'Update ready'}</strong>
          </div>
          <Button class="primary" disabled={restarting()} onClick={() => void restartToUpdate()}>
            Restart to update
          </Button>
        </section>
      </Show>
      {app}
    </>
  )
}

function describe(node: { text?: string; content?: unknown[]; type: string }): string {
  if (node.text) return node.text
  return (
    node.content
      ?.map((child) => describe(child as typeof node))
      .join(['paragraph', 'heading'].includes(node.type) ? '' : '\n') ?? ''
  )
}
