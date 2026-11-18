import { and, eq } from 'drizzle-orm'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '../../packages/contracts'
import { auth } from './auth'
import { db } from './db'
import { account, session, user } from './schema'

const email = Bun.argv[2]
if (!email) throw new Error('Usage: bun run account:reset-password EMAIL < password-file')
const next = (await Bun.stdin.text()).replace(/\r?\n$/, '')
if (next.length < MIN_PASSWORD_LENGTH || next.length > MAX_PASSWORD_LENGTH)
  throw new Error(
    `Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters`,
  )
const { password } = await auth.$context
const hash = await password.hash(next)
await db.transaction(async (tx) => {
  const [owner] = await tx
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email.toLowerCase()))
  if (!owner) throw new Error('Account unavailable')
  const changed = await tx
    .update(account)
    .set({ password: hash, updatedAt: new Date() })
    .where(and(eq(account.userId, owner.id), eq(account.providerId, 'credential')))
    .returning({ id: account.id })
  if (changed.length !== 1) throw new Error('Credential account unavailable')
  await tx.delete(session).where(eq(session.userId, owner.id))
})
console.log('Password reset and sessions revoked')
process.exit(0)
