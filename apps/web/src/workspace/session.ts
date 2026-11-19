import { createSignal, onCleanup } from 'solid-js'
import { local } from '../storage'
import { notify } from '../components/activity-toasts'

type SessionOptions = {
  setNotice: (message: string) => void
  flushEdits: () => Promise<boolean>
  storageError: () => void
  onAccountChanged: () => void
  onSessionClosed: () => void
  restoreWorkspace: () => Promise<void>
  refreshWorkspace: (manual: boolean) => Promise<void>
}

export function createSession({
  setNotice,
  flushEdits,
  storageError,
  onAccountChanged,
  onSessionClosed,
  restoreWorkspace,
  refreshWorkspace,
}: SessionOptions) {
  const [owner, setOwner] = createSignal<string>()
  const [ready, setReady] = createSignal(false)
  const [authorized, setAuthorized] = createSignal(false)
  const [mustSignIn, setMustSignIn] = createSignal(false)
  const [writable, setWritable] = createSignal(false)
  const [unavailable, setUnavailable] = createSignal(false)
  const [signingIn, setSigningIn] = createSignal(false)
  const [signingOut, setSigningOut] = createSignal(false)
  let releaseWriter: (() => void) | undefined
  let lockOwner: string | undefined
  let requestedLock = 0
  const sessionChanges = new BroadcastChannel('quick-notes-session')
  const [refreshing, setRefreshing] = createSignal(false)
  const [manualRefresh, setManualRefresh] = createSignal(false)
  let refreshAgain = false
  let refreshAgainManually = false

  onCleanup(() => {
    sessionChanges.close()
    releaseWriter?.()
  })

  // The writer lock makes the local draft queue exclusive to one tab for this account.
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

  function expire() {
    setAuthorized(false)
    setMustSignIn(true)
  }

  async function restoreSession() {
    try {
      setOwner(await local.owner())
    } catch {
      storageError()
    }
    if (owner()) {
      setUnavailable(true)
      acquireWriter(owner()!)
      await restoreWorkspace()
    }
    await refresh()
  }

  function listenForSignOut() {
    sessionChanges.onmessage = (event) => {
      if (owner() && event.data?.closed === owner()) closeSession()
    }
  }

  async function refresh(manual = false) {
    if (refreshing() || signingIn() || signingOut()) {
      refreshAgain = true
      refreshAgainManually ||= manual
      return
    }
    setRefreshing(true)
    setManualRefresh(manual)
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
          onAccountChanged()
        }
        setOwner(account.id)
        await local.setOwner(account.id).catch(storageError)
        setAuthorized(true)
        setMustSignIn(false)
      } else if (response?.status === 401 && owner()) expire()
      else setAuthorized(false)
      const account = owner()
      if (account) {
        acquireWriter(account)
        await refreshWorkspace(manual)
      }
    } catch {
      if (manual) setNotice('Refresh paused. Reconnect or try again.')
    } finally {
      setRefreshing(false)
      setManualRefresh(false)
      setReady(true)
      if (refreshAgain && !signingIn() && !signingOut()) {
        const nextManual = refreshAgainManually
        refreshAgain = false
        refreshAgainManually = false
        void refresh(nextManual)
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
    ++requestedLock
    releaseWriter?.()
    lockOwner = undefined
    setWritable(false)
    setOwner(undefined)
    setAuthorized(false)
    setMustSignIn(false)
    onSessionClosed()
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

  return {
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
  }
}
