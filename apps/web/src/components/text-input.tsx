import { TextField } from '@kobalte/core/text-field'
import { splitProps, type JSX } from 'solid-js'

export function TextInput(
  props: Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onInput'> & {
    value?: string
    defaultValue?: string
    onInput?: JSX.EventHandler<HTMLInputElement, InputEvent>
  },
) {
  const [field, input] = splitProps(props, [
    'name',
    'required',
    'disabled',
    'value',
    'defaultValue',
    'readOnly',
  ])
  return (
    <TextField as="span" class="field-root" {...field}>
      <TextField.Input as="input" {...input} />
    </TextField>
  )
}
