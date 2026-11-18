import { TextInput } from './text-input'
import { Listbox } from '@kobalte/core/listbox'
import { Popover } from '@kobalte/core/popover'
import { Check, ChevronDown, FileText, Folder, FolderInput, Search } from 'lucide-solid'
import { createMemo, createSignal, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import type { Folder as NoteFolder } from '../../../../packages/contracts'

const noFolder = { id: 'no-folder', name: 'No folder' }

export function FolderPicker(props: {
  folders: NoteFolder[]
  selected: string | null | undefined
  disabled: boolean
  onSelect: (id: string | null) => void
}) {
  const [expanded, setExpanded] = createSignal(false)
  const [filter, setFilter] = createSignal('')
  let trigger: HTMLButtonElement | undefined
  const focusTrigger = () => requestAnimationFrame(() => trigger?.focus({ preventScroll: true }))
  const selectedId = () => props.selected ?? noFolder.id
  const currentName = () =>
    props.folders.find((folder) => folder.id === props.selected)?.name ??
    (props.selected ? 'Unavailable folder' : noFolder.name)
  const options = createMemo(() => {
    const query = filter().trim().toLocaleLowerCase()
    return [
      noFolder,
      ...props.folders.filter((folder) => folder.name.toLocaleLowerCase().includes(query)),
    ]
  })

  return (
    <Popover
      modal={false}
      placement="bottom-end"
      gutter={8}
      overflowPadding={12}
      fitViewport
      open={expanded() && !props.disabled}
      onOpenChange={(open) => {
        if (open) setFilter('')
        setExpanded(open)
      }}
    >
      <Popover.Trigger
        class="folder-picker-trigger"
        ref={(node) => {
          trigger = node
        }}
        aria-label="Move note to folder"
        title={currentName()}
        disabled={props.disabled}
      >
        <FolderInput size={16} aria-hidden="true" />
        <span>{currentName()}</span>
        <ChevronDown class="folder-picker-chevron" size={14} aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Content class="folder-picker-popover" onEscapeKeyDown={focusTrigger}>
        <Popover.Title class="folder-picker-heading">Move to folder</Popover.Title>
        <Show when={props.folders.length >= 7}>
          <label class="folder-picker-search">
            <Search size={15} aria-hidden="true" />
            <TextInput
              type="search"
              aria-label="Filter folders"
              placeholder="Find a folder…"
              value={filter()}
              onInput={(event) => setFilter(event.currentTarget.value)}
            />
          </label>
        </Show>
        <Listbox
          aria-label="Destination folder"
          class="picker-options"
          options={options()}
          value={[selectedId()]}
          optionValue="id"
          optionTextValue="name"
          selectionMode="single"
          selectOnFocus={false}
          allowDuplicateSelectionEvents
          onChange={(selection) => {
            const id = selection.values().next().value
            if (id === undefined || props.disabled) return
            if (id !== selectedId()) props.onSelect(id === noFolder.id ? null : id)
            setExpanded(false)
            focusTrigger()
          }}
          renderItem={(item) => (
            <Listbox.Item class="picker-option" item={item}>
              <Dynamic
                component={item.rawValue.id === noFolder.id ? FileText : Folder}
                size={16}
                aria-hidden="true"
              />
              <Listbox.ItemLabel as="span">{item.rawValue.name}</Listbox.ItemLabel>
              <Listbox.ItemIndicator>
                <Check size={15} aria-hidden="true" />
              </Listbox.ItemIndicator>
            </Listbox.Item>
          )}
        />
        <Show when={filter().trim() && options().length === 1}>
          <p class="folder-picker-empty">No matching folders</p>
        </Show>
      </Popover.Content>
    </Popover>
  )
}
