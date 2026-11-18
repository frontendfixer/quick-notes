export function registerAppWorker(onUpdate: () => void) {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return

  const serviceWorker = navigator.serviceWorker
  const listeners = new AbortController()
  let controller = serviceWorker.controller
  let registration: ServiceWorkerRegistration | undefined
  let checking = false

  serviceWorker.addEventListener(
    'controllerchange',
    () => {
      if (controller && serviceWorker.controller !== controller) onUpdate()
      controller = serviceWorker.controller
    },
    { signal: listeners.signal },
  )

  const registered = serviceWorker
    .register(import.meta.env.BASE_URL + 'sw.js', {
      updateViaCache: 'none',
    })
    .then((result) => {
      if (listeners.signal.aborted) return
      registration = result
      const checkWaiting = () => {
        if (serviceWorker.controller && result.waiting) onUpdate()
      }
      const watchInstall = () => {
        result.installing?.addEventListener('statechange', checkWaiting, {
          signal: listeners.signal,
        })
      }
      result.addEventListener('updatefound', watchInstall, { signal: listeners.signal })
      watchInstall()
      checkWaiting()
    })
    .catch((error) => {
      console.warn('Quick Notes service worker registration failed', error)
    })

  return {
    async check() {
      if (!registration || checking || !navigator.onLine || document.visibilityState !== 'visible')
        return

      checking = true
      try {
        await registration.update()
      } catch {
        // The app may have lost connectivity since the check started.
      } finally {
        checking = false
      }
    },
    async activate() {
      await registered
      const waiting = registration?.waiting
      if (!waiting || serviceWorker.controller === waiting) return
      await new Promise<void>((resolve, reject) => {
        const timeout = AbortSignal.timeout(15000)
        const activation = new AbortController()
        const signal = AbortSignal.any([timeout, listeners.signal, activation.signal])
        serviceWorker.addEventListener(
          'controllerchange',
          () => {
            if (serviceWorker.controller === waiting) {
              activation.abort()
              resolve()
            }
          },
          { signal },
        )
        timeout.addEventListener('abort', () => reject(timeout.reason), { signal })
        waiting.postMessage({ type: 'SKIP_WAITING' })
      })
    },
    dispose() {
      listeners.abort()
    },
  }
}
