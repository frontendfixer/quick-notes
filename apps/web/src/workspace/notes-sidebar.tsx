import { TextInput } from '../components/text-input'
import { Alert } from '@kobalte/core/alert'
import { Button } from '@kobalte/core/button'
import { ChevronDown, LockKeyhole, Plus, RefreshCw, Search, WifiOff } from 'lucide-solid'
import { For, Show } from 'solid-js'
import { type View } from '../../../../packages/contracts'
import { readScreen } from '../location'
import {
  CollectionHeading,
  EmptyCollection,
  FolderNameForm,
  FolderRow,
} from '../components/folder-views'
import { AccountMenu, SortMenu } from '../components/note-menus'
import { writingGuideTitle, type createWritingGuide } from '../components/writing-guide'
import { NoteRow } from '../components/note-row'
import { ConfirmationDialog } from '../components/confirmation-dialog'

import type { Workspace } from '../workspace'
import { noteTitle } from '../note-title'
import { Reauthentication } from './reauthentication'

type Props = Workspace['sidebar'] & { guide: ReturnType<typeof createWritingGuide> }

export function NotesSidebar(props: Props) {
  const {
    folderBusy,
    activeView,
    authorized,
    canCreate,
    canManageFolders,
    cancelFolderForm,
    changeView,
    chosenFolder,
    clearSearch,
    collectionIsEmpty,
    collectionKind,
    confirmSignOut,
    displayedList,
    draftFor,
    drafts,
    exportDrafts,
    flushEdits,
    folder,
    folderError,
    folderForm,
    folders,
    home,
    listParams,
    loadingMore,
    loadingNotes,
    manualRefresh,
    mustSignIn,
    newNote,
    next,
    notice,
    open,
    opening,
    query,
    ready,
    refresh,
    safeList,
    saveFolder,
    searchNotes,
    select,
    setAccountTrigger,
    setCollectionPanel,
    setConfirmSignOut,
    setFolderError,
    setFolderForm,
    setNotesPanel,
    setSearchInput,
    setSort,
    showEditor,
    signOut,
    signingOut,
    sort,
    sortedFolders,
    status,
    storageNotice,
    title,
    unavailable,
    updateScreen,
    upload,
    view,
    visibleById,
    visibleIds,
    writable,
    signIn,
    signingIn,
  } = props
  let sidebar: HTMLElement | undefined
  let accountTrigger: HTMLButtonElement | undefined
  let notesPanel: HTMLDivElement | undefined
  const folderFormControls = () => (
    <>
      <Show when={folderForm() === 'rename'}>
        <FolderNameForm
          mode="rename"
          initialName={chosenFolder()?.name ?? ''}
          busy={folderBusy()}
          disabled={!canManageFolders()}
          error={folderError()}
          onSubmit={saveFolder}
          onEdit={() => setFolderError('')}
          onCancel={cancelFolderForm}
        />
      </Show>
      <Show when={!folderForm() && folderError()}>
        <Alert as="p" class="inline-error">
          {folderError()}
        </Alert>
      </Show>
    </>
  )
  const showGuide = () => home() && !query().trim() && props.guide.pinned()
  const emptyHeadings: Record<View, string> = {
    active: 'No notes yet',
    archived: 'Archive is empty',
    trash: 'Trash is empty',
  }
  return (
    <aside
      classList={{ sidebar: true, 'mobile-hidden': showEditor() }}
      ref={(node) => {
        sidebar = node
      }}
    >
      <header class="sidebar-header">
        <div class="brand">
          <span class="brand-mark">
            <span class="note-logo" aria-hidden="true" />
          </span>
          <span class="brand-copy">
            <strong>Quick Notes</strong>
          </span>
        </div>

        <AccountMenu
          view={view()}
          onView={changeView}
          onGuide={() => props.guide.show(() => accountTrigger)}
          hasDrafts={drafts().length > 0 || status() === 'Save failed'}
          onDownloadDrafts={exportDrafts}
          canSignOut={writable() && !signingOut() && !unavailable()}
          onSignOut={() => requestAnimationFrame(() => setConfirmSignOut(true))}
          triggerRef={(node) => {
            accountTrigger = node
            setAccountTrigger(node)
          }}
        />
      </header>
      <ConfirmationDialog
        open={confirmSignOut()}
        onOpenChange={setConfirmSignOut}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          accountTrigger?.focus()
        }}
        title="Sign out?"
        description={
          drafts().length || status() === 'Editing' || status() === 'Save failed'
            ? 'Your unsynced drafts stay on this device and will be available the next time you sign in.'
            : 'You’ll need to sign in again to access your notes.'
        }
        confirmLabel="Sign out"
        onConfirm={() => void signOut()}
      />
      <Show when={!writable() && ready()}>
        <p class="sidebar-read-only message">
          <LockKeyhole size={16} /> Another tab has editing access.
        </p>
      </Show>
      <Show when={mustSignIn() && !showEditor()}>
        <Reauthentication signIn={signIn} signingIn={signingIn} />
      </Show>
      <Show when={authorized() && !unavailable()}>
        <div class="search">
          <Search size={17} />
          <TextInput
            type="search"
            placeholder="Search notes…"
            aria-label="Search notes"
            maxlength="150"
            ref={setSearchInput}
            value={query()}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && query()) clearSearch()
            }}
            onInput={(event) => searchNotes(event.currentTarget.value)}
          />
          <kbd aria-hidden="true">{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'} K</kbd>
        </div>
      </Show>
      <div class="collection-panel" ref={setCollectionPanel}>
        <Show when={!home()}>
          <CollectionHeading
            title={activeView()}
            kind={collectionKind()}
            canManage={Boolean(chosenFolder()) && canManageFolders()}
            onBack={() => changeView('active')}
            onRename={() => {
              setFolderError('')
              setFolderForm(folderForm() === 'rename' ? undefined : 'rename')
            }}
            onDelete={() => void saveFolder()}
          />
        </Show>
        <Show when={query().trim()}>
          <p class="search-scope muted">
            Searching {home() ? 'notes outside folders' : activeView()}{' '}
            <Button class="secondary" onClick={clearSearch}>
              Clear search
            </Button>
          </p>
        </Show>
        <div
          class="notes"
          aria-busy={loadingNotes()}
          ref={(node) => {
            notesPanel = node
            setNotesPanel(node)
          }}
        >
          <Show when={!showEditor() && notice()}>
            <div class="list-error">
              <Alert as="p" class="inline-error">
                {notice()}
              </Alert>
              <Show when={notice() === storageNotice}>
                <Button class="secondary" onClick={() => void flushEdits().then(() => upload())}>
                  Retry save
                </Button>
              </Show>
              <Show when={notice() === 'Could not refresh the notes list.'}>
                <Button class="secondary" disabled={loadingNotes()} onClick={() => void safeList()}>
                  Retry loading notes
                </Button>
              </Show>
            </div>
          </Show>
          <Show when={opening() === 'remote' && !showEditor()}>
            <p class="muted" role="status">
              Opening note…
            </p>
          </Show>
          <Show when={unavailable()}>
            <p class="offline-notice">
              <WifiOff size={15} />
              Offline · showing notes on this device
            </p>
          </Show>
          <Show when={showGuide() || !collectionIsEmpty()}>
            <div class="list-heading">
              <h2>
                {query().trim()
                  ? 'Search results'
                  : view() === 'archived'
                    ? 'Archived notes'
                    : view() === 'trash'
                      ? 'Deleted notes'
                      : 'Notes'}
              </h2>
              <div class="list-heading-actions">
                <Show
                  when={
                    authorized() &&
                    !unavailable() &&
                    (visibleIds().length > 0 || (home() && folders().length > 0))
                  }
                >
                  <SortMenu
                    value={sort()}
                    mount={sidebar}
                    onChange={(value) => {
                      if (sort() === value) return
                      setSort(value)
                      updateScreen('replace', readScreen().note)
                      if (notesPanel && (!home() || query().trim())) notesPanel.scrollTop = 0
                      void safeList()
                    }}
                  />
                </Show>
                <Button
                  class="icon-button"
                  title="Refresh notes list"
                  aria-label="Refresh notes list"
                  disabled={manualRefresh() || signingOut()}
                  onClick={() => void refresh(true)}
                >
                  <RefreshCw size={17} aria-hidden="true" />
                </Button>
              </div>
            </div>
          </Show>
          <Show when={home() && !query().trim()}>
            <section class="folder-list" aria-label="Folders">
              <For each={sortedFolders()}>
                {(item) => <FolderRow folder={item} onOpen={() => changeView('active', item.id)} />}
              </For>
            </section>
          </Show>
          {folderFormControls()}
          <Show when={showGuide()}>
            <NoteRow
              id="writing-guide"
              note={undefined}
              title={writingGuideTitle}
              preview="Formatting, Markdown, and organizing notes"
              current={false}
              pinned
              hasConflict={false}
              onOpen={() =>
                props.guide.show(() =>
                  showGuide()
                    ? sidebar?.querySelector<HTMLButtonElement>('[data-note-id="writing-guide"]')
                    : accountTrigger,
                )
              }
            />
          </Show>
          <For
            each={visibleIds()}
            fallback={
              <Show when={!showGuide()}>
                <Show
                  when={!collectionIsEmpty()}
                  fallback={
                    <EmptyCollection
                      kind={collectionKind()}
                      onBack={() => changeView('active')}
                      mobile
                      offline={unavailable() || mustSignIn()}
                      canCreate={canCreate()}
                      onCreate={newNote}
                    />
                  }
                >
                  <div class="list-empty" aria-busy={!ready() || loadingNotes()}>
                    <span class="collection-icon" aria-hidden="true">
                      <Show when={query().trim()} fallback={<span class="note-logo" />}>
                        <Search size={18} />
                      </Show>
                    </span>
                    <p role="status">
                      {ready() && !loadingNotes()
                        ? query().trim() && !unavailable()
                          ? 'No matching notes'
                          : folder()
                            ? 'No notes in this folder'
                            : home() && folders().length > 0
                              ? 'No notes outside folders'
                              : emptyHeadings[view()]
                        : 'Loading notes…'}
                    </p>
                    <Show
                      when={ready() && !loadingNotes() && !query().trim() && view() === 'active'}
                    >
                      <Button class="secondary" onClick={newNote} disabled={!canCreate()}>
                        <Plus size={16} aria-hidden="true" />
                        Create a note
                      </Button>
                    </Show>
                  </div>
                </Show>
              </Show>
            }
          >
            {(id) => {
              const note = () => visibleById().get(id)
              const current = () => open()?.id === id
              return (
                <NoteRow
                  id={id}
                  note={note()}
                  current={current()}
                  title={noteTitle(current() ? title() : (note()?.title ?? ''))}
                  folderName={folders().find((item) => item.id === note()?.folderId)?.name}
                  hasConflict={Boolean(draftFor(id)?.conflict)}
                  onOpen={() => void select(id)}
                />
              )
            }}
          </For>
          <Show when={next() && displayedList() === listParams().toString()}>
            <Button class="load-more" disabled={loadingMore()} onClick={() => void safeList(true)}>
              {loadingMore() ? 'Loading more…' : 'Load more'}
              <ChevronDown size={15} />
            </Button>
          </Show>
        </div>
      </div>
    </aside>
  )
}
