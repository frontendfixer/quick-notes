import { createWritingGuide } from './components/writing-guide'
import { Show } from 'solid-js'
import { ActivityToasts } from './components/activity-toasts'
import { AccountAccess } from './components/account-access'
import { CreateFolderDialog } from './components/folder-views'
import { CreateMenu } from './components/create-menu'
import { ConfirmationDialog } from './components/confirmation-dialog'

import { createWorkspace } from './workspace'
import { noteTitle } from './note-title'
import { NotesSidebar } from './workspace/notes-sidebar'
import { NoteWorkspace } from './workspace/note-workspace'
import { UpdateDialog } from './workspace/update-dialog'

export default function App() {
  const { shell, sidebar, editor, updateDialog } = createWorkspace()
  const {
    canCreate,
    canEdit,
    canManageFolders,
    cancelFolderForm,
    changeNoteState,
    folderBusy,
    folderError,
    folderForm,
    joiningWaitlist,
    newFolder,
    newNote,
    noteToTrash,
    notice,
    open,
    owner,
    ready,
    restoreFolderDialogFocus,
    saveFolder,
    setCreateTrigger,
    setFolderError,
    setNoteToTrash,
    setNotice,
    showEditor,
    showWaitlist,
    signIn,
    signingIn,
    title,
    unavailable,
  } = shell
  const guide = createWritingGuide(owner)
  return (
    <>
      <UpdateDialog {...updateDialog} />
      <div class="app">
        <ActivityToasts editorOpen={showEditor()} />
        <Show
          when={owner()}
          fallback={
            <AccountAccess
              ready={ready()}
              joiningWaitlist={joiningWaitlist()}
              notice={notice()}
              signingIn={signingIn()}
              unavailable={unavailable()}
              onSignIn={signIn}
              onBackToSignIn={() => showWaitlist(false)}
              onSignUp={() => {
                setNotice('')
                showWaitlist(true)
              }}
            />
          }
        >
          <NotesSidebar {...sidebar} guide={guide} />
          <guide.Guide />
          <NoteWorkspace {...editor} />

          <ConfirmationDialog
            open={Boolean(noteToTrash() && noteToTrash() === open()?.id && showEditor())}
            onOpenChange={(isOpen) => {
              if (!isOpen) setNoteToTrash(undefined)
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              if (!showEditor()) return
              const toolbar = document.querySelector('.editor-pane:not([hidden]) .note-topbar')
              const trigger = toolbar?.querySelector<HTMLButtonElement>(
                '.note-more, button[aria-label="Move to trash"]',
              )
              trigger?.focus({ preventScroll: true })
            }}
            title="Move note to Trash?"
            description={
              <>
                <strong>{noteTitle(title())}</strong> can be restored from Trash.
              </>
            }
            confirmLabel="Move to Trash"
            onConfirm={() => {
              if (noteToTrash() !== open()?.id || !canEdit()) return
              setNoteToTrash(undefined)
              changeNoteState('deleted', true, 'Note moved to Trash')
            }}
          />
          <CreateMenu
            editorOpen={showEditor()}
            canCreateNote={canCreate()}
            canCreateFolder={canManageFolders()}
            onCreateNote={newNote}
            onCreateFolder={newFolder}
            onTriggerRef={setCreateTrigger}
          />
          <CreateFolderDialog
            open={folderForm() === 'create'}
            busy={folderBusy()}
            disabled={!canManageFolders()}
            error={folderError()}
            onSubmit={saveFolder}
            onEdit={() => setFolderError('')}
            onCancel={cancelFolderForm}
            onClose={restoreFolderDialogFocus}
          />
        </Show>
      </div>
    </>
  )
}
