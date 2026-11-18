import { beforeAll, expect, test } from 'bun:test'
import { emptyNote } from '../packages/contracts'

const configured = process.env.QUICK_NOTES_INTEGRATION === '1'
const integration = configured ? test : test.skip
const origin = process.env.APP_ORIGIN ?? 'http://localhost:3000'
const password = 'quick-notes-test-only-password'
let app: typeof import('../apps/api/app').app
let first: string
let second: string

async function request(path: string, cookie = '', body?: unknown, method = body ? 'POST' : 'GET') {
  return app.request(origin + '/api' + path, {
    method,
    headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}
beforeAll(async () => {
  if (!configured) return
  ;({ app } = await import('../apps/api/app'))
  const { createAuth } = await import('../apps/api/auth')
  async function account() {
    const email = crypto.randomUUID() + '@example.test'
    await createAuth(true).api.signUpEmail({ body: { email, name: email, password } })
    const response = await request('/auth/sign-in/email', '', { email, password })
    expect(response.status).toBe(200)
    return response.headers.getSetCookie()[0].split(';')[0]
  }
  first = await account()
  second = await account()
})

integration(
  'private sessions, owner scoping, immutable retry receipts and concurrent writes',
  async () => {
    const id = crypto.randomUUID()
    const path = '/notes/' + id
    const fields = { ...emptyNote(), title: 'Juniper evergreen' }
    const create = { mutationId: crypto.randomUUID(), expectedRevision: null, fields }
    expect((await request('/notes')).status).toBe(401)
    expect(
      (
        await request('/auth/sign-up/email', '', {
          email: 'uninvited@example.test',
          name: 'Uninvited',
          password,
        })
      ).status,
    ).toBeGreaterThanOrEqual(400)
    expect(
      (
        await app.request(origin + '/api' + path, {
          method: 'PUT',
          headers: { Origin: 'https://example.test' },
        })
      ).status,
    ).toBe(403)
    const initial = await request(path, first, create, 'PUT')
    expect(initial.status).toBe(200)
    const ack = await initial.json()
    expect(ack.revision).toBe(1)
    expect((await request(path, second)).status).toBe(404)
    const edit = (title: string) => ({
      mutationId: crypto.randomUUID(),
      expectedRevision: 1,
      fields: { ...fields, title },
    })
    const responses = await Promise.all([
      request(path, first, edit('Juniper left'), 'PUT'),
      request(path, first, edit('Juniper right'), 'PUT'),
    ])
    expect(responses.map((result) => result.status).sort()).toEqual([200, 409])
    expect((await responses.find((result) => result.status === 409)!.json()).current.revision).toBe(
      2,
    )
    expect(await (await request(path, first, create, 'PUT')).json()).toEqual(ack)
    expect(
      (await request(path, first, { ...create, fields: { ...fields, title: 'Different' } }, 'PUT'))
        .status,
    ).toBe(422)
    expect((await request(path, first)).headers.get('ETag')).toBe('"2"')
    expect(
      (
        await app.request(origin + '/api' + path, {
          headers: { Cookie: first, 'If-None-Match': '"2"' },
        })
      ).status,
    ).toBe(304)
    expect((await (await request('/notes?q=juniper', first)).json()).notes).toHaveLength(1)
    expect((await (await request('/notes?q=juniper', second)).json()).notes).toHaveLength(0)
    expect((await (await request('/export', first)).json()).notes).toHaveLength(1)
    expect((await request('/auth/sign-out', first, {})).status).toBe(200)
    expect((await request('/me', first)).status).toBe(401)
  },
)

integration('keyset pagination and archive, trash and restore', async () => {
  await Promise.all(
    Array.from({ length: 54 }, () =>
      request(
        '/notes/' + crypto.randomUUID(),
        second,
        {
          mutationId: crypto.randomUUID(),
          expectedRevision: null,
          fields: { ...emptyNote(), title: 'Same title' },
        },
        'PUT',
      ).then((response) => expect(response.status).toBe(200)),
    ),
  )
  for (const sort of ['updated', 'title']) {
    const page = await (await request('/notes?sort=' + sort, second)).json()
    expect(page.notes).toHaveLength(50)
    expect(page.next).toBeString()
    const tail = await (
      await request('/notes?sort=' + sort + '&cursor=' + page.next, second)
    ).json()
    expect(tail.notes).toHaveLength(4)
    expect(tail.next).toBeNull()
    expect(new Set([...page.notes, ...tail.notes].map((note) => note.id)).size).toBe(54)
  }
  const page = await (await request('/notes', second)).json()
  const id = page.notes[0].id
  const update = (expectedRevision: number, archived: boolean, deleted: boolean) =>
    request(
      '/notes/' + id,
      second,
      {
        mutationId: crypto.randomUUID(),
        expectedRevision,
        fields: { ...emptyNote(), archived, deleted },
      },
      'PUT',
    )
  expect((await update(1, true, false)).status).toBe(200)
  expect((await (await request('/notes?view=archived', second)).json()).notes).toHaveLength(1)
  expect((await update(2, true, true)).status).toBe(200)
  expect((await (await request('/notes?view=trash', second)).json()).notes).toHaveLength(1)
  expect((await update(3, true, false)).status).toBe(200)
  expect((await (await request('/notes?view=trash', second)).json()).notes).toHaveLength(0)
})

integration('database rollback discards changes after an operation fails', async () => {
  const { db } = await import('../apps/api/db')
  const { user } = await import('../apps/api/schema')
  const { eq } = await import('drizzle-orm')
  const id = crypto.randomUUID()
  await expect(
    db.transaction(async (tx) => {
      await tx.insert(user).values({ id, name: 'Rollback', email: id + '@example.test' })
      throw new Error('Abort transaction')
    }),
  ).rejects.toThrow('Abort transaction')
  expect(await db.select().from(user).where(eq(user.id, id))).toHaveLength(0)
})

integration(
  'private folders group notes and deleting a folder moves all its notes to Trash',
  async () => {
    const { createAuth } = await import('../apps/api/auth')
    const email = crypto.randomUUID() + '@example.test'
    await createAuth(true).api.signUpEmail({ body: { email, name: email, password } })
    const outsider = (await request('/auth/sign-in/email', '', { email, password })).headers
      .getSetCookie()[0]
      .split(';')[0]
    const created = await request('/folders', second, { name: '  Trips  ' })
    expect(created.status).toBe(201)
    const folder = await created.json()
    expect(folder.name).toBe('Trips')
    expect((await request('/folders', second, { name: 'TRIPS' })).status).toBe(409)
    expect(await (await request('/folders', outsider)).json()).toEqual([])
    expect((await request('/folders/' + folder.id, outsider, undefined, 'DELETE')).status).toBe(404)
    expect(
      (await request('/folders/' + folder.id, second, { name: 'Travel' }, 'PATCH')).status,
    ).toBe(200)
    const mutation = (
      fields: ReturnType<typeof emptyNote>,
      expectedRevision: number | null = null,
    ) => ({
      mutationId: crypto.randomUUID(),
      expectedRevision,
      fields,
    })
    const destination = '/notes/' + crypto.randomUUID()
    expect(
      (
        await request(
          destination,
          outsider,
          mutation({ ...emptyNote(), folderId: folder.id }),
          'PUT',
        )
      ).status,
    ).toBe(422)
    const archived = '/notes/' + crypto.randomUUID()
    expect(
      (
        await request(
          destination,
          second,
          mutation({ ...emptyNote(), title: 'Map', folderId: folder.id }),
          'PUT',
        )
      ).status,
    ).toBe(200)
    expect(
      (
        await request(
          archived,
          second,
          mutation({ ...emptyNote(), title: 'Tickets', folderId: folder.id, archived: true }),
          'PUT',
        )
      ).status,
    ).toBe(200)
    expect(
      (
        await request(
          destination,
          second,
          mutation({ ...emptyNote(), title: 'Updated map' }, 1),
          'PUT',
        )
      ).status,
    ).toBe(200)
    expect((await (await request('/notes?folder=' + folder.id, second)).json()).notes).toHaveLength(
      1,
    )
    const backup = await (await request('/export', second)).json()
    expect(backup.folders).toContainEqual({ id: folder.id, name: 'Travel' })
    expect(
      backup.notes.filter((note: { folderId?: string }) => note.folderId === folder.id),
    ).toHaveLength(2)
    expect((await request('/folders/' + folder.id, second, undefined, 'DELETE')).status).toBe(204)
    expect(await (await request('/folders', second)).json()).toEqual([])
    for (const path of [destination, archived]) {
      const note = await (await request(path, second)).json()
      expect(note.deleted).toBe(true)
      expect(note.folderId).toBeNull()
      expect(note.revision).toBeGreaterThan(1)
    }
  },
)

integration('waitlist signup creates no account until database approval', async () => {
  const { eq } = await import('drizzle-orm')
  const { db } = await import('../apps/api/db')
  const { signupWaitlist, user } = await import('../apps/api/schema')
  const email = crypto.randomUUID() + '@example.test'
  const password = 'm7#X9z!Q'
  const invalid = await request('/signup-waitlist', '', { email, password: password.slice(0, -1) })
  expect(invalid.status).toBe(422)
  const submission = await request('/signup-waitlist', '', { email: email.toUpperCase(), password })
  expect(submission.status).toBe(202)
  expect(submission.headers.get('Set-Cookie')).toBeNull()
  const { id } = await submission.json()
  const [pending] = await db.select().from(signupWaitlist).where(eq(signupWaitlist.id, id))
  expect(pending.email).toBe(email)
  expect(pending.passwordHash).toBeString()
  expect(pending.passwordHash).not.toBe(password)
  expect(pending.approvedAt).toBeNull()
  expect(await db.select().from(user).where(eq(user.email, email))).toHaveLength(0)
  expect((await request('/auth/sign-in/email', '', { email, password })).status).toBe(401)
  await db.update(signupWaitlist).set({ approvedAt: new Date() }).where(eq(signupWaitlist.id, id))
  const [approved] = await db.select().from(signupWaitlist).where(eq(signupWaitlist.id, id))
  expect(approved.approvedAt).toBeInstanceOf(Date)
  expect(approved.passwordHash).toBeNull()
  const response = await request('/auth/sign-in/email', '', { email, password })
  expect(response.status).toBe(200)
  const cookie = response.headers.getSetCookie()[0].split(';')[0]
  expect((await request('/notes', cookie)).status).toBe(200)
})
