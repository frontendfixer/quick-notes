# Quick Notes

Quick Notes is a private rich-text notes PWA. Use Chrome on Android or Chromium on Linux to install it from the browser menu. The **On device** view lists notes available without internet, including pending drafts.

## Run locally

Requires Bun 1.4.4 and PostgreSQL 18. Docker Compose can provide PostgreSQL.

1. Run `bun install --frozen-lockfile` and copy `.env.example` to `.env`.
2. Generate a session secret with `openssl rand -hex 32` and set `BETTER_AUTH_SECRET` in `.env`. Set `POSTGRES_PASSWORD` and the corresponding password in `DATABASE_URL`. Use a URL-safe database password or encode it in the URL.
3. Run `docker compose up -d db`, then `bun run db:migrate`.
4. Provision a user from Bash. Enter a password of at least 12 characters when prompted.

   ```bash
   read -r -s -p 'Quick Notes password: ' quick_notes_password
   printf '\n'
   printf '%s\n' "$quick_notes_password" | bun run account:create you@example.com
   unset quick_notes_password
   ```

5. Run `bun run build` and `bun run start`, then open http://localhost:3000. Use the production build for service worker and offline checks.

For Vite development, run `APP_ORIGIN=http://localhost:5173 bun run start` alongside `bun run dev`, opening the Vite origin. The database is shared between development and the production build, so use a separate development database when needed.

## Host privately

Build static assets with `bun install --frozen-lockfile` and `bun run build`; run migrations once and run `bun run start` from the project directory. Terminate TLS at a reverse proxy, keep Bun behind it, and set `APP_ORIGIN` to the external HTTPS origin. Keep API routes and the shell on that origin. Serve the worker and HTML with revalidation and retain prior hashed assets during a rollout. Use a TLS database URL for a remote database. If the reverse proxy overwrites a client-IP header, set `TRUSTED_CLIENT_IP_HEADER` to its name so login throttling can operate per client. With no header configured, login throttling uses a shared bucket. Set up database backups with a restore drill and restrict production credentials and provisioning access.

For password recovery, run `bun run account:reset-password you@example.com` and pass the new password via stdin as in the provisioning example. The reset revokes existing sessions. Signup is available through the provisioning command.

## Approve signup requests

The sign-in page links to **Sign up**. The user chooses a password and receives a request ID. Confirm that the applicant sent you the matching request ID through a channel you trust before approving it. The app does not send verification or approval email.

Run these statements in the Quick Notes PostgreSQL database:

```sql
SELECT id, email, requested_at
FROM signup_waitlist
WHERE approved_at IS NULL
ORDER BY requested_at;

UPDATE signup_waitlist
SET approved_at = now()
WHERE id = '<request-id>' AND approved_at IS NULL
RETURNING id, email, approved_at;
```

Approval creates the account and clears the pending password hash in the same transaction. The applicant can then sign in with the password they chose. Remove rejected requests with `DELETE FROM signup_waitlist WHERE id = '<request-id>' AND approved_at IS NULL;`.

## Writing and recovery

**Saved on device** means the local transaction completed. **Saved to server** means the server acknowledged the current draft. Drafts still pending when the browser profile is cleared or evicted are recoverable only from a prior download. One tab per account and browser profile edits at a time. Close the writable tab to hand off editing. Another device can edit concurrently and receives a conflict when its base revision is stale.

Create a private folder from **Folders** in the sidebar. Notes created while a folder is selected go into it automatically. Use **Move note to folder** to organize existing notes. Deleting a folder moves its notes to Trash immediately. Restored notes return without a folder. Folder membership is included in exports.

When a conflict appears, review the server text, then save your draft as a new note or explicitly replace the reviewed version. **Download drafts** includes data still in memory and locally committed changes. **Export notes** downloads the server copy in versioned JSON. To restore a server export into a provisioned account, run `bun run backup:restore you@example.com backup.json`. This creates new note copies and retains formatting, archive, trash and pin states. Recovery JSON is readable and can also be used to recover a draft manually.

## Verify

- `bun run lint`, `bun run format:check`, `bun run check` and `bun run build`. Use `bun run format` to apply formatting.
- `bun test` for the document contract. With a migrated disposable database and configured environment, run `QUICK_NOTES_INTEGRATION=1 bun test` for session and API tests.
- With the production server running against a disposable database, run `bun tests/browser.ts` for the Chromium PWA test. Set `CHROMIUM_BIN` if Chromium is installed elsewhere. Integration and browser tests create test accounts and notes. Run `bun tests/benchmark.ts` against that server for the Linux Chromium latency sample.

### Verification on 2026-11-18

The pinned build uses Solid 1.9.19 because the published Solid Vite plugin declares a Solid 1.x peer dependency. The production shell JavaScript was about 42 KiB gzip and the editor is a separate precached chunk.

Type checking, the production build, clean PostgreSQL 18 migrations, Bun SQL over TLS, API integration, backup restore, password reset and session revocation passed. Headless Chromium verified local save retry after a simulated quota error, idempotent upload after losing a server acknowledgement, recovery of three drafts after closing and reopening offline, and separate device conflict recovery.

On Linux Chromium 155, using a loopback API and 20 samples per document size, P95 warm-cache startup was 218 ms. P95 cached note opening was 108 ms for 10 KiB and 72 ms for 100 KiB. Across these samples the higher P95 was 27 ms to the typing paint proxy, 67 ms to local commit and 788 ms to server acknowledgement. These are headless results. Physical Android installation, keyboard and lifecycle checks, and desktop installation and assistive-technology checks remain release gates.
