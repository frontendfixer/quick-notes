import { openDB, type DBSchema } from 'idb'
import type { Mutation, Note, NoteFields, Folder } from '../../../packages/contracts'

export type Draft = {
  owner: string
  id: string
  fields: NoteFields
  generation: string
  base: number | null
  changedAt: string
  sent?: { generation: string; mutation: Mutation }
  conflict?: { current: Note | null }
  error?: string
}

interface Local extends DBSchema {
  settings: { key: string; value: string }
  snapshots: {
    key: [string, string]
    value: { owner: string; note: Note; accessed: number }
    indexes: { owner: string }
  }
  drafts: { key: [string, string]; value: Draft; indexes: { owner: string } }
}

let connection: ReturnType<typeof openDB<Local>> | undefined
const database = () =>
  (connection ??= openDB<Local>('quick-notes', 1, {
    upgrade(db) {
      db.createObjectStore('settings')
      db.createObjectStore('snapshots').createIndex('owner', 'owner')
      db.createObjectStore('drafts').createIndex('owner', 'owner')
    },
  }))

export const local = {
  async owner() {
    return (await database()).get('settings', 'owner')
  },
  async setOwner(owner: string) {
    await (await database()).put('settings', owner, 'owner')
  },
  async hideOwner() {
    await (await database()).delete('settings', 'owner')
  },
  async folders(owner: string): Promise<Folder[]> {
    const value = await (await database()).get('settings', 'folders:' + owner)
    return value ? JSON.parse(value) : []
  },
  async cacheFolders(owner: string, folders: Folder[]) {
    await (await database()).put('settings', JSON.stringify(folders), 'folders:' + owner)
  },
  async drafts(owner: string) {
    return (await database()).getAllFromIndex('drafts', 'owner', owner)
  },
  async snapshots(owner: string) {
    const snapshots = await (await database()).getAllFromIndex('snapshots', 'owner', owner)
    return snapshots.map((snapshot) => snapshot.note)
  },
  async dropFolderSnapshots(owner: string, id: string) {
    const tx = (await database()).transaction('snapshots', 'readwrite')
    const entries = await tx.store.index('owner').getAll(owner)
    await Promise.all(
      entries
        .filter(({ note }) => note.folderId === id)
        .map(({ note }) => tx.store.delete([owner, note.id])),
    )
    await tx.done
  },
  async dropSnapshot(owner: string, id: string) {
    await (await database()).delete('snapshots', [owner, id])
  },
  async snapshot(owner: string, id: string) {
    return (await (await database()).get('snapshots', [owner, id]))?.note
  },
  async cache(owner: string, note: Note, keep: string) {
    const tx = (await database()).transaction('snapshots', 'readwrite')
    const existing = await tx.store.get([owner, note.id])
    if (existing && existing.note.revision > note.revision) {
      await tx.done
      return
    }
    await tx.store.put({ owner, note, accessed: Date.now() }, [owner, note.id])
    const entries = await tx.store.index('owner').getAll(owner)
    entries.sort(
      (a, b) =>
        (b.note.id === keep ? 1 : 0) - (a.note.id === keep ? 1 : 0) || b.accessed - a.accessed,
    )
    await Promise.all(entries.slice(20).map((entry) => tx.store.delete([owner, entry.note.id])))
    await tx.done
  },
  async change(owner: string, id: string, change: (draft?: Draft) => Draft | undefined) {
    const tx = (await database()).transaction('drafts', 'readwrite', { durability: 'strict' })
    const key: [string, string] = [owner, id]
    const previous = await tx.store.get(key)
    const draft = change(previous)
    if (draft) await tx.store.put(draft, key)
    else if (previous) await tx.store.delete(key)
    await tx.done
    return draft
  },
  async acknowledge(draft: Draft, note: Note, keep?: string) {
    const tx = (await database()).transaction(['drafts', 'snapshots'], 'readwrite', {
      durability: 'strict',
    })
    const key: [string, string] = [draft.owner, draft.id]
    const drafts = tx.objectStore('drafts')
    const current = await drafts.get(key)
    if (current?.sent && current.sent.mutation.mutationId === draft.sent?.mutation.mutationId) {
      const snapshots = tx.objectStore('snapshots')
      const previous = await snapshots.get(key)
      if (!previous || previous.note.revision <= note.revision) {
        await snapshots.put({ owner: draft.owner, note, accessed: Date.now() }, key)
      }
      if (current.generation === draft.sent?.generation) await drafts.delete(key)
      else await drafts.put({ ...current, base: note.revision, sent: undefined }, key)
    }
    const snapshots = tx.objectStore('snapshots')
    const entries = await snapshots.index('owner').getAll(draft.owner)
    entries.sort(
      (a, b) =>
        (b.note.id === keep ? 1 : 0) - (a.note.id === keep ? 1 : 0) || b.accessed - a.accessed,
    )
    await Promise.all(
      entries.slice(20).map((entry) => snapshots.delete([draft.owner, entry.note.id])),
    )
    await tx.done
  },
}
