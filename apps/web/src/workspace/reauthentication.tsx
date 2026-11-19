import { Button } from '@kobalte/core/button'
import type { Accessor } from 'solid-js'
import { TextInput } from '../components/text-input'
import { PasswordField } from '../components/account-access'

export function Reauthentication({
  signIn,
  signingIn,
}: {
  signIn: (event: SubmitEvent) => void
  signingIn: Accessor<boolean>
}) {
  return (
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
}
