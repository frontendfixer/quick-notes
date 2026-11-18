# Notes PWA — Vision and Technology Brief

## Purpose

This document is the product vision and technology direction for an implementation agent. Treat it as a requirements brief, **not** an implementation plan. Research the latest official documentation and current package compatibility before proposing architecture or writing code. Produce a considered project plan first, identifying any material tradeoffs or unresolved decisions. Do not assume versions or integration APIs from this brief are current.

## Product vision

Build a **minimal, exceptionally fast, installable note-taking PWA** for **Android and Linux**. It should feel immediate to launch, open, navigate, and type in, with a quiet, distraction-free interface. It is a personal notes product, not a collaboration platform or general-purpose document suite.

Prioritize, in order:

1. **Reliability of writing and autosave** — never silently discard user edits.
2. **Fast startup and responsive editing** — keep the initial application and editor lightweight.
3. **Offline-first writing** — an already opened/locally available note must remain editable without internet.
4. **Simple cross-device availability** — server-authoritative notes with background refresh rather than a real-time sync system.
5. **Small, maintainable codebase** — prefer browser APIs and narrowly scoped dependencies over unnecessary abstractions.
6. **Long-term portability** — keep notes exportable and avoid unnecessary proprietary dependencies.

## User experience and essential features

- Installable PWA for Android and Linux, with an offline-capable application shell.
- Simple notes list and fast opening of notes; responsive layouts suitable for touch and desktop keyboard/mouse.
- Create, read, edit, soft-delete, restore, archive, and pin notes.
- Rich-text editing with **bold, italic, underline, strikethrough, headings, bullet lists, numbered lists, interactive checklists, text highlighting**, and undo/redo. Include links and basic keyboard shortcuts where appropriate. Formatting should be WYSIWYG, without requiring a separate Markdown preview.
- Minimal, unobtrusive formatting controls appropriate to Android and Linux.
- Search and sorting of notes via the backend. **Do not build a local full-text search index or replicate the entire notes database by default.**
- Automatic saving with clear, nonintrusive states: editing, saved locally/pending upload, saved to server, error/conflict.
- Preserve the currently opened note locally for offline editing; also retain **every pending unsynchronized draft**, even after switching notes or restarting the app. Local storage is for available-note snapshots and pending edits, not a full local mirror.
- Resume pending uploads automatically after reconnect or app reopening; use ordinary background refresh on focus, reconnect, and sensible intervals while active to discover edits from another device.
- Safeguard against stale server responses overwriting newer local drafts. Use revision-aware writes and preserve conflicting edits for recovery rather than silently replacing either version.
- Provide a straightforward export/backup capability and reasonable recovery paths for failed saves.
- Support authentication and private, user-scoped notes; secure sessions and transport.
- Accessible controls, keyboard navigation, clear focus behavior, and readable light/dark presentation.

## Confirmed technical direction

| Concern | Preferred technology / approach |
| --- | --- |
| Application form | Static, client-rendered Progressive Web App (PWA) |
| Frontend | **SolidJS** with TypeScript; verify the current stable release and ecosystem compatibility |
| Build | **Vite** |
| Styling | **SCSS**, lightweight custom UI; avoid a heavy component library |
| Rich-text editor | **Tiptap**, using the minimum necessary ProseMirror extensions; research current SolidJS integration guidance |
| Local draft persistence | **IndexedDB**, with a small, reliable abstraction |
| Offline shell | Service Worker / PWA caching using a maintained Vite-compatible solution |
| Network client | Native `fetch` unless a specific library is justified |
| Backend | **Hono** HTTP API |
| Backend runtime | **Bun**, subject to compatibility verification |
| Database | **PostgreSQL** |
| Database access and migrations | **Drizzle ORM**, subject to current compatibility review |
| Validation and shared contracts | TypeScript and **Zod** where useful |
| Search | PostgreSQL-backed server-side search; no separate search service initially |
| Cross-device refresh | HTTP requests, focus/reconnect refresh, conditional or incremental fetching where beneficial; **no WebSocket requirement** |
| Authentication | Secure, conventional session-based authentication; research current best practices and recommend the simplest robust implementation |

These choices are the intended baseline. Research official docs and surface evidence-based changes before substituting a confirmed choice, especially SolidJS, Tiptap, Hono, Bun, or PostgreSQL.

## Autosave and data-consistency principles

- Typing must never wait for the network.
- Keep editor updates immediate; persist drafts locally promptly and send debounced server updates independently.
- Treat PostgreSQL as the canonical server record, but prioritize an unacknowledged local draft over an older fetched version.
- Track whether a specific local edit has actually been acknowledged; do not clear a newer draft after an older request succeeds.
- Do not rely on unload handlers, background timers, or browser background sync for correctness. Browsers may suspend PWAs, particularly on Android.
- Refresh remote content when the app becomes active or reconnects, and periodically while active; do not promise instantaneous background delivery.
- Support offline editing for notes that are locally available. **Do not claim all notes are accessible offline** when only active/recent notes are cached.
- Evaluate crash/force-close recovery, concurrent edits across devices, request reordering, offline reconnect, and storage eviction in the plan.

## Performance and design principles

- Optimize perceived startup and interaction latency before chasing framework benchmark scores.
- Minimize initial JavaScript and avoid SSR, heavyweight state management, broad UI kits, or extra runtimes unless justified by measured benefit.
- Load nonessential editor features lazily where practical without causing visible delays during normal writing.
- Avoid unnecessary rerenders, network round trips, and expensive serialization during typing.
- Design for both Android touch input and Linux keyboard workflows; use responsive, compact, modern, minimal visuals. Favor restrained colors, no gradients, and simple iconography.
- Set measurable performance budgets and benchmark on real Android and Linux environments. Do not present speculative latency numbers as guarantees.

## Deliberately out of scope for the first release

- Collaborative multi-user editing, presence, CRDTs, or WebSocket-driven real-time synchronization.
- Complete offline replication of all notes or local full-text indexing.
- Attachments, file management, image uploads, AI features, complex nested folders, and elaborate document publishing.
- A native Android or Linux application alongside the PWA.

## Instructions for the implementation agent

1. **Research current official documentation** for SolidJS, Vite, Tiptap/ProseMirror, Hono, Bun, Drizzle, PostgreSQL, and the relevant browser storage/PWA APIs. Confirm supported versions, integration patterns, limitations, and maintenance status.
2. Independently design the implementation architecture, project organization, data model, API contracts, auth/session model, offline draft workflow, autosave lifecycle, refresh strategy, conflict recovery, and deployment approach. **None are prescribed by this brief.**
3. Identify practical browser limitations on Android and Linux, especially PWA lifecycle behavior, IndexedDB persistence, background work, and rich-text editor input handling.
4. Produce a phased, testable plan with explicit acceptance criteria and performance/reliability checks **before implementation**.
5. Keep the solution minimal; justify any additional library, service, or complexity against the stated vision.
6. If requirements conflict, prioritize data safety, then responsiveness, then simplicity. Ask for decisions only where a tradeoff materially changes the product.

**Expected first deliverable:** a researched implementation proposal and phased plan—not a generated project scaffold.
