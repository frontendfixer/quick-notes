import { CancelledError, type QueryClient } from '@tanstack/solid-query'
import { batch, createMemo, createSignal, type Accessor } from 'solid-js'
import { plainText, type Summary, type NoteFields, type View } from '../../../../packages/contracts'
import { local, type Draft } from '../storage'
import type { NoteSort } from '../components/note-menus'

type NotePage = { notes: Summary[]; next: string | null }
type CachedList = NotePage & { pages: number }

function belongsTo(note: Pick<Summary, 'deleted' | 'archived'>, view: View) {
  return view === 'trash' ? note.deleted : !note.deleted && note.archived === (view === 'archived')
}

type ListOptions = {
  queryClient: QueryClient
  owner: Accessor<string | undefined>
  authorized: Accessor<boolean>
  unavailable: Accessor<boolean>
  mustSignIn: Accessor<boolean>
  signingOut: Accessor<boolean>
  drafts: Accessor<Draft[]>
  draftFor: (id: string) => Draft | undefined
  view: Accessor<View>
  folder: Accessor<string | undefined>
  sort: Accessor<NoteSort>
  query: Accessor<string>
  notice: Accessor<string>
  setNotice: (notice: string) => void
  manualRefresh: Accessor<boolean>
  expire: () => void
}

