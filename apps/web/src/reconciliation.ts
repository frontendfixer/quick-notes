import { reconciliationLimit, reconciliationResponse, type Note } from '../../../packages/contracts'
import { local } from './storage'

export async function reconcileNotes(owner: string, isCurrent: () => boolean, expire: () => void) {
  const [snapshots, drafts] = await Promise.all([local.snapshots(owner), local.drafts(owner)])
  const cached = new Map(snapshots.map((note) => [note.id, note]))
  const tracked = new Map(
    drafts.filter((draft) => draft.base !== null).map((draft) => [draft.id, draft]),
  )
  const ids = [...new Set([...cached.keys(), ...tracked.keys()])]
  for (let start = 0; isCurrent() && start < ids.length; start += reconciliationLimit) {
    const batch = ids.slice(start, start + reconciliationLimit)
    const response = await fetch('/api/notes/reconcile?ids=' + batch.join(','), {
      signal: AbortSignal.timeout(5000),
    })
    if (!isCurrent()) return
    if (response.status === 401) return expire()
    if (!response.ok) throw new Error('Could not reconcile notes')
    const result = reconciliationResponse.parse(await response.json())
    if (result.owner !== owner || !isCurrent()) return
    // Membership in this account-scoped response is independent of the currently visible list.
    const remote = new Map(result.notes.map((note) => [note.id, note]))
    for (const id of batch) {
      if (!isCurrent()) return
      const previous = cached.get(id)
      const status = remote.get(id)
      const draft = tracked.get(id)
      if (!status) {
        if (previous) await local.reconcileSnapshot(owner, previous, null)
        if (
          draft &&
          (!draft.sent || draft.conflict) &&
          !draft.purge &&
          draft.conflict?.current !== null &&
          isCurrent()
        ) {
          await local.change(owner, id, (current) =>
            current?.generation === draft.generation &&
            (!current.sent || current.conflict) &&
            !current.purge
              ? { ...current, conflict: { current: null } }
              : current,
          )
        }
      } else if (previous && status.revision > previous.revision) {
        const detail = await fetch('/api/notes/' + id, { signal: AbortSignal.timeout(5000) })
        if (!isCurrent()) return
        if (detail.status === 401) return expire()
        if (detail.status === 404) continue
        if (!detail.ok) throw new Error('Could not refresh cached note')
        const note: Note = await detail.json()
        if (isCurrent() && note.id === id && note.revision >= status.revision)
          await local.reconcileSnapshot(owner, previous, note)
      }
    }
  }
}
