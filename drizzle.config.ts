import { defineConfig } from 'drizzle-kit'
export default defineConfig({
  dialect: 'postgresql',
  schema: './apps/api/schema.ts',
  out: './apps/api/migrations',
})
