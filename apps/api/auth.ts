import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '../../packages/contracts'
import { db } from './db'
import * as schema from './schema'

export const origin = new URL(
  process.env.APP_ORIGIN ??
    (process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : 'http://localhost:3000'),
).origin
const configuredOrigin = new URL(origin)
const loopbackHosts = ['localhost', '127.0.0.1']
export const trustedOrigins =
  configuredOrigin.protocol === 'http:' && loopbackHosts.includes(configuredOrigin.hostname)
    ? loopbackHosts.map((hostname) => {
        const address = new URL(origin)
        address.hostname = hostname
        return address.origin
      })
    : [origin]

const secret = process.env.BETTER_AUTH_SECRET
if (!secret || secret.length < 32)
  throw new Error('Set BETTER_AUTH_SECRET to at least 32 random characters')

export function createAuth(provision = false) {
  return betterAuth({
    baseURL: origin,
    secret,
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: !provision,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
    },
    trustedOrigins,
    advanced: {
      useSecureCookies: origin.startsWith('https:'),
      ipAddress: {
        ipAddressHeaders: process.env.TRUSTED_CLIENT_IP_HEADER
          ? [process.env.TRUSTED_CLIENT_IP_HEADER]
          : [],
      },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 30,
      customRules: { '/sign-in/email': { window: 60, max: 5 } },
    },
  })
}
export const auth = createAuth()
