export const shortcuts = {
  Bold: 'B',
  Italic: 'I',
  Underline: 'U',
  Bullets: 'Shift+8',
  Checklist: 'Shift+9',
  Strikethrough: 'Shift+S',
  'Heading 1': 'Alt+1',
  'Heading 2': 'Alt+2',
  'Heading 3': 'Alt+3',
  'Numbered list': 'Shift+7',
  Highlight: 'Shift+H',
  Quote: 'Shift+B',
  'Inline code': 'E',
  'Code block': 'Alt+C',
  Divider: 'Alt+Shift+D',
  Link: 'Shift+K',
} as const

export const modifier = /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? 'Meta' : 'Control'
export const shortcutLabel = (keys: string) => `${modifier === 'Meta' ? 'Cmd' : 'Ctrl'}+${keys}`
