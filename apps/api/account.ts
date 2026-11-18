import { createAuth } from './auth'

const email = Bun.argv[2]
if (!email) throw new Error('Usage: bun run account:create EMAIL < password-file')
const password = (await Bun.stdin.text()).replace(/\r?\n$/, '')
const result = await createAuth(true).api.signUpEmail({ body: { email, name: email, password } })
console.log('Created account', result.user.email)
process.exit(0)
