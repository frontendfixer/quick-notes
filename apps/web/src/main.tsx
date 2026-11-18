import { createEffect, createSignal, For, lazy, onCleanup, onMount, Show, Suspense } from 'solid-js'
import { render } from 'solid-js/web'
import { registerSW } from 'virtual:pwa-register'
import {
  emptyNote,
  type Ack,
  type Note,
  type NoteFields,
  type Summary,
  type View,
} from '../../../packages/contracts'
import { local, type Draft } from './storage'
import './style.scss'

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

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  )
  const anchor = Object.assign(document.createElement('a'), { href: url, download: name })
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function App() {
  const [owner, setOwner] = createSignal<string>()
  const [ready, setReady] = createSignal(false)
  const [authorized, setAuthorized] = createSignal(false)
  const [mustSignIn, setMustSignIn] = createSignal(false)
  const [writable, setWritable] = createSignal(false)
  const [unavailable, setUnavailable] = createSignal(false)
  const [view, setView] = createSignal<View>('active')
  const [sort, setSort] = createSignal('updated')
  const [query, setQuery] = createSignal('')
  const [notes, setNotes] = createSignal<Summary[]>([])
  const [next, setNext] = createSignal<string | null>(null)
  const [drafts, setDrafts] = createSignal<Draft[]>([])
  const [open, setOpen] = createSignal<OpenNote>()
  const [title, setTitle] = createSignal('')
  const [fields, setFields] = createSignal(emptyNote())
  const [showEditor, setShowEditor] = createSignal(false)
  const [status, setStatus] = createSignal('')
  const [notice, setNotice] = createSignal('')
  const [update, setUpdate] = createSignal(false)
  const [signingIn, setSigningIn] = createSignal(false)
  const [opening, setOpening] = createSignal(false)
  const [creating, setCreating] = createSignal(false)
  const [signingOut, setSigningOut] = createSignal(false)
  let updateWorker: (reloadPage?: boolean) => Promise<void>
  let releaseWriter: (() => void) | undefined
  let lockOwner: string | undefined
  let requestedLock = 0
  const sessionChanges = new BroadcastChannel('quick-notes-session')
  let selection = 0
  let editEpoch = 0
  let listEpoch = 0
  let draftEpoch = 0
  let syncBusy = false
  let refreshBusy = false
  let refreshAgain = false
  let queue: Promise<unknown> = Promise.resolve()
  let localTimer: ReturnType<typeof setTimeout> | undefined
  let uploadTimer: ReturnType<typeof setTimeout> | undefined
  let listTimer: ReturnType<typeof setTimeout> | undefined
  let retryDelay = 1000
  const pending = new Map<string, PendingEdit>()
  let documentReader: (() => NoteFields['document']) | undefined

  const ordered = <T,>(work: () => Promise<T>) => {
    const result = queue.then(work)
    queue = result.catch(() => undefined)
    return result
  }
  const draftFor = (id: string) => drafts().find((draft) => draft.id === id)
  const activeDraft = () => draftFor(open()?.id ?? '')
  const canEdit = () => writable() && !fields().deleted && !signingOut() && !creating()

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

  async function list(append = false) {
    const id = owner()
    if (!id) return
    const request = ++listEpoch
    const tab = view()
    if (tab === 'offline' || unavailable() || mustSignIn()) {
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
          tab === 'offline'
            ? offline
            : offline.filter((note) =>
                tab === 'trash'
                  ? note.deleted
                  : !note.deleted && note.archived === (tab === 'archived'),
              ),
        )
        setNext(null)
      }
      return
    }
    if (!authorized()) return
    const params = new URLSearchParams({ view: tab, sort: sort(), q: query() })
    if (append && next()) params.set('cursor', next()!)
    const response = await fetch('/api/notes?' + params)
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

  async function select(id: string) {
    const account = owner()
    if (!account) return
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
        loadEditor(id, account, draft ? draft.base : cached!.revision, initial)
        if (cached) void local.cache(account, cached, id).catch(storageError)
      }
      if (!authorized() || unavailable()) {
        if (!draft && !cached) setNotice('This note is unavailable offline.')
        return
      }
      const edit = editEpoch
      const response = await fetch('/api/notes/' + id, {
        headers: cached ? { 'If-None-Match': '"' + cached.revision + '"' } : {},
      })
      if (response.status === 401) return expire()
      if (response.status === 304) return
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
          loadEditor(id, account, (cached ?? note).revision, cached ?? note)
        }
      }
    } catch {
      if (request === selection) setNotice('Could not open note. Try again when connected.')
    } finally {
      if (request === selection) setOpening(false)
    }
  }

  const storageNotice =
    'Device storage could not save your changes. Retry or download a recovery copy.'
  function storageError() {
    setStatus('Save failed')
    setNotice(storageNotice)
  }

  function record(overrides: Partial<NoteFields> = {}) {
    const current = open()
    if (!current || !writable() || signingOut()) return
    editEpoch++
    const currentFields = { ...fields(), ...overrides, title: title() }
    const reader = documentReader
    setFields(currentFields)
    pending.set(current.id, {
      owner: current.owner,
      id: current.id,
      base: current.base,
      generation: crypto.randomUUID(),
      fields: () => ({ ...currentFields, document: reader?.() ?? currentFields.document }),
      changedAt: new Date().toISOString(),
    })
    setStatus('Editing')
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
          await local.change(item.owner, item.id, (previous) => ({
            ...previous,
            owner: item.owner,
            id: item.id,
            changedAt: item.changedAt,
            generation: item.generation,
            fields: item.fields(),
            base: previous ? previous.base : current?.id === item.id ? current.base : item.base,
            error: undefined,
          }))
          if (pending.get(item.id) === item) pending.delete(item.id)
          if (open()?.id === item.id && !pending.has(item.id)) setStatus('Saved on device')
        }
        await loadLocal()
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
          continue
        }
        if ([400, 413, 422].includes(response.status)) {
          await ordered(() =>
            local.change(
              id,
              draft.id,
              (current) =>
                current && {
                  ...current,
                  sent: undefined,
                  error:
                    current.generation === sent.generation
                      ? 'Server rejected this draft. Edit it or download a copy.'
                      : undefined,
                },
            ),
          )
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
      if (uploaded) void safeList()
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
    try {
      await list(append)
    } catch {
      setNotice('Could not refresh the notes list.')
    }
  }

  async function refresh() {
    if (refreshBusy || signingIn() || signingOut()) {
      refreshAgain = true
      return
    }
    refreshBusy = true
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
        await safeList()
        if (authorized()) {
          void upload()
          const current = open()
          if (
            current &&
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
            if (result.status === 401) expire()
            if (result.ok) {
              const note: Note = await result.json()
              await local.cache(current.owner, note, current.id).catch(storageError)
              if (
                open() === current &&
                !current.composing &&
                epoch === editEpoch &&
                request === selection &&
                note.revision > (current.base ?? 0)
              ) {
                loadEditor(current.id, current.owner, note.revision, note)
              }
            }
          }
        }
      }
    } catch {
      setNotice('Refresh paused. Reconnect or try again.')
    } finally {
      refreshBusy = false
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
      if (!response.ok)
        setNotice(
          response.status === 429
            ? 'Too many attempts. Try again shortly.'
            : 'Sign-in failed. Check your email and password.',
        )
      else void navigator.storage?.persist?.().catch(() => false)
    } catch {
      setNotice('Could not connect to sign in.')
    } finally {
      setSigningIn(false)
      void refresh()
    }
  }

  function closeSession() {
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
    setQuery('')
    setShowEditor(false)
  }

  async function signOut() {
    if (!writable() || signingOut()) return
    setSigningOut(true)
    try {
      if (!(await flushEdits())) return
      if (
        drafts().length &&
        !window.confirm(
          'Some changes are saved only on this device. Sign out and keep them for your next sign-in?',
        )
      )
        return
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
    } catch {
      setNotice('Could not sign out. Please reconnect and retry.')
    } finally {
      setSigningOut(false)
    }
  }

  async function create(initial = emptyNote()) {
    const account = owner()
    if (!account || !writable() || creating() || signingOut()) return
    const request = ++selection
    setOpening(false)
    setCreating(true)
    try {
      if (!(await flushEdits()) || owner() !== account || request !== selection) return
      const id = crypto.randomUUID()
      loadEditor(id, account, null, initial)
      record()
      return id
    } finally {
      setCreating(false)
    }
  }

  async function resolveConflict(copy: boolean) {
    if (!writable() || !(await flushEdits())) return
    const draft = activeDraft()
    if (!draft?.conflict) return
    const remote = draft.conflict.current
    if (copy) {
      const copyId = await create({ ...draft.fields, deleted: false })
      if (!copyId || !(await flushEdits())) return
      if (remote) await local.cache(draft.owner, remote, copyId).catch(storageError)
      await ordered(() => local.change(draft.owner, draft.id, () => undefined))
    } else {
      if (!window.confirm('Replace the reviewed server version with this draft?')) return
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
    sessionChanges.onmessage = (event) => {
      if (owner() && event.data?.closed === owner()) closeSession()
    }
    updateWorker = registerSW({ onNeedRefresh: () => setUpdate(true) })
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
        void safeList()
      }
      await refresh()
    })()
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh()
      else if (pending.size) void flushEdits()
    }
    const resume = () => {
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
      sessionChanges.close()
      window.removeEventListener('online', resume)
      window.removeEventListener('offline', resume)
      window.removeEventListener('focus', resume)
      document.removeEventListener('visibilitychange', visible)
      releaseWriter?.()
    })
  })

  const visibleNotes = () => {
    const cachedView = view() === 'offline' || unavailable() || mustSignIn()
    if (!cachedView && query().trim()) return notes()
    const pendingNotes: Summary[] = []
    for (const draft of drafts()) {
      const f = draft.fields
      if (
        view() === 'offline' ||
        (view() === 'trash' ? f.deleted : !f.deleted && f.archived === (view() === 'archived'))
      ) {
        const { document: _document, ...metadata } = f
        pendingNotes.push({
          ...metadata,
          id: draft.id,
          revision: draft.base ?? 0,
          updatedAt: draft.changedAt,
        })
      }
    }
    const editing = new Set(drafts().map((draft) => draft.id))
    pendingNotes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return [...pendingNotes, ...notes().filter((note) => !editing.has(note.id))]
  }

  const reauthForm = () => (
    <form class="reauth" onSubmit={signIn}>
      <span>Sign in to resume uploads.</span>
      <input
        name="email"
        type="email"
        aria-label="Email"
        placeholder="Email"
        autocomplete="username"
        required
      />
      <input
        name="password"
        type="password"
        aria-label="Password"
        placeholder="Password"
        autocomplete="current-password"
        required
      />
      <button class="primary" disabled={signingIn()}>
        Sign in
      </button>
    </form>
  )

  return (
    <div class="app">
      <Show
        when={owner()}
        fallback={
          <main class="login">
            <div class="brand">
              <img src="/icon-192.png" alt="" /> Quick Notes
            </div>
            <Show when={ready()} fallback={<p>Opening…</p>}>
              <form onSubmit={signIn}>
                <h1>Sign in</h1>
                <label>
                  Email
                  <input name="email" type="email" autocomplete="username" required />
                </label>
                <label>
                  Password
                  <input name="password" type="password" autocomplete="current-password" required />
                </label>
                <button class="primary" disabled={signingIn() || unavailable()}>
                  {signingIn() ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
              <Show when={unavailable()}>
                <p>Connect to sign in on this device.</p>
              </Show>
            </Show>
            <Show when={notice()}>
              <p role="alert">{notice()}</p>
            </Show>
          </main>
        }
      >
        <aside classList={{ sidebar: true, 'mobile-hidden': showEditor() }}>
          <div class="sidebar-header">
            <div class="brand">
              <img src="/icon-192.png" alt="" /> Quick Notes
            </div>
            <button
              class="primary"
              onClick={() => void create()}
              disabled={!writable() || creating() || signingOut()}
            >
              + New
            </button>
          </div>
          <Show when={mustSignIn() && !showEditor()}>{reauthForm()}</Show>
          <nav aria-label="Note views">
            <For
              each={
                [
                  ['active', 'Notes'],
                  ['archived', 'Archive'],
                  ['trash', 'Trash'],
                  ['offline', 'On device'],
                ] as const
              }
            >
              {([key, name]) => (
                <button
                  aria-pressed={view() === key}
                  onClick={() => {
                    setView(key)
                    setNotes([])
                    void safeList()
                  }}
                >
                  {name}
                </button>
              )}
            </For>
          </nav>
          <Show when={authorized() && !unavailable() && view() !== 'offline'}>
            <div class="search">
              <input
                type="search"
                placeholder="Search notes"
                aria-label="Search notes"
                maxlength="150"
                value={query()}
                onInput={(event) => {
                  setQuery(event.currentTarget.value)
                  ++listEpoch
                  clearTimeout(listTimer)
                  listTimer = setTimeout(() => void safeList(), 220)
                }}
              />
              <select
                aria-label="Sort notes"
                value={sort()}
                onChange={(event) => {
                  setSort(event.currentTarget.value)
                  void safeList()
                }}
              >
                <option value="updated">Recent</option>
                <option value="title">Title</option>
              </select>
            </div>
          </Show>
          <div class="notes">
            <Show when={!showEditor() && notice()}>
              <p class="muted" role="alert">
                {notice()}
              </p>
            </Show>
            <Show when={opening() && !showEditor()}>
              <p class="muted" role="status">
                Opening note…
              </p>
            </Show>
            <Show when={unavailable()}>
              <p class="muted">Offline · showing notes on this device</p>
            </Show>
            <For
              each={visibleNotes()}
              fallback={<p class="muted">{ready() ? 'No notes here.' : 'Opening…'}</p>}
            >
              {(note) => (
                <button
                  class="note-row"
                  aria-current={open()?.id === note.id ? 'true' : undefined}
                  onClick={() => void select(note.id)}
                >
                  <span>{label(note.title)}</span>
                  <small>
                    {draftFor(note.id)?.conflict
                      ? 'Conflict'
                      : draftFor(note.id)
                        ? 'Pending'
                        : note.pinned
                          ? 'Pinned'
                          : ''}
                  </small>
                </button>
              )}
            </For>
            <Show when={next()}>
              <button onClick={() => void safeList(true)}>Load more</button>
            </Show>
          </div>
          <div class="account-actions">
            <Show when={authorized()}>
              <a href="/api/export">Export notes</a>
            </Show>
            <Show when={drafts().length || status() === 'Save failed'}>
              <button onClick={exportDrafts}>Download drafts</button>
            </Show>
            <button
              onClick={() => void signOut()}
              disabled={!writable() || signingOut() || unavailable()}
            >
              Sign out
            </button>
          </div>
        </aside>
        <main classList={{ workspace: true, 'mobile-hidden': !showEditor() }}>
          <Show when={mustSignIn() && showEditor()}>{reauthForm()}</Show>
          <Show when={!writable() && ready()}>
            <p class="message">Editing is available in one tab at a time.</p>
          </Show>
          <Show when={notice()}>
            <p class="message" role="alert">
              {notice()}
            </p>
          </Show>
          <Show when={update()}>
            <div class="message">
              <button
                onClick={async () => {
                  if (await flushEdits()) await updateWorker(true)
                }}
              >
                Restart to update
              </button>
            </div>
          </Show>
          <Show
            when={open()}
            keyed
            fallback={
              <div class="empty">
                <h1>Quick Notes</h1>
                <p>Open a note or start a new one.</p>
              </div>
            }
          >
            {(note) => (
              <article class="note">
                <div class="note-actions">
                  <button class="back" onClick={() => setShowEditor(false)}>
                    ‹ Notes
                  </button>
                  <span class="save" role="status">
                    {activeDraft()?.conflict
                      ? 'Conflict'
                      : activeDraft()?.error
                        ? 'Save rejected'
                        : status()}
                  </span>
                  <Show when={status() === 'Save failed'}>
                    <button
                      onClick={() => {
                        void flushEdits().then(() => upload())
                      }}
                    >
                      Retry save
                    </button>
                    <button onClick={exportDrafts}>Download draft</button>
                  </Show>
                  <Show
                    when={!fields().deleted}
                    fallback={
                      <button disabled={!writable()} onClick={() => record({ deleted: false })}>
                        Restore
                      </button>
                    }
                  >
                    <button
                      disabled={!canEdit()}
                      onClick={() => record({ pinned: !fields().pinned })}
                    >
                      {fields().pinned ? 'Unpin' : 'Pin'}
                    </button>
                    <button
                      disabled={!canEdit()}
                      onClick={() => record({ archived: !fields().archived })}
                    >
                      {fields().archived ? 'Unarchive' : 'Archive'}
                    </button>
                    <button disabled={!canEdit()} onClick={() => record({ deleted: true })}>
                      Trash
                    </button>
                  </Show>
                </div>
                <Show when={activeDraft()?.error}>
                  <p class="message" role="alert">
                    {activeDraft()?.error}
                  </p>
                </Show>
                <Show when={activeDraft()?.conflict}>
                  {(conflict) => (
                    <section class="conflict">
                      <h2>Another device changed this note</h2>
                      <p>Your draft is open below.</p>
                      <details>
                        <summary>Review server version</summary>
                        <pre>
                          {conflict().current
                            ? label(conflict().current!.title) +
                              '\n' +
                              describe(conflict().current!.document)
                            : 'No server version'}
                        </pre>
                      </details>
                      <button disabled={!writable()} onClick={() => void resolveConflict(true)}>
                        Save draft as a new note
                      </button>
                      <button disabled={!writable()} onClick={() => void resolveConflict(false)}>
                        Use my draft
                      </button>
                      <button onClick={exportDrafts}>Download draft</button>
                    </section>
                  )}
                </Show>
                <input
                  class="note-title"
                  aria-label="Note title"
                  placeholder="Untitled"
                  value={title()}
                  maxlength="200"
                  readOnly={!canEdit()}
                  onInput={(event) => {
                    setTitle(event.currentTarget.value)
                    record()
                  }}
                />
                <Suspense fallback={<p>Opening editor…</p>}>
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
            )}
          </Show>
        </main>
      </Show>
    </div>
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

render(() => <App />, document.getElementById('root')!)
