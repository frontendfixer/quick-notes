import { Ellipsis, Type, X } from 'lucide-solid'
import { animate } from 'motion/mini'
import {
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  Show,
  splitProps,
  untrack,
  type JSX,
} from 'solid-js'

function AnimatedPanel(
  props: JSX.HTMLAttributes<HTMLDivElement> & { open: boolean; rise?: boolean },
) {
  const [local, attrs] = splitProps(props, ['open', 'rise'])
  let panel!: HTMLDivElement
  const [visible, setVisible] = createSignal(false)
  createEffect(() => {
    const open = local.open
    if (!open && !untrack(visible)) return
    const offset = local.rise ? 'translateY(7px)' : 'translateX(7px)'
    if (open) setVisible(true)
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const animation = animate(
      panel,
      { opacity: open ? 1 : 0, transform: open ? 'translate(0px, 0px)' : offset },
      { duration: reduced ? 0 : open ? 0.16 : 0.12, ease: [0.22, 1, 0.36, 1] },
    )
    let superseded = false
    if (!open) {
      void animation.then(() => {
        if (!superseded) setVisible(false)
      })
    }
    onCleanup(() => {
      superseded = true
      animation.stop()
    })
  })
  return (
    <div
      {...attrs}
      ref={(node) => {
        panel = node
      }}
      inert={!local.open}
      aria-hidden={!local.open}
      data-visible={visible() ? '' : undefined}
    />
  )
}

export default function FormattingDock(props: {
  toolCount: number
  tools: (start: () => number, end: () => number) => JSX.Element
}) {
  const [open, setOpen] = createSignal(false)
  const [more, setMore] = createSignal(false)
  const [fitting, setFitting] = createSignal(5)
  const [bottom, setBottom] = createSignal(0)
  const [availableHeight, setAvailableHeight] = createSignal(300)
  let dock!: HTMLDivElement
  let toggle!: HTMLButtonElement
  let moreButton: HTMLButtonElement | undefined

  function close() {
    setMore(false)
    setOpen(false)
  }

  onMount(() => {
    const viewport = window.visualViewport
    const workspace = dock.closest('main')
    const measure = () => {
      const width = Math.min(viewport?.width ?? innerWidth, workspace?.clientWidth || innerWidth)
      // Trigger, More, side gutters and panel padding consume the reserved width.
      setFitting(Math.min(9, Math.max(1, Math.floor((width - 162) / 43))))
      const height = viewport?.height ?? innerHeight
      setAvailableHeight(Math.max(76, height - 112))
      setBottom(Math.max(0, Math.round(innerHeight - height - (viewport?.offsetTop ?? 0))))
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !open()) return
      const fromDock = dock.contains(document.activeElement)
      if (more()) {
        setMore(false)
        if (fromDock) moreButton?.focus()
      } else {
        close()
        if (fromDock) toggle.focus()
      }
    }
    const outside = (event: PointerEvent) => {
      if (!event.composedPath().includes(dock)) close()
    }
    const observer = new ResizeObserver(measure)
    if (workspace) observer.observe(workspace)
    viewport?.addEventListener('resize', measure)
    viewport?.addEventListener('scroll', measure)
    window.addEventListener('resize', measure)
    document.addEventListener('keydown', escape)
    document.addEventListener('pointerdown', outside)
    measure()
    onCleanup(() => {
      observer.disconnect()
      viewport?.removeEventListener('resize', measure)
      viewport?.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
      document.removeEventListener('keydown', escape)
      document.removeEventListener('pointerdown', outside)
    })
  })

  return (
    <div
      class="format-dock"
      ref={(node) => {
        dock = node
      }}
      style={{ '--dock-keyboard': `${bottom()}px`, '--dock-height': `${availableHeight()}px` }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <button
        type="button"
        ref={(node) => {
          toggle = node
        }}
        class="format-trigger"
        aria-label={open() ? 'Close formatting' : 'Open formatting'}
        aria-expanded={open()}
        aria-controls="note-format-tools"
        title={open() ? 'Close formatting' : 'Open formatting'}
        onClick={() => (open() ? close() : setOpen(true))}
      >
        <Show when={open()} fallback={<Type size={22} />}>
          <X size={21} />
        </Show>
      </button>
      <AnimatedPanel
        id="note-format-tools"
        class="format-panel"
        role="group"
        aria-label="Formatting"
        open={open()}
      >
        {props.tools(() => 0, fitting)}
        <Show when={fitting() < props.toolCount}>
          <button
            type="button"
            ref={(node) => {
              moreButton = node
            }}
            aria-label="More formatting"
            aria-expanded={more()}
            aria-controls="note-format-overflow"
            title="More formatting"
            onClick={() => setMore(!more())}
          >
            <Ellipsis size={21} />
          </button>
        </Show>
      </AnimatedPanel>
      <AnimatedPanel
        id="note-format-overflow"
        class="format-panel format-overflow"
        role="group"
        aria-label="More formatting tools"
        open={open() && more()}
        rise
      >
        {props.tools(fitting, () => props.toolCount)}
      </AnimatedPanel>
    </div>
  )
}
