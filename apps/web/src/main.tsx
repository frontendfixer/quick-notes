import { animate } from 'motion/mini'
import {
  Archive,
  ArchiveRestore,
  ArrowDownWideNarrow,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronsUpDown,
  CircleAlert,
  Cloud,
  Download,
  Eye,
  EyeOff,
  FileDown,
  FileText,
  Folder as FolderIcon,
  FolderInput,
  FolderPlus,
  Pencil,
  LockKeyhole,
  LogOut,
  Pin,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  UserRound,
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
import { render } from 'solid-js/web'
import { registerSW } from 'virtual:pwa-register'
import {
  emptyNote,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  type Ack,
  type Note,
  type NoteFields,
  type Summary,
  type View,
  type Folder,
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
const accountViews = [
  ['archived', 'Archive', Archive],
  ['trash', 'Trash', Trash2],
] as const

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

function PasswordField(props: { placeholder?: string; signup?: boolean }) {
  const [visible, setVisible] = createSignal(false)
  return (
    <div class="password-field">
      <input
        name="password"
        aria-label="Password"
        type={visible() ? 'text' : 'password'}
        placeholder={props.placeholder}
        autocomplete={props.signup ? 'new-password' : 'current-password'}
        minlength={props.signup ? MIN_PASSWORD_LENGTH : undefined}
        maxlength={props.signup ? MAX_PASSWORD_LENGTH : undefined}
        required
      />
      <button
        type="button"
        class="icon-button"
        aria-label={visible() ? 'Hide password' : 'Show password'}
        title={visible() ? 'Hide password' : 'Show password'}
        onClick={() => setVisible((value) => !value)}
      >
        <Show when={visible()} fallback={<Eye size={17} />}>
          <EyeOff size={17} />
        </Show>
      </button>
    </div>
  )
}

function WaitlistForm(props: { signIn: () => void }) {
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const [requestId, setRequestId] = createSignal('')
  const [copied, setCopied] = createSignal(false)

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    if (busy()) return
    const data = new FormData(event.currentTarget as HTMLFormElement)
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/signup-waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: data.get('email'), password: data.get('password') }),
      })
      const result: { id?: string; error?: string } = await response.json()
      if (!response.ok || !result.id)
        throw new Error(result.error ?? 'Could not submit the request.')
      setRequestId(result.id)
    } catch (error) {
      setError(
        error instanceof Error && error.name === 'Error'
          ? error.message
          : 'Could not submit the request. Try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Show
        when={requestId()}
        fallback={
          <>
            <h1>Sign up</h1>
            <p class="login-description">An approval is required before you can sign in.</p>
            <form onSubmit={submit}>
              <label>
                Email
                <input name="email" type="email" autocomplete="email" maxlength="254" required />
              </label>
              <span class="password-label">Password</span>
              <PasswordField signup placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`} />
              <button class="primary login-submit" disabled={busy()}>
                {busy() ? 'Submitting…' : 'Join waitlist'}
                <ArrowRight size={17} />
              </button>
            </form>
            <Show when={error()}>
              <p class="inline-error" role="alert">
                {error()}
              </p>
            </Show>
          </>
        }
      >
        <h1>Request received</h1>
        <p class="login-description">
          Share your request ID with the owner. After approval, sign in with the email and password
          you entered.
        </p>
        <div class="waitlist-id">
          <code>{requestId()}</code>
          <button
            type="button"
            class="secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(requestId())
                setCopied(true)
              } catch {
                setError('Select and copy the request ID above.')
              }
            }}
          >
            {copied() ? 'Copied' : 'Copy'}
          </button>
        </div>
        <Show when={error()}>
          <p class="inline-error" role="alert">
            {error()}
          </p>
        </Show>
      </Show>
      <button class="login-switch" onClick={props.signIn}>
        Back to sign in
      </button>
    </>
  )
}

function App() {
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
  const [folder, setFolder] = createSignal<string>()
  const [folderForm, setFolderForm] = createSignal<'create' | 'rename'>()
  const [folderBusy, setFolderBusy] = createSignal(false)
  const [folderError, setFolderError] = createSignal('')
  const chosenFolder = () => folders().find(({ id }) => id === folder())
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
  let folderEpoch = 0
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

  const inView = (note: Pick<NoteFields, 'folderId' | 'deleted' | 'archived'>) =>
    belongsTo(note, view()) && (!folder() || note.folderId === folder())

  function changeView(tab: View, id?: string) {
    if (tab === view() && id === folder()) return
    clearTimeout(listTimer)
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
    void safeList()
  }

  async function loadFolders(id: string, cached = false) {
    const request = ++folderEpoch
    const items: Folder[] = cached
      ? await local.folders(id)
      : await fetch('/api/folders').then(async (response) => {
          if (!response.ok) throw new Error('Could not load folders')
          return response.json()
        })
    if (owner() !== id || request !== folderEpoch) return
    setFolders(items)
    if (folder() && !items.some((item) => item.id === folder())) changeView('active')
    if (!cached) await local.cacheFolders(id, items).catch(() => undefined)
  }

  async function saveFolder(event?: SubmitEvent) {
    event?.preventDefault()
    const account = owner()
    if (!account || !canManageFolders()) return
    const existing = event && folderForm() === 'create' ? undefined : chosenFolder()
    if (
      !event &&
      (!existing || !window.confirm('Delete this folder and move all its notes to Trash?'))
    )
      return
    const input = event ? new FormData(event.currentTarget as HTMLFormElement).get('name') : null
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
        body: event ? JSON.stringify({ name: input }) : undefined,
      })
      if (response.status === 401) expire()
      if (!response.ok) {
        const problem = await response.json().catch(() => null)
        throw new Error(problem?.error ?? 'Could not update the folder.')
      }
      if (owner() !== account) return
      const saved: Folder | undefined = event ? await response.json() : undefined
      const items = folders().filter((item) => item.id !== existing?.id && item.id !== saved?.id)
      if (saved) items.push(saved)
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
        changeView('active')
      }
      setFolderForm(undefined)
    } catch (error) {
      setFolderError(error instanceof Error ? error.message : 'Could not update the folder.')
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
        setNotes(offline.filter(inView))
        setNext(null)
      }
      return
    }
    if (!authorized()) return
    const params = new URLSearchParams({ view: tab, sort: sort(), q: query() })
    if (folder()) params.set('folder', folder()!)
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
    if (open()?.id === id) {
      ++selection
      setOpening(false)
      setShowEditor(true)
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
          const latest = cached ?? note
          if (open()?.id !== id || latest.revision > (open()?.base ?? 0)) {
            loadEditor(id, account, latest.revision, latest)
          }
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
    if (Object.keys(overrides).length) setFields(currentFields)
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
          const saved = await local.change(item.owner, item.id, (previous) => ({
            ...previous,
            owner: item.owner,
            id: item.id,
            changedAt: item.changedAt,
            generation: item.generation,
            fields: item.fields(),
            base: previous ? previous.base : current?.id === item.id ? current.base : item.base,
            error: undefined,
          }))
          if (saved && owner() === item.owner) {
            ++draftEpoch
            setDrafts((current) => {
              const index = current.findIndex(({ id }) => id === saved.id)
              return index === -1
                ? [saved, ...current]
                : current.map((item, i) => (i === index ? saved : item))
            })
          }
          if (pending.get(item.id) === item) pending.delete(item.id)
          if (open()?.id === item.id && !pending.has(item.id)) setStatus('Saved on device')
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
          continue
        }
        if ([400, 413, 422].includes(response.status)) {
          const problem: { error?: string } | null = await response.json().catch(() => null)
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
                      ? (problem?.error ??
                        'Server rejected this draft. Edit it or download a copy.')
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
          setFolders([])
          setFolder(undefined)
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
        if (authorized()) void loadFolders(owner()!).catch(() => undefined)
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
            : response.status === 403
              ? 'This address is not allowed to sign in. Open Quick Notes from its original address.'
              : response.status === 401
                ? 'Sign-in failed. Check your email and password.'
                : 'Sign-in is unavailable right now. Try again shortly.',
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
    setFolder(undefined)
    setFolders([])
    setFolderForm(undefined)
    setFolderError('')
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
        await loadFolders(owner()!, true).catch(() => undefined)
        void safeList()
      }
      await refresh()
    })()
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh()
      else if (pending.size) void flushEdits()
    }
    const focusSearch = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === 'k' &&
        searchInput?.isConnected
      ) {
        event.preventDefault()
        setShowEditor(false)
        searchInput.focus()
      }
    }
    window.addEventListener('keydown', focusSearch)
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
      window.removeEventListener('keydown', focusSearch)
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
      const { document: _document, ...metadata } = draft.fields
      const previous = ordered.get(draft.id)
      const summary = {
        ...metadata,
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
      <input
        name="email"
        type="email"
        aria-label="Email"
        placeholder="Email"
        autocomplete="username"
        required
      />
      <PasswordField placeholder="Password" />
      <button class="primary" disabled={signingIn()}>
        Sign in
      </button>
    </form>
  )

  const updateNotice = (mobile = false) => (
    <Show when={update()}>
      <div classList={{ message: true, 'update-message': true, 'mobile-update': mobile }}>
        <RefreshCw size={16} />
        <span>An update is ready.</span>
        <button
          onClick={async () => {
            if (await flushEdits()) await updateWorker(true)
          }}
        >
          Restart to update
        </button>
      </div>
    </Show>
  )

  const saveText = () =>
    activeDraft()?.conflict ? 'Conflict' : activeDraft()?.error ? 'Save rejected' : status()
  const saveLabel = () => {
    const state = saveText()
    if (state === 'Editing' || state === 'Saved on device') {
      return unavailable() || mustSignIn() ? 'Offline' : 'Saving…'
    }
    return state === 'Saved to server' ? 'Up to date' : state
  }
  const saveProblem = () => ['Conflict', 'Save rejected', 'Save failed'].includes(saveText())
  const newNote = () => void create({ ...emptyNote(), folderId: folder() ?? null })
  const canCreate = () => writable() && !creating() && !signingOut() && !folderBusy()
  const home = () => view() === 'active' && !folder()
  const collection = () => folder() ?? view()
  const activeView = () =>
    chosenFolder()?.name ??
    (view() === 'archived' ? 'Archive' : view() === 'trash' ? 'Trash' : 'Notes')
  let collectionPanel: HTMLDivElement | undefined
  createEffect(
    on(
      collection,
      (current, previous) => {
        const panel = collectionPanel
        if (!panel) return
        panel.scrollTop = 0
        const isHome = current === 'active'
        const target =
          isHome && previous
            ? panel.querySelector<HTMLElement>('[data-folder-id="' + CSS.escape(previous) + '"]')
            : panel.querySelector<HTMLElement>('[data-collection-back]')
        target?.focus({ preventScroll: true })
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
  const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
  const emptyHeadings: Record<View, string> = {
    active: 'No notes yet',
    archived: 'Archive is empty',
    trash: 'Trash is empty',
  }

  return (
    <div class="app">
      <Show
        when={owner()}
        fallback={
          <main class="login">
            <section class="login-card" aria-label="Quick Notes account access">
              <div class="brand">
                <span class="brand-mark">
                  <span class="note-logo" aria-hidden="true" />
                </span>
                Quick Notes
              </div>
              <Show
                when={ready()}
                fallback={
                  <p class="muted" role="status">
                    Opening Quick Notes…
                  </p>
                }
              >
                <Show
                  when={!joiningWaitlist()}
                  fallback={<WaitlistForm signIn={() => setJoiningWaitlist(false)} />}
                >
                  <h1>Sign in</h1>
                  <p class="login-description">Open your private notes on this device.</p>
                  <form onSubmit={signIn}>
                    <label>
                      Email
                      <input name="email" type="email" autocomplete="username" required />
                    </label>
                    <span class="password-label">Password</span>
                    <PasswordField />
                    <button class="primary login-submit" disabled={signingIn() || unavailable()}>
                      {signingIn() ? 'Signing in…' : 'Sign in'}
                      <ArrowRight size={17} />
                    </button>
                  </form>
                  <Show when={unavailable()}>
                    <p class="muted">Connect to sign in on this device.</p>
                  </Show>
                  <button
                    class="login-switch"
                    disabled={signingIn() || unavailable()}
                    onClick={() => {
                      setNotice('')
                      setJoiningWaitlist(true)
                    }}
                  >
                    Sign up
                  </button>
                </Show>
              </Show>
              {updateNotice()}
              <Show when={notice()}>
                <p class="inline-error" role="alert">
                  {notice()}
                </p>
              </Show>
            </section>
          </main>
        }
      >
        <aside classList={{ sidebar: true, 'mobile-hidden': showEditor() }}>
          <header class="sidebar-header">
            <div class="brand">
              <span class="brand-mark">
                <span class="note-logo" aria-hidden="true" />
              </span>
              Quick Notes
            </div>
            <button
              class="primary new-note"
              aria-label="New note"
              onClick={newNote}
              disabled={!canCreate()}
            >
              <Plus size={17} />
              <span>New</span>
            </button>
          </header>
          <Show when={mustSignIn() && !showEditor()}>{reauthForm()}</Show>
          <Show when={authorized() && !unavailable()}>
            <div class="search">
              <Search size={17} />
              <input
                type="search"
                placeholder="Search notes"
                aria-label="Search notes"
                maxlength="150"
                ref={(node) => {
                  searchInput = node
                }}
                value={query()}
                onInput={(event) => {
                  setQuery(event.currentTarget.value)
                  ++listEpoch
                  clearTimeout(listTimer)
                  listTimer = setTimeout(() => void safeList(), 220)
                }}
              />
              <kbd aria-hidden="true">{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'} K</kbd>
            </div>
          </Show>
          {updateNotice(true)}
          <div
            class="collection-panel"
            ref={(node) => {
              collectionPanel = node
            }}
          >
            <Show when={!home()}>
              <header class="collection-heading">
                <button
                  class="icon-button collection-back"
                  aria-label="Back to home"
                  title="Back to home"
                  data-collection-back
                  onClick={() => changeView('active')}
                >
                  <ArrowLeft size={19} />
                </button>
                <h2>{activeView()}</h2>
                <Show when={chosenFolder() && canManageFolders()}>
                  <button
                    class="icon-button"
                    title="Rename folder"
                    aria-label="Rename folder"
                    onClick={() => {
                      setFolderError('')
                      setFolderForm(folderForm() === 'rename' ? undefined : 'rename')
                    }}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    class="icon-button"
                    title="Delete folder"
                    aria-label="Delete folder"
                    onClick={() => void saveFolder()}
                  >
                    <Trash2 size={16} />
                  </button>
                </Show>
              </header>
            </Show>
            <Show when={home()}>
              <div class="folder-heading">
                <h2>Folders</h2>
                <Show when={canManageFolders()}>
                  <button
                    class="icon-button"
                    title="New folder"
                    aria-label="New folder"
                    onClick={() => {
                      setFolderError('')
                      setFolderForm(folderForm() === 'create' ? undefined : 'create')
                    }}
                  >
                    <FolderPlus size={17} />
                  </button>
                </Show>
              </div>
            </Show>
            <Show when={folderForm()} keyed>
              {(mode) => (
                <form class="folder-form" onSubmit={saveFolder}>
                  <input
                    name="name"
                    aria-label="Folder name"
                    placeholder="Folder name"
                    maxlength="60"
                    required
                    value={mode === 'rename' ? (chosenFolder()?.name ?? '') : ''}
                    ref={(input) => queueMicrotask(() => input.isConnected && input.focus())}
                  />
                  <button class="secondary" disabled={!canManageFolders()}>
                    {mode === 'create' ? 'Create' : 'Save'}
                  </button>
                </form>
              )}
            </Show>
            <Show when={folderError()}>
              <p class="inline-error" role="alert">
                {folderError()}
              </p>
            </Show>

            <Show when={home() && folders().length > 0}>
              <section class="folder-grid" aria-label="Folders">
                <For each={folders()}>
                  {(item) => (
                    <button
                      class="folder-tile"
                      aria-label={item.name}
                      data-folder-id={item.id}
                      onClick={() => changeView('active', item.id)}
                    >
                      <span class="folder-tile-icon">
                        <FolderIcon size={19} />
                      </span>
                      <span class="folder-tile-name">{item.name}</span>
                    </button>
                  )}
                </For>
              </section>
            </Show>

            <div class="list-heading">
              <h2>Notes</h2>
              <Show when={authorized() && !unavailable()}>
                <label class="sort-control">
                  <ArrowDownWideNarrow size={15} />
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
                </label>
              </Show>
            </div>
            <div class="notes">
              <Show when={!showEditor() && notice()}>
                <p class="inline-error" role="alert">
                  {notice()}
                </p>
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
              <For
                each={visibleIds()}
                fallback={
                  <div class="list-empty">
                    <FileText size={21} />
                    <p>
                      {ready()
                        ? query().trim() && !unavailable()
                          ? 'No matching notes'
                          : folder()
                            ? 'No notes in this folder'
                            : emptyHeadings[view()]
                        : 'Loading notes…'}
                    </p>
                  </div>
                }
              >
                {(id) => {
                  const note = () => visibleById().get(id)
                  const draft = createMemo(() => draftById().get(id))
                  const rowDate = createMemo(() => {
                    const value = note()?.updatedAt
                    return value ? dateFormat.format(new Date(value)) : ''
                  })
                  return (
                    <button
                      class="note-row"
                      aria-current={open()?.id === id ? 'true' : undefined}
                      aria-label={label(open()?.id === id ? title() : (note()?.title ?? ''))}
                      onClick={() => void select(id)}
                    >
                      <span class="row-icon">
                        <FileText size={16} />
                      </span>
                      <span class="row-copy">
                        <strong>
                          {label(open()?.id === id ? title() : (note()?.title ?? ''))}
                        </strong>
                        <small>{rowDate()}</small>
                      </span>
                      <span class="row-state">
                        <Show when={draft()?.conflict}>
                          <CircleAlert size={14} aria-label="Conflict" />
                        </Show>
                        <Show when={note()?.pinned}>
                          <Pin size={14} aria-label="Pinned" />
                        </Show>
                      </span>
                    </button>
                  )
                }}
              </For>
              <Show when={next()}>
                <button class="load-more" onClick={() => void safeList(true)}>
                  Load more
                  <ChevronDown size={15} />
                </button>
              </Show>
            </div>
          </div>
          <footer class="account-actions">
            <details class="account-menu">
              <summary aria-label="Account options">
                <span class="account-avatar">
                  <UserRound size={16} />
                </span>
                <span>Account</span>
                <ChevronsUpDown size={14} class="menu-chevron" />
              </summary>
              <div class="account-popover">
                <For each={accountViews}>
                  {([tab, title, Icon]) => (
                    <button
                      aria-current={view() === tab ? 'page' : undefined}
                      onClick={(event) => {
                        const menu = event.currentTarget.closest('details')
                        menu?.removeAttribute('open')
                        if (view() === tab) menu?.querySelector('summary')?.focus()
                        else changeView(tab)
                      }}
                    >
                      <Icon size={16} />
                      {title}
                    </button>
                  )}
                </For>
                <div class="account-divider" />

                <Show when={authorized()}>
                  <a href="/api/export">
                    <Download size={16} />
                    Export notes
                  </a>
                </Show>
                <Show when={drafts().length || status() === 'Save failed'}>
                  <button onClick={exportDrafts}>
                    <FileDown size={16} />
                    Download drafts
                  </button>
                </Show>
                <button
                  onClick={() => void signOut()}
                  disabled={!writable() || signingOut() || unavailable()}
                >
                  <LogOut size={16} />
                  Sign out
                </button>
              </div>
            </details>
          </footer>
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
            <p class="message inline-error" role="alert">
              <CircleAlert size={16} />
              {notice()}
            </p>
          </Show>
          {updateNotice()}
          <Show
            when={open()}
            keyed
            fallback={
              <section class="empty">
                <div class="empty-icon">
                  <span class="note-logo note-logo-large" aria-hidden="true" />
                </div>
                <h1>Select a note</h1>
                <p>Choose one from the sidebar or start a new note.</p>
                <button class="secondary" onClick={newNote} disabled={!canCreate()}>
                  <Plus size={16} />
                  Create a note
                </button>
              </section>
            }
          >
            {(note) => (
              <>
                <header class="note-topbar">
                  <div class="note-location">
                    <button
                      class="icon-button back"
                      aria-label="Back to notes"
                      title="Back to notes"
                      onClick={() => setShowEditor(false)}
                    >
                      <ArrowLeft size={20} />
                    </button>
                    <FileText size={16} class="desktop-note-icon" />
                    <span>
                      {fields().deleted
                        ? 'Trash'
                        : fields().archived
                          ? 'Archive'
                          : (folders().find((item) => item.id === fields().folderId)?.name ??
                            'Notes')}
                    </span>
                  </div>
                  <div class="note-actions">
                    <Show when={folders().length || fields().folderId}>
                      <label class="folder-move">
                        <FolderInput size={17} />
                        <select
                          aria-label="Move note to folder"
                          value={fields().folderId ?? ''}
                          onChange={(event) =>
                            record({ folderId: event.currentTarget.value || null })
                          }
                          disabled={!writable() || signingOut() || creating() || folderBusy()}
                        >
                          <option value="">No folder</option>
                          <Show
                            when={
                              fields().folderId &&
                              !folders().some((item) => item.id === fields().folderId)
                            }
                          >
                            <option value={fields().folderId ?? ''} disabled>
                              Unavailable folder
                            </option>
                          </Show>
                          <For each={folders()}>
                            {(item) => <option value={item.id}>{item.name}</option>}
                          </For>
                        </select>
                      </label>
                    </Show>
                    <span
                      classList={{ 'save-chip': true, 'save-problem': saveProblem() }}
                      role="status"
                      data-save-state={saveText()}
                    >
                      <Show when={saveProblem()} fallback={<Cloud size={15} />}>
                        <CircleAlert size={15} />
                      </Show>
                      <span>{saveLabel()}</span>
                    </span>
                    <Show when={status() === 'Save failed'}>
                      <button
                        class="icon-button"
                        title="Retry save"
                        aria-label="Retry save"
                        onClick={() => void flushEdits().then(() => upload())}
                      >
                        <RefreshCw size={17} />
                      </button>
                      <button
                        class="icon-button"
                        title="Download draft"
                        aria-label="Download draft"
                        onClick={exportDrafts}
                      >
                        <Download size={17} />
                      </button>
                    </Show>
                    <Show
                      when={!fields().deleted}
                      fallback={
                        <button
                          class="secondary"
                          disabled={!writable()}
                          onClick={() => record({ deleted: false })}
                        >
                          <RotateCcw size={16} />
                          Restore
                        </button>
                      }
                    >
                      <button
                        class="icon-button"
                        aria-pressed={fields().pinned}
                        disabled={!canEdit()}
                        title={fields().pinned ? 'Unpin note' : 'Pin note'}
                        aria-label={fields().pinned ? 'Unpin note' : 'Pin note'}
                        onClick={() => record({ pinned: !fields().pinned })}
                      >
                        <Pin size={18} />
                      </button>
                      <button
                        class="icon-button"
                        disabled={!canEdit()}
                        title={fields().archived ? 'Unarchive note' : 'Archive note'}
                        aria-label={fields().archived ? 'Unarchive note' : 'Archive note'}
                        onClick={() => record({ archived: !fields().archived })}
                      >
                        <Show when={fields().archived} fallback={<Archive size={18} />}>
                          <ArchiveRestore size={18} />
                        </Show>
                      </button>
                      <button
                        class="icon-button danger-action"
                        title="Move to trash"
                        aria-label="Move to trash"
                        disabled={!canEdit()}
                        onClick={() => record({ deleted: true })}
                      >
                        <Trash2 size={18} />
                      </button>
                    </Show>
                  </div>
                </header>
                <article class="note">
                  <Show when={activeDraft()?.error}>
                    <p class="message inline-error" role="alert">
                      <CircleAlert size={16} />
                      {activeDraft()?.error}
                    </p>
                  </Show>
                  <Show when={activeDraft()?.conflict}>
                    {(conflict) => (
                      <section class="conflict">
                        <h2>
                          <CircleAlert size={19} />
                          This note changed on another device
                        </h2>
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
                        <div class="conflict-actions">
                          <button
                            class="secondary"
                            disabled={!writable()}
                            onClick={() => void resolveConflict(true)}
                          >
                            Save draft as a new note
                          </button>
                          <button
                            class="secondary"
                            disabled={!writable()}
                            onClick={() => void resolveConflict(false)}
                          >
                            Use my draft
                          </button>
                          <button class="secondary" onClick={exportDrafts}>
                            <Download size={16} />
                            Download draft
                          </button>
                        </div>
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
              </>
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
