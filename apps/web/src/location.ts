import type { View } from '../../../packages/contracts'
import type { NoteSort } from './components/note-menus'

type Screen = {
  view: View
  folder?: string
  note?: string
  query: string
  sort: NoteSort
}

export function readScreen(): Screen {
  const params = new URLSearchParams(location.search)
  const id = (key: string) => {
    const value = params.get(key)
    return value && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
      ? value.toLowerCase()
      : undefined
  }
  const view = params.get('view')
  return {
    view: view === 'archived' || view === 'trash' ? view : 'active',
    folder: view === 'archived' || view === 'trash' ? undefined : id('folder'),
    note: id('note'),
    query: (params.get('q') ?? '').slice(0, 150),
    sort: params.get('sort') === 'title' ? 'title' : 'updated',
  }
}

export function writeScreen(screen: Screen, mode: 'push' | 'replace') {
  const url = new URL(location.href)
  const params = {
    view: screen.view === 'active' ? undefined : screen.view,
    folder: screen.folder,
    note: screen.note,
    q: screen.query || undefined,
    sort: screen.sort === 'updated' ? undefined : screen.sort,
  }
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value)
    else url.searchParams.delete(key)
  }
  if (url.href === location.href) return
  if (mode === 'push') history.pushState(null, '', url)
  else history.replaceState(history.state, '', url)
}
