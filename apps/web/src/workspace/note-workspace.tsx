import { TextField } from '@kobalte/core/text-field'
import { Collapsible } from '@kobalte/core/collapsible'
import { Alert } from '@kobalte/core/alert'
import { Button } from '@kobalte/core/button'
import { ChevronDown, CircleAlert, Download, LockKeyhole, Plus, RefreshCw } from 'lucide-solid'
import { Show, Suspense } from 'solid-js'
import { plainText } from '../../../../packages/contracts'
import { CollectionPreviewPrompt, EmptyCollection } from '../components/folder-views'
import { NoteToolbar } from '../components/note-toolbar'
import { ConfirmationDialog } from '../components/confirmation-dialog'

import { RichEditor, type Workspace } from '../workspace'
import { noteTitle } from '../note-title'
import { Reauthentication } from './reauthentication'

type Props = Workspace['editor']

export function NoteWorkspace(props: Props) {
  const {
    activeDraft,
    backToNotes,
    canCreate,
    canDeletePermanently,
    canEdit,
    changeNoteState,
    changeView,
    collectionIsEmpty,
    collectionKind,
    deletePermanently,
    deletingNote,
    exportDrafts,
    exportPdf,
    exportingPdf,
    fields,
    flushEdits,
    folderBusy,
    folders,
    manualRefresh,
    mustSignIn,
    newNote,
    notice,
    open,
    ready,
    record,
    refresh,
    resolveConflict,
    saveLabel,
    saveProblem,
    saveText,
    setDocumentReader,
    setNoteToTrash,
    setTitle,
    showEditor,
    signIn,
    signingIn,
    signingOut,
    status,
    title,
    unavailable,
    updateNote,
    upload,
    view,
    writable,
  } = props

  return (
    <main classList={{ workspace: true, 'mobile-hidden': !showEditor() }}>
      <Show when={mustSignIn() && showEditor()}>
        <Reauthentication signIn={signIn} signingIn={signingIn} />
      </Show>
      <Show when={!writable() && ready()}>
        <p class="message">
          <LockKeyhole size={16} />
          Editing is available in one tab at a time.
        </p>
      </Show>
      <Show when={notice()}>
        <Alert as="p" class="message inline-error">
          <CircleAlert size={16} />
          {notice()}
        </Alert>
      </Show>
      <Show when={!showEditor() || !open()}>
        <Show
          when={!collectionIsEmpty()}
          fallback={
            <EmptyCollection
              kind={collectionKind()}
              onBack={() => changeView('active')}
              offline={unavailable() || mustSignIn()}
              canCreate={canCreate()}
              onCreate={newNote}
            />
          }
        >
          <Show
            when={view() === 'active'}
            fallback={<CollectionPreviewPrompt kind={view() === 'trash' ? 'trash' : 'archived'} />}
          >
            <section class="empty">
              <div class="empty-icon">
                <span class="note-logo note-logo-large" aria-hidden="true" />
              </div>
              <h1>Select a note</h1>
              <p>Choose a note from the sidebar.</p>
              <Button class="secondary" onClick={newNote} disabled={!canCreate()}>
                <Plus size={16} />
                Create a note
              </Button>
            </section>
          </Show>
        </Show>
      </Show>
      <Show when={open()} keyed>
        {(note) => (
          <div class="editor-pane" hidden={!showEditor()}>
            <NoteToolbar
              visible={showEditor()}
              fields={fields()}
              folders={folders()}
              canEdit={canEdit()}
              canRestore={
                writable() &&
                !signingOut() &&
                !folderBusy() &&
                !activeDraft()?.purge &&
                deletingNote() !== note.id
              }
              canDeletePermanently={canDeletePermanently()}
              refreshing={manualRefresh() || deletingNote() === note.id}
              exportingPdf={exportingPdf()}
              onPrint={() => void exportPdf('print')}
              onDownloadPdf={() => void exportPdf('download')}
              onRefresh={() => void refresh(true)}
              onDeletePermanently={() => void deletePermanently()}
              title={noteTitle(title())}
              hasSavedNote={note.base !== null || Boolean(activeDraft())}
              saveState={saveText()}
              saveLabel={saveLabel()}
              saveProblem={saveProblem()}
              offline={unavailable() || mustSignIn()}
              onBack={() => backToNotes()}
              onMove={(folderId) =>
                updateNote(
                  { folderId },
                  folderId ? 'Note moved to folder' : 'Note removed from folder',
                )
              }
              onPin={() =>
                updateNote(
                  { pinned: !fields().pinned },
                  fields().pinned ? 'Note unpinned' : 'Note pinned',
                )
              }
              onArchive={() =>
                changeNoteState(
                  'archived',
                  !fields().archived,
                  fields().archived ? 'Note unarchived' : 'Note archived',
                )
              }
              onTrash={() => setNoteToTrash(note.id)}
              onRestore={() =>
                changeNoteState(
                  'deleted',
                  false,
                  fields().archived ? 'Note restored to Archive' : 'Note restored to Notes',
                )
              }
            />
            <article class="note">
              <Show when={status() === 'Save failed' && !activeDraft()?.error}>
                <div class="note-recovery">
                  <Button
                    class="secondary"
                    title="Retry saving this note"
                    onClick={() => void flushEdits().then(() => upload())}
                  >
                    <RefreshCw size={16} aria-hidden="true" />
                    Retry save
                  </Button>
                  <Button class="secondary" title="Download all drafts" onClick={exportDrafts}>
                    <Download size={16} aria-hidden="true" />
                    Download all drafts
                  </Button>
                </div>
              </Show>
              <Show when={activeDraft()?.error}>
                <section class="conflict" aria-label="Save rejected">
                  <h2>
                    <CircleAlert size={16} /> Save rejected
                  </h2>
                  <Alert as="p">{activeDraft()?.error}</Alert>
                  <p>
                    Your draft is saved on this device. If its folder is unavailable, choose a
                    different folder or No folder.
                  </p>
                  <div class="conflict-actions">
                    <Button
                      class="secondary"
                      title="Retry saving this note"
                      disabled={!canEdit() || unavailable() || mustSignIn()}
                      onClick={() => {
                        record()
                        void flushEdits().then(() => upload())
                      }}
                    >
                      Retry save
                    </Button>
                    <Button class="secondary" title="Download all drafts" onClick={exportDrafts}>
                      Download all drafts
                    </Button>
                  </div>
                </section>
              </Show>
              <Show when={activeDraft()?.conflict}>
                {(conflict) => (
                  <section class="conflict">
                    <h2>
                      <CircleAlert size={19} />
                      This note changed on another device
                    </h2>
                    <p>Your draft is open below. Keep both to save it as a separate note.</p>
                    <Collapsible>
                      <Collapsible.Trigger
                        class="conflict-compare-trigger"
                        title="Compare with synced version"
                      >
                        Compare with synced version
                        <ChevronDown size={14} aria-hidden="true" />
                      </Collapsible.Trigger>
                      <Collapsible.Content>
                        <div class="conflict-comparison">
                          <section>
                            <h3>Your draft</h3>
                            <pre>
                              {noteTitle(title()) +
                                '\n' +
                                plainText(activeDraft()?.fields.document ?? note.fields.document)}
                            </pre>
                          </section>
                          <section>
                            <h3>Synced version</h3>
                            <pre>
                              {conflict().current
                                ? noteTitle(conflict().current!.title) +
                                  '\n' +
                                  describe(conflict().current!.document)
                                : 'No server version'}
                            </pre>
                          </section>
                        </div>
                      </Collapsible.Content>
                    </Collapsible>
                    <div class="conflict-actions">
                      <Button
                        class="secondary"
                        title="Keep both versions as separate notes"
                        disabled={!writable()}
                        onClick={() => void resolveConflict(true)}
                      >
                        Keep both
                      </Button>
                      <ConfirmationDialog
                        trigger="Replace synced version"
                        triggerClass="secondary"
                        disabled={!writable() || !conflict().current}
                        title="Replace synced version?"
                        description="This will replace the synced version of this note with your draft."
                        confirmLabel="Replace synced version"
                        onConfirm={() => void resolveConflict(false)}
                      />
                      <Button class="secondary" title="Download all drafts" onClick={exportDrafts}>
                        <Download size={16} />
                        Download all drafts
                      </Button>
                    </div>
                  </section>
                )}
              </Show>
              <TextField class="field-root" value={title()} readOnly={!canEdit()}>
                <TextField.TextArea
                  class="note-title"
                  rows={1}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' || event.isComposing) return
                    event.preventDefault()
                    event.currentTarget
                      .closest('article')
                      ?.querySelector<HTMLElement>('.tiptap')
                      ?.focus()
                  }}
                  aria-label="Note title"
                  placeholder="Untitled"
                  maxlength="200"
                  onCompositionStart={() => {
                    note.composing = true
                  }}
                  onCompositionEnd={() => {
                    note.composing = false
                  }}
                  onInput={(event) => {
                    const value = event.currentTarget.value.replace(/[\r\n]+/g, ' ')
                    event.currentTarget.value = value
                    setTitle(value)
                    record()
                  }}
                />
              </TextField>
              <Suspense fallback={<div class="editor-loading" aria-label="Opening editor" />}>
                <RichEditor
                  initial={note.fields.document}
                  editable={canEdit}
                  changed={setDocumentReader}
                  composition={(active) => {
                    note.composing = active
                  }}
                />
              </Suspense>
            </article>
          </div>
        )}
      </Show>
    </main>
  )
}

function describe(node: { text?: string; content?: unknown[]; type: string }): string {
  if (node.text) return node.text
  return (
    node.content
      ?.map((child) => describe(child as typeof node))
      .join(['paragraph', 'heading'].includes(node.type) ? '' : '\n') ?? ''
  )
}
