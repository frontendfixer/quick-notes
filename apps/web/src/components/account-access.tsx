import { notify } from './activity-toasts'
import { TextInput } from './text-input'
import { Alert } from '@kobalte/core/alert'
import { Button } from '@kobalte/core/button'
import { ArrowRight, Eye, EyeOff } from 'lucide-solid'
import { createSignal, Show } from 'solid-js'
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from '../../../../packages/contracts'

export function PasswordField(props: { placeholder?: string; signup?: boolean }) {
  const [visible, setVisible] = createSignal(false)
  return (
    <div class="password-field">
      <TextInput
        name="password"
        aria-label="Password"
        type={visible() ? 'text' : 'password'}
        placeholder={props.placeholder}
        autocomplete={props.signup ? 'new-password' : 'current-password'}
        minlength={props.signup ? MIN_PASSWORD_LENGTH : undefined}
        maxlength={props.signup ? MAX_PASSWORD_LENGTH : undefined}
        required
      />
      <Button
        type="button"
        class="icon-button"
        aria-label={visible() ? 'Hide password' : 'Show password'}
        title={visible() ? 'Hide password' : 'Show password'}
        onClick={() => setVisible((value) => !value)}
      >
        <Show when={visible()} fallback={<Eye size={17} />}>
          <EyeOff size={17} />
        </Show>
      </Button>
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
      notify('Access request submitted')
    } catch (error) {
      const message =
        error instanceof Error && error.name === 'Error'
          ? error.message
          : 'Could not submit the request. Try again.'
      setError(message)
      notify(message, { error: true })
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
                <TextInput
                  name="email"
                  type="email"
                  autocomplete="email"
                  maxlength="254"
                  required
                />
              </label>
              <span class="password-label">Password</span>
              <PasswordField signup />
              <p class="muted password-hint">Use at least {MIN_PASSWORD_LENGTH} characters.</p>
              <Button type="submit" class="primary login-submit" disabled={busy()}>
                {busy() ? 'Submitting…' : 'Join waitlist'}
                <ArrowRight size={17} />
              </Button>
            </form>
            <Show when={error()}>
              <Alert as="p" class="inline-error">
                {error()}
              </Alert>
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
          <span class="muted">Request ID</span>
          <code>{requestId()}</code>
          <Button
            type="button"
            class="secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(requestId())
                setCopied(true)
                notify('Request ID copied')
              } catch {
                setError('Select and copy the request ID above.')
              }
            }}
          >
            {copied() ? 'Copied' : 'Copy ID'}
          </Button>
        </div>
        <Show when={error()}>
          <Alert as="p" class="inline-error">
            {error()}
          </Alert>
        </Show>
      </Show>
      <Button class="login-switch" onClick={props.signIn}>
        Back to sign in
      </Button>
    </>
  )
}

export function AccountAccess(props: {
  ready: boolean
  joiningWaitlist: boolean
  notice: string
  signingIn: boolean
  unavailable: boolean
  onSignIn: (event: SubmitEvent) => void
  onBackToSignIn: () => void
  onSignUp: () => void
}) {
  return (
    <main class="login">
      <section class="login-card" aria-label="Quick Notes account access">
        <div class="brand">
          <span class="brand-mark">
            <span class="note-logo" aria-hidden="true" />
          </span>
          <span class="brand-copy">
            <strong>Quick Notes</strong>
            <span>Capture, organize and find your notes</span>
          </span>
        </div>
        <Show
          when={props.ready}
          fallback={
            <p class="muted" role="status">
              Opening Quick Notes…
            </p>
          }
        >
          <Show
            when={!props.joiningWaitlist}
            fallback={<WaitlistForm signIn={props.onBackToSignIn} />}
          >
            <h1>Sign in</h1>
            <p class="login-description">Open your private notes on this device.</p>
            <form onSubmit={props.onSignIn}>
              <label>
                Email
                <TextInput name="email" type="email" autocomplete="username" required />
              </label>
              <span class="password-label">Password</span>
              <PasswordField />
              <Show when={props.notice}>
                <Alert as="p" class="inline-error">
                  {props.notice}
                </Alert>
              </Show>
              <Button
                type="submit"
                class="primary login-submit"
                disabled={props.signingIn || props.unavailable}
              >
                {props.signingIn ? 'Signing in…' : 'Sign in'}
                <ArrowRight size={17} />
              </Button>
            </form>
            <Show when={props.unavailable}>
              <p class="muted">Connect to sign in on this device.</p>
            </Show>
            <Button
              class="login-switch"
              disabled={props.signingIn || props.unavailable}
              onClick={props.onSignUp}
            >
              Sign up
            </Button>
          </Show>
        </Show>
      </section>
    </main>
  )
}
