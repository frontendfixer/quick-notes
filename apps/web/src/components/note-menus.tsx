import { DropdownMenu } from '@kobalte/core/dropdown-menu'
import {
  Archive,
  BookOpen,
  ArrowDownAZ,
  ArrowDownWideNarrow,
  Check,
  ChevronDown,
  Clock,
  FileDown,
  LogOut,
  Trash2,
  UserRound,
} from 'lucide-solid'
import { For, Show } from 'solid-js'
import { writingGuideTitle } from './writing-guide'
import type { View } from '../../../../packages/contracts'

const accountViews = [
  ['archived', 'Archive', Archive],
  ['trash', 'Trash', Trash2],
] as const

const sortOptions = [
  { value: 'updated', label: 'Last edited', icon: Clock },
  { value: 'title', label: 'Title A–Z', icon: ArrowDownAZ },
] as const

export type NoteSort = (typeof sortOptions)[number]['value']

export function focusOpenedMenu(open: boolean, content: () => HTMLElement | undefined) {
  if (!open) return
  requestAnimationFrame(() => {
    const menu = content()
    const focused = document.activeElement
    if (!menu?.isConnected || !menu.hasAttribute('data-expanded')) return
    if (focused !== menu && focused?.getAttribute('aria-controls') !== menu.id) return
    menu
      .querySelector<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])')
      ?.focus({ preventScroll: true })
  })
}

export function AccountMenu(props: {
  view: View
  onView: (view: View) => void
  onGuide: () => void
  hasDrafts: boolean
  onDownloadDrafts: () => void
  canSignOut: boolean
  onSignOut: () => void
  triggerRef: (button: HTMLButtonElement) => void
}) {
  let content: HTMLDivElement | undefined
  let trigger: HTMLButtonElement | undefined
  return (
    <DropdownMenu
      modal={false}
      placement="bottom-end"
      gutter={8}
      onOpenChange={(open) => focusOpenedMenu(open, () => content)}
    >
      <DropdownMenu.Trigger
        class="account-trigger"
        aria-label="Account options"
        ref={(node) => {
          trigger = node
          props.triggerRef(node)
        }}
      >
        <UserRound size={18} aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content
        class="ui-menu account-popover"
        onEscapeKeyDown={() => requestAnimationFrame(() => trigger?.focus({ preventScroll: true }))}
        ref={(node) => {
          content = node
        }}
      >
        <For each={accountViews}>
          {([view, title, Icon]) => (
            <DropdownMenu.Item
              class="ui-menu-item"
              aria-current={props.view === view ? 'page' : undefined}
              onSelect={() => props.onView(view)}
            >
              <Icon size={16} aria-hidden="true" />
              {title}
            </DropdownMenu.Item>
          )}
        </For>
        <DropdownMenu.Item class="ui-menu-item" onSelect={props.onGuide}>
          <BookOpen size={16} aria-hidden="true" />
          {writingGuideTitle}
        </DropdownMenu.Item>
        <Show when={props.hasDrafts}>
          <DropdownMenu.Item class="ui-menu-item" onSelect={props.onDownloadDrafts}>
            <FileDown size={16} aria-hidden="true" />
            Download drafts
          </DropdownMenu.Item>
        </Show>
        <DropdownMenu.Item
          class="ui-menu-item sign-out"
          onSelect={props.onSignOut}
          disabled={!props.canSignOut}
        >
          <LogOut size={16} aria-hidden="true" />
          Sign out
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu>
  )
}

export function SortMenu(props: {
  value: NoteSort
  onChange: (sort: NoteSort) => void
  mount: HTMLElement | undefined
}) {
  let content: HTMLDivElement | undefined
  let trigger: HTMLButtonElement | undefined
  const label = () => (props.value === 'title' ? sortOptions[1].label : sortOptions[0].label)

  return (
    <DropdownMenu
      modal={false}
      placement="bottom-end"
      gutter={6}
      onOpenChange={(open) => focusOpenedMenu(open, () => content)}
    >
      <DropdownMenu.Trigger
        class="sort-trigger"
        aria-label="Sort notes"
        aria-description={label()}
        ref={(node) => {
          trigger = node
        }}
      >
        <ArrowDownWideNarrow size={16} aria-hidden="true" />
        <span>{label()}</span>
        <ChevronDown class="sort-chevron" size={14} aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal mount={props.mount}>
        <DropdownMenu.Content
          class="ui-menu sort-popover"
          onEscapeKeyDown={() =>
            requestAnimationFrame(() => trigger?.focus({ preventScroll: true }))
          }
          ref={(node) => {
            content = node
          }}
        >
          <DropdownMenu.RadioGroup
            value={props.value}
            onChange={(value) => {
              const option = sortOptions.find((option) => option.value === value)
              if (option) props.onChange(option.value)
            }}
          >
            <For each={sortOptions}>
              {(option) => (
                <DropdownMenu.RadioItem
                  class="ui-menu-item sort-option"
                  value={option.value}
                  closeOnSelect
                >
                  <option.icon size={16} aria-hidden="true" />
                  <span>{option.label}</span>
                  <DropdownMenu.ItemIndicator>
                    <Check size={15} aria-hidden="true" />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              )}
            </For>
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}
