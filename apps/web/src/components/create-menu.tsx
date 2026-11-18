import { DropdownMenu } from '@kobalte/core/dropdown-menu'
import { FilePlus, FolderPlus, Plus } from 'lucide-solid'
import { focusOpenedMenu } from './note-menus'

const onMac = navigator.platform.includes('Mac')

export const createShortcuts = {
  note: { code: 'KeyN', key: 'N' },
  folder: { code: 'KeyF', key: 'F' },
} as const

export function CreateMenu(props: {
  editorOpen: boolean
  canCreateNote: boolean
  canCreateFolder: boolean
  onCreateNote: () => void
  onCreateFolder: () => void
  onTriggerRef: (button: HTMLButtonElement) => void
}) {
  const prefix = onMac ? '⌘ ⌥' : 'Ctrl Alt'
  const modifier = onMac ? 'Meta' : 'Control'
  let content: HTMLDivElement | undefined
  let trigger: HTMLButtonElement | undefined
  let nextAction: (() => void) | undefined

  return (
    <div class="create-actions" data-editor={props.editorOpen ? '' : undefined}>
      <DropdownMenu
        modal={false}
        placement="top-end"
        gutter={10}
        onOpenChange={(open) => {
          focusOpenedMenu(open, () => content)
          if (!open && nextAction) {
            const action = nextAction
            nextAction = undefined
            requestAnimationFrame(action)
          }
        }}
      >
        <DropdownMenu.Trigger
          class="primary create-trigger"
          ref={(node) => {
            trigger = node
            props.onTriggerRef(node)
          }}
          aria-label="Create menu"
          disabled={!props.canCreateFolder && !props.canCreateNote}
        >
          <Plus size={26} aria-hidden="true" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            class="ui-menu create-popover"
            aria-label="Create"
            ref={(node) => {
              content = node
            }}
            onEscapeKeyDown={() =>
              requestAnimationFrame(() => trigger?.focus({ preventScroll: true }))
            }
          >
            <DropdownMenu.Item
              class="ui-menu-item create-option"
              disabled={!props.canCreateFolder}
              aria-keyshortcuts={modifier + '+Alt+' + createShortcuts.folder.key}
              onSelect={() => {
                nextAction = props.onCreateFolder
              }}
            >
              <FolderPlus size={18} aria-hidden="true" />
              <span>Create Folder</span>
              <kbd aria-hidden="true">
                {prefix} {createShortcuts.folder.key}
              </kbd>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              class="ui-menu-item create-option"
              disabled={!props.canCreateNote}
              aria-keyshortcuts={modifier + '+Alt+' + createShortcuts.note.key}
              onSelect={() => {
                nextAction = props.onCreateNote
              }}
            >
              <FilePlus size={18} aria-hidden="true" />
              <span>Create Note</span>
              <kbd aria-hidden="true">
                {prefix} {createShortcuts.note.key}
              </kbd>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </div>
  )
}
