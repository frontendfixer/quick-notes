import { createSession } from './workspace/session'
import { createDraftBuffer } from './workspace/draft-buffer'
import { createFolders } from './workspace/folders'
import { createNoteSync } from './workspace/note-sync'
import { createNoteList } from './workspace/note-list'
import { noteTitle } from './note-title'
import { QueryClient } from '@tanstack/solid-query'
import { animate } from 'motion/mini'
import { batch, createEffect, createSignal, lazy, on, onCleanup, onMount } from 'solid-js'
import { registerAppWorker } from './pwa-update'
import { emptyNote, type Note, type NoteFields, type View } from '../../../packages/contracts'
import { local } from './storage'
import { readScreen, writeScreen } from './location'
import { clearNotifications, notify } from './components/activity-toasts'
import { type CollectionKind } from './components/folder-views'
import { createShortcuts } from './components/create-menu'
import { type NoteSort } from './components/note-menus'
export const RichEditor = lazy(() => import('./editor'))

type OpenNote = {
  id: string
  owner: string
  title: string
  fields: NoteFields
  base: number | null
  composing: boolean
}
function download(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  )
  const anchor = Object.assign(document.createElement('a'), { href: url, download: name })
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Compose the workspace modules and keep cross-surface navigation in one place.
export function createWorkspace() {
  const [exportingPdf, setExportingPdf] = createSignal(false)
  const initialScreen = readScreen()
  const [joiningWaitlist, setJoiningWaitlist] = createSignal(
    new URLSearchParams(location.search).get('signup') === '1',
  )
  const queryClient = new QueryClient({
    defaultOptions: { queries: { networkMode: 'always', retry: false } },
  })
  const [folder, setFolder] = createSignal(initialScreen.folder)
  const [view, setView] = createSignal<View>(initialScreen.view)
  const [sort, setSort] = createSignal<NoteSort>(initialScreen.sort)
  const [query, setQuery] = createSignal(initialScreen.query)
  const [open, setOpen] = createSignal<OpenNote>()
  const [title, setTitle] = createSignal('')
  const [fields, setFields] = createSignal(emptyNote())
  let homeScroll = 0
  let libraryScroll = 0
  let notesPanel: HTMLDivElement | undefined
  const [showEditor, setShowEditor] = createSignal(false)
  const [status, setStatus] = createSignal('')
  const [notice, setNotice] = createSignal('')
  const [update, setUpdate] = createSignal(false)
  const [updateDeferred, setUpdateDeferred] = createSignal(false)
  const [opening, setOpening] = createSignal<false | 'local' | 'remote'>(false)
  const [creating, setCreating] = createSignal(false)
  const [confirmSignOut, setConfirmSignOut] = createSignal(false)
  const [noteToTrash, setNoteToTrash] = createSignal<string>()
  let accountTrigger: HTMLButtonElement | undefined
  let createTrigger: HTMLButtonElement | undefined
  let folderDialogOrigin: HTMLElement | undefined
  const [restarting, setRestarting] = createSignal(false)
  let worker: ReturnType<typeof registerAppWorker>
  let selection = 0
  let editEpoch = 0
  const [deletingNote, setDeletingNote] = createSignal<string>()
  let listTimer: ReturnType<typeof setTimeout> | undefined
  let documentReader: (() => NoteFields['document']) | undefined
  let searchInput: HTMLInputElement | undefined

  const {
    owner,
    ready,
    authorized,
    mustSignIn,
    writable,
    unavailable,
    signingIn,
    signingOut,
    manualRefresh,
    expire,
    refresh,
    signIn,
    signOut,
    restoreSession,
    listenForSignOut,
  } = createSession({
    setNotice,
    flushEdits: () => flushEdits(),
    storageError,
    refreshWorkspace,
    onSessionClosed: resetWorkspace,
    onAccountChanged() {
      setOpen(undefined)
      queryClient.clear()
      clearList()
      clearDrafts()
      clearFolders()
      setShowEditor(false)
    },
    async restoreWorkspace() {
      await loadLocal().catch(storageError)
      await loadFolders(owner()!, true).catch(() => undefined)
      void safeList(false, false)
    },
  })
  const { drafts, draftFor, loadLocal, queueEdit, flushEdits, ordered, pending, clearDrafts } =
    createDraftBuffer({
      owner,
      open,
      scheduleUpload: () => scheduleUpload(550),
      onPersisted(id) {
        if (showEditor() && open()?.id === id && !readScreen().note) updateScreen('push', id)
      },
      onSaveStatus: setStatus,
      onFlushSuccess() {
        if (notice() === storageNotice) setNotice('')
      },
      onStorageError: storageError,
    })
  const activeDraft = () => draftFor(open()?.id ?? '')
  const {
    safeList,
    clearList,
    invalidateListRequest,
    invalidateCachedLists,
    removeListNote,
    acknowledgeListNote,
    refreshChangedLists,
    inView,
    listParams,
    displayedList,
    loadingNotes,
    loadingMore,
    next,
    visibleById,
    visibleIds,
  } = createNoteList({
    queryClient,
    owner,
    authorized,
    unavailable,
    mustSignIn,
    signingOut,
    drafts,
    draftFor,
    view,
    folder,
    sort,
    query,
    notice,
    setNotice,
    manualRefresh,
    expire,
  })
  const {
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
    clearFolders,
  } = createFolders({
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
    onFolderMissing() {
      const note = readScreen().note
      changeView('active', undefined, 'none')
      updateScreen('replace', note)
      setNotice('This folder is no longer available.')
      void safeList()
    },
    onFolderDeleted(id) {
      const current = open()
      if (
        current &&
        fields().folderId === id &&
        !draftFor(current.id) &&
        !pending.has(current.id)
      ) {
        ++selection
        setOpen(undefined)
        setShowEditor(false)
      }
      changeView('active', undefined, 'replace')
    },
  })
  const { scheduleUpload, upload } = createNoteSync({
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
    openNoteId: () => open()?.id,
    hasPendingEdits: () => pending.size > 0,
    onPurged: closeUnavailableNote,
    onNoteUpdated: acknowledgeListNote,
    onUploaded(id) {
      refreshChangedLists(id)
      if (!folderBusy()) void loadFolders(id).catch(() => undefined)
    },
    async onAcknowledged(draft, revision) {
      const current = open()
      if (current?.owner !== draft.owner || current.id !== draft.id) return
      current.base = revision
      if (
        !pending.has(draft.id) &&
        !(await local.drafts(draft.owner)).some(({ id }) => id === draft.id)
      )
        setStatus('Saved to server')
    },
  })
  const canEdit = () =>
    writable() &&
    !activeDraft()?.purge &&
    !fields().deleted &&
    !signingOut() &&
    !creating() &&
    !folderBusy()

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
      clearList()
      setShowEditor(false)
    })
    if (historyMode !== 'none') {
      updateScreen(historyMode)
      void safeList()
    }
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
          clearList()
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
    if (!account || draftFor(id)?.purge) return
    if (open()?.id === id) {
      ++selection
      setOpening(false)
      matchCollection(fields())
      setShowEditor(true)
      updateScreen(fromUrl ? 'replace' : 'push', id)
      return
    }
    const request = ++selection
    setOpening('local')
    let hasLocal = false
    setNotice('')
    try {
      if (!(await flushEdits())) return
      if (request !== selection || owner() !== account) return
      const draft = draftFor(id)
      if (draft?.purge) return
      let cached = await local.snapshot(account, id)
      if (request !== selection || owner() !== account) return
      if (draft || cached) {
        hasLocal = true
        const initial = draft?.fields ?? cached!
        showNote(account, draft ? draft.base : cached!.revision, initial)
        if (cached) void local.touchSnapshot(account, cached).catch(storageError)
      }
      if (!authorized() || unavailable()) {
        if (!draft && !cached) setNotice('This note is unavailable offline.')
        return
      }
      if (!hasLocal) setOpening('remote')
      const edit = editEpoch
      const response = await fetch('/api/notes/' + id, {
        headers: cached ? { 'If-None-Match': '"' + cached.revision + '"' } : {},
        signal: AbortSignal.timeout(5000),
      })
      if (response.status === 401) return expire()
      if (response.status === 304 || (response.status === 404 && draft)) return
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
      if (request === selection && !hasLocal)
        setNotice('Could not open note. Try again when connected.')
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
    removeListNote(id)
  }

  function canDeletePermanently() {
    const current = open()
    const draft = activeDraft()
    return Boolean(
      current &&
      fields().deleted &&
      writable() &&
      !signingOut() &&
      !folderBusy() &&
      !deletingNote() &&
      !draft?.purge &&
      !draft?.conflict &&
      status() !== 'Editing' &&
      !pending.has(current.id) &&
      (draft || current.base !== null),
    )
  }

  async function deletePermanently() {
    const current = open()
    if (!current || !canDeletePermanently()) return
    const deletedFields = fields()
    setDeletingNote(current.id)
    try {
      await ordered(async () => {
        await local.change(current.owner, current.id, (previous) => {
          if ((previous?.base ?? current.base) === null && !previous?.sent) return undefined
          return {
            owner: current.owner,
            id: current.id,
            fields: deletedFields,
            base: current.base,
            changedAt: new Date().toISOString(),
            ...previous,
            generation: crypto.randomUUID(),
            error: undefined,
            purge: true,
            purgeRevision: previous ? undefined : (current.base ?? undefined),
          }
        })
        await loadLocal(current.owner)
      })
      if (owner() === current.owner) {
        closeUnavailableNote(current.id)
        notify(
          draftFor(current.id)?.purge ? 'Permanent deletion queued' : 'Note permanently deleted',
        )
        void upload()
      }
    } catch {
      storageError()
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

  async function exportPdf(action: 'print' | 'download') {
    if (!open() || exportingPdf()) return
    const pdfTitle = noteTitle(title())
    const document = documentReader?.() ?? fields().document
    let printWindow: Window | undefined
    if (action === 'print') {
      printWindow = window.open('', '_blank') ?? undefined
      if (!printWindow) {
        notify('Allow pop-ups to print this note.', { error: true })
        return
      }
      printWindow.opener = null
    }

    setExportingPdf(true)
    try {
      const { exportNotePdf } = await import('./note-pdf')
      await exportNotePdf(pdfTitle, document, printWindow)
    } catch {
      printWindow?.close()
      notify('Could not generate the note PDF.', { error: true })
    } finally {
      setExportingPdf(false)
    }
  }

  function resetWorkspace() {
    setConfirmSignOut(false)
    setNoteToTrash(undefined)
    ++selection
    setOpen(undefined)
    clearDrafts()
    queryClient.clear()
    clearList()
    setView('active')
    setFolder(undefined)
    clearFolders()
    setFolderForm(undefined)
    setFolderError('')
    setQuery('')
    setShowEditor(false)
    updateScreen('replace')
    clearNotifications()
    homeScroll = 0
    libraryScroll = 0
  }

  async function refreshWorkspace(manual: boolean) {
    await loadLocal().catch(storageError)
    await Promise.all([
      authorized() ? loadFolders(owner()!).catch(() => undefined) : undefined,
      safeList(false, manual || displayedList() === undefined),
    ])
    const restored = await restoreNoteFromUrl()
    if (authorized()) {
      if (manual) await upload(true)
      else void upload(true)
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
    if (!draft?.conflict || (!copy && !draft.conflict.current)) return
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
    listenForSignOut()
    worker = registerAppWorker(() => setUpdate(true))
    onCleanup(() => worker?.dispose())
    void restoreSession()
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
      window.removeEventListener('online', resume)
      window.removeEventListener('offline', resume)
      window.removeEventListener('focus', resume)
      document.removeEventListener('visibilitychange', visible)
      queryClient.clear()
    })
  })

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
        if (activeDraft()?.purge || fields()[key] !== value) return false
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
      if (draft?.purge) return false
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
    if (!note || !writable() || signingOut() || activeDraft()?.purge || deletingNote() === note.id)
      return
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
  function searchNotes(value: string) {
    setQuery(value)
    updateScreen('replace', readScreen().note)
    if (notesPanel) notesPanel.scrollTop = 0
    invalidateListRequest()
    clearTimeout(listTimer)
    listTimer = setTimeout(() => void safeList(), 220)
  }

  function setDocumentReader(read: () => unknown) {
    documentReader = () => read() as NoteFields['document']
    record()
  }

  const setAccountTrigger = (node: HTMLButtonElement) => {
    accountTrigger = node
  }
  const setSearchInput = (node: HTMLInputElement) => {
    searchInput = node
  }
  const setCollectionPanel = (node: HTMLDivElement) => {
    collectionPanel = node
  }
  const setNotesPanel = (node: HTMLDivElement) => {
    notesPanel = node
  }
  const setCreateTrigger = (node: HTMLButtonElement) => {
    createTrigger = node
  }

  return {
    shell: {
      canCreate,
      canEdit,
      canManageFolders,
      cancelFolderForm,
      changeNoteState,
      folderBusy,
      folderError,
      folderForm,
      joiningWaitlist,
      newFolder,
      newNote,
      noteToTrash,
      notice,
      open,
      owner,
      ready,
      restoreFolderDialogFocus,
      saveFolder,
      setCreateTrigger,
      setFolderError,
      setNoteToTrash,
      setNotice,
      showEditor,
      showWaitlist,
      signIn,
      signingIn,
      title,
      unavailable,
    },
    sidebar: {
      signingIn,
      signIn,
      folderBusy,
      activeView,
      authorized,
      canCreate,
      canManageFolders,
      cancelFolderForm,
      changeView,
      chosenFolder,
      clearSearch,
      collectionIsEmpty,
      collectionKind,
      confirmSignOut,
      displayedList,
      draftFor,
      drafts,
      exportDrafts,
      flushEdits,
      folder,
      folderError,
      folderForm,
      folders,
      home,
      listParams,
      loadingMore,
      loadingNotes,
      manualRefresh,
      mustSignIn,
      newNote,
      next,
      notice,
      open,
      opening,
      query,
      ready,
      refresh,
      safeList,
      saveFolder,
      searchNotes,
      select,
      setAccountTrigger,
      setCollectionPanel,
      setConfirmSignOut,
      setFolderError,
      setFolderForm,
      setNotesPanel,
      setSearchInput,
      setSort,
      showEditor,
      signOut,
      signingOut,
      sort,
      sortedFolders,
      status,
      storageNotice,
      title,
      unavailable,
      updateScreen,
      upload,
      view,
      visibleById,
      visibleIds,
      writable,
    },
    editor: {
      activeDraft,
      backToNotes,
      canCreate,
      canDeletePermanently,
      canEdit,
      changeNoteState,
      changeView,
      collectionIsEmpty,
      collectionKind,
      deletePermanently,
      deletingNote,
      exportDrafts,
      exportPdf,
      exportingPdf,
      fields,
      flushEdits,
      folderBusy,
      folders,
      manualRefresh,
      mustSignIn,
      newNote,
      notice,
      open,
      ready,
      record,
      refresh,
      resolveConflict,
      saveLabel,
      saveProblem,
      saveText,
      setDocumentReader,
      setNoteToTrash,
      setTitle,
      showEditor,
      signIn,
      signingIn,
      signingOut,
      status,
      title,
      unavailable,
      updateNote,
      upload,
      view,
      writable,
    },
    updateDialog: {
      restartToUpdate,
      restarting,
      setUpdateDeferred,
      update,
      updateDeferred,
    },
  }
}

export type Workspace = ReturnType<typeof createWorkspace>
