import * as ContextMenu from '@kobalte/core/context-menu'
import { useMenuContext } from '@kobalte/core/menu'
import { Clipboard, Copy, Redo2, Scissors, Undo2 } from 'lucide-solid'
import { Editor } from '@tiptap/core'
import { For, createEffect, Show, type ParentProps } from 'solid-js'

import { clipboardAction, markdownClipboardAction } from './clipboard'
import { modifier, shortcutLabel, shortcuts } from './shortcuts'
import type { InlineTool } from './formatting'

type HistoryAction = 'undo' | 'redo'
const historyTools = [
  ['Undo', Undo2, 'undo'],
  ['Redo', Redo2, 'redo'],
] as const

const clipboardTools = [
  ['Copy', Copy, 'C', 'copy'],
  ['Paste', Clipboard, 'V', 'paste'],
  ['Cut', Scissors, 'X', 'cut'],
] as const

function EditorMenuTrigger(props: {
  ref: (element: HTMLDivElement) => void
  editable: boolean
  editor: () => Editor | undefined
  composition: (active: boolean) => void
}) {
  const menu = useMenuContext()

  createEffect(() => {
    if (!props.editable && menu.isOpen()) menu.close()
  })

  return (
    <ContextMenu.Trigger
      ref={props.ref}
      class="document"
      disabled={!props.editable}
      onPointerDown={(event) => {
        // Kobalte excludes the entire trigger from outside dismissal.
        if (event.button === 0 && menu.isOpen()) menu.close()
      }}
      onKeyDown={(event: KeyboardEvent & { currentTarget: HTMLDivElement }) => {
        if (
          !props.editable ||
          event.defaultPrevented ||
          event.isComposing ||
          (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10'))
        )
          return
        const editor = props.editor()
        if (!editor) return

        event.preventDefault()
        const caret = editor.view.coordsAtPos(editor.state.selection.head)
        event.currentTarget.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: caret.left,
            clientY: caret.bottom,
          }),
        )
      }}
      onCompositionStart={() => props.composition(true)}
      onCompositionEnd={() => props.composition(false)}
    />
  )
}

function EditorMenuContent(props: ParentProps<{ focusEditor: () => void }>) {
  const menu = useMenuContext()
  return (
    <ContextMenu.Content
      class="ui-menu editor-context-menu"
      aria-label="Edit note"
      onCloseAutoFocus={(event) => event.preventDefault()}
      onEscapeKeyDown={props.focusEditor}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key !== 'Tab') return
        event.preventDefault()
        menu.close()
        props.focusEditor()
      }}
    >
      {props.children}
    </ContextMenu.Content>
  )
}

export function EditorContextMenu(props: {
  ref: (element: HTMLDivElement) => void
  editable: boolean
  getEditor: () => Editor | undefined
  composition: (active: boolean) => void
  epoch: () => number
  inlineTools: InlineTool[]
}) {
  function canUseHistory(command: HistoryAction) {
    props.epoch()
    return props.getEditor()?.can()[command]() ?? false
  }

  return (
    <ContextMenu.Root modal={false}>
      <EditorMenuTrigger
        ref={props.ref}
        editor={props.getEditor}
        editable={props.editable}
        composition={props.composition}
      />
      <Show when={props.editable}>
        <ContextMenu.Portal>
          <EditorMenuContent focusEditor={() => props.getEditor()?.view.focus()}>
            <ContextMenu.Group class="editor-context-history" aria-label="Edit history">
              <For each={historyTools}>
                {([label, Icon, command]) => (
                  <ContextMenu.Item
                    class="ui-menu-item"
                    title={`${label} (${shortcutLabel(command === 'undo' ? 'Z' : 'Shift+Z')})`}
                    disabled={!canUseHistory(command)}
                    onSelect={() => {
                      const editor = props.getEditor()
                      if (editor?.isEditable) editor.chain().focus()[command]().run()
                    }}
                  >
                    <Icon size={16} aria-hidden="true" />
                    {label}
                  </ContextMenu.Item>
                )}
              </For>
            </ContextMenu.Group>
            <ContextMenu.Separator class="editor-context-separator" />
            <For each={clipboardTools}>
              {([label, Icon, keys, command]) => (
                <ContextMenu.Item
                  class="ui-menu-item"
                  title={`${label} (${shortcutLabel(keys)})`}
                  aria-keyshortcuts={`${modifier}+${keys}`}
                  disabled={
                    command !== 'paste' && (props.epoch(), props.getEditor()?.state.selection.empty)
                  }
                  onSelect={() => void clipboardAction(props.getEditor(), command)}
                >
                  <Icon size={16} aria-hidden="true" />
                  {label}
                  <kbd aria-hidden="true">{shortcutLabel(keys)}</kbd>
                </ContextMenu.Item>
              )}
            </For>
            <ContextMenu.Item
              class="ui-menu-item"
              title="Copy the selection or the whole note as Markdown"
              onSelect={() => void markdownClipboardAction(props.getEditor(), 'copy')}
            >
              <Copy size={16} aria-hidden="true" />
              Copy as Markdown
            </ContextMenu.Item>
            <ContextMenu.Item
              class="ui-menu-item"
              title="Paste and format Markdown from the clipboard"
              onSelect={() => void markdownClipboardAction(props.getEditor(), 'paste')}
            >
              <Clipboard size={16} aria-hidden="true" />
              Paste as Markdown
            </ContextMenu.Item>
            <ContextMenu.Separator class="editor-context-separator" />
            <For each={props.inlineTools}>
              {([label, Icon, mark, action]) => (
                <ContextMenu.Item
                  class="ui-menu-item"
                  data-active={(props.epoch(), props.getEditor()?.isActive(mark)) ? '' : undefined}
                  title={`${label} (${shortcutLabel(shortcuts[label])})`}
                  aria-keyshortcuts={`${modifier}+${shortcuts[label]}`}
                  aria-haspopup={mark === 'link' ? 'dialog' : undefined}
                  onSelect={() => {
                    const editor = props.getEditor()
                    if (editor?.isEditable) action(editor)
                  }}
                >
                  <Icon size={16} aria-hidden="true" />
                  {label}
                  <kbd aria-hidden="true">{shortcutLabel(shortcuts[label])}</kbd>
                </ContextMenu.Item>
              )}
            </For>
          </EditorMenuContent>
        </ContextMenu.Portal>
      </Show>
    </ContextMenu.Root>
  )
}