export function createNoteList({
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
}: ListOptions) {
  const [notes, setNotes] = createSignal<Summary[]>([])
  const [next, setNext] = createSignal<string | null>(null)
  const [loadingNotes, setLoadingNotes] = createSignal(false)
  const [loadingMore, setLoadingMore] = createSignal(false)
  let moreRequest: number | undefined
  const [displayedList, setDisplayedList] = createSignal<string>()
  let listInFlight: string | undefined
  let refreshAfterList = false
  let listEpoch = 0

  // The same identity scopes both cached pages and results that may update the current view.
  const inView = (note: Pick<NoteFields, 'folderId' | 'deleted' | 'archived'>) => {
    const currentFolder = folder()
    const currentView = view()
    if (!belongsTo(note, currentView)) return false
    if (currentFolder) return note.folderId === currentFolder
    return currentView !== 'active' || !note.folderId
  }

  function clearList() {
    ++listEpoch
    setDisplayedList(undefined)
    listInFlight = undefined
    refreshAfterList = false
    moreRequest = undefined
    setLoadingNotes(false)
    setLoadingMore(false)
    setNotes([])
    setNext(null)
  }

  function listParams() {
    const params = new URLSearchParams({ view: view(), sort: sort(), q: query() })
    const currentFolder = folder()
    if (currentFolder) params.set('folder', currentFolder)
    else if (view() === 'active') params.set('unfiled', 'true')
    return params
  }

  class SessionExpired extends Error {}

  async function fetchNotePage(
    params: URLSearchParams,
    cursor: string | null,
    signal: AbortSignal,
  ) {
    const page = new URLSearchParams(params)
    if (cursor) page.set('cursor', cursor)
    const response = await fetch('/api/notes?' + page, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
    })
    if (response.status === 401) throw new SessionExpired()
    if (!response.ok) throw new Error('Could not load notes')
    return (await response.json()) as NotePage
  }

  async function safeList(append = false, foreground = true) {
    const id = owner()
    if (!id || signingOut()) return
    const params = listParams()
    const identity = params.toString()
    const key = ['notes', id, identity] as const
    const cached = queryClient.getQueryData<CachedList>(key)
    const online = authorized() && !unavailable()
    const cursor = append && displayedList() === identity ? next() : null
    if ((append && !cursor) || (moreRequest !== undefined && displayedList() === identity)) return
    if (!foreground && listInFlight === identity) return
    const request = ++listEpoch
    listInFlight = identity
    const current = () =>
      request === listEpoch && owner() === id && listParams().toString() === identity
    const show = (page: NotePage) => {
      batch(() => {
        setDisplayedList(identity)
        setNotes(page.notes)
        setNext(page.next)
      })
    }
    if (append) {
      moreRequest = request
      setLoadingMore(true)
    } else {
      moreRequest = undefined
      setLoadingMore(false)
      if (online && cached && displayedList() !== identity) show(cached)
      setLoadingNotes(foreground && displayedList() === undefined)
    }
    try {
      if (!online) {
        const snapshots = await local.snapshots(id)
        if (!current()) return
        const entries = new Map(snapshots.map((note) => [note.id, note]))
        for (const draft of drafts()) {
          entries.set(draft.id, {
            ...draft.fields,
            id: draft.id,
            revision: draft.base ?? 0,
            updatedAt: draft.changedAt,
          })
        }
        show({
          notes: [...entries.values()]
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .filter(inView)
            .map((note) => ({ ...note, preview: plainText(note.document).slice(0, 180) })),
          next: null,
        })
        return
      }
      if (cursor) await queryClient.cancelQueries({ queryKey: key, exact: true })
      const data = cursor
        ? await queryClient.query({
            queryKey: ['note-page', id, identity, cursor],
            gcTime: 0,
            queryFn: async ({ signal }): Promise<CachedList> => {
              const page = await fetchNotePage(params, cursor, signal)
              const combined = new Map((cached?.notes ?? notes()).map((note) => [note.id, note]))
              for (const note of page.notes) combined.set(note.id, note)
              return {
                notes: [...combined.values()],
                next: page.next,
                pages: (cached?.pages ?? 1) + 1,
              }
            },
          })
        : await queryClient.query({
            queryKey: key,
            queryFn: async ({ signal }): Promise<CachedList> => {
              const entries = new Map<string, Summary>()
              const pageCount = cached?.pages ?? 1
              let next: string | null = null
              let pages = 0
              do {
                const page = await fetchNotePage(params, next, signal)
                for (const note of page.notes) entries.set(note.id, note)
                next = page.next
              } while (++pages < pageCount && next)
              return { notes: [...entries.values()], next, pages }
            },
          })
      if (!current()) return
      if (cursor) queryClient.setQueryData(key, data)
      show(data)
      if (notice() === 'Could not refresh the notes list.') setNotice('')
    } catch (error) {
      if (!current() || error instanceof CancelledError) return
      if (error instanceof SessionExpired) expire()
      else if (append || (foreground && (!cached || manualRefresh())))
        setNotice('Could not refresh the notes list.')
    } finally {
      if (moreRequest === request) {
        moreRequest = undefined
        setLoadingMore(false)
      }
      if (request === listEpoch) {
        listInFlight = undefined
        setLoadingNotes(false)
        if (refreshAfterList) {
          refreshAfterList = false
          void safeList(false, false)
        }
      }
    }
  }

  function invalidateListRequest() {
    ++listEpoch
    listInFlight = undefined
    setLoadingNotes(false)
  }

  function removeListNote(id: string) {
    ++listEpoch
    listInFlight = undefined
    setLoadingNotes(false)
    void queryClient.cancelQueries({ queryKey: ['notes', owner()] })
    setNotes((previous) => previous.filter((note) => note.id !== id))
    queryClient.setQueriesData<CachedList>(
      { queryKey: ['notes', owner()] },
      (data) => data && { ...data, notes: data.notes.filter((note) => note.id !== id) },
    )
  }

  function acknowledgeListNote(id: string, updated: Summary) {
    for (const { queryKey } of queryClient.getQueryCache().findAll({ queryKey: ['notes', id] })) {
      const params = new URLSearchParams(String(queryKey[2]))
      const destination = params.get('folder')
      const matches =
        belongsTo(updated, params.get('view') as View) &&
        (destination
          ? updated.folderId === destination
          : !params.has('unfiled') || !updated.folderId)
      queryClient.setQueryData<CachedList>(
        queryKey,
        (data) =>
          data && {
            ...data,
            notes: data.notes.flatMap((note) =>
              note.id !== updated.id ? [note] : matches ? [{ ...note, ...updated }] : [],
            ),
          },
      )
    }
    setNotes((previous) => {
      const exists = previous.some(({ id }) => id === updated.id)
      if (!inView(updated)) return previous.filter(({ id }) => id !== updated.id)
      if (exists) return previous.map((note) => (note.id === updated.id ? updated : note))
      return query().trim() ? previous : [updated, ...previous]
    })
  }

  function invalidateCachedLists(id: string) {
    void queryClient.invalidateQueries({ queryKey: ['notes', id], refetchType: 'none' })
  }

  function refreshChangedLists(id: string) {
    invalidateCachedLists(id)
    if (listInFlight) refreshAfterList = true
    else void safeList(false, false)
  }

  // Overlay unsynced edits on server summaries so local work remains visible.
  const visibleNotes = createMemo(() => {
    const cachedView = unavailable() || mustSignIn()
    if (!cachedView && query().trim()) return notes().filter((note) => !draftFor(note.id)?.purge)
    const ordered = new Map(notes().map((note) => [note.id, note]))
    const added: Summary[] = []
    for (const draft of drafts()) {
      if (draft.purge) {
        ordered.delete(draft.id)
        continue
      }
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

  return {
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
  }
}
