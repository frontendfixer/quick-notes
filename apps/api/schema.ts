import { sql } from 'drizzle-orm'
import {
  boolean,
  foreignKey,
  integer,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import type { Ack, NoteFields } from '../../packages/contracts'

const date = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: date('created_at').notNull().defaultNow(),
  updatedAt: date('updated_at').notNull().defaultNow(),
})
export const signupWaitlist = pgTable('signup_waitlist', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull(),
  passwordHash: text('password_hash'),
  requestedAt: date('requested_at').notNull().defaultNow(),
  approvedAt: date('approved_at'),
})
export const session = pgTable('session', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  expiresAt: date('expires_at').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: date('created_at').notNull().defaultNow(),
  updatedAt: date('updated_at').notNull().defaultNow(),
})
export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: date('access_token_expires_at'),
  refreshTokenExpiresAt: date('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: date('created_at').notNull().defaultNow(),
  updatedAt: date('updated_at').notNull().defaultNow(),
})
export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: date('expires_at').notNull(),
  createdAt: date('created_at').notNull().defaultNow(),
  updatedAt: date('updated_at').notNull().defaultNow(),
})
export const folders = pgTable(
  'folders',
  {
    id: uuid('id').notNull(),
    owner: text('owner')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    updatedAt: date('updated_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.owner, table.id] }),
    uniqueIndex('folders_owner_name').on(table.owner, sql`lower(${table.name})`),
  ],
)
export const notes = pgTable(
  'notes',
  {
    id: uuid('id').notNull(),
    owner: text('owner')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    folderId: uuid('folder_id'),
    title: text('title').notNull(),
    document: jsonb('document').$type<NoteFields['document']>().notNull(),
    searchText: text('search_text').notNull(),
    pinned: boolean('pinned').notNull(),
    archived: boolean('archived').notNull(),
    deletedAt: date('deleted_at'),
    revision: integer('revision').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date', precision: 3 })
      .notNull()
      .defaultNow(),
    createdAt: date('created_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.owner, table.id] }),
    foreignKey({
      columns: [table.owner, table.folderId],
      foreignColumns: [folders.owner, folders.id],
    }),
    index('notes_owner_folder').on(table.owner, table.folderId),
    index('notes_owner_updated').on(table.owner, table.updatedAt, table.id),
    index('notes_owner_title').on(table.owner, table.title, table.id),
    index('notes_search').using(
      'gin',
      sql`to_tsvector('simple', ${table.title} || ' ' || ${table.searchText})`,
    ),
  ],
)
export const receipts = pgTable(
  'note_receipts',
  {
    owner: text('owner')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    mutationId: uuid('mutation_id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    result: jsonb('result').$type<Ack>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.owner, table.mutationId] })],
)
