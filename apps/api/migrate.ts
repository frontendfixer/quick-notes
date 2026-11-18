import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { db } from './db'
await migrate(db, { migrationsFolder: new URL('./migrations', import.meta.url).pathname })
process.exit(0)
