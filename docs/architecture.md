# Quick Notes architecture

Quick Notes is an offline-capable Solid PWA backed by a Hono API and PostgreSQL. A note can exist as an in-memory editor change, a durable draft in IndexedDB, a cached server snapshot, or a server record. Those copies have different lifetimes. Follow the ownership and revision checks when changing how they move between layers.

## Workspace and editor

- The app shell renders account access and the main workspace. The workspace controller coordinates URL state, editor selection, and actions that span multiple modules. It exposes separate models for the shell, sidebar, note pane, and update dialog. [App shell](../apps/web/src/app.tsx) · [Workspace controller](../apps/web/src/workspace.ts)
- The session module owns account state, sign-in and sign-out, and the browser writer lock. The workspace controller connects it to list refreshes and editor state. Sign-out clears the in-memory query cache and hides local data for the signed-out account. [Session](../apps/web/src/workspace/session.ts)
- The note list module owns the TanStack Query cache, pagination, offline list fallback, and the draft overlay. Query keys include the account and the complete view, folder, search, and sort parameters. Background refetches retain the current view. The folder module coordinates folder reads and mutations with list invalidation. [Note lists](../apps/web/src/workspace/note-list.ts) · [Folders](../apps/web/src/workspace/folders.ts)
- The rich editor owns the Tiptap instance and its lifecycle. Formatting, context-menu interactions, clipboard conversion, image handling, and link editing live near it in dedicated modules. The shared document schema defines the supported content on both the web and API sides. [Rich editor](../apps/web/src/editor.tsx) · [Editor modules](../apps/web/src/editor) · [Document schema](../packages/note-document.ts)
- The stylesheet entry point declares cascade order. Keep related overrides in their layer. Compare compiled CSS before and after moving rules between layers. [Styles](../apps/web/src/style.scss)

## Drafts, sync, and reconciliation

1. Editor changes enter the draft buffer. Its serialized work queue coordinates local edits with sync acknowledgements, and its generation IDs let a newer edit survive acknowledgement of an older one.
2. The sync loop stores each outgoing mutation before sending it. Retries reuse the stored mutation ID and payload. On the server, a receipt records the accepted result, and an expected revision guards against overwriting another device’s edit.
3. The reconciliation pass checks server revisions for IDs already tracked on this device. It updates changed snapshots, evicts snapshots for permanently deleted notes, and preserves local edits as a conflict if the server note is gone.
4. Trash is recoverable until explicit permanent deletion. A note trashed before its first upload can stay local. A synced note is permanently deleted using its confirmed Trash revision so a concurrent restore blocks deletion.

[Draft buffer](../apps/web/src/workspace/draft-buffer.ts) · [Sync loop](../apps/web/src/workspace/note-sync.ts) · [Reconciliation](../apps/web/src/reconciliation.ts) · [IndexedDB storage](../apps/web/src/storage.ts) · [Note API](../apps/api/note-routes.ts)

## API routing

The API entry point registers security headers and origin checks first, then public auth and waitlist routes. Session middleware runs before the private note and folder routes. Private handlers scope their database reads and writes to the authenticated owner. Keep the static reconciliation route ahead of the note-ID route. [API entry point](../apps/api/app.ts) · [Waitlist routes](../apps/api/waitlist-routes.ts) · [Folder routes](../apps/api/folder-routes.ts)

## Where to verify changes

Run `bun run check`, `bun run lint`, and `bun run build` for source and asset changes. With a migrated disposable PostgreSQL database, run `QUICK_NOTES_INTEGRATION=1 bun test` for contracts, private routes, revision checks, and receipts. The browser scripts exercise the production build, including offline recovery, editor commands, the update prompt, and background refresh. [Verification setup](../README.md#verify) · [Browser suites](../tests)

The editor suite uses mocked API and image responses. Run it with the production assets served by `bun --bun vite preview --port 4179`, then run `bun tests/editor-browser.ts`. Use the Bun API server for the database-backed browser suites. The service-worker update suite starts its own server.
